import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "./schema";
import {
  acceptInvitation,
  createMemberInvitationStore,
  getInvitationContext,
  hashInvitationToken,
  type MemberInvitationDependencies,
} from "../server/member-invitations";

const enabled = process.env.INVITATION_AUTH_RLS_TEST === "1";
const describeRls = enabled ? describe : describe.skip;
const adminUrl = enabled ? assertLocalCiDatabase(process.env.DATABASE_URL) : undefined;
const suffix = `${process.pid}-${Date.now()}`;
const runtimeRole = `invitation_runtime_${process.pid}`;
const runtimePassword = `invitation-runtime-${process.pid}`;
const orgA = `invitation-org-a-${suffix}`;
const orgB = `invitation-org-b-${suffix}`;
const userA = `invitation-user-a-${suffix}`;
const userB = `invitation-user-b-${suffix}`;
const userC = `invitation-user-c-${suffix}`;
const userD = `invitation-user-d-${suffix}`;
const tokens = {
  live: `live-${suffix}`,
  expired: `expired-${suffix}`,
  revoked: `revoked-${suffix}`,
  concurrent: `concurrent-${suffix}`,
  otherOrg: `other-org-${suffix}`,
  atomic: `atomic-${suffix}`,
};

let admin: Sql | undefined;
let runtimePool: Pool | undefined;
let dependencies: MemberInvitationDependencies | undefined;

