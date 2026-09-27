import { and, asc, eq, ilike } from "drizzle-orm";
import {
  artists,
  budget_projects,
  campaigns,
  contacts,
  organizations,
  project_events,
  releases,
  tracks,
  works,
} from "../db/schema";
import { db } from "../lib/db";
import {
  dedupeRecordSearchResults,
  MIN_RECORD_SEARCH_QUERY_LENGTH,
  MAX_RECORD_SEARCH_RESULTS,
  recordSearchContactHref,
  recordSearchEventHref,
  recordSearchEventSubtitle,
  recordSearchOrganizationHref,
  recordSearchProjectHref,
  recordSearchProjectSubtitle,
  recordSearchTrackHref,
  rankRecordSearchResults,
  normalizeRecordSearchQuery,
  type RecordSearchResult,
} from "../lib/commands/records";

const DEFAULT_LIMIT = 8;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function searchRecords(
  orgId: string,
  rawQuery: string | null | undefined,
  limit = DEFAULT_LIMIT,
): Promise<RecordSearchResult[]> {
  const query = normalizeRecordSearchQuery(rawQuery);
  if (query.length < MIN_RECORD_SEARCH_QUERY_LENGTH) return [];

  const pattern = `%${escapeLike(query)}%`;
  const perTypeLimit = Math.max(2, Math.ceil(limit / 2));

  const [artistRows, releaseRows, trackRows, workRows, contactRows, organizationRows, campaignRows, projectRows, eventRows] =
    await Promise.all([
      db.select({ id: artists.id, title: artists.name }).from(artists)
        .where(and(eq(artists.org_id, orgId), ilike(artists.name, pattern)))
        .orderBy(asc(artists.name)).limit(perTypeLimit),
      db.select({ id: releases.id, title: releases.title }).from(releases)
        .where(and(eq(releases.org_id, orgId), ilike(releases.title, pattern)))
        .orderBy(asc(releases.title)).limit(perTypeLimit),
      db.select({ id: tracks.id, title: tracks.title, releaseId: tracks.release_id, workId: tracks.work_id }).from(tracks)
        .where(and(eq(tracks.org_id, orgId), ilike(tracks.title, pattern)))
        .orderBy(asc(tracks.title)).limit(perTypeLimit),
      db.select({ id: works.id, title: works.title, isrc: works.isrc }).from(works)
        .where(and(eq(works.org_id, orgId), ilike(works.title, pattern)))
        .orderBy(asc(works.title)).limit(perTypeLimit),
      db.select({ id: contacts.id, title: contacts.name, role: contacts.role }).from(contacts)
        .where(and(eq(contacts.org_id, orgId), ilike(contacts.name, pattern)))
        .orderBy(asc(contacts.name)).limit(perTypeLimit),
      db.select({ id: organizations.id, title: organizations.name, type: organizations.type }).from(organizations)
        .where(and(eq(organizations.org_id, orgId), ilike(organizations.name, pattern)))
        .orderBy(asc(organizations.name)).limit(perTypeLimit),
      db.select({ id: campaigns.id, title: campaigns.campaign_name, status: campaigns.status }).from(campaigns)
        .where(and(eq(campaigns.org_id, orgId), ilike(campaigns.campaign_name, pattern)))
        .orderBy(asc(campaigns.campaign_name)).limit(perTypeLimit),
      db.select({
        id: budget_projects.id,
        title: budget_projects.name,
        projectType: budget_projects.project_type,
        status: budget_projects.status,
        startDate: budget_projects.start_date,
      }).from(budget_projects)
        .where(and(eq(budget_projects.org_id, orgId), ilike(budget_projects.name, pattern)))
        .orderBy(asc(budget_projects.name)).limit(perTypeLimit),
      db.select({
        id: project_events.id,
        title: project_events.title,
        eventType: project_events.event_type,
        status: project_events.status,
        startDate: project_events.start_date,
      }).from(project_events)
        .where(and(eq(project_events.org_id, orgId), ilike(project_events.title, pattern)))
        .orderBy(asc(project_events.title), asc(project_events.start_date)).limit(perTypeLimit),
    ]);

  const results: RecordSearchResult[] = [
    ...artistRows.map((row) => ({ ...row, kind: "artist" as const, href: `/artists/${row.id}` })),
    ...releaseRows.map((row) => ({ ...row, kind: "release" as const, href: `/releases/${row.id}` })),
    ...trackRows.map((row) => ({
      id: row.id,
      kind: "track" as const,
      title: row.title,
      subtitle: row.releaseId ? "Track on release" : row.workId ? "Linked work" : "Track",
      href: recordSearchTrackHref(row),
    })),
    ...workRows.map((row) => ({
      ...row,
      kind: "work" as const,
      subtitle: row.isrc ? `ISRC ${row.isrc}` : "Work",
      href: `/works/${row.id}`,
    })),
    ...contactRows.map((row) => ({
      id: row.id,
      kind: "contact" as const,
      title: row.title,
      subtitle: row.role ?? "Contact",
      href: recordSearchContactHref(row.id),
    })),
    ...organizationRows.map((row) => ({
      id: row.id,
      kind: "organization" as const,
      title: row.title,
      subtitle: row.type ?? "Organization",
      href: recordSearchOrganizationHref(row.id),
    })),
    ...campaignRows.map((row) => ({
      id: row.id,
      kind: "campaign" as const,
      title: row.title,
      subtitle: row.status ?? "Campaign",
      href: `/campaigns/${row.id}`,
    })),
    ...projectRows.map((row) => ({
      id: row.id,
      kind: "project" as const,
      title: row.title,
      subtitle: recordSearchProjectSubtitle(row),
      href: recordSearchProjectHref(row.id),
    })),
    ...eventRows.map((row) => ({
      id: row.id,
      kind: "event" as const,
      title: row.title,
      subtitle: recordSearchEventSubtitle(row),
      href: recordSearchEventHref(row.id),
    })),
  ];

  return rankRecordSearchResults(dedupeRecordSearchResults(results), query)
    .slice(0, Math.min(Math.max(limit, 1), MAX_RECORD_SEARCH_RESULTS));
}
