import { Buffer } from "node:buffer";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { local_tool_tokens, org_memberships } from "../db/schema";
import {
  LOCAL_TOOL_SCOPES,
  localToolScopeSchema,
  type LocalToolScope,
} from "../lib/campaign-enrichment-local-tool-contract";
import { HttpError } from "./errors";
import {
  boundedLocalToolDurationMs,
  recordLocalToolOperation,
  type LocalToolOperationEvent,
} from "./local-tool-audit";
import { LocalToolError } from "./local-tools-api";
import type { MembershipRole } from "./tenant";
import type { DatabaseRequestContext } from "../lib/database-request-context";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
const TOKEN_PATTERN = /^lsmcp_([A-Za-z0-9-]+)_([A-Za-z0-9_-]{43})$/;
const SECRET_HASH_PATTERN = /^[a-f0-9]{64}$/;

export const createLocalToolTokenSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(localToolScopeSchema).min(1).max(LOCAL_TOOL_SCOPES.length)
    .refine((scopes) => new Set(scopes).size === scopes.length, "Scopes must be unique"),
  expires_in_days: z.number().int().min(1).max(30).default(30),
}).strict();

type CreateLocalToolTokenSchemaInput = z.input<typeof createLocalToolTokenSchema>;

export type CreateLocalToolTokenInput = Omit<CreateLocalToolTokenSchemaInput, "scopes"> & {
  scopes: readonly LocalToolScope[];
};

