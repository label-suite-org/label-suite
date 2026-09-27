CREATE TABLE "label_suite"."campaign_discovery_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "provider_channel_id" text NOT NULL,
  "state" text DEFAULT 'unreviewed' NOT NULL,
  "rejection_reason" text,
  "revision" integer DEFAULT 0 NOT NULL,
  "actor_user_id" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "decided_at" timestamp,
  "history" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_discovery_reviews_state_check" CHECK ("state" in ('unreviewed', 'shortlisted', 'rejected', 'promoted')),
  CONSTRAINT "campaign_discovery_reviews_rejection_reason_check" CHECK ("rejection_reason" is null or "rejection_reason" in ('wrong_music', 'wrong_format', 'inactive', 'insufficient_evidence', 'duplicate', 'unsuitable_contact_model'))
);
CREATE INDEX "campaign_discovery_reviews_org_campaign_idx" ON "label_suite"."campaign_discovery_reviews" ("org_id", "campaign_id");
CREATE INDEX "campaign_discovery_reviews_org_channel_idx" ON "label_suite"."campaign_discovery_reviews" ("org_id", "provider", "provider_channel_id");
CREATE UNIQUE INDEX "campaign_discovery_reviews_campaign_channel_unique_idx" ON "label_suite"."campaign_discovery_reviews" ("org_id", "campaign_id", "provider", "provider_channel_id");
ALTER TABLE "label_suite"."campaign_discovery_reviews" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_discovery_reviews_org_isolation" ON "label_suite"."campaign_discovery_reviews"
  USING ("org_id" = nullif(current_setting('app.current_org_id', true), ''))
  WITH CHECK ("org_id" = nullif(current_setting('app.current_org_id', true), ''));
