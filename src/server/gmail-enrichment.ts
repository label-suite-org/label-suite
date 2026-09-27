import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  contact_enrichment_suggestions,
  contacts,
  gmail_connections,
} from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { idSchema } from "./validation";
import { decideCanonicalEnrichmentProposal } from "./contact-authority";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_PREFIX = "enc:v1:";

const contactSuggestionFields = [
  "email",
  "phone",
  "website",
  "linkedin_url",
  "address",
  "role",
] as const;

type ContactSuggestionField = typeof contactSuggestionFields[number];
type SuggestionField = ContactSuggestionField | "organization_name";

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  payload?: {
    headers?: GmailHeader[];
    body?: { data?: string };
    parts?: GmailPart[];
  };
};

export const gmailEnrichmentScanSchema = z.object({
  contact_id: idSchema.optional(),
  limit: z.number().int().min(1).max(25).optional(),
});

export const updateEnrichmentSuggestionSchema = z.object({
  id: idSchema,
  action: z.enum(["apply", "ignore"]),
});

export type GmailEnrichmentScanInput = z.infer<typeof gmailEnrichmentScanSchema>;
export type UpdateEnrichmentSuggestionInput = z.infer<typeof updateEnrichmentSuggestionSchema>;

export interface ContactEnrichmentSuggestion {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  field: string;
  value: string;
  normalized_value: string;
  confidence: number;
  evidence: Record<string, unknown> | null;
  source_type: string;
  source_email: string | null;
  status: string;
  created_at: Date | null;
}

export interface GmailConnectionSummary {
  id: string;
  email: string;
  status: string;
  scope: string | null;
  last_scan_at: Date | null;
  created_at: Date | null;
}

export async function listGmailConnections(orgId: string, userId: string): Promise<GmailConnectionSummary[]> {
  return db
    .select({
      id: gmail_connections.id,
      email: gmail_connections.email,
      status: gmail_connections.status,
      scope: gmail_connections.scope,
      last_scan_at: gmail_connections.last_scan_at,
      created_at: gmail_connections.created_at,
    })
    .from(gmail_connections)
    .where(and(eq(gmail_connections.org_id, orgId), eq(gmail_connections.user_id, userId)))
    .orderBy(desc(gmail_connections.updated_at));
}

export async function listContactEnrichmentSuggestions(
  orgId: string,
  contactId?: string,
): Promise<ContactEnrichmentSuggestion[]> {
  const rows = await db
    .select({
      id: contact_enrichment_suggestions.id,
      contact_id: contact_enrichment_suggestions.contact_id,
      contact_name: contacts.name,
      field: contact_enrichment_suggestions.field,
      value: contact_enrichment_suggestions.value,
      normalized_value: contact_enrichment_suggestions.normalized_value,
      confidence: contact_enrichment_suggestions.confidence,
      evidence: contact_enrichment_suggestions.evidence,
      source_type: contact_enrichment_suggestions.source_type,
      source_email: gmail_connections.email,
      status: contact_enrichment_suggestions.status,
      created_at: contact_enrichment_suggestions.created_at,
    })
    .from(contact_enrichment_suggestions)
    .leftJoin(
      contacts,
      and(
        eq(contact_enrichment_suggestions.contact_id, contacts.id),
        eq(contacts.org_id, orgId),
      ),
    )
    .leftJoin(
      gmail_connections,
      eq(contact_enrichment_suggestions.source_connection_id, gmail_connections.id),
    )
    .where(
      and(
        eq(contact_enrichment_suggestions.org_id, orgId),
        eq(contact_enrichment_suggestions.status, "pending"),
        contactId ? eq(contact_enrichment_suggestions.contact_id, contactId) : sql`true`,
      ),
    )
    .orderBy(desc(contact_enrichment_suggestions.confidence), desc(contact_enrichment_suggestions.created_at));

  return rows.map((row) => ({
    ...row,
    confidence: Number(row.confidence),
    evidence: row.evidence ?? null,
  }));
}

