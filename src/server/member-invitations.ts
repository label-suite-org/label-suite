import { createHash, randomBytes as nodeRandomBytes, randomUUID as nodeRandomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { org_invitations, org_memberships } from "../db/schema";
import { users } from "../db/auth-schema";
import { db } from "../lib/db";
import { type SendEmailResult, sendWorkspaceInvitationEmail } from "./email";
import { type AuditLogInput, type AuditLogWriter, writeAuditLog } from "./audit";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import type { MembershipRole } from "./tenant";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_INVITATION_MESSAGE = "Invitation is invalid or expired";
const INVITABLE_ROLES = ["operator", "fundraiser", "member", "payee"] as const;
type InvitableRole = typeof INVITABLE_ROLES[number];

export interface InvitationRecord {
  id: string;
  orgId: string;
  email: string;
  normalizedEmail: string;
  role: MembershipRole;
  tokenDigest: string | null;
  status: string;
  invitedByUserId: string | null;
  acceptedByUserId: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  lastSentAt: Date | null;
  createdAt: Date;
}

export interface WorkspaceMemberRecord {
  membershipId: string;
  orgId: string;
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: Date;
}

export interface InvitationUpdateExpectation {
  status?: string;
  tokenDigest?: string | null;
}

export interface InvitationTransaction extends AuditLogWriter {
  findMemberByEmail(orgId: string, normalizedEmail: string): Promise<WorkspaceMemberRecord | null>;
  findMemberByUserId(orgId: string, userId: string): Promise<WorkspaceMemberRecord | null>;
  countOwners(orgId: string): Promise<number>;
  findPendingInvitation(orgId: string, normalizedEmail: string): Promise<InvitationRecord | null>;
  findInvitationById(orgId: string, invitationId: string): Promise<InvitationRecord | null>;
  adoptInvitationBootstrap(tokenDigest: string): Promise<void>;
  findInvitationByDigest(tokenDigest: string): Promise<InvitationRecord | null>;
  adoptInvitationContext(orgId: string, userId?: string): Promise<void>;
  findInvitationByDigestForUpdate(tokenDigest: string): Promise<InvitationRecord | null>;
  insertInvitation(invitation: InvitationRecord): Promise<void>;
  updateInvitation(
    invitationId: string,
    changes: Partial<InvitationRecord>,
    expectation?: InvitationUpdateExpectation,
  ): Promise<boolean>;
  insertMembership(member: WorkspaceMemberRecord): Promise<boolean>;
  updateMembershipRole(orgId: string, userId: string, role: MembershipRole): Promise<boolean>;
  deleteMembership(orgId: string, userId: string): Promise<boolean>;
  listMembers(orgId: string): Promise<WorkspaceMemberRecord[]>;
  listInvitations(orgId: string): Promise<InvitationRecord[]>;
}

export interface MemberInvitationStore {
  transaction<T>(callback: (transaction: InvitationTransaction) => Promise<T>): Promise<T>;
  listMembers(orgId: string): Promise<WorkspaceMemberRecord[]>;
  listInvitations(orgId: string): Promise<InvitationRecord[]>;
}

export interface MemberInvitationDependencies {
  store: MemberInvitationStore;
  sendInvitationEmail: typeof sendWorkspaceInvitationEmail;
  now: () => Date;
  randomBytes: (size: number) => Buffer;
  randomUUID: () => string;
}

export interface CreateInvitationInput {
  orgId: string;
  email: string;
  role: InvitableRole;
  invitedByUserId: string;
  inviterName: string;
  workspaceName: string;
  acceptBaseUrl: string;
  requestId?: string | null;
}

export interface ResendInvitationInput {
  orgId: string;
  invitationId: string;
  actorUserId: string;
  inviterName: string;
  workspaceName: string;
  acceptBaseUrl: string;
  requestId?: string | null;
}

export interface RevokeInvitationInput {
  orgId: string;
  invitationId: string;
  actorUserId: string;
  requestId?: string | null;
}

export interface AcceptInvitationInput {
  token: string;
  userId: string;
  userEmail: string;
  requestId?: string | null;
}

export interface ChangeMemberRoleInput {
  orgId: string;
  userId: string;
  role: InvitableRole;
  actorUserId: string;
  requestId?: string | null;
}

export interface RemoveMemberInput {
  orgId: string;
  userId: string;
  actorUserId: string;
  requestId?: string | null;
}

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashInvitationToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function createInvitation(
  input: CreateInvitationInput,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  const normalizedEmail = requireEmail(input.email);
  const role = requireInvitableRole(input.role);
  const now = dependencies.now();
  const rawToken = dependencies.randomBytes(32).toString("base64url");
  const invitation: InvitationRecord = {
    id: dependencies.randomUUID(),
    orgId: input.orgId,
    email: normalizedEmail,
    normalizedEmail,
    role,
    tokenDigest: hashInvitationToken(rawToken),
    status: "pending",
    invitedByUserId: input.invitedByUserId,
    acceptedByUserId: null,
    expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    revokedAt: null,
    lastSentAt: now,
    createdAt: now,
  };

  try {
    await dependencies.store.transaction(async (tx) => {
      if (await tx.findMemberByEmail(input.orgId, normalizedEmail)) {
        throw new ConflictError("This person is already a workspace member");
      }
      if (await tx.findPendingInvitation(input.orgId, normalizedEmail)) {
        throw new ConflictError("A pending invitation already exists for this email");
      }
      await tx.insertInvitation(invitation);
      await audit(tx, dependencies, {
        orgId: input.orgId,
        actorUserId: input.invitedByUserId,
        requestId: input.requestId,
        action: "invitation.created",
        entityType: "org_invitation",
        entityId: invitation.id,
        afterData: { email: normalizedEmail, role },
      });
    });
  } catch (error) {
    if (isPendingInvitationUniqueViolation(error)) {
      throw new ConflictError("A pending invitation already exists for this email");
    }
    throw error;
  }

  const delivery = await deliverInvitation(dependencies, {
    toEmail: normalizedEmail,
    inviterName: input.inviterName,
    workspaceName: input.workspaceName,
    acceptUrl: invitationUrl(input.acceptBaseUrl, rawToken),
  });

  return { invitation: publicInvitation(invitation), delivery };
}

export async function resendInvitation(
  input: ResendInvitationInput,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  const now = dependencies.now();
  const rawToken = dependencies.randomBytes(32).toString("base64url");
  const tokenDigest = hashInvitationToken(rawToken);
  const invitation = await dependencies.store.transaction(async (tx) => {
    const existing = await tx.findInvitationById(input.orgId, input.invitationId);
    if (!existing || existing.status !== "pending" || !existing.tokenDigest) throw invalidInvitation();

    const changed = await tx.updateInvitation(existing.id, {
      tokenDigest,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      lastSentAt: now,
    }, { status: "pending", tokenDigest: existing.tokenDigest });
    if (!changed) throw invalidInvitation();
    await audit(tx, dependencies, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "invitation.resent",
      entityType: "org_invitation",
      entityId: existing.id,
      metadata: { email: existing.normalizedEmail },
    });
    return { ...existing, tokenDigest, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), lastSentAt: now };
  });

  const delivery = await deliverInvitation(dependencies, {
    toEmail: invitation.normalizedEmail,
    inviterName: input.inviterName,
    workspaceName: input.workspaceName,
    acceptUrl: invitationUrl(input.acceptBaseUrl, rawToken),
  });
  return { invitation: publicInvitation(invitation), delivery };
}

