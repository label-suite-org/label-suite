CREATE TABLE "label_suite"."orgs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'internal',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "label_suite"."orgs" ("id", "name", "slug", "plan") VALUES ('true-nature', 'True Nature', 'true-nature', 'internal') ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
DROP INDEX "label_suite"."airtable_record_mappings_source_unique_idx";--> statement-breakpoint
ALTER TABLE "label_suite"."airtable_record_mappings" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_categories" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."bugs" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."campaigns" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."contacts" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."documents" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."dsp_pitches" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."isrc_sequences" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."media_assets" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."radio_stations" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."releases" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."roles" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."side_artists" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."tracks" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."works" ADD COLUMN "org_id" text DEFAULT 'true-nature' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_slug_unique_idx" ON "label_suite"."orgs" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "label_suite"."airtable_record_mappings" ADD CONSTRAINT "airtable_record_mappings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD CONSTRAINT "artists_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_categories" ADD CONSTRAINT "budget_categories_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD CONSTRAINT "budget_line_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."bugs" ADD CONSTRAINT "bugs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD CONSTRAINT "calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD CONSTRAINT "campaign_stations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."campaigns" ADD CONSTRAINT "campaigns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."contacts" ADD CONSTRAINT "contacts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."documents" ADD CONSTRAINT "documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."dsp_pitches" ADD CONSTRAINT "dsp_pitches_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."isrc_sequences" ADD CONSTRAINT "isrc_sequences_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."media_assets" ADD CONSTRAINT "media_assets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."radio_stations" ADD CONSTRAINT "radio_stations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."releases" ADD CONSTRAINT "releases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."roles" ADD CONSTRAINT "roles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD CONSTRAINT "royalties_revenue_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."side_artists" ADD CONSTRAINT "side_artists_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."tracks" ADD CONSTRAINT "tracks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."works" ADD CONSTRAINT "works_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "airtable_record_mappings_org_id_idx" ON "label_suite"."airtable_record_mappings" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "artists_org_id_idx" ON "label_suite"."artists" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "budget_categories_org_id_idx" ON "label_suite"."budget_categories" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "budget_line_items_org_id_idx" ON "label_suite"."budget_line_items" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bugs_org_id_idx" ON "label_suite"."bugs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "calls_org_id_idx" ON "label_suite"."calls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "campaign_stations_org_id_idx" ON "label_suite"."campaign_stations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_id_idx" ON "label_suite"."campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contacts_org_id_idx" ON "label_suite"."contacts" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "documents_org_id_idx" ON "label_suite"."documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dsp_pitches_org_id_idx" ON "label_suite"."dsp_pitches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "isrc_sequences_org_id_idx" ON "label_suite"."isrc_sequences" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "media_assets_org_id_idx" ON "label_suite"."media_assets" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "ops_tasks_org_id_idx" ON "label_suite"."ops_tasks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "radio_stations_org_id_idx" ON "label_suite"."radio_stations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "releases_org_id_idx" ON "label_suite"."releases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roles_org_id_idx" ON "label_suite"."roles" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "royalties_revenue_org_id_idx" ON "label_suite"."royalties_revenue" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "side_artists_org_id_idx" ON "label_suite"."side_artists" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tracks_org_id_idx" ON "label_suite"."tracks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "works_org_id_idx" ON "label_suite"."works" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "airtable_record_mappings_source_unique_idx" ON "label_suite"."airtable_record_mappings" USING btree ("org_id","airtable_base_id","airtable_table_name","airtable_record_id");
