import { and, asc, eq, getTableColumns, gt, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { campaigns, campaign_leads, campaign_creator_engagements, campaign_audience_contacts, contact_enrichment_suggestions, contact_organizations, contacts, organizations, roles, works } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { createCanonicalContact, updateCanonicalContact, decideCanonicalEnrichmentProposal, canonicalProposalAcceptanceReady } from "./contact-authority";
import { nullableText } from "./validation";

const MAX_LIMIT = 50;
const CONTEXT_LIMIT = 12;
const proposalActionSchema = z.object({ id: z.string().min(1), action: z.enum(["accept", "ignore"]) });
const personFields = { name: z.string().trim().min(1), email: nullableText, phone: nullableText, website: nullableText, linkedin_url: nullableText, address: nullableText, role: nullableText, notes: nullableText };
const organizationFields = { name: z.string().trim().min(1), type: nullableText, email: nullableText, phone: nullableText, website: nullableText, linkedin_url: nullableText, address: nullableText, notes: nullableText };

export const nativeContactCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), ...personFields }).strict(),
  z.object({ kind: z.literal("organization"), ...organizationFields }).strict(),
]);
export const nativeContactUpdateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), expected_updated_at: z.string().datetime(), proposal: proposalActionSchema.optional(), ...Object.fromEntries(Object.entries(personFields).map(([key, value]) => [key, value.optional()])) }).strict(),
  z.object({ kind: z.literal("organization"), expected_updated_at: z.string().datetime(), ...Object.fromEntries(Object.entries(organizationFields).map(([key, value]) => [key, value.optional()])) }).strict(),
]);

export function parseNativeContactList(input: { limit: string | null; cursor: string | null; query: string | null; kind: string | null }) {
  const raw = Number(input.limit ?? 25);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), MAX_LIMIT) : 25;
  if (input.kind !== null && input.kind !== "person" && input.kind !== "organization") throw new ConflictError("Invalid contact identity kind");
  const query = input.query?.trim().slice(0, 120).toLowerCase() || null;
  const kind = input.kind as ContactKind | null;
  const cursor = decodeCursor(input.cursor);
  if (cursor && (cursor.query !== query || cursor.filter_kind !== kind)) throw new ConflictError("Invalid contact cursor");
  return { limit, cursor, query, kind };
}

export async function listNativeContacts(orgId: string, input: ReturnType<typeof parseNativeContactList>) {
  const personConditions = [eq(contacts.org_id, orgId)];
  const organizationConditions = [eq(organizations.org_id, orgId)];
  if (input.kind === "organization") personConditions.push(sql`false`);
  if (input.kind === "person") organizationConditions.push(sql`false`);
  if (input.query) {
    const term = `%${input.query.replace(/[%_\\]/g, "\\$&")}%`;
    personConditions.push(or(ilike(contacts.name, term), ilike(contacts.email, term), ilike(contacts.company, term))!);
    organizationConditions.push(or(ilike(organizations.name, term), ilike(organizations.email, term))!);
  }
  if (input.cursor) {
    personConditions.push(afterCursor(contacts.name, contacts.id, "person", input.cursor));
    organizationConditions.push(afterCursor(organizations.name, organizations.id, "organization", input.cursor));
  }
  const result = await db.execute(sql`
    select * from (
      select ${contacts.id} as id, ${contacts.name} as name, ${revisionToken(contacts.updated_at)} as revision, 'person'::text as kind, 'canonical'::text as source
      from ${contacts} where ${and(...personConditions)}
      union all
      select ${organizations.id} as id, ${organizations.name} as name, ${revisionToken(organizations.updated_at)} as revision, 'organization'::text as kind, coalesce(${organizations.source}, 'canonical') as source
      from ${organizations} where ${and(...organizationConditions)}
    ) native_contacts order by name asc, id asc, kind asc limit ${input.limit + 1}
  `);
  const rows = (result as unknown as { rows: Array<{ id: string; name: string; revision: string | null; kind: ContactKind; source: string }> }).rows;
  const visible = rows.slice(0, input.limit);
  const last = visible.at(-1);
  return { items: visible.map((row) => ({ identity: { kind: row.kind, id: row.id }, name: row.name, revision: row.revision, provenance: { source: row.source, provider_state: "unavailable" } })), next_cursor: rows.length > input.limit && last ? encodeCursor(last.name, last.id, last.kind, input.query, input.kind) : null, bounded: { limit: input.limit, partial: rows.length > input.limit } };
}