export async function revokeInvitation(
  input: RevokeInvitationInput,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  return dependencies.store.transaction(async (tx) => {
    const existing = await tx.findInvitationById(input.orgId, input.invitationId);
    if (!existing || existing.status !== "pending") throw invalidInvitation();
    const now = dependencies.now();
    const changed = await tx.updateInvitation(existing.id, {
      status: "revoked",
      revokedAt: now,
      tokenDigest: null,
    }, { status: "pending" });
    if (!changed) throw invalidInvitation();
    await audit(tx, dependencies, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "invitation.revoked",
      entityType: "org_invitation",
      entityId: existing.id,
      beforeData: { status: "pending" },
      afterData: { status: "revoked" },
      metadata: { email: existing.normalizedEmail },
    });
    return { ok: true };
  });
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  const tokenDigest = hashInvitationToken(input.token);
  return dependencies.store.transaction(async (tx) => {
    await tx.adoptInvitationBootstrap(tokenDigest);
    const bootstrapInvitation = await tx.findInvitationByDigest(tokenDigest);
    requireRecognizedInvitation(bootstrapInvitation);
    if (bootstrapInvitation.status === "pending") requirePendingInvitation(bootstrapInvitation, input, dependencies);
    await tx.adoptInvitationContext(bootstrapInvitation.orgId, input.userId);
    const invitation = await tx.findInvitationByDigestForUpdate(tokenDigest);
    requireRecognizedInvitation(invitation);
    if (invitation.status === "pending") requirePendingInvitation(invitation, input, dependencies);
    if (invitation.id !== bootstrapInvitation.id || invitation.orgId !== bootstrapInvitation.orgId) throw invalidInvitation();

    if (invitation.status === "accepted") {
      if (invitation.acceptedByUserId !== input.userId) throw invalidInvitation();
      const membership = await tx.findMemberByUserId(invitation.orgId, input.userId);
      if (!membership) throw invalidInvitation();
      return { orgId: invitation.orgId, role: membership.role, alreadyAccepted: true };
    }
    if (invitation.status !== "pending" || invitation.expiresAt.getTime() <= dependencies.now().getTime()) {
      throw invalidInvitation();
    }

    const now = dependencies.now();
    const membership: WorkspaceMemberRecord = {
      membershipId: dependencies.randomUUID(),
      orgId: invitation.orgId,
      userId: input.userId,
      name: "",
      email: normalizeInvitationEmail(input.userEmail),
      role: invitation.role,
      joinedAt: now,
    };
    if (!await tx.insertMembership(membership)) throw invalidInvitation();
    if (!await tx.updateInvitation(invitation.id, {
      status: "accepted",
      acceptedByUserId: input.userId,
      acceptedAt: now,
    }, { status: "pending", tokenDigest })) throw invalidInvitation();
    await audit(tx, dependencies, {
      orgId: invitation.orgId,
      actorUserId: input.userId,
      requestId: input.requestId,
      action: "invitation.accepted",
      entityType: "org_invitation",
      entityId: invitation.id,
      beforeData: { status: "pending" },
      afterData: { status: "accepted", userId: input.userId, role: invitation.role },
    });
    return { orgId: invitation.orgId, role: invitation.role, alreadyAccepted: false };
  });
}