export function buildGmailAuthUrl({
  orgId,
  userId,
  origin,
}: {
  orgId: string;
  userId: string;
  origin: string;
}) {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const state = signState({ orgId, userId, nonce: crypto.randomUUID(), ts: Date.now() });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(origin),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function handleGmailOAuthCallback({
  code,
  state,
  currentOrgId,
  currentUserId,
  origin,
}: {
  code: string;
  state: string;
  currentOrgId: string;
  currentUserId: string;
  origin: string;
}) {
  const parsedState = verifyState(state);
  if (parsedState.orgId !== currentOrgId || parsedState.userId !== currentUserId) {
    throw new HttpError("Gmail connection state does not match the active session", 403);
  }

  const token = await exchangeCodeForToken(code, origin);
  if (!token.access_token) throw new HttpError("Google did not return an access token", 502);

  const profile = await gmailJson<{ emailAddress?: string }>(
    `${GMAIL_API_URL}/profile`,
    token.access_token,
  );
  const email = profile.emailAddress?.trim().toLowerCase();
  if (!email) throw new HttpError("Could not read Gmail profile email", 502);

  const existing = (
    await db
      .select({ id: gmail_connections.id, refresh_token: gmail_connections.refresh_token })
      .from(gmail_connections)
      .where(
        and(
          eq(gmail_connections.org_id, currentOrgId),
          eq(gmail_connections.user_id, currentUserId),
          eq(gmail_connections.email, email),
        ),
      )
      .limit(1)
  )[0];

  const id = existing?.id ?? crypto.randomUUID();
  const refreshToken = token.refresh_token
    ? sealSecret(token.refresh_token)
    : existing?.refresh_token ?? null;

  await db
    .insert(gmail_connections)
    .values({
      id,
      org_id: currentOrgId,
      user_id: currentUserId,
      email,
      scope: token.scope ?? GMAIL_SCOPE,
      access_token: sealSecret(token.access_token),
      refresh_token: refreshToken,
      token_type: token.token_type ?? "Bearer",
      expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      status: "connected",
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        gmail_connections.org_id,
        gmail_connections.user_id,
        gmail_connections.email,
      ],
      set: {
        access_token: sealSecret(token.access_token),
        refresh_token: refreshToken,
        scope: token.scope ?? GMAIL_SCOPE,
        token_type: token.token_type ?? "Bearer",
        expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
        status: "connected",
        updated_at: new Date(),
      },
    });

  return { id, email };
}

export async function scanGmailForContactEnrichment(
  orgId: string,
  userId: string,
  input: GmailEnrichmentScanInput,
) {
  const connection = await getActiveConnection(orgId, userId);
  if (!connection) throw new ConflictError("Connect Gmail before scanning contacts");

  const accessToken = await validAccessToken(connection);
  const contactRows = await contactsForScan(orgId, input.contact_id, input.limit ?? 10);
  let scannedContacts = 0;
  let scannedMessages = 0;
  let suggestionsCreated = 0;

  for (const contact of contactRows) {
    const missing = missingContactFields(contact);
    if (!missing.length) continue;

    scannedContacts++;
    const messages = await searchGmailMessages(accessToken, queryForContact(contact), 6);
    scannedMessages += messages.length;

    for (const messageRef of messages) {
      const message = await readGmailMessage(accessToken, messageRef.id);
      const evidence = messageEvidence(message);
      const text = messageText(message);
      const suggestions = extractSuggestions(contact, text, evidence);
      for (const suggestion of suggestions) {
        const created = await insertSuggestion(orgId, connection.id, contact.id, suggestion);
        if (created) suggestionsCreated++;
      }
    }
  }

  await db
    .update(gmail_connections)
    .set({ last_scan_at: new Date(), updated_at: new Date() })
    .where(eq(gmail_connections.id, connection.id));

  return {
    ok: true,
    scanned_contacts: scannedContacts,
    scanned_messages: scannedMessages,
    suggestions_created: suggestionsCreated,
    suggestions: await listContactEnrichmentSuggestions(orgId, input.contact_id),
  };
}