export async function getNativeContactDetail(orgId: string, id: string, kind: ContactKind) {
  if (kind === "person") {
    const [person] = await db.select({ ...getTableColumns(contacts), revision: revisionToken(contacts.updated_at) }).from(contacts).where(and(eq(contacts.id, id), eq(contacts.org_id, orgId))).limit(1);
    if (!person) throw new NotFoundError("Contact not found");
    const [affiliations, roleContext, proposals, campaignContext] = await Promise.all([
      db.select({ id: contact_organizations.id, organization_id: organizations.id, organization_name: organizations.name, title: contact_organizations.title, department: contact_organizations.department, relationship_type: contact_organizations.relationship_type, is_primary: contact_organizations.is_primary, source: contact_organizations.source, confidence: contact_organizations.confidence }).from(contact_organizations).innerJoin(organizations, and(eq(contact_organizations.organization_id, organizations.id), eq(organizations.org_id, orgId))).where(and(eq(contact_organizations.org_id, orgId), eq(contact_organizations.contact_id, id))).orderBy(asc(organizations.name)).limit(CONTEXT_LIMIT + 1),
      db.select({ id: roles.id, role: roles.role, scope: roles.scope, work_id: works.id, work_title: works.title }).from(roles).leftJoin(works, and(eq(roles.work_id, works.id), eq(works.org_id, orgId))).where(and(eq(roles.org_id, orgId), eq(roles.contact_id, id))).orderBy(asc(roles.id)).limit(CONTEXT_LIMIT + 1),
      db.select({ id: contact_enrichment_suggestions.id, field: contact_enrichment_suggestions.field, value: contact_enrichment_suggestions.value, confidence: contact_enrichment_suggestions.confidence, evidence: contact_enrichment_suggestions.evidence, source_type: contact_enrichment_suggestions.source_type, status: contact_enrichment_suggestions.status, created_at: contact_enrichment_suggestions.created_at }).from(contact_enrichment_suggestions).where(and(eq(contact_enrichment_suggestions.org_id, orgId), eq(contact_enrichment_suggestions.contact_id, id), eq(contact_enrichment_suggestions.status, "pending"))).orderBy(asc(contact_enrichment_suggestions.id)).limit(CONTEXT_LIMIT + 1),
      db.select({ id: campaigns.id, name: campaigns.campaign_name, status: campaigns.status }).from(campaigns).where(and(eq(campaigns.org_id, orgId), sql`(
        exists (select 1 from ${campaign_leads} where ${campaign_leads.org_id} = ${orgId} and ${campaign_leads.contact_id} = ${id} and ${campaign_leads.campaign_id} = ${campaigns.id})
        or exists (select 1 from ${campaign_creator_engagements} where ${campaign_creator_engagements.org_id} = ${orgId} and ${campaign_creator_engagements.contact_id} = ${id} and ${campaign_creator_engagements.campaign_id} = ${campaigns.id})
        or exists (select 1 from ${campaign_audience_contacts} where ${campaign_audience_contacts.org_id} = ${orgId} and ${campaign_audience_contacts.contact_id} = ${id} and ${campaign_audience_contacts.audience_id} = ${campaigns.campaign_audience_id})
      )`)).orderBy(asc(campaigns.campaign_name), asc(campaigns.id)).limit(CONTEXT_LIMIT + 1),
    ]);
    return personDetail(person, affiliations, roleContext, proposals, campaignContext, person.revision);
  }
  const [organization] = await db.select({ ...getTableColumns(organizations), revision: revisionToken(organizations.updated_at) }).from(organizations).where(and(eq(organizations.id, id), eq(organizations.org_id, orgId))).limit(1);
  if (!organization) throw new NotFoundError("Contact not found");
  return { identity: { kind: "organization" as const, id }, canonical: organization, revision: organization.revision, affiliations: [], context: { roles: [], campaigns: { items: [], unavailable: "No canonical organization-to-campaign relationship exists" } }, proposals: { items: [], unavailable: "Canonical proposals target people only" }, provenance: { source: organization.source ?? "canonical", provider_state: "unavailable" } };
}