export type LocalToolTokenRow = {
  id: string;
  org_id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  secret_hash: string;
  scopes: LocalToolScope[];
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type LocalToolTokenRecord = Omit<LocalToolTokenRow, "secret_hash">;

export type LocalToolPrincipal = {
  tokenId: string;
  orgId: string;
  userId: string;
  scopes: readonly LocalToolScope[];
};

export type LocalToolTokenStore = {
  insert(row: LocalToolTokenRow): Promise<LocalToolTokenRow>;
  list(orgId: string): Promise<LocalToolTokenRow[]>;
  findById(id: string): Promise<LocalToolTokenRow | null>;
  findMembership(orgId: string, userId: string): Promise<{ role: string } | null>;
  revoke(orgId: string, id: string, revokedAt: Date): Promise<LocalToolTokenRow | null>;
  touchLastUsed(orgId: string, id: string, usedAt: Date): Promise<void>;
};

export type LocalToolTokenDependencies = {
  store: LocalToolTokenStore;
  now: () => Date;
  randomUUID: () => string;
  randomBytes: (size: number) => Buffer;
  hasCapability: (role: MembershipRole, capability: "operations.mutate") => boolean | Promise<boolean>;
  runWithDatabaseContext<TResult>(
    context: DatabaseRequestContext,
    operation: () => Promise<TResult>,
  ): Promise<TResult>;
};

export type LocalToolAuthenticationAuditContext = {
  requestId: string;
  tool: LocalToolOperationEvent["tool"];
  startedAt: number;
  record?: typeof recordLocalToolOperation;
};

export async function createLocalToolToken(
  orgId: string,
  userId: string,
  input: CreateLocalToolTokenInput,
  dependencies: LocalToolTokenDependencies = defaultDependencies,
): Promise<{ token: string; record: LocalToolTokenRecord }> {
  const parsed = createLocalToolTokenSchema.parse(input);
  const now = dependencies.now();
  const tokenId = dependencies.randomUUID();
  if (!/^[A-Za-z0-9-]+$/.test(tokenId)) throw new Error("Token ID contains unsupported characters");

  const secret = dependencies.randomBytes(32).toString("base64url");
  const token = `lsmcp_${tokenId}_${secret}`;
  const row: LocalToolTokenRow = {
    id: tokenId,
    org_id: orgId,
    user_id: userId,
    name: parsed.name,
    token_prefix: `lsmcp_${tokenId}`,
    secret_hash: sha256Hex(token),
    scopes: [...parsed.scopes],
    expires_at: new Date(now.getTime() + parsed.expires_in_days * DAY_IN_MILLISECONDS),
    revoked_at: null,
    last_used_at: null,
    created_at: now,
    updated_at: now,
  };
  const inserted = await dependencies.store.insert(row);
  return { token, record: toSafeRecord(inserted) };
}

export async function listLocalToolTokens(
  orgId: string,
  dependencies: LocalToolTokenDependencies = defaultDependencies,
): Promise<LocalToolTokenRecord[]> {
  return (await dependencies.store.list(orgId)).map(toSafeRecord);
}

export async function revokeLocalToolToken(
  orgId: string,
  tokenId: string,
  dependencies: LocalToolTokenDependencies = defaultDependencies,
): Promise<LocalToolTokenRecord> {
  const row = await dependencies.store.revoke(orgId, tokenId, dependencies.now());
  if (!row) throw new HttpError("Local tool token not found", 404);
  return toSafeRecord(row);
}

export async function authenticateLocalToolRequest(
  request: Request,
  requiredScope: LocalToolScope,
  dependencies: LocalToolTokenDependencies = defaultDependencies,
  auditContext?: LocalToolAuthenticationAuditContext,
): Promise<LocalToolPrincipal> {
  return runAuthenticatedLocalToolRequest(
    request,
    requiredScope,
    async (principal) => principal,
    dependencies,
    auditContext,
  );
}

export async function runAuthenticatedLocalToolRequest<TResult>(
  request: Request,
  requiredScope: LocalToolScope,
  operation: (principal: LocalToolPrincipal) => Promise<TResult>,
  dependencies: LocalToolTokenDependencies = defaultDependencies,
  auditContext?: LocalToolAuthenticationAuditContext,
): Promise<TResult> {
  let identity: (Pick<LocalToolTokenRow, "id"> & Partial<Pick<LocalToolTokenRow, "org_id" | "user_id">>) | undefined;
  try {
    const rawToken = parseBearerToken(request.headers.get("authorization"));
    const tokenId = parseTokenId(rawToken);
    identity = { id: tokenId };
    const row = await dependencies.runWithDatabaseContext(
      { userId: "", localToolTokenId: tokenId },
      () => dependencies.store.findById(tokenId),
    );
    const now = dependencies.now();

    if (!row) throw new LocalToolError("authentication_failed");

    if (
      !hashMatches(rawToken, row.secret_hash)
      || row.revoked_at !== null
      || row.expires_at.getTime() <= now.getTime()
    ) {
      throw new LocalToolError("authentication_failed");
    }
    const parsedScopes = z.array(localToolScopeSchema).safeParse(row.scopes);
    if (!parsedScopes.success) throw new LocalToolError("authentication_failed");
    if (!parsedScopes.data.includes(requiredScope)) throw new LocalToolError("scope_forbidden");

    const membership = await dependencies.runWithDatabaseContext(
      { userId: row.user_id },
      () => dependencies.store.findMembership(row.org_id, row.user_id),
    );
    if (
      !membership
      || !isMembershipRole(membership.role)
      || !await dependencies.hasCapability(membership.role, "operations.mutate")
    ) {
      throw new LocalToolError("authentication_failed");
    }

    identity = row;
    return dependencies.runWithDatabaseContext(
      { userId: row.user_id, orgId: row.org_id },
      async () => {
        try {
          await dependencies.store.touchLastUsed(row.org_id, row.id, now);
        } catch (error) {
          await recordAuthenticationFailure(auditContext, dependencies.now(), "internal_error", identity);
          throw error;
        }
        return operation({
          tokenId: row.id,
          orgId: row.org_id,
          userId: row.user_id,
          scopes: [...parsedScopes.data],
        });
      },
    );
  } catch (error) {
    if (identity?.org_id) throw error;
    const resultCategory = error instanceof LocalToolError
      && (error.code === "authentication_failed" || error.code === "scope_forbidden")
      ? error.code
      : "internal_error";
    await recordAuthenticationFailure(
      auditContext,
      dependencies.now(),
      resultCategory,
      identity,
    );
    throw error;
  }
}

async function recordAuthenticationFailure(
  context: LocalToolAuthenticationAuditContext | undefined,
  now: Date,
  resultCategory: "authentication_failed" | "scope_forbidden" | "internal_error",
  identity?: Pick<LocalToolTokenRow, "id"> & Partial<Pick<LocalToolTokenRow, "org_id" | "user_id">>,
): Promise<void> {
  if (!context) return;
  try {
    await (context.record ?? recordLocalToolOperation)({
      requestId: context.requestId,
      ...(identity?.id ? { tokenId: identity.id } : {}),
      ...(identity?.org_id ? { orgId: identity.org_id } : {}),
      ...(identity?.user_id ? { userId: identity.user_id } : {}),
      tool: context.tool,
      operation: "authenticate",
      resultCategory,
      durationMs: boundedLocalToolDurationMs(context.startedAt, now.getTime()),
      proposalCount: 0,
    });
  } catch {
    // An audit sink must never replace the fixed authentication envelope.
  }
}

function parseBearerToken(authorization: string | null): string {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match) throw new LocalToolError("authentication_failed");
  return match[1];
}

