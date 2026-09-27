import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL);
const describeNativeAuth = enabled ? describe : describe.skip;
const adminUrl = enabled ? assertLocalCiDatabase(process.env.DATABASE_URL) : undefined;
const suffix = randomUUID();
const orgA = `native-auth-org-a-${suffix}`;
const orgB = `native-auth-org-b-${suffix}`;
const userA = `native-auth-user-a-${suffix}`;
const userB = `native-auth-user-b-${suffix}`;
const liveToken = randomUUID();
const expiredToken = randomUUID();
const revokeToken = randomUUID();
const liveSession = `native-auth-session-live-${suffix}`;
const expiredSession = `native-auth-session-expired-${suffix}`;
const revokeSession = `native-auth-session-revoke-${suffix}`;

let admin: Sql | undefined;
let getNativeSession: typeof import("../lib/native-session").getNativeSession;
let listUserMemberships: typeof import("../server/tenant").listUserMemberships;
let resolveExistingMembership: typeof import("../server/tenant").resolveExistingMembership;
let runWithDatabaseContext: typeof import("../lib/db").runWithDatabaseContext;
let nativeSessionGET: typeof import("../pages/api/native/session").GET;
let nativeSessionPOST: typeof import("../pages/api/native/session").POST;
let nativeSignOutPOST: typeof import("../pages/api/native/sign-out").POST;

describeNativeAuth("native authentication against request-scoped membership data", () => {
  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1 });
    [
      { getNativeSession },
      { listUserMemberships, resolveExistingMembership },
      { runWithDatabaseContext },
      { GET: nativeSessionGET, POST: nativeSessionPOST },
      { POST: nativeSignOutPOST },
    ] = await Promise.all([
      import("../lib/native-session"),
      import("../server/tenant"),
      import("../lib/db"),
      import("../pages/api/native/session"),
      import("../pages/api/native/sign-out"),
    ]);
    await seedFixtures(admin);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from "label_suite"."session" where "id" in (${liveSession}, ${expiredSession}, ${revokeSession})`;
    await admin`delete from "label_suite"."org_memberships" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."user" where "id" in (${userA}, ${userB})`;
    await admin`delete from "label_suite"."orgs" where "id" in (${orgA}, ${orgB})`;
    await admin.end();
  });

  it("rejects expired and revoked sessions through the native route", async () => {
    const expired = await runWithDatabaseContext({ userId: userA, orgId: orgA }, async () => nativeSessionGET({
      request: new Request("https://example.test/api/native/session", { headers: { Authorization: `Bearer ${expiredToken}` } }),
    } as never));
    expect(expired.status).toBe(401);

    const beforeRevoke = await getNativeSession(revokeToken);
    expect(beforeRevoke?.user.id).toBe(userA);
    const revoked = await runWithDatabaseContext({ userId: userA, orgId: orgA }, async () => nativeSignOutPOST({
      request: new Request("https://example.test/api/native/sign-out", { method: "POST", headers: { Authorization: `Bearer ${revokeToken}` } }),
    } as never));
    expect(revoked.status).toBe(204);
    await expect(getNativeSession(revokeToken)).resolves.toBeNull();
    const revokedRoute = await runWithDatabaseContext({ userId: userA, orgId: orgA }, async () => nativeSessionGET({
      request: new Request("https://example.test/api/native/session", { headers: { Authorization: `Bearer ${revokeToken}` } }),
    } as never));
    expect(revokedRoute.status).toBe(401);
  });

  it("projects only the requesting user's workspaces and derives role capabilities", async () => {
    const listedA = await runWithDatabaseContext({ userId: userA, orgId: orgA }, async () => nativeSessionGET({
      request: new Request("https://example.test/api/native/session", { headers: { Authorization: `Bearer ${liveToken}` } }),
    } as never));
    expect(listedA.status).toBe(200);
    const bodyA = await listedA.json();
    expect(bodyA.workspaces.map((workspace: { org: { id: string } }) => workspace.org.id)).toEqual([orgA]);
    expect(bodyA.workspaces[0].role).toBe("operator");
    expect(bodyA.workspaces[0].capabilities["operations.mutate"]).toBe(true);

    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => resolveExistingMembership(userA, orgB))).resolves.toBeNull();
    const selectedOtherOrg = await runWithDatabaseContext({ userId: userA, orgId: orgA }, async () => nativeSessionPOST({
      request: new Request("https://example.test/api/native/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${liveToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: orgB }),
      }),
    } as never));
    expect(selectedOtherOrg.status).toBe(403);

    const listedB = await runWithDatabaseContext({ userId: userB, orgId: orgB }, () => listUserMemberships(userB));
    expect(listedB).toHaveLength(1);
    expect(listedB[0]).toMatchObject({ org: { id: orgB }, role: "member" });
  });
});

async function seedFixtures(client: Sql | undefined): Promise<void> {
  if (!client) throw new Error("Native auth integration database is unavailable");
  await client`
    insert into "label_suite"."orgs" ("id", "name", "slug") values
      (${orgA}, 'Native auth org A', ${orgA}),
      (${orgB}, 'Native auth org B', ${orgB})
  `;
  await client`
    insert into "label_suite"."user" ("id", "name", "email", "emailVerified") values
      (${userA}, 'Native auth user A', ${`${userA}@example.test`}, true),
      (${userB}, 'Native auth user B', ${`${userB}@example.test`}, true)
  `;
  await client`
    insert into "label_suite"."org_memberships" ("id", "org_id", "user_id", "role") values
      (${`${orgA}:${userA}`}, ${orgA}, ${userA}, 'operator'),
      (${`${orgB}:${userB}`}, ${orgB}, ${userB}, 'member')
  `;
  await client`
    insert into "label_suite"."session" ("id", "expiresAt", "token", "userId") values
      (${liveSession}, now() + interval '1 hour', ${liveToken}, ${userA}),
      (${expiredSession}, now() - interval '1 hour', ${expiredToken}, ${userA}),
      (${revokeSession}, now() + interval '1 hour', ${revokeToken}, ${userA})
  `;
}

function assertLocalCiDatabase(value: string | undefined): string {
  let target: URL;
  try { target = new URL(value ?? ""); }
  catch { throw new Error("Refusing native auth RLS test target: DATABASE_URL must be a valid local PostgreSQL URL."); }
  const database = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "database"].includes(target.hostname)
    || database !== "label_suite" || target.search || target.hash) {
    throw new Error("Refusing native auth RLS test target: require the exact local label_suite CI database.");
  }
  return target.toString();
}