export async function updateContactEnrichmentSuggestion(
  orgId: string,
  input: UpdateEnrichmentSuggestionInput,
  actorUserId: string | null = null,
) {
  const suggestion = (
    await db
      .select()
      .from(contact_enrichment_suggestions)
      .where(
        and(
          eq(contact_enrichment_suggestions.id, input.id),
          eq(contact_enrichment_suggestions.org_id, orgId),
          eq(contact_enrichment_suggestions.status, "pending"),
        ),
      )
      .limit(1)
  )[0];

  if (!suggestion) throw new NotFoundError("Suggestion not found");
  if (input.action === "apply") {
    if (!suggestion.contact_id) throw new ConflictError("Suggestion is not linked to a contact");
    await assertContactInOrg(orgId, suggestion.contact_id);
  }
  const result = await decideCanonicalEnrichmentProposal(
    { orgId, actorUserId },
    suggestion.contact_id,
    { id: input.id, action: input.action === "apply" ? "accept" : "ignore" },
  );
  return { ok: true, action: input.action, field: suggestion.field, value: suggestion.value, revision: result.revision };
}

async function contactsForScan(orgId: string, contactId: string | undefined, limit: number) {
  const rows = await db
    .select({
      id: contacts.id,
      name: contacts.name,
      email: contacts.email,
      phone: contacts.phone,
      website: contacts.website,
      linkedin_url: contacts.linkedin_url,
      address: contacts.address,
      role: contacts.role,
      company: contacts.company,
      notes: contacts.notes,
    })
    .from(contacts)
    .where(and(eq(contacts.org_id, orgId), contactId ? eq(contacts.id, contactId) : sql`true`))
    .orderBy(asc(contacts.name))
    .limit(limit);

  if (contactId && !rows.length) throw new NotFoundError("Contact not found");
  return rows;
}

async function assertContactInOrg(orgId: string, contactId: string) {
  const rows = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId)))
    .limit(1);

  if (!rows.length) throw new NotFoundError("Contact not found");
}

function missingContactFields(contact: Awaited<ReturnType<typeof contactsForScan>>[number]) {
  const missing: SuggestionField[] = [];
  for (const field of contactSuggestionFields) {
    if (!contact[field]?.trim()) missing.push(field);
  }
  if (!contact.company?.trim()) missing.push("organization_name");
  return missing;
}

function queryForContact(contact: Awaited<ReturnType<typeof contactsForScan>>[number]) {
  if (contact.email?.trim()) {
    const email = contact.email.trim();
    return `{from:${email} to:${email}} newer_than:5y`;
  }

  const pieces = [`"${contact.name.replace(/"/g, "")}"`];
  if (contact.company?.trim()) pieces.push(`"${contact.company.trim().replace(/"/g, "")}"`);
  return `${pieces.join(" ")} newer_than:5y`;
}

async function searchGmailMessages(accessToken: string, q: string, maxResults: number) {
  const url = new URL(`${GMAIL_API_URL}/messages`);
  url.searchParams.set("q", q);
  url.searchParams.set("maxResults", String(maxResults));
  const result = await gmailJson<{ messages?: Array<{ id: string }> }>(url.toString(), accessToken);
  return result.messages ?? [];
}

async function readGmailMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const url = new URL(`${GMAIL_API_URL}/messages/${id}`);
  url.searchParams.set("format", "full");
  return gmailJson<GmailMessage>(url.toString(), accessToken);
}

function extractSuggestions(
  contact: Awaited<ReturnType<typeof contactsForScan>>[number],
  text: string,
  evidence: Record<string, unknown>,
) {
  const suggestions: Array<{ field: SuggestionField; value: string; confidence: number; evidence: Record<string, unknown> }> = [];
  const add = (field: SuggestionField, value: string | null, confidence: number) => {
    const clean = value?.trim();
    if (!clean) return;
    if (field !== "organization_name" && contact[field as ContactSuggestionField]?.trim()) return;
    suggestions.push({ field, value: clean, confidence, evidence });
  };

  if (!contact.email) add("email", bestEmailForContact(contact.name, text), 0.82);
  add("phone", extractPhones(text)[0] ?? null, 0.74);
  add("linkedin_url", extractUrls(text).find((url) => /linkedin\.com/i.test(url)) ?? null, 0.78);
  add("website", extractUrls(text).find((url) => !/linkedin\.com|google\.com|gmail\.com/i.test(url)) ?? null, 0.68);
  add("address", extractAddress(text), 0.58);
  add("role", extractRole(text), 0.62);
  add("organization_name", organizationFromText(contact, text), 0.66);

  return suggestions;
}