export async function getInvitationContext(
  token: string,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  const digest = hashInvitationToken(token);
  return dependencies.store.transaction(async (tx) => {
    await tx.adoptInvitationBootstrap(digest);
    const invitation = await tx.findInvitationByDigest(digest);
    if (!invitation || invitation.status !== "pending" || !invitation.tokenDigest
      || invitation.expiresAt.getTime() <= dependencies.now().getTime()) {
      throw invalidInvitation();
    }
    return { email: invitation.normalizedEmail };
  });
}

function requireRecognizedInvitation(
  invitation: InvitationRecord | null,
): asserts invitation is InvitationRecord {
  if (!invitation || !invitation.tokenDigest || !["pending", "accepted"].includes(invitation.status)) {
    throw invalidInvitation();
  }
}

function requirePendingInvitation(
  invitation: InvitationRecord,
  input: AcceptInvitationInput,
  dependencies: MemberInvitationDependencies,
): void {
  if (invitation.expiresAt.getTime() <= dependencies.now().getTime()) throw invalidInvitation();
  if (normalizeInvitationEmail(input.userEmail) !== invitation.normalizedEmail) {
    throw invalidInvitation();
  }
  if (!INVITABLE_ROLES.includes(invitation.role as InvitableRole)) throw invalidInvitation();
}

export async function listWorkspaceMembers(
  orgId: string,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  return dependencies.store.listMembers(orgId);
}

export async function listWorkspaceInvitations(
  orgId: string,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  return (await dependencies.store.listInvitations(orgId)).map(publicInvitation);
}