function parseTokenId(rawToken: string): string {
  const match = rawToken.match(TOKEN_PATTERN);
  if (!match) throw new LocalToolError("authentication_failed");
  return match[1];
}

function hashMatches(rawToken: string, storedHash: string): boolean {
  const actual = createHash("sha256").update(rawToken).digest();
  if (!SECRET_HASH_PATTERN.test(storedHash)) return false;
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSafeRecord(row: LocalToolTokenRow): LocalToolTokenRecord {
  const { secret_hash: _secretHash, ...record } = row;
  return { ...record, scopes: [...record.scopes] };
}

function isMembershipRole(role: string): role is MembershipRole {
  return role === "owner"
    || role === "operator"
    || role === "fundraiser"
    || role === "member"
    || role === "payee";
}

const drizzleStore: LocalToolTokenStore = {
  async insert(row) {
    const { db } = await import("../lib/db");
    const [inserted] = await db.insert(local_tool_tokens).values(row).returning();
    if (!inserted) throw new Error("Local tool token insert returned no record");
    return inserted;
  },
  async list(orgId) {
    const { db } = await import("../lib/db");
    return db.select().from(local_tool_tokens)
      .where(eq(local_tool_tokens.org_id, orgId))
      .orderBy(desc(local_tool_tokens.created_at), desc(local_tool_tokens.id));
  },
  async findById(id) {
    const { db } = await import("../lib/db");
    return (await db.select().from(local_tool_tokens)
      .where(eq(local_tool_tokens.id, id)).limit(1))[0] ?? null;
  },
  async findMembership(orgId, userId) {
    const { db } = await import("../lib/db");
    return (await db.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId))).limit(1))[0] ?? null;
  },
  async revoke(orgId, id, revokedAt) {
    const { db } = await import("../lib/db");
    return db.transaction(async (tx) => {
      const existing = (await tx.select().from(local_tool_tokens)
        .where(and(eq(local_tool_tokens.org_id, orgId), eq(local_tool_tokens.id, id))).limit(1))[0];
      if (!existing || existing.revoked_at) return existing ?? null;

      const updated = (await tx.update(local_tool_tokens)
        .set({ revoked_at: revokedAt, updated_at: revokedAt })
        .where(and(
          eq(local_tool_tokens.org_id, orgId),
          eq(local_tool_tokens.id, id),
          isNull(local_tool_tokens.revoked_at),
        ))
        .returning())[0];
      if (updated) return updated;
      return (await tx.select().from(local_tool_tokens)
        .where(and(eq(local_tool_tokens.org_id, orgId), eq(local_tool_tokens.id, id))).limit(1))[0] ?? null;
    });
  },
  async touchLastUsed(orgId, id, usedAt) {
    const { db } = await import("../lib/db");
    await db.update(local_tool_tokens)
      .set({ last_used_at: usedAt, updated_at: usedAt })
      .where(and(eq(local_tool_tokens.org_id, orgId), eq(local_tool_tokens.id, id)));
  },
};

const defaultDependencies: LocalToolTokenDependencies = {
  store: drizzleStore,
  now: () => new Date(),
  randomUUID,
  randomBytes,
  hasCapability: async (role, capability) => {
    const { hasCapability } = await import("./tenant");
    return hasCapability(role, capability);
  },
  runWithDatabaseContext: async (context, operation) => {
    const { runWithDatabaseContext } = await import("../lib/db");
    return runWithDatabaseContext(context, operation);
  },
};
