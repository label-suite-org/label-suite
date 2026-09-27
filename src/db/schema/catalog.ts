import { sql } from "drizzle-orm";
import {
  text,
  integer,
  real,
  timestamp,
  boolean,
  jsonb,
  date,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";

// ─── Artists ────────────────────────────────────────────
export const artists = schema.table("artists", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  image_url: text("image_url"),
  bio: text("bio"),
  bio_document: jsonb("bio_document").$type<Record<string, unknown>>(),
  bio_html: text("bio_html"),
  bio_review_status: text("bio_review_status").notNull().default("draft"),
  bio_reviewed_hash: text("bio_reviewed_hash"),
  bio_reviewed_at: timestamp("bio_reviewed_at"),
  bio_reviewed_by: text("bio_reviewed_by"),
  spotify_id: text("spotify_id"),
  spotify_followers: integer("spotify_followers"),
  spotify_popularity: integer("spotify_popularity"),
  pro: text("pro"), // ASCAP, KODA, SOCAN, etc.
  ipi: text("ipi"),
  instagram: text("instagram"),
  tiktok: text("tiktok"),
  relationship: text("relationship"),
  contact_id: text("contact_id").references(() => contacts.id),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("artists_org_id_idx").on(table.org_id),
  index("artists_name_idx").on(table.name),
  index("artists_contact_id_idx").on(table.contact_id),
  index("artists_relationship_idx").on(table.relationship),
  check(
    "artists_relationship_check",
    sql`${table.relationship} is null or ${table.relationship} in ('roster', 'collaborator')`,
  ),
  check(
    "artists_bio_review_status_check",
    sql`${table.bio_review_status} in ('draft', 'reviewed')`,
  ),
  uniqueIndex("artists_spotify_id_unique_idx").on(table.org_id, table.spotify_id).where(sql`${table.spotify_id} is not null`),
]);

// ─── Releases ───────────────────────────────────────────
export const releases = schema.table("releases", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  title: text("title").notNull(),
  artist_id: text("artist_id").references(() => artists.id),
  parent_release_id: text("parent_release_id").references((): AnyPgColumn => releases.id, { onDelete: "set null" }),
  release_date: text("release_date"),
  format: text("format"), // single, EP, album
  upc_ean: text("upc_ean"),
  cover_art_url: text("cover_art_url"),
  status: text("status").default("draft"), // draft, scheduled, released, archived
  delivery_status: text("delivery_status"),
  exploitation_scope: text("exploitation_scope"),
  notes: text("notes"),
  // Computed fields (cached from validation)
  release_ready: boolean("release_ready").default(false),
  release_missing: text("release_missing"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("releases_org_id_idx").on(table.org_id),
  index("releases_artist_id_idx").on(table.artist_id),
  index("releases_parent_release_id_idx").on(table.org_id, table.parent_release_id),
  index("releases_status_idx").on(table.status),
  index("releases_release_date_idx").on(table.release_date),
  uniqueIndex("releases_upc_ean_unique_idx").on(table.org_id, table.upc_ean).where(sql`${table.upc_ean} is not null`),
]);

// ─── Shared Catalog ────────────────────────────────────
export const catalog_entries = schema.table("catalog_entries", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  entry_type: text("entry_type").notNull().default("release"),
  title: text("title").notNull(),
  release_id: text("release_id").references(() => releases.id, { onDelete: "set null" }),
  release_date: text("release_date"),
  status: text("status").notNull().default("planned"),
  catalog_number: text("catalog_number"),
  catalog_number_locked: boolean("catalog_number_locked").notNull().default(false),
  catalog_number_source: text("catalog_number_source").notNull().default("generated"),
  sort_position: integer("sort_position").notNull().default(0),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("catalog_entries_org_id_idx").on(table.org_id),
  index("catalog_entries_org_date_position_idx").on(table.org_id, table.release_date, table.sort_position),
  index("catalog_entries_org_release_idx").on(table.org_id, table.release_id),
  uniqueIndex("catalog_entries_org_release_entry_unique_idx")
    .on(table.org_id, table.release_id)
    .where(sql`${table.entry_type} = 'release' and ${table.release_id} is not null`),
  uniqueIndex("catalog_entries_org_number_unique_idx")
    .on(table.org_id, table.catalog_number)
    .where(sql`${table.catalog_number} is not null`),
]);