export async function changeMemberRole(
  input: ChangeMemberRoleInput,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  const role = requireInvitableRole(input.role);
  return dependencies.store.transaction(async (tx) => {
    const existing = await tx.findMemberByUserId(input.orgId, input.userId);
    if (!existing) throw new NotFoundError("Workspace member not found");
    if (existing.role === "owner" && await tx.countOwners(input.orgId) <= 1) {
      throw new ConflictError("The last workspace owner cannot be demoted");
    }
    const previousRole = existing.role;
    if (!await tx.updateMembershipRole(input.orgId, input.userId, role)) throw new NotFoundError("Workspace member not found");
    await audit(tx, dependencies, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "member.role_changed",
      entityType: "org_membership",
      entityId: existing.membershipId,
      beforeData: { role: previousRole },
      afterData: { role },
      metadata: { targetUserId: input.userId },
    });
    return { ok: true, role };
  });
}

export async function removeMember(
  input: RemoveMemberInput,
  dependencies: MemberInvitationDependencies = defaultDependencies,
) {
  return dependencies.store.transaction(async (tx) => {
    const existing = await tx.findMemberByUserId(input.orgId, input.userId);
    if (!existing) throw new NotFoundError("Workspace member not found");
    if (existing.role === "owner" && await tx.countOwners(input.orgId) <= 1) {
      throw new ConflictError("The last workspace owner cannot be removed");
    }
    if (!await tx.deleteMembership(input.orgId, input.userId)) throw new NotFoundError("Workspace member not found");
    await audit(tx, dependencies, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      action: "member.removed",
      entityType: "org_membership",
      entityId: existing.membershipId,
      beforeData: { role: existing.role, userId: input.userId },
    });
    return { ok: true };
  });
}

function requireEmail(email: string): string {
  const normalized = normalizeInvitationEmail(email);
  if (!normalized || !normalized.includes("@")) throw new HttpError("A valid email address is required", 400);
  return normalized;
}

function requireInvitableRole(role: string): InvitableRole {
  if (!INVITABLE_ROLES.includes(role as InvitableRole)) throw new HttpError("Role cannot be invited or assigned", 400);
  return role as InvitableRole;
}

function invitationUrl(baseUrl: string, rawToken: string): string {
  return `${baseUrl.replace(/\/$/, "")}#${encodeURIComponent(rawToken)}`;
}

async function deliverInvitation(
  dependencies: MemberInvitationDependencies,
  input: Parameters<typeof sendWorkspaceInvitationEmail>[0],
): Promise<SendEmailResult> {
  let delivery: SendEmailResult;
  try {
    delivery = await dependencies.sendInvitationEmail(input);
  } catch {
    throw new HttpError("Invitation was created, but the email could not be delivered", 502);
  }
  if (delivery.status === "failed") {
    throw new HttpError("Invitation was created, but the email could not be delivered", 502);
  }
  return delivery;
}

async function audit(
  tx: InvitationTransaction,
  dependencies: MemberInvitationDependencies,
  input: AuditLogInput,
) {
  await writeAuditLog({ ...input, id: dependencies.randomUUID() }, tx);
}

function publicInvitation(invitation: InvitationRecord) {
  const { tokenDigest: _tokenDigest, ...safe } = invitation;
  return safe;
}

function invalidInvitation(): HttpError {
  return new HttpError(INVALID_INVITATION_MESSAGE, 400, "INVITATION_INVALID");
}

function isPendingInvitationUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 3 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === "org_invitations_pending_email_unique_idx") return true;
    current = candidate.cause;
  }
  return false;
}

type DrizzleExecutor = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;
type DrizzleDatabase = DrizzleExecutor & Pick<typeof db, "transaction">;

function toInvitation(row: typeof org_invitations.$inferSelect): InvitationRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    email: row.email,
    normalizedEmail: row.normalized_email,
    role: row.role as MembershipRole,
    tokenDigest: row.token_digest,
    status: row.status,
    invitedByUserId: row.invited_by_user_id,
    acceptedByUserId: row.accepted_by_user_id,
    expiresAt: invitationDate(row.expires_at, "expires_at") ?? new Date(0),
    acceptedAt: invitationDate(row.accepted_at, "accepted_at"),
    revokedAt: invitationDate(row.revoked_at, "revoked_at"),
    lastSentAt: invitationDate(row.last_sent_at, "last_sent_at"),
    createdAt: invitationDate(row.created_at, "created_at") ?? new Date(0),
  };
}

