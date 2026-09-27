ALTER TABLE "label_suite"."campaigns"
  ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_editor_ai_runs_failure_category_check'
      AND conrelid = 'label_suite.campaign_editor_ai_runs'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_editor_ai_runs"
      ADD CONSTRAINT "campaign_editor_ai_runs_failure_category_check"
      CHECK ("failure_category" IS NULL OR "failure_category" IN ('disabled', 'refused', 'timeout', 'network', 'provider', 'malformed_output', 'invalid_proposal', 'unknown_citation'));
  END IF;
END $$;
