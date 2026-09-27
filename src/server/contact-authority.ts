import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { contact_enrichment_suggestions, contact_organizations, contacts, organizations } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";

/**
 * Canonical contact mutation contract. Every writer supplies an active org and
 * actor (null is retained only for legacy session compatibility); native callers
 * additionally supply the exact revision token returned by this module.
 */
export type CanonicalActor = { orgId: string; actorUserId: string | null };
export type CanonicalKind = "person" | "organization";
export const citedEnrichmentEvidenceSchema = z.object({
  message_id: z.string().trim().min(1),
  thread_id: z.string().trim().min(1).nullable().optional(),
  from: z.string().trim().min(1).nullable().optional(),
  subject: z.string().trim().min(1).nullable().optional(),
  date: z.string().trim().min(1).nullable().optional(),
  snippet: z.string().nullable().optional(),
}).strict();

const personFields = ["name", "email", "phone", "image_url", "website", "linkedin_url", "address", "role", "company", "notes"] as const;
const organizationFields = ["name", "type", "email", "phone", "website", "linkedin_url", "address", "image_url", "notes"] as const;
const proposalFields = new Set(["email", "phone", "website", "linkedin_url", "address", "role", "organization_name"]);

export function canonicalProposalAcceptanceReady(proposal: { status: string; source_type: string; field: string; evidence: unknown }): boolean {
  return proposal.status === "pending" && proposal.source_type === "gmail" && proposalFields.has(proposal.field)
    && citedEnrichmentEvidenceSchema.safeParse(proposal.evidence).success;
}

/** PostgreSQL clock expression that advances a timestamp even within one clock tick. */
export const revisionSql = sql`greatest(clock_timestamp(), updated_at + interval '1 microsecond')`;

export function proposalAuditEventType(action: "accept" | "ignore") {
  return action === "accept" ? "contact.proposal_accepted" : "contact.proposal_ignored";
}

export async function createCanonicalContact(
  actor: CanonicalActor,
  kind: CanonicalKind,
  input: Record<string, unknown>,
) {
  const table = kind === "person" ? contacts : organizations;
  const id = typeof input.id === "string" ? input.id : crypto.randomUUID();
  const fields = pick(input, kind === "person" ? personFields : organizationFields);
  return db.transaction(async (tx) => {
    const values = kind === "person"
      ? { id, org_id: actor.orgId, ...fields }
      : { id, org_id: actor.orgId, ...fields, source: "manual" };
    const inserted = await tx.insert(table).values(values as never).onConflictDoNothing({ target: table.id }).returning();
    if (inserted[0]) {
      await recordAuditEvent(actor.orgId, {
        actor_user_id: actor.actorUserId,
        event_type: `${kind}.created`,
        object_type: kind,
        object_id: id,
        after: auditRow(inserted[0]),
      }, tx);
    }
    return { id, ok: true, revision: inserted[0] ? await revisionFor(tx, table, actor.orgId, id) : null };
  });
}

export async function updateCanonicalContact(
  actor: CanonicalActor,
  kind: CanonicalKind,
  id: string,
  input: Record<string, unknown>,
  expectedRevision?: string,
) {
  const table = kind === "person" ? contacts : organizations;
  const fields = pick(input, kind === "person" ? personFields : organizationFields);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(table).where(and(eq(table.id, id), eq(table.org_id, actor.orgId))).limit(1).for("update");
    if (!before) throw new NotFoundError(`${kind === "person" ? "Contact" : "Organization"} not found`);
    const update = { ...fields, updated_at: revisionSql };
    const conditions = [eq(table.id, id), eq(table.org_id, actor.orgId)];
    if (expectedRevision) conditions.push(eq(revisionToken(table.updated_at), expectedRevision));
    const [after] = await tx.update(table).set(update as never).where(and(...conditions)).returning();
    if (!after) throw new ConflictError("Contact changed while updating; refresh and retry");
    await recordAuditEvent(actor.orgId, {
      actor_user_id: actor.actorUserId,
      event_type: `${kind}.updated`,
      object_type: kind,
      object_id: id,
      before: auditRow(before),
      after: auditRow(after),
    }, tx);
    return { id, ok: true, kind, revision: await revisionFor(tx, table, actor.orgId, id) };
  });
}

/**
 * Claims exactly one pending proposal before touching contact data. Any failed
 * CAS or audit insert throws inside the same transaction, so the claim rolls back.
 */