function invitationDate(value: unknown, field: string): Date | null {
  if (value == null) return null;
  const serialized = typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value}+0000`
    : value;
  const date = serialized instanceof Date ? serialized : new Date(serialized as string | number);
  if (Number.isNaN(date.getTime())) throw new Error(`Invitation row has invalid ${field}`);
  return date;
}

function toMember(row: {
  membershipId: string; orgId: string; userId: string; name: string; email: string; role: string; joinedAt: Date | null;
}): WorkspaceMemberRecord {
  return { ...row, role: row.role as MembershipRole, joinedAt: row.joinedAt ?? new Date(0) };
}

async function selectMembers(executor: DrizzleExecutor, orgId: string): Promise<WorkspaceMemberRecord[]> {
  const rows = await executor.select({
    membershipId: org_memberships.id,
    orgId: org_memberships.org_id,
    userId: org_memberships.user_id,
    name: users.name,
    email: users.email,
    role: org_memberships.role,
    joinedAt: org_memberships.created_at,
  }).from(org_memberships).innerJoin(users, eq(org_memberships.user_id, users.id))
    .where(eq(org_memberships.org_id, orgId)).orderBy(asc(users.name));
  return rows.map(toMember);
}

async function selectInvitations(executor: DrizzleExecutor, orgId: string): Promise<InvitationRecord[]> {
  const rows = await executor.select().from(org_invitations)
    .where(eq(org_invitations.org_id, orgId)).orderBy(asc(org_invitations.created_at));
  return rows.map(toInvitation);
}

function makeTransaction(executor: DrizzleExecutor): InvitationTransaction {
  return {
    async findMemberByEmail(orgId, normalizedEmail) {
      const rows = await executor.select({
        membershipId: org_memberships.id, orgId: org_memberships.org_id, userId: org_memberships.user_id,
        name: users.name, email: users.email, role: org_memberships.role, joinedAt: org_memberships.created_at,
      }).from(org_memberships).innerJoin(users, eq(org_memberships.user_id, users.id)).where(and(
        eq(org_memberships.org_id, orgId), sql`lower(btrim(${users.email})) = ${normalizedEmail}`,
      )).limit(1);
      return rows[0] ? toMember(rows[0]) : null;
    },
    async findMemberByUserId(orgId, userId) {
      const rows = await executor.select({
        membershipId: org_memberships.id, orgId: org_memberships.org_id, userId: org_memberships.user_id,
        name: users.name, email: users.email, role: org_memberships.role, joinedAt: org_memberships.created_at,
      }).from(org_memberships).innerJoin(users, eq(org_memberships.user_id, users.id)).where(and(
        eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId),
      )).limit(1);
      return rows[0] ? toMember(rows[0]) : null;
    },
    async countOwners(orgId) {
      const result = await executor.execute(sql`SELECT ${org_memberships.id} FROM ${org_memberships} WHERE ${org_memberships.org_id} = ${orgId} AND ${org_memberships.role} = 'owner' FOR UPDATE`);
      return result.rows.length;
    },
    async findPendingInvitation(orgId, normalizedEmail) {
      const rows = await executor.select().from(org_invitations).where(and(
        eq(org_invitations.org_id, orgId), eq(org_invitations.normalized_email, normalizedEmail), eq(org_invitations.status, "pending"),
      )).limit(1);
      return rows[0] ? toInvitation(rows[0]) : null;
    },
    async findInvitationById(orgId, invitationId) {
      const rows = await executor.select().from(org_invitations).where(and(
        eq(org_invitations.org_id, orgId), eq(org_invitations.id, invitationId),
      )).limit(1);
      return rows[0] ? toInvitation(rows[0]) : null;
    },
    async adoptInvitationBootstrap(tokenDigest) {
      await executor.execute(sql`select set_config('app.current_invitation_token_digest', ${tokenDigest}, true)`);
    },
    async findInvitationByDigest(tokenDigest) {
      const result = await executor.execute(sql`SELECT * FROM ${org_invitations} WHERE ${org_invitations.token_digest} = ${tokenDigest} LIMIT 1`);
      const row = result.rows[0] as typeof org_invitations.$inferSelect | undefined;
      return row ? toInvitation(row) : null;
    },
    async adoptInvitationContext(orgId, userId) {
      await executor.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
      await executor.execute(sql`select set_config('app.current_user_id', ${userId ?? ""}, true)`);
    },
    async findInvitationByDigestForUpdate(tokenDigest) {
      const result = await executor.execute(sql`SELECT * FROM ${org_invitations} WHERE ${org_invitations.token_digest} = ${tokenDigest} FOR UPDATE`);
      const row = result.rows[0] as typeof org_invitations.$inferSelect | undefined;
      return row ? toInvitation(row) : null;
    },
    async insertInvitation(invitation) {
      await executor.insert(org_invitations).values({
        id: invitation.id, org_id: invitation.orgId, email: invitation.email, normalized_email: invitation.normalizedEmail,
        role: invitation.role, token_digest: invitation.tokenDigest, status: invitation.status,
        invited_by_user_id: invitation.invitedByUserId, accepted_by_user_id: invitation.acceptedByUserId,
        expires_at: invitation.expiresAt, accepted_at: invitation.acceptedAt, revoked_at: invitation.revokedAt,
        last_sent_at: invitation.lastSentAt, created_at: invitation.createdAt, updated_at: invitation.createdAt,
      });
    },
    async updateInvitation(invitationId, changes, expectation) {
      const values: Partial<typeof org_invitations.$inferInsert> = { updated_at: new Date() };
      if ("tokenDigest" in changes) values.token_digest = changes.tokenDigest;
      if ("status" in changes) values.status = changes.status;
      if ("expiresAt" in changes) values.expires_at = changes.expiresAt;
      if ("acceptedByUserId" in changes) values.accepted_by_user_id = changes.acceptedByUserId;
      if ("acceptedAt" in changes) values.accepted_at = changes.acceptedAt;
      if ("revokedAt" in changes) values.revoked_at = changes.revokedAt;
      if ("lastSentAt" in changes) values.last_sent_at = changes.lastSentAt;
      const conditions = [eq(org_invitations.id, invitationId)];
      if (expectation?.status) conditions.push(eq(org_invitations.status, expectation.status));
      if (expectation?.tokenDigest !== undefined) {
        conditions.push(expectation.tokenDigest === null
          ? sql`${org_invitations.token_digest} is null`
          : eq(org_invitations.token_digest, expectation.tokenDigest));
      }
      const rows = await executor.update(org_invitations).set(values).where(and(...conditions)).returning({ id: org_invitations.id });
      return rows.length === 1;
    },
    async insertMembership(member) {
      const rows = await executor.insert(org_memberships).values({
        id: member.membershipId, org_id: member.orgId, user_id: member.userId, role: member.role,
        created_at: member.joinedAt, updated_at: member.joinedAt,
      }).onConflictDoNothing({ target: [org_memberships.org_id, org_memberships.user_id] }).returning({ id: org_memberships.id });
      return rows.length === 1;
    },
    async updateMembershipRole(orgId, userId, role) {
      const rows = await executor.update(org_memberships).set({ role, updated_at: new Date() }).where(and(
        eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId),
      )).returning({ id: org_memberships.id });
      return rows.length === 1;
    },
    async deleteMembership(orgId, userId) {
      const rows = await executor.delete(org_memberships).where(and(
        eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId),
      )).returning({ id: org_memberships.id });
      return rows.length === 1;
    },
    listMembers: (orgId) => selectMembers(executor, orgId),
    listInvitations: (orgId) => selectInvitations(executor, orgId),
    insertAuditLog: (input) => writeAuditLog(input, executor),
  };
}

export function createMemberInvitationStore(database: DrizzleDatabase): MemberInvitationStore {
  return {
    transaction: (callback) => database.transaction((tx) => callback(makeTransaction(tx))),
    listMembers: (orgId) => selectMembers(database, orgId),
    listInvitations: (orgId) => selectInvitations(database, orgId),
  };
}

const drizzleStore = createMemberInvitationStore(db);

const defaultDependencies: MemberInvitationDependencies = {
  store: drizzleStore,
  sendInvitationEmail: sendWorkspaceInvitationEmail,
  now: () => new Date(),
  randomBytes: nodeRandomBytes,
  randomUUID: nodeRandomUUID,
};