export async function createNativeContact(orgId: string, input: z.infer<typeof nativeContactCreateSchema>, actorUserId: string) {
  const result = await createCanonicalContact({ orgId, actorUserId }, input.kind, input);
  return { id: result.id, kind: input.kind, revision: result.revision };
}

export async function updateNativeContact(orgId: string, id: string, input: z.infer<typeof nativeContactUpdateSchema>, actorUserId: string) {
  if (input.kind === "person" && input.proposal) return decideNativeContactProposal(orgId, id, { ...input.proposal, expected_updated_at: input.expected_updated_at, kind: input.kind }, actorUserId);
  const result = await updateCanonicalContact({ orgId, actorUserId }, input.kind, id, input, input.expected_updated_at);
  return { id, kind: input.kind, revision: result.revision };
}

export async function decideNativeContactProposal(orgId: string, contactId: string, input: { id: string; action: "accept" | "ignore"; expected_updated_at: string; kind: "person" | "organization" }, actorUserId: string) {
  if (input.kind !== "person") throw new ConflictError("Canonical enrichment proposals apply to people only");
  return decideCanonicalEnrichmentProposal({ orgId, actorUserId }, contactId, {
    id: input.id, action: input.action, expectedRevision: input.expected_updated_at,
  });
}

function personDetail(person: typeof contacts.$inferSelect, affiliations: any[], roleContext: any[], proposals: any[], campaignContext: { id: string; name: string; status: string | null }[], revision: string | null) { return { identity: { kind: "person" as const, id: person.id }, canonical: person, revision, affiliations: { items: affiliations.slice(0, CONTEXT_LIMIT), partial: affiliations.length > CONTEXT_LIMIT }, context: { roles: { items: roleContext.slice(0, CONTEXT_LIMIT), partial: roleContext.length > CONTEXT_LIMIT }, campaigns: { items: campaignContext.slice(0, CONTEXT_LIMIT), partial: campaignContext.length > CONTEXT_LIMIT } }, proposals: { items: proposals.slice(0, CONTEXT_LIMIT).map(proposal => ({ ...proposal, acceptance_ready: canonicalProposalAcceptanceReady(proposal) })), partial: proposals.length > CONTEXT_LIMIT, auto_apply: false }, provenance: { source: "canonical", provider_state: "unavailable" } }; }
type ContactKind = "person" | "organization";
type ContactCursor = { name: string; id: string; kind: ContactKind; query: string | null; filter_kind: ContactKind | null };
function revisionToken(column: typeof contacts.updated_at | typeof organizations.updated_at) { return sql<string | null>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`; }
function afterCursor(name: typeof contacts.name | typeof organizations.name, id: typeof contacts.id | typeof organizations.id, kind: ContactKind, cursor: ContactCursor) { return or(gt(name, cursor.name), and(eq(name, cursor.name), or(gt(id, cursor.id), and(eq(id, cursor.id), sql`${kind} > ${cursor.kind}`))!))!; }
function decodeCursor(value: string | null): ContactCursor | null { if (!value) return null; try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); if (typeof parsed.name !== "string" || typeof parsed.id !== "string" || (parsed.kind !== "person" && parsed.kind !== "organization") || (parsed.query !== null && typeof parsed.query !== "string") || (parsed.filter_kind !== null && parsed.filter_kind !== "person" && parsed.filter_kind !== "organization")) throw new Error(); return parsed; } catch { throw new ConflictError("Invalid contact cursor"); } }
function encodeCursor(name: string, id: string, kind: ContactKind, query: string | null, filter_kind: ContactKind | null) { return Buffer.from(JSON.stringify({ name, id, kind, query, filter_kind })).toString("base64url"); }
