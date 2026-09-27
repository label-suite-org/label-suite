CREATE TABLE IF NOT EXISTS "label_suite"."campaign_audiences" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'true-nature',
  "name" text NOT NULL,
  "description" text,
  "membership_rules" jsonb NOT NULL DEFAULT '{"include_contact_roles":[],"exclude_contact_roles":[],"require_contact_email":true,"exclude_contact_ids":[],"include_station_states":[],"exclude_station_states":[],"require_station_email":true,"exclude_station_ids":[]}'::jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_audiences_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id"),
  CONSTRAINT "campaign_audiences_membership_rules_check"
    CHECK (jsonb_typeof("membership_rules") = 'object')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_audience_contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'true-nature',
  "audience_id" text NOT NULL,
  "contact_id" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_audience_contacts_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id"),
  CONSTRAINT "campaign_audience_contacts_audience_id_campaign_audiences_id_fk"
    FOREIGN KEY ("audience_id") REFERENCES "label_suite"."campaign_audiences"("id")
    ON DELETE cascade,
  CONSTRAINT "campaign_audience_contacts_contact_id_contacts_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_audience_stations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL DEFAULT 'true-nature',
  "audience_id" text NOT NULL,
  "station_id" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_audience_stations_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id"),
  CONSTRAINT "campaign_audience_stations_audience_id_campaign_audiences_id_fk"
    FOREIGN KEY ("audience_id") REFERENCES "label_suite"."campaign_audiences"("id")
    ON DELETE cascade,
  CONSTRAINT "campaign_audience_stations_station_id_radio_stations_id_fk"
    FOREIGN KEY ("station_id") REFERENCES "label_suite"."radio_stations"("id")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audiences_org_id_idx" ON "label_suite"."campaign_audiences" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audiences_name_idx" ON "label_suite"."campaign_audiences" ("name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_audiences_org_name_unique_idx" ON "label_suite"."campaign_audiences" ("org_id","name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audience_contacts_org_id_idx" ON "label_suite"."campaign_audience_contacts" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audience_contacts_audience_id_idx" ON "label_suite"."campaign_audience_contacts" ("audience_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audience_contacts_contact_id_idx" ON "label_suite"."campaign_audience_contacts" ("contact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_audience_contacts_audience_contact_unique_idx" ON "label_suite"."campaign_audience_contacts" ("org_id", "audience_id", "contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audience_stations_org_id_idx" ON "label_suite"."campaign_audience_stations" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audience_stations_audience_id_idx" ON "label_suite"."campaign_audience_stations" ("audience_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_audience_stations_station_id_idx" ON "label_suite"."campaign_audience_stations" ("station_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_audience_stations_audience_station_unique_idx" ON "label_suite"."campaign_audience_stations" ("org_id", "audience_id", "station_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaigns" ADD COLUMN IF NOT EXISTS "campaign_audience_id" text REFERENCES "label_suite"."campaign_audiences"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_audience_idx" ON "label_suite"."campaigns" ("campaign_audience_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_audiences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_audiences";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_audiences"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_audience_contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_audience_contacts";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_audience_contacts"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_audience_stations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_audience_stations";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_audience_stations"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_audiences";
--> statement-breakpoint
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_audiences"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_audience_contacts";
--> statement-breakpoint
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_audience_contacts"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_audience_stations";
--> statement-breakpoint
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_audience_stations"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