async function insertSuggestion(
  orgId: string,
  connectionId: string,
  contactId: string,
  suggestion: { field: SuggestionField; value: string; confidence: number; evidence: Record<string, unknown> },
) {
  const normalizedValue = normalizeSuggestionValue(suggestion.field, suggestion.value);
  const result = await db
    .insert(contact_enrichment_suggestions)
    .values({
      id: crypto.randomUUID(),
      org_id: orgId,
      contact_id: contactId,
      source_connection_id: connectionId,
      field: suggestion.field,
      value: suggestion.value,
      normalized_value: normalizedValue,
      confidence: suggestion.confidence,
      evidence: suggestion.evidence,
      status: "pending",
    })
    .onConflictDoNothing({
      target: [
        contact_enrichment_suggestions.org_id,
        contact_enrichment_suggestions.contact_id,
        contact_enrichment_suggestions.field,
        contact_enrichment_suggestions.normalized_value,
        contact_enrichment_suggestions.source_type,
      ],
    })
    .returning({ id: contact_enrichment_suggestions.id });

  return result.length > 0;
}


async function getActiveConnection(orgId: string, userId: string) {
  return (
    await db
      .select()
      .from(gmail_connections)
      .where(
        and(
          eq(gmail_connections.org_id, orgId),
          eq(gmail_connections.user_id, userId),
          eq(gmail_connections.status, "connected"),
        ),
      )
      .orderBy(desc(gmail_connections.updated_at))
      .limit(1)
  )[0] ?? null;
}

