CREATE TABLE "label_suite"."creator_channels" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "provider" text NOT NULL,
  "provider_channel_id" text NOT NULL,
  "title" text NOT NULL,
  "url" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX "creator_channels_org_id_idx" ON "label_suite"."creator_channels" ("org_id");
CREATE UNIQUE INDEX "creator_channels_org_provider_identity_unique_idx" ON "label_suite"."creator_channels" ("org_id", "provider", "provider_channel_id");

CREATE TABLE "label_suite"."campaign_discovery_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE cascade,
  "status" text NOT NULL,
  "estimated_cost_units" integer NOT NULL,
  "queries" jsonb NOT NULL,
  "channels" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_discovery_runs_status_check" CHECK ("status" in ('completed', 'partial', 'failed'))
);
CREATE INDEX "campaign_discovery_runs_org_campaign_idx" ON "label_suite"."campaign_discovery_runs" ("org_id", "campaign_id");

ALTER TABLE "label_suite"."creator_channels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "creator_channels_org_isolation" ON "label_suite"."creator_channels"
  USING ("org_id" = nullif(current_setting('app.current_org_id', true), ''))
  WITH CHECK ("org_id" = nullif(current_setting('app.current_org_id', true), ''));
ALTER TABLE "label_suite"."campaign_discovery_runs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_discovery_runs_org_isolation" ON "label_suite"."campaign_discovery_runs"
  USING ("org_id" = nullif(current_setting('app.current_org_id', true), ''))
  WITH CHECK ("org_id" = nullif(current_setting('app.current_org_id', true), ''));
