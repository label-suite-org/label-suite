import { asc, eq } from "drizzle-orm";
import { users } from "../db/auth-schema";
import { org_memberships, orgs } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { HttpError } from "./errors";
import {
  hasCapability,
  type Capability,
  type MembershipRole,
} from "./native-capabilities";

export {
  hasCapability,
  ROLE_CAPABILITIES,
  serializeClientCapabilities,
  type Capability,
  type MembershipRole,
} from "./native-capabilities";

export const TRUE_NATURE_ORG_ID = "true-nature";
export const ACTIVE_ORG_COOKIE = "label_suite_org_id";

export interface TenantContext {
  orgId: string;
}

export interface AuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface ActiveOrg {
  org: {
    id: string;
    name: string;
    slug: string;
    plan: string | null;
  };
  role: MembershipRole;
}

export async function resolveActiveOrgForUser(
  user: AuthUser,
  requestedOrgId?: string | null,
): Promise<ActiveOrg> {
  const memberships = await listUserMemberships(user.id);

  if (!memberships.length) {
    const initialOrg = await claimTrueNatureOrgForFirstUser(user);
    if (initialOrg) return initialOrg;
    return createPersonalOrgForUser(user);
  }

  const requested = requestedOrgId
    ? memberships.find((membership) => membership.org.id === requestedOrgId)
    : undefined;

  return requested ?? memberships[0];
}

export function requireOrgId(locals: App.Locals | Record<string, unknown>): string {
  const orgId = "orgId" in locals ? locals.orgId : undefined;
  if (typeof orgId === "string" && orgId) return orgId;
  throw new HttpError("Active workspace is required", 401);
}

export function requireCapability(
  locals: App.Locals | Record<string, unknown>,
  capability: Capability,
): string {
  const role = normalizeRole("membershipRole" in locals ? String(locals.membershipRole ?? "") : null);
  if (!hasCapability(role, capability)) throw new HttpError("Insufficient permissions", 403);
  return requireOrgId(locals);
}

/** Returns orgId after verifying the caller has at least operator-level access. */
export function requireMutateRole(locals: App.Locals | Record<string, unknown>): string {
  const role = "membershipRole" in locals ? locals.membershipRole : undefined;
  if (role !== "owner" && role !== "operator") {
    throw new HttpError("Insufficient permissions", 403);
  }
  return requireOrgId(locals);
}

/** Returns orgId after verifying the caller has owner-level access. */
export function requireOwnerRole(locals: App.Locals | Record<string, unknown>): string {
  const role = "membershipRole" in locals ? locals.membershipRole : undefined;
  if (role !== "owner") {
    throw new HttpError("Owner role required", 403);
  }
  return requireOrgId(locals);
}

/** Returns the active workspace and authenticated identity for the payee portal. */
export function requirePayeePortal(locals: App.Locals | Record<string, unknown>): {
  orgId: string;
  userId: string;
  email: string;
} {
  const role = normalizeRole("membershipRole" in locals ? String(locals.membershipRole ?? "") : null);
  if (role !== "payee") throw new HttpError("Payee portal access required", 403);

  const user = "user" in locals ? locals.user as AuthUser | undefined : undefined;
  if (!user?.id || !user.email?.trim()) throw new HttpError("Payee identity is incomplete", 403);
  return { orgId: requireOrgId(locals), userId: user.id, email: user.email };
}

export async function listUserMemberships(userId: string): Promise<ActiveOrg[]> {
  const rows = await db
    .select({
      role: org_memberships.role,
      orgId: orgs.id,
      orgName: orgs.name,
      orgSlug: orgs.slug,
      orgPlan: orgs.plan,
      createdAt: org_memberships.created_at,
    })
    .from(org_memberships)
    .innerJoin(orgs, eq(org_memberships.org_id, orgs.id))
    .where(eq(org_memberships.user_id, userId))
    .orderBy(asc(org_memberships.created_at), asc(orgs.name));

  return rows.map((row) => ({
    org: {
      id: row.orgId,
      name: row.orgName,
      slug: row.orgSlug,
      plan: row.orgPlan,
    },
    role: normalizeRole(row.role),
  }));
}

/** Native workspace selection must never trigger the web onboarding fallback. */
export async function resolveExistingMembership(userId: string, orgId: string): Promise<ActiveOrg | null> {
  return (await listUserMemberships(userId)).find((membership) => membership.org.id === orgId) ?? null;
}

async function claimTrueNatureOrgForFirstUser(user: AuthUser): Promise<ActiveOrg | null> {
  return runWithDatabaseContext({ userId: user.id, orgId: TRUE_NATURE_ORG_ID }, async () => {
    const firstUser = (
      await db
        .select({ id: users.id })
        .from(users)
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(1)
    )[0];

    if (!firstUser || firstUser.id !== user.id) return null;

    const existingTrueNatureMembership = (
      await db
        .select({ id: org_memberships.id })
        .from(org_memberships)
        .where(eq(org_memberships.org_id, TRUE_NATURE_ORG_ID))
        .limit(1)
    )[0];

    if (existingTrueNatureMembership) return null;

    await db.transaction(async (tx) => {
      await tx.insert(orgs).values({
        id: TRUE_NATURE_ORG_ID,
        name: "True Nature",
        slug: "true-nature",
        plan: "internal",
        timezone: "Europe/Copenhagen",
        currency: "DKK",
        validation_sweep_mode: "manual",
        default_release_policy: "readiness_gates",
        isrc_country_code: "DK",
        isrc_registrant_code: "O7P",
      }).onConflictDoNothing({ target: orgs.id });

      await tx.insert(org_memberships).values({
        id: `${TRUE_NATURE_ORG_ID}:${user.id}`,
        org_id: TRUE_NATURE_ORG_ID,
        user_id: user.id,
        role: "owner",
      }).onConflictDoNothing({
        target: [org_memberships.org_id, org_memberships.user_id],
      });
    });

    const memberships = await listUserMemberships(user.id);
    return memberships.find((membership) => membership.org.id === TRUE_NATURE_ORG_ID) ?? null;
  });
}

async function createPersonalOrgForUser(user: AuthUser): Promise<ActiveOrg> {
  const orgId = `org_${crypto.randomUUID()}`;
  const name = workspaceNameForUser(user);
  const slug = `${slugify(name)}-${user.id.slice(0, 8).toLowerCase()}`;

  await runWithDatabaseContext({ userId: user.id, orgId }, async () => {
    await db.transaction(async (tx) => {
      await tx.insert(orgs).values({
        id: orgId,
        name,
        slug,
        plan: "trial",
        timezone: "Europe/Copenhagen",
        currency: "DKK",
        validation_sweep_mode: "manual",
        default_release_policy: "readiness_gates",
      });

      await tx.insert(org_memberships).values({
        id: `${orgId}:${user.id}`,
        org_id: orgId,
        user_id: user.id,
        role: "owner",
      });
    });
  });

  return {
    org: {
      id: orgId,
      name,
      slug,
      plan: "trial",
    },
    role: "owner",
  };
}

function workspaceNameForUser(user: AuthUser): string {
  if (user.name?.trim()) return `${user.name.trim()}'s Workspace`;
  if (user.email?.trim()) return `${user.email.split("@")[0]}'s Workspace`;
  return "My Workspace";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "workspace";
}

export function normalizeRole(role: string | null): MembershipRole {
  if (
    role === "owner"
    || role === "operator"
    || role === "fundraiser"
    || role === "member"
    || role === "payee"
  ) {
    return role;
  }
  return "member";
}