export const release_milestones = schema.table("release_milestones", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  release_id: text("release_id").notNull().references(() => releases.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  phase: text("phase").notNull(),
  due_date: date("due_date"),
  status: text("status").notNull().default("todo"),
  owner: text("owner"),
  notes: text("notes"),
  is_blocking: boolean("is_blocking").notNull().default(false),
  position: integer("position").notNull().default(0),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("release_milestones_org_release_phase_idx").on(table.org_id, table.release_id, table.phase, table.position),
]);

// ─── Reporting Calendar ────────────────────────────────
export const reporting_weeks = schema.table("reporting_weeks", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  label: text("label").notNull(),
  start_date: date("start_date").notNull(),
  end_date: date("end_date").notNull(),
  status: text("status").notNull().default("planned"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("reporting_weeks_org_start_idx").on(table.org_id, table.start_date),
  index("reporting_weeks_org_end_idx").on(table.org_id, table.end_date),
  uniqueIndex("reporting_weeks_org_dates_unique_idx").on(table.org_id, table.start_date, table.end_date),
]);

export const release_reporting = schema.table("release_reporting", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  reporting_week_id: text("reporting_week_id").notNull().references(() => reporting_weeks.id),
  release_id: text("release_id").notNull().references(() => releases.id),
  status: text("status").notNull().default("planned"),
  priority: text("priority").default("P2"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("release_reporting_org_id_idx").on(table.org_id),
  index("release_reporting_week_id_idx").on(table.reporting_week_id),
  index("release_reporting_release_id_idx").on(table.release_id),
  uniqueIndex("release_reporting_org_week_release_unique_idx").on(table.org_id, table.reporting_week_id, table.release_id),
]);

// ─── WORKS (stable recording identity) ──────────────────
export const works = schema.table("works", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  title: text("title").notNull(),
  isrc: text("isrc"),
  iswc: text("iswc"),
  alt_isrcs: text("alt_isrcs"),
  audio_url: text("audio_url"),
  duration: integer("duration"), // seconds
  genre: text("genre"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("works_org_id_idx").on(table.org_id),
  index("works_title_idx").on(table.title),
  uniqueIndex("works_isrc_unique_idx").on(table.org_id, table.isrc).where(sql`${table.isrc} is not null`),
  uniqueIndex("works_iswc_unique_idx").on(table.org_id, table.iswc).where(sql`${table.iswc} is not null`),
]);

// ─── Tracks ─────────────────────────────────────────────
export const tracks = schema.table("tracks", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  title: text("title").notNull(),
  release_id: text("release_id").references(() => releases.id),
  work_id: text("work_id").references(() => works.id),
  position: integer("position"), // track number on release
  version: text("version"), // main, remix, acoustic, etc.
  isrc: text("isrc"),
  audio_url: text("audio_url"),
  duration: integer("duration"),
  // Computed
  track_ready: boolean("track_ready").default(false),
  track_missing: text("track_missing"),
  clearance_progress: real("clearance_progress").default(0),
  clearance_pub: real("clearance_pub").default(0),
  clearance_master: real("clearance_master").default(0),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("tracks_org_id_idx").on(table.org_id),
  index("tracks_release_id_idx").on(table.release_id),
  index("tracks_work_id_idx").on(table.work_id),
  index("tracks_release_position_idx").on(table.release_id, table.position),
  index("tracks_isrc_idx").on(table.isrc),
]);

// ─── Roles (Credit) ─────────────────────────────────────
export const roles = schema.table("roles", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  contact_id: text("contact_id").references(() => contacts.id),
  work_id: text("work_id").references(() => works.id),
  role: text("role"), // Producer, Songwriter, Vocalist, etc.
  ownership_type: text("ownership_type"), // Rights, Credit
  scope: text("scope"), // Publishing, Master, Mechanical
  percent_share: real("percent_share"),
  clearance_status: text("clearance_status"), // Signed, Confirmed, Pending, Unknown
  reviewed_by: text("reviewed_by"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("roles_org_id_idx").on(table.org_id),
  index("roles_contact_id_idx").on(table.contact_id),
  index("roles_work_id_idx").on(table.work_id),
  index("roles_work_scope_idx").on(table.work_id, table.scope),
]);

// ─── Side Artists ──────────────────────────────────────
export const side_artists = schema.table("side_artists", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  artist_id: text("artist_id").references(() => artists.id),
  release_id: text("release_id").references(() => releases.id),
  type: text("type"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("side_artists_org_id_idx").on(table.org_id),
  index("side_artists_artist_id_idx").on(table.artist_id),
  index("side_artists_release_id_idx").on(table.release_id),
]);
