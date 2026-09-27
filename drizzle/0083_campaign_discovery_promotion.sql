ALTER TABLE "label_suite"."campaign_discovery_reviews"
  ADD COLUMN IF NOT EXISTS "promoted_lead_id" text REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "promotion_outcome" text,
  ADD COLUMN IF NOT EXISTS "promoted_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;
CREATE INDEX IF NOT EXISTS "campaign_discovery_reviews_promoted_lead_idx"
  ON "label_suite"."campaign_discovery_reviews" ("org_id", "promoted_lead_id");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_discovery_reviews_promotion_outcome_check'
      AND conrelid = 'label_suite.campaign_discovery_reviews'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_discovery_reviews"
      ADD CONSTRAINT "campaign_discovery_reviews_promotion_outcome_check"
      CHECK ("promotion_outcome" is null or "promotion_outcome" in ('created', 'existing'));
  END IF;
END $$;
