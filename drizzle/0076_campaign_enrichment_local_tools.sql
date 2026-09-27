CREATE TABLE IF NOT EXISTS "label_suite"."local_tool_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "token_prefix" text NOT NULL,
  "secret_hash" text NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."campaign_enrichment_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "campaign_id" text NOT NULL,
  "lead_id" text NOT NULL,
  "token_id" text NOT NULL,
  "user_id" text NOT NULL,
  "claimed_at" timestamp DEFAULT now() NOT NULL,
  "renewed_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_enrichment_runs"
  ADD COLUMN IF NOT EXISTS "source_kind" text NOT NULL DEFAULT 'in_app_provider',
  ADD COLUMN IF NOT EXISTS "submitted_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "local_tool_token_id" text,
  ADD COLUMN IF NOT EXISTS "expected_lead_revision" text,
  ADD COLUMN IF NOT EXISTS "idempotency_key" text,
  ADD COLUMN IF NOT EXISTS "submission_hash" text,
  ADD COLUMN IF NOT EXISTS "client_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'local_tool_tokens_org_id_orgs_id_fk'
      AND conrelid = 'label_suite.local_tool_tokens'::regclass
  ) THEN
    ALTER TABLE "label_suite"."local_tool_tokens"
      ADD CONSTRAINT "local_tool_tokens_org_id_orgs_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'local_tool_tokens_user_id_user_id_fk'
      AND conrelid = 'label_suite.local_tool_tokens'::regclass
  ) THEN
    ALTER TABLE "label_suite"."local_tool_tokens"
      ADD CONSTRAINT "local_tool_tokens_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "label_suite"."user"("id") NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_claims_org_id_orgs_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_claims'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_claims"
      ADD CONSTRAINT "campaign_enrichment_claims_org_id_orgs_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_claims_campaign_id_campaigns_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_claims'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_claims"
      ADD CONSTRAINT "campaign_enrichment_claims_campaign_id_campaigns_id_fk"
      FOREIGN KEY ("campaign_id") REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_claims_lead_id_campaign_leads_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_claims'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_claims"
      ADD CONSTRAINT "campaign_enrichment_claims_lead_id_campaign_leads_id_fk"
      FOREIGN KEY ("lead_id") REFERENCES "label_suite"."campaign_leads"("id") ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_claims_token_id_local_tool_tokens_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_claims'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_claims"
      ADD CONSTRAINT "campaign_enrichment_claims_token_id_local_tool_tokens_id_fk"
      FOREIGN KEY ("token_id") REFERENCES "label_suite"."local_tool_tokens"("id") NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_claims_user_id_user_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_claims'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_claims"
      ADD CONSTRAINT "campaign_enrichment_claims_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "label_suite"."user"("id") NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_runs_submitted_by_user_id_user_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_runs'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_runs"
      ADD CONSTRAINT "campaign_enrichment_runs_submitted_by_user_id_user_id_fk"
      FOREIGN KEY ("submitted_by_user_id") REFERENCES "label_suite"."user"("id") ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_runs_local_tool_token_id_local_tool_tokens_id_fk'
      AND conrelid = 'label_suite.campaign_enrichment_runs'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_runs"
      ADD CONSTRAINT "campaign_enrichment_runs_local_tool_token_id_local_tool_tokens_id_fk"
      FOREIGN KEY ("local_tool_token_id") REFERENCES "label_suite"."local_tool_tokens"("id") ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "label_suite"."local_tool_tokens" VALIDATE CONSTRAINT "local_tool_tokens_org_id_orgs_id_fk";