describeRls("invitation authentication bootstrap under the runtime role", () => {
  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1 });
    await admin.unsafe(`create role ${quoteIdentifier(runtimeRole)} login password '${runtimePassword}' nosuperuser nobypassrls`);
    await admin.unsafe(`grant usage on schema "label_suite" to ${quoteIdentifier(runtimeRole)}`);
    await admin.unsafe(`grant select, update on "label_suite"."org_invitations" to ${quoteIdentifier(runtimeRole)}`);
    await admin.unsafe(`grant select, insert on "label_suite"."org_memberships" to ${quoteIdentifier(runtimeRole)}`);
    await admin.unsafe(`grant select on "label_suite"."user" to ${quoteIdentifier(runtimeRole)}`);
    await admin.unsafe(`grant insert on "label_suite"."audit_logs" to ${quoteIdentifier(runtimeRole)}`);
    await seedFixtures(admin);

    runtimePool = new Pool({ connectionString: runtimeDatabaseUrl(adminUrl!, runtimeRole, runtimePassword), max: 4 });
    const database = drizzle(runtimePool, { schema });
    dependencies = {
      store: createMemberInvitationStore(database),
      sendInvitationEmail: async () => ({ messageId: "unused", status: "sent" }),
      now: () => new Date("2026-08-13T08:00:00.000Z"),
      randomBytes: () => Buffer.alloc(32, 1),
      randomUUID,
    };
  });

  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (!admin) return;
    await admin`delete from "label_suite"."audit_logs" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."org_memberships" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."org_invitations" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."user" where "id" in (${userA}, ${userB}, ${userC}, ${userD})`;
    await admin`delete from "label_suite"."orgs" where "id" in (${orgA}, ${orgB})`;
    await admin.unsafe(`drop owned by ${quoteIdentifier(runtimeRole)}`);
    await admin.unsafe(`drop role if exists ${quoteIdentifier(runtimeRole)}`);
    await admin.end();
  });

  it("reveals only the exact live invitation and clears bootstrap state after the transaction", async () => {
    await expect(getInvitationContext(tokens.live, dependencies!)).resolves.toEqual({ email: `${userA}@example.test` });
    await expect(getInvitationContext("invalid-token", dependencies!)).rejects.toMatchObject({ code: "INVITATION_INVALID" });

    const client = await runtimePool!.connect();
    try {
      const result = await client.query(`select id from "label_suite"."org_invitations"`);
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("derives the tenant from the token and accepts atomically", async () => {
    await expect(acceptInvitation({
      token: tokens.live,
      userId: userA,
      userEmail: `${userA}@example.test`,
    }, dependencies!)).resolves.toMatchObject({ orgId: orgA, role: "member" });

    const memberships = await admin!<{ org_id: string; user_id: string }[]>`
      select org_id, user_id from "label_suite"."org_memberships" where user_id = ${userA}
    `;
    expect(memberships).toEqual([{ org_id: orgA, user_id: userA }]);
    const audits = await admin!<{ action: string; actor_user_id: string }[]>`
      select action, actor_user_id from "label_suite"."audit_logs"
      where org_id = ${orgA} and entity_id = ${`invitation-live-${suffix}`}
    `;
    expect(audits).toEqual([{ action: "invitation.accepted", actor_user_id: userA }]);
    await expect(getInvitationContext(tokens.live, dependencies!)).rejects.toMatchObject({ code: "INVITATION_INVALID" });

    await expect(acceptInvitation({
      token: tokens.live, userId: userA, userEmail: `${userA}@example.test`,
    }, dependencies!)).resolves.toMatchObject({ orgId: orgA, role: "member", alreadyAccepted: true });
    await expect(acceptInvitation({
      token: tokens.live, userId: userC, userEmail: `${userA}@example.test`,
    }, dependencies!)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
  });

  it("rejects expired and revoked tokens without creating memberships", async () => {
    await expect(acceptInvitation({
      token: tokens.expired, userId: userB, userEmail: `${userB}@example.test`,
    }, dependencies!)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
    await expect(acceptInvitation({
      token: tokens.revoked, userId: userB, userEmail: `${userB}@example.test`,
    }, dependencies!)).rejects.toMatchObject({ code: "INVITATION_INVALID" });
    const memberships = await admin!`select id from "label_suite"."org_memberships" where user_id = ${userB} and org_id = ${orgA}`;
    expect(memberships).toEqual([]);
  });

  it("uses the token organization even when another tenant context was previously selected", async () => {
    const isolatedPool = new Pool({ connectionString: runtimeDatabaseUrl(adminUrl!, runtimeRole, runtimePassword), max: 1 });
    const isolatedDatabase = drizzle(isolatedPool, { schema });
    const isolatedDependencies = { ...dependencies!, store: createMemberInvitationStore(isolatedDatabase) };
    const client = await isolatedPool.connect();
    try {
      await client.query("select set_config('app.current_org_id', $1, false)", [orgA]);
    } finally {
      client.release();
    }
    try {
      await expect(acceptInvitation({
        token: tokens.otherOrg, userId: userB, userEmail: `${userB}@example.test`,
      }, isolatedDependencies)).resolves.toMatchObject({ orgId: orgB, alreadyAccepted: false });
    } finally {
      await isolatedPool.end();
    }
    const memberships = await admin!`select org_id from "label_suite"."org_memberships" where user_id = ${userB}`;
    expect(memberships).toEqual([{ org_id: orgB }]);
  });

  it("serializes concurrent acceptance so exactly one membership is created", async () => {
    const input = { token: tokens.concurrent, userId: userC, userEmail: `${userC}@example.test` };
    const outcomes = await Promise.allSettled([
      acceptInvitation(input, dependencies!),
      acceptInvitation(input, dependencies!),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
    expect(outcomes.map((outcome) => outcome.status === "fulfilled" && outcome.value.alreadyAccepted).sort()).toEqual([false, true]);
    const memberships = await admin!`select id from "label_suite"."org_memberships" where user_id = ${userC}`;
    expect(memberships).toHaveLength(1);
  });

  it("rolls back membership and invitation consumption when audit persistence fails", async () => {
    await expect(acceptInvitation({
      token: tokens.atomic, userId: userD, userEmail: "wrong-recipient@example.test",
    }, dependencies!)).rejects.toMatchObject({
      code: "INVITATION_INVALID",
      message: "Invitation is invalid or expired",
    });
    const baseStore = dependencies!.store;
    const failingDependencies: MemberInvitationDependencies = {
      ...dependencies!,
      store: {
        ...baseStore,
        transaction: (callback) => baseStore.transaction((tx) => callback({
          ...tx,
          insertAuditLog: async () => { throw new Error("controlled audit failure"); },
        })),
      },
    };
    await expect(acceptInvitation({
      token: tokens.atomic, userId: userD, userEmail: `${userD}@example.test`,
    }, failingDependencies)).rejects.toThrow("controlled audit failure");
    const memberships = await admin!`select id from "label_suite"."org_memberships" where user_id = ${userD}`;
    expect(memberships).toEqual([]);
    const invitations = await admin!<{ status: string }[]>`
      select status from "label_suite"."org_invitations" where id = ${`invitation-atomic-${suffix}`}
    `;
    expect(invitations).toEqual([{ status: "pending" }]);
  });

  it("does not let one bootstrap digest reveal another organization", async () => {
    const client = await runtimePool!.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.current_invitation_token_digest', $1, true)", [hashInvitationToken(tokens.concurrent)]);
      const hidden = await client.query(
        `select id from "label_suite"."org_invitations" where org_id = $1`,
        [orgB],
      );
      expect(hidden.rows).toEqual([]);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});

async function seedFixtures(client: Sql): Promise<void> {
  await client`
    insert into "label_suite"."orgs" ("id", "name", "slug") values
      (${orgA}, 'Invitation RLS org A', ${orgA}),
      (${orgB}, 'Invitation RLS org B', ${orgB})
  `;
  await client`
    insert into "label_suite"."user" ("id", "name", "email", "emailVerified") values
      (${userA}, 'Invitation user A', ${`${userA}@example.test`}, true),
      (${userB}, 'Invitation user B', ${`${userB}@example.test`}, true),
      (${userC}, 'Invitation user C', ${`${userC}@example.test`}, true),
      (${userD}, 'Invitation user D', ${`${userD}@example.test`}, true)
  `;
  await insertInvitation(client, "live", orgA, userA, tokens.live, "pending", "2026-08-20T08:00:00.000Z", null);
  await insertInvitation(client, "expired", orgA, userB, tokens.expired, "pending", "2026-08-12T08:00:00.000Z", null);
  await insertInvitation(client, "revoked", orgA, userB, tokens.revoked, "revoked", "2026-08-20T08:00:00.000Z", "2026-08-12T08:00:00.000Z");
  await insertInvitation(client, "concurrent", orgA, userC, tokens.concurrent, "pending", "2026-08-20T08:00:00.000Z", null);
  await insertInvitation(client, "other-org", orgB, userB, tokens.otherOrg, "pending", "2026-08-20T08:00:00.000Z", null);
  await insertInvitation(client, "atomic", orgA, userD, tokens.atomic, "pending", "2026-08-20T08:00:00.000Z", null);
}

async function insertInvitation(
  client: Sql,
  label: string,
  orgId: string,
  userId: string,
  token: string,
  status: string,
  expiresAt: string,
  revokedAt: string | null,
): Promise<void> {
  await client`
    insert into "label_suite"."org_invitations" (
      "id", "org_id", "email", "normalized_email", "role", "token_digest", "status",
      "expires_at", "revoked_at", "created_at", "updated_at"
    ) values (
      ${`invitation-${label}-${suffix}`}, ${orgId}, ${`${userId}@example.test`}, ${`${userId}@example.test`},
      'member', ${hashInvitationToken(token)}, ${status}, ${expiresAt}, ${revokedAt},
      '2026-08-12T08:00:00.000Z', '2026-08-12T08:00:00.000Z'
    )
  `;
}

function runtimeDatabaseUrl(value: string, username: string, password: string): string {
  const target = new URL(value);
  target.username = username;
  target.password = password;
  return target.toString();
}

function assertLocalCiDatabase(value: string | undefined): string {
  let target: URL;
  try {
    target = new URL(value ?? "");
  } catch {
    throw new Error("Refusing invitation RLS test target: DATABASE_URL must be a valid local PostgreSQL URL.");
  }
  let database: string;
  try {
    database = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  } catch {
    throw new Error("Refusing invitation RLS test target: DATABASE_URL must be a valid local PostgreSQL URL.");
  }
  if (
    !["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "database"].includes(target.hostname)
    || database !== "label_suite"
    || target.search
    || target.hash
  ) {
    throw new Error("Refusing invitation RLS test target: require the exact local label_suite CI database.");
  }
  return target.toString();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