async function validAccessToken(connection: typeof gmail_connections.$inferSelect) {
  const expiresAt = connection.expires_at?.getTime() ?? 0;
  if (expiresAt > Date.now() + 60_000) return openSecret(connection.access_token);
  if (!connection.refresh_token) return openSecret(connection.access_token);

  const refreshToken = openSecret(connection.refresh_token);
  const body = new URLSearchParams({
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new HttpError(`Could not refresh Gmail token: ${await response.text()}`, 502);
  const token = await response.json() as { access_token: string; expires_in?: number; scope?: string; token_type?: string };
  await db
    .update(gmail_connections)
    .set({
      access_token: sealSecret(token.access_token),
      expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      scope: token.scope ?? connection.scope,
      token_type: token.token_type ?? connection.token_type,
      updated_at: new Date(),
    })
    .where(eq(gmail_connections.id, connection.id));
  return token.access_token;
}

async function exchangeCodeForToken(code: string, origin: string) {
  const body = new URLSearchParams({
    code,
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: gmailRedirectUri(origin),
    grant_type: "authorization_code",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new HttpError(`Could not connect Gmail: ${await response.text()}`, 502);
  return response.json() as Promise<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  }>;
}

async function gmailJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new HttpError(`Gmail API request failed: ${await response.text()}`, 502);
  return response.json() as Promise<T>;
}

function messageEvidence(message: GmailMessage) {
  const headers = message.payload?.headers ?? [];
  return {
    message_id: message.id,
    thread_id: message.threadId ?? null,
    from: header(headers, "From"),
    subject: header(headers, "Subject"),
    date: header(headers, "Date"),
    snippet: message.snippet?.slice(0, 240) ?? null,
  };
}

function messageText(message: GmailMessage) {
  const headers = message.payload?.headers ?? [];
  const headerText = ["From", "To", "Cc", "Reply-To", "Subject"]
    .map((name) => header(headers, name))
    .filter(Boolean)
    .join("\n");
  const body = [
    decodeBody(message.payload?.body?.data),
    ...(message.payload?.parts ?? []).flatMap(partText),
  ].filter(Boolean).join("\n");
  return `${headerText}\n${body}`.slice(0, 80_000);
}

function partText(part: GmailPart): string[] {
  const own = part.mimeType?.startsWith("text/") ? decodeBody(part.body?.data) : "";
  return [own, ...(part.parts ?? []).flatMap(partText)].filter(Boolean);
}

function decodeBody(data?: string) {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function header(headers: GmailHeader[], name: string) {
  return headers.find((candidate) => candidate.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function bestEmailForContact(name: string, text: string) {
  const emails = extractEmails(text);
  if (!emails.length) return null;
  const loweredName = name.toLowerCase();
  const nameParts = loweredName.split(/\s+/).filter((part) => part.length > 2);
  return emails.find((email) => nameParts.some((part) => email.toLowerCase().includes(part))) ?? emails[0];
}

function extractEmails(text: string) {
  return uniqueMatches(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
    .filter((email) => !/@(?:gmail|googlemail)\.com$/i.test(email));
}

function extractPhones(text: string) {
  return uniqueMatches(text, /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/g)
    .map((phone) => phone.replace(/\s+/g, " ").trim())
    .filter((phone) => phone.replace(/\D/g, "").length >= 8)
    .slice(0, 4);
}

function extractUrls(text: string) {
  return uniqueMatches(text, /https?:\/\/[^\s<>"')]+/gi)
    .map((url) => url.replace(/[.,;]+$/, ""))
    .filter((url) => !/accounts\.google|mail\.google|calendar\.google/i.test(url))
    .slice(0, 8);
}

function extractAddress(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) =>
      line.length >= 12 &&
      line.length <= 120 &&
      /\d/.test(line) &&
      /\b(street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd|vej|gade|floor|suite|copenhagen|københavn|london|new york|los angeles)\b/i.test(line),
    ) ?? null;
}

function extractRole(text: string) {
  const rolePattern = /\b(manager|artist manager|label manager|a&r|a and r|publicist|pr|marketing|publisher|lawyer|attorney|producer|songwriter|writer|agent|director|founder|co-founder|head of [a-z &]+)\b/i;
  const match = text.match(rolePattern);
  return match?.[0] ? titleCase(match[0]) : null;
}

function organizationFromText(contact: Awaited<ReturnType<typeof contactsForScan>>[number], text: string) {
  if (contact.company?.trim()) return null;
  const email = extractEmails(text)[0];
  if (!email) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || /gmail\.com|icloud\.com|hotmail\.com|outlook\.com|yahoo\.com/.test(domain)) return null;
  return titleCase(domain.split(".")[0].replace(/[-_]+/g, " "));
}

function uniqueMatches(text: string, pattern: RegExp) {
  return [...new Set(text.match(pattern) ?? [])];
}

function normalizeSuggestionValue(field: SuggestionField, value: string) {
  const trimmed = value.trim();
  if (field === "email") return trimmed.toLowerCase();
  if (field === "phone") return trimmed.replace(/\D/g, "");
  if (field === "website" || field === "linkedin_url") return trimmed.replace(/\/+$/, "").toLowerCase();
  return trimmed.toLowerCase().replace(/\s+/g, " ");
}


function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : "")
    .join(" ");
}

function gmailRedirectUri(origin: string) {
  return process.env.GOOGLE_GMAIL_REDIRECT_URI ?? new URL("/api/gmail/callback", origin).toString();
}

function signState(payload: { orgId: string; userId: string; nonce: string; ts: number }) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(state: string) {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) throw new HttpError("Invalid Gmail connection state", 400);
  const expected = createHmac("sha256", stateSecret()).update(encoded).digest("base64url");
  if (signature !== expected) throw new HttpError("Invalid Gmail connection signature", 400);
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { orgId: string; userId: string; ts: number };
  if (Date.now() - parsed.ts > 10 * 60 * 1000) throw new HttpError("Gmail connection state expired", 400);
  return parsed;
}

export function sealSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function openSecret(value: string) {
  if (!value.startsWith(TOKEN_PREFIX)) return value;
  const [ivText, tagText, encryptedText] = value.slice(TOKEN_PREFIX.length).split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Invalid encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function tokenKey() {
  return createHash("sha256").update(stateSecret()).digest();
}

function stateSecret() {
  return process.env.GMAIL_TOKEN_SECRET ?? process.env.BETTER_AUTH_SECRET ?? requiredEnv("GMAIL_TOKEN_SECRET");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new ConflictError(`${name} is required for Gmail enrichment`);
  return value;
}