ALTER TABLE "label_suite"."local_tool_tokens" VALIDATE CONSTRAINT "local_tool_tokens_user_id_user_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_claims" VALIDATE CONSTRAINT "campaign_enrichment_claims_org_id_orgs_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_claims" VALIDATE CONSTRAINT "campaign_enrichment_claims_campaign_id_campaigns_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_claims" VALIDATE CONSTRAINT "campaign_enrichment_claims_lead_id_campaign_leads_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_claims" VALIDATE CONSTRAINT "campaign_enrichment_claims_token_id_local_tool_tokens_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_claims" VALIDATE CONSTRAINT "campaign_enrichment_claims_user_id_user_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_runs" VALIDATE CONSTRAINT "campaign_enrichment_runs_submitted_by_user_id_user_id_fk";
ALTER TABLE "label_suite"."campaign_enrichment_runs" VALIDATE CONSTRAINT "campaign_enrichment_runs_local_tool_token_id_local_tool_tokens_id_fk";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'local_tool_tokens_secret_hash_check'
      AND conrelid = 'label_suite.local_tool_tokens'::regclass
  ) THEN
    ALTER TABLE "label_suite"."local_tool_tokens"
      ADD CONSTRAINT "local_tool_tokens_secret_hash_check"
      CHECK (secret_hash ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_runs_source_kind_check'
      AND conrelid = 'label_suite.campaign_enrichment_runs'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_runs"
      ADD CONSTRAINT "campaign_enrichment_runs_source_kind_check"
      CHECK (source_kind in ('in_app_provider', 'codex_mcp')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_runs_expected_lead_revision_check'
      AND conrelid = 'label_suite.campaign_enrichment_runs'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_runs"
      ADD CONSTRAINT "campaign_enrichment_runs_expected_lead_revision_check"
      CHECK (expected_lead_revision is null or expected_lead_revision ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_enrichment_runs_submission_hash_check'
      AND conrelid = 'label_suite.campaign_enrichment_runs'::regclass
  ) THEN
    ALTER TABLE "label_suite"."campaign_enrichment_runs"
      ADD CONSTRAINT "campaign_enrichment_runs_submission_hash_check"
      CHECK (submission_hash is null or submission_hash ~ '^[a-f0-9]{64}$') NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "label_suite"."local_tool_tokens" VALIDATE CONSTRAINT "local_tool_tokens_secret_hash_check";
ALTER TABLE "label_suite"."campaign_enrichment_runs" VALIDATE CONSTRAINT "campaign_enrichment_runs_source_kind_check";
ALTER TABLE "label_suite"."campaign_enrichment_runs" VALIDATE CONSTRAINT "campaign_enrichment_runs_expected_lead_revision_check";
ALTER TABLE "label_suite"."campaign_enrichment_runs" VALIDATE CONSTRAINT "campaign_enrichment_runs_submission_hash_check";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "local_tool_tokens_org_created_at_idx"
  ON "label_suite"."local_tool_tokens" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "local_tool_tokens_user_id_idx"
  ON "label_suite"."local_tool_tokens" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrichment_claims_org_lead_unique_idx"
  ON "label_suite"."campaign_enrichment_claims" ("org_id", "lead_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_claims_org_campaign_idx"
  ON "label_suite"."campaign_enrichment_claims" ("org_id", "campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_claims_token_id_idx"
  ON "label_suite"."campaign_enrichment_claims" ("token_id");
CREATE INDEX IF NOT EXISTS "campaign_enrichment_claims_expires_at_idx"
  ON "label_suite"."campaign_enrichment_claims" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_enrichment_runs_local_tool_idempotency_unique_idx"
  ON "label_suite"."campaign_enrichment_runs" ("org_id", "source_kind", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "label_suite"."local_tool_tokens" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "local_tool_tokens_org_isolation" ON "label_suite"."local_tool_tokens";
CREATE POLICY "local_tool_tokens_org_isolation" ON "label_suite"."local_tool_tokens"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."campaign_enrichment_claims" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign_enrichment_claims_org_isolation" ON "label_suite"."campaign_enrichment_claims";
CREATE POLICY "campaign_enrichment_claims_org_isolation" ON "label_suite"."campaign_enrichment_claims"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_enrichment_claims";
CREATE TRIGGER "same_org_references"
BEFORE INSERT OR UPDATE ON "label_suite"."campaign_enrichment_claims"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"(
  'campaign_id', 'campaigns',
  'lead_id', 'campaign_leads',
  'token_id', 'local_tool_tokens'
);
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_enrichment_runs";
CREATE TRIGGER "same_org_references"
BEFORE INSERT OR UPDATE ON "label_suite"."campaign_enrichment_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"(
  'campaign_id', 'campaigns',
  'lead_id', 'campaign_leads',
  'prompt_id', 'campaign_communicator_prompts',
  'local_tool_token_id', 'local_tool_tokens'
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_enrichment_claims";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_enrichment_claims"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
