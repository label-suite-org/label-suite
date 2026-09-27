CREATE TABLE IF NOT EXISTS "label_suite"."campaign_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "source_key" text NOT NULL,
  "source_type" text NOT NULL,
  "title" text NOT NULL,
  "url" text,
  "external_id" text,
  "authorization_note" text,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_sources_org_id_idx" ON "label_suite"."campaign_sources" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_sources_campaign_id_idx" ON "label_suite"."campaign_sources" ("campaign_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_sources_org_campaign_key_unique_idx" ON "label_suite"."campaign_sources" ("org_id", "campaign_id", "source_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_leads" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "source_id" text REFERENCES "label_suite"."campaign_sources"("id") ON DELETE SET NULL,
  "contact_id" text REFERENCES "label_suite"."contacts"("id") ON DELETE SET NULL,
  "station_id" text REFERENCES "label_suite"."radio_stations"("id") ON DELETE SET NULL,
  "exact_edit_track_id" text REFERENCES "label_suite"."tracks"("id") ON DELETE SET NULL,
  "dedupe_key" text NOT NULL,
  "target_name" text NOT NULL,
  "target_type" text NOT NULL,
  "target_url" text,
  "contact_route" text,
  "discovery_source" text NOT NULL,
  "recommending_person" text,
  "introduction_available" boolean,
  "musical_fit" text,
  "relationship_warmth" integer DEFAULT 0 NOT NULL,
  "editorial_fit" integer DEFAULT 0 NOT NULL,
  "useful_reach" integer DEFAULT 0 NOT NULL,
  "direct_free_access" integer DEFAULT 0 NOT NULL,
  "pipeline_stage" text DEFAULT 'identified' NOT NULL,
  "pitch_angle" text,
  "last_contacted_at" timestamp,
  "follow_up_at" timestamp,
  "outcome" text,
  "evidence_url" text,
  "published_at" timestamp,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_leads_target_type_check" CHECK ("target_type" IN ('radio_station', 'radio_show', 'youtube_channel', 'editorial', 'community', 'premiere', 'guest_mix', 'other')),
  CONSTRAINT "campaign_leads_pipeline_stage_check" CHECK ("pipeline_stage" IN ('identified', 'qualified', 'ready', 'sent', 'responded', 'confirmed', 'published', 'nurture')),
  CONSTRAINT "campaign_leads_relationship_warmth_check" CHECK ("relationship_warmth" BETWEEN 0 AND 3),
  CONSTRAINT "campaign_leads_editorial_fit_check" CHECK ("editorial_fit" BETWEEN 0 AND 3),
  CONSTRAINT "campaign_leads_useful_reach_check" CHECK ("useful_reach" BETWEEN 0 AND 2),
  CONSTRAINT "campaign_leads_direct_free_access_check" CHECK ("direct_free_access" BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_leads_org_id_idx" ON "label_suite"."campaign_leads" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_leads_campaign_id_idx" ON "label_suite"."campaign_leads" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_leads_stage_idx" ON "label_suite"."campaign_leads" ("org_id", "campaign_id", "pipeline_stage");
CREATE INDEX IF NOT EXISTS "campaign_leads_follow_up_idx" ON "label_suite"."campaign_leads" ("org_id", "follow_up_at");
CREATE INDEX IF NOT EXISTS "campaign_leads_station_id_idx" ON "label_suite"."campaign_leads" ("station_id");
CREATE INDEX IF NOT EXISTS "campaign_leads_contact_id_idx" ON "label_suite"."campaign_leads" ("contact_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_leads_org_campaign_dedupe_unique_idx" ON "label_suite"."campaign_leads" ("org_id", "campaign_id", "dedupe_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_dogfood_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "entry_type" text NOT NULL,
  "severity" text DEFAULT 'P2' NOT NULL,
  "title" text NOT NULL,
  "details" text,
  "ui_surface" text,
  "status" text DEFAULT 'logged' NOT NULL,
  "evidence_url" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_dogfood_entries_type_check" CHECK ("entry_type" IN ('bug', 'friction', 'missing_field', 'improvement')),
  CONSTRAINT "campaign_dogfood_entries_severity_check" CHECK ("severity" IN ('P0', 'P1', 'P2', 'P3')),
  CONSTRAINT "campaign_dogfood_entries_status_check" CHECK ("status" IN ('logged', 'triaged', 'in_progress', 'fixed', 'wont_fix'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_org_id_idx" ON "label_suite"."campaign_dogfood_entries" ("org_id");
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_campaign_id_idx" ON "label_suite"."campaign_dogfood_entries" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_dogfood_entries_status_idx" ON "label_suite"."campaign_dogfood_entries" ("org_id", "campaign_id", "status");
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN IF NOT EXISTS "linked_campaign_lead_id" text;
ALTER TABLE "label_suite"."ops_tasks" DROP CONSTRAINT IF EXISTS "ops_tasks_linked_campaign_lead_id_campaign_leads_id_fk";
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_linked_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("linked_campaign_lead_id") REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL NOT VALID;
ALTER TABLE "label_suite"."ops_tasks" VALIDATE CONSTRAINT "ops_tasks_linked_campaign_lead_id_campaign_leads_id_fk";
CREATE INDEX IF NOT EXISTS "ops_tasks_linked_campaign_lead_id_idx" ON "label_suite"."ops_tasks" ("linked_campaign_lead_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."campaign_dogfood_entries" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_sources";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_sources" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_leads";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_leads" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_dogfood_entries";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_dogfood_entries" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_sources";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_sources" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_leads";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_leads" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns', 'source_id', 'campaign_sources', 'contact_id', 'contacts', 'station_id', 'radio_stations', 'exact_edit_track_id', 'tracks');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_dogfood_entries";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."campaign_dogfood_entries" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('campaign_id', 'campaigns');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."ops_tasks";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."ops_tasks" FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('event_id', 'project_events', 'linked_campaign_lead_id', 'campaign_leads');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_sources";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_sources" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_leads";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_leads" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_dogfood_entries";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_dogfood_entries" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