export async function decideCanonicalEnrichmentProposal(
  actor: CanonicalActor,
  contactId: string | null,
  input: { id: string; action: "accept" | "ignore"; expectedRevision?: string },
) {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.update(contact_enrichment_suggestions).set(
      input.action === "accept"
        ? { status: "applied", applied_at: sql`clock_timestamp()`, updated_at: revisionSql }
        : { status: "ignored", ignored_at: sql`clock_timestamp()`, updated_at: revisionSql },
    ).where(and(
      eq(contact_enrichment_suggestions.id, input.id),
      eq(contact_enrichment_suggestions.org_id, actor.orgId),
      contactId ? eq(contact_enrichment_suggestions.contact_id, contactId) : isNull(contact_enrichment_suggestions.contact_id),
      eq(contact_enrichment_suggestions.status, "pending"),
    )).returning();
    if (!proposal) throw new ConflictError("Proposal is no longer pending");

    if (!contactId) {
      if (input.action !== "ignore") throw new ConflictError("Suggestion is not linked to a contact");
      await recordAuditEvent(actor.orgId, {
        actor_user_id: actor.actorUserId,
        event_type: proposalAuditEventType("ignore"),
        object_type: "contact_enrichment_suggestion",
        object_id: proposal.id,
        before: { status: "pending" },
        after: auditRow(proposal),
      }, tx);
      return { id: proposal.id, status: proposal.status, revision: null };
    }

    if (input.action === "accept" && !proposalFields.has(proposal.field)) {
      throw new ConflictError("Proposal field cannot be applied to canonical person data");
    }
    if (input.action === "accept" && proposal.source_type !== "gmail") {
      throw new ConflictError("Unsupported proposal source; Gmail citation authority is required");
    }
    const citation = input.action === "accept" ? citedEnrichmentEvidenceSchema.safeParse(proposal.evidence) : null;
    if (citation && !citation.success) throw new ConflictError("Proposal requires cited Gmail message evidence before acceptance");

    const [before] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.org_id, actor.orgId))).limit(1).for("update");
    if (!before) throw new NotFoundError("Contact not found");
    const conditions = [eq(contacts.id, contactId), eq(contacts.org_id, actor.orgId)];
    if (input.expectedRevision) conditions.push(eq(revisionToken(contacts.updated_at), input.expectedRevision));
    const contactUpdate = input.action === "accept" && proposal.field !== "organization_name"
      ? { [proposal.field]: proposal.value, updated_at: revisionSql }
      : { updated_at: revisionSql };
    const [after] = await tx.update(contacts).set(contactUpdate).where(and(...conditions)).returning();
    if (!after) throw new ConflictError("Contact changed while deciding proposal; refresh and retry");

    let organizationLink: { organization_id: string; created: boolean } | undefined;
    if (input.action === "accept" && proposal.field === "organization_name") {
      const [existing] = await tx.select({ id: organizations.id }).from(organizations)
        .where(and(eq(organizations.org_id, actor.orgId), eq(organizations.name, proposal.value))).limit(1);
      let organizationId = existing?.id;
      let created = false;
      if (!organizationId) {
        const [inserted] = await tx.insert(organizations).values({ id: crypto.randomUUID(), org_id: actor.orgId, name: proposal.value, type: "company", source: "gmail enrichment" })
          .onConflictDoNothing({ target: [organizations.org_id, organizations.name] }).returning({ id: organizations.id });
        created = !!inserted;
        const [concurrent] = inserted ? [] : await tx.select({ id: organizations.id }).from(organizations)
          .where(and(eq(organizations.org_id, actor.orgId), eq(organizations.name, proposal.value))).limit(1);
        organizationId = inserted?.id ?? concurrent?.id;
        if (!organizationId) throw new ConflictError("Organization changed while accepting; refresh and retry");
      }
      const links = await tx.select({ id: contact_organizations.id }).from(contact_organizations)
        .where(and(eq(contact_organizations.org_id, actor.orgId), eq(contact_organizations.contact_id, contactId))).limit(1);
      await tx.insert(contact_organizations).values({
        id: crypto.randomUUID(), org_id: actor.orgId, contact_id: contactId, organization_id: organizationId,
        relationship_type: "works_at", is_primary: links.length === 0, source: "gmail enrichment", confidence: 0.66,
      }).onConflictDoNothing({ target: [contact_organizations.org_id, contact_organizations.contact_id, contact_organizations.organization_id] });
      organizationLink = { organization_id: organizationId, created };
    }

    await recordAuditEvent(actor.orgId, {
      actor_user_id: actor.actorUserId,
      event_type: proposalAuditEventType(input.action),
      object_type: "contact_enrichment_suggestion",
      object_id: proposal.id,
      before: { proposal: auditRow({ ...proposal, status: "pending" }), contact: auditRow(before) },
      after: { proposal: auditRow(proposal), contact: auditRow(after), ...(organizationLink ? { organization_link: organizationLink } : {}) },
      metadata: citation?.success ? {
        citation: {
          source_type: proposal.source_type,
          message_id: citation.data.message_id,
          thread_id: citation.data.thread_id ?? null,
        },
      } : { source_type: proposal.source_type },
    }, tx);
    return { id: proposal.id, status: proposal.status, revision: await revisionFor(tx, contacts, actor.orgId, contactId) };
  });
}

function pick(input: Record<string, unknown>, allowed: readonly string[]) {
  return Object.fromEntries(allowed.filter((key) => Object.hasOwn(input, key)).map((key) => [key, input[key]]));
}
function revisionToken(column: typeof contacts.updated_at | typeof organizations.updated_at) {
  return sql<string | null>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}
async function revisionFor(tx: any, table: typeof contacts | typeof organizations, orgId: string, id: string) {
  const [row] = await tx.select({ revision: revisionToken(table.updated_at) }).from(table).where(and(eq(table.id, id), eq(table.org_id, orgId))).limit(1);
  return row?.revision ?? null;
}
function auditRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}
