import { sql } from "drizzle-orm";
import { check, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs } from "./foundation";
import { artists } from "./catalog";
import type { ArtistSubmission, SharedAgreement } from "../../lib/artist-portal";

export const artist_portals = schema.table("artist_portals", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  artist_id: text("artist_id").notNull().references(() => artists.id),
  artist_name: text("artist_name").notNull(),
  token_hash: text("token_hash").notNull(),
  agreements: jsonb("agreements").$type<SharedAgreement[]>().notNull().default([]),
  revoked_at: timestamp("revoked_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  check("artist_portals_token_hash_check", sql`${table.token_hash} ~ '^[a-f0-9]{64}$'`),
  check("artist_portals_agreements_check", sql`jsonb_typeof(${table.agreements}) = 'array'`),
  uniqueIndex("artist_portals_org_artist_idx").on(table.org_id, table.artist_id),
  uniqueIndex("artist_portals_token_hash_idx").on(table.token_hash),
]);

export const artist_portal_submissions = schema.table("artist_portal_submissions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  portal_id: text("portal_id").notNull().references(() => artist_portals.id),
  request_id: text("request_id").notNull(),
  details: jsonb("details").$type<ArtistSubmission>().notNull(),
  reviewed_at: timestamp("reviewed_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  check("artist_portal_submissions_details_check", sql`jsonb_typeof(${table.details}) = 'object'`),
  uniqueIndex("artist_portal_submissions_request_idx").on(table.portal_id, table.request_id),
  index("artist_portal_submissions_org_portal_idx").on(table.org_id, table.portal_id),
]);
