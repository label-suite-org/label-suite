import { sql } from "drizzle-orm";
import {
  text,
  integer,
  timestamp,
  date,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { orgs, contacts } from "./foundation";
import { artists, releases, tracks } from "./catalog";
import { documents, media_assets } from "./assets";
import { ops_tasks } from "./operations";
import type { SyncDetails, SyncSave } from "../../lib/sync";
export const sync_deals = schema.table(
  "sync_deals",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => orgs.id),
    production: text("production").notNull(),
    version: integer("version").notNull().default(1),
    artist_id: text("artist_id").references(() => artists.id),
    release_id: text("release_id").references(() => releases.id),
    track_id: text("track_id").references(() => tracks.id),
    contact_id: text("contact_id").references(() => contacts.id),
    asset_id: text("asset_id").references(() => media_assets.id),
    task_id: text("task_id").references(() => ops_tasks.id),
    licensee: text("licensee"),
    details: jsonb("details").$type<SyncDetails>().notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("sync_deals_org_idx").on(t.org_id),
    check("sync_details_object", sql`jsonb_typeof(${t.details}) = 'object'`),
  ],
);
export const sync_revisions = schema.table(
  "sync_revisions",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => orgs.id),
    deal_id: text("deal_id")
      .notNull()
      .references(() => sync_deals.id),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<SyncSave>().notNull(),
    actor_id: text("actor_id").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sync_revisions_deal_version_idx").on(t.deal_id, t.version),
  ],
);
export const sync_receipts = schema.table(
  "sync_receipts",
  {
    id: text("id").primaryKey(),
    org_id: text("org_id")
      .notNull()
      .references(() => orgs.id),
    deal_id: text("deal_id")
      .notNull()
      .references(() => sync_deals.id),
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    currency: text("currency").notNull(),
    received_date: date("received_date").notNull(),
    reference: text("reference").notNull(),
    document_id: text("document_id").references(() => documents.id),
    actor_id: text("actor_id").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("sync_receipts_org_deal_idx").on(t.org_id, t.deal_id),
    check("sync_receipts_positive", sql`${t.amount} > 0`),
    check("sync_receipts_currency", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);
