-- Phase 1 preserves all legacy royalty history. Canonical state checks are
-- intentionally NOT VALID on existing tables so historical rows are not
-- rewritten or silently reclassified; defaults make new writes canonical.
ALTER TABLE "label_suite"."royalty_imports"
  ALTER COLUMN "currency" DROP NOT NULL;
ALTER TABLE "label_suite"."royalty_imports"
  ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "label_suite"."royalty_imports"
  ALTER COLUMN "status" SET DEFAULT 'received';
ALTER TABLE "label_suite"."royalty_imports"
  DROP CONSTRAINT IF EXISTS "royalty_imports_status_canonical_check";
ALTER TABLE "label_suite"."royalty_imports"
  ADD CONSTRAINT "royalty_imports_status_canonical_check"
  CHECK ("status" IN ('received', 'parsing', 'parsed', 'failed', 'superseded')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."royalty_statements"
  ALTER COLUMN "status" SET DEFAULT 'draft';
ALTER TABLE "label_suite"."royalty_statements"
  DROP CONSTRAINT IF EXISTS "royalty_statements_status_canonical_check";
ALTER TABLE "label_suite"."royalty_statements"
  ADD CONSTRAINT "royalty_statements_status_canonical_check"
  CHECK ("status" IN ('draft', 'calculated', 'reviewed', 'issued', 'closed')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "label_suite"."royalty_payouts"
  ALTER COLUMN "status" SET DEFAULT 'draft';
ALTER TABLE "label_suite"."royalty_payouts"
  DROP CONSTRAINT IF EXISTS "royalty_payouts_status_canonical_check";
ALTER TABLE "label_suite"."royalty_payouts"
  ADD CONSTRAINT "royalty_payouts_status_canonical_check"
  CHECK ("status" IN ('draft', 'approved', 'recorded', 'failed', 'reversed')) NOT VALID;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."royalty_import_currency_totals" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "import_id" text NOT NULL REFERENCES "label_suite"."royalty_imports"("id"),
  "currency" text NOT NULL,
  "row_count" integer DEFAULT 0 NOT NULL,
  "gross_total" numeric(20,8) NOT NULL,
  "fees_total" numeric(20,8) NOT NULL,
  "net_total" numeric(20,8) NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."royalty_calculation_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "engine_version" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "idempotency_key" text NOT NULL,
  "approved_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "approved_at" timestamp,
  "reversed_by_run_id" text REFERENCES "label_suite"."royalty_calculation_runs"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "royalty_calculation_runs_status_check" CHECK ("status" IN ('draft', 'approved', 'reversed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."royalty_ledger_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "idempotency_key" text NOT NULL,
  "posting_status" text DEFAULT 'draft' NOT NULL,
  "actor_user_id" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "evidence_reference" text,
  "reversal_of_transaction_id" text REFERENCES "label_suite"."royalty_ledger_transactions"("id"),
  "effective_date" date NOT NULL,
  "posted_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "royalty_ledger_transactions_posting_status_check" CHECK ("posting_status" IN ('draft', 'posted', 'reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "royalty_import_currency_totals_org_import_currency_unique_idx"
  ON "label_suite"."royalty_import_currency_totals" ("org_id", "import_id", "currency");
CREATE INDEX IF NOT EXISTS "royalty_import_currency_totals_import_idx"
  ON "label_suite"."royalty_import_currency_totals" ("import_id");
CREATE UNIQUE INDEX IF NOT EXISTS "royalty_calculation_runs_org_idempotency_unique_idx"
  ON "label_suite"."royalty_calculation_runs" ("org_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "royalty_calculation_runs_org_status_idx"
  ON "label_suite"."royalty_calculation_runs" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "royalty_calculation_runs_reversed_by_run_idx"
  ON "label_suite"."royalty_calculation_runs" ("reversed_by_run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "royalty_ledger_transactions_org_idempotency_unique_idx"
  ON "label_suite"."royalty_ledger_transactions" ("org_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "royalty_ledger_transactions_org_status_effective_idx"
  ON "label_suite"."royalty_ledger_transactions" ("org_id", "posting_status", "effective_date");
CREATE INDEX IF NOT EXISTS "royalty_ledger_transactions_reversal_of_transaction_idx"
  ON "label_suite"."royalty_ledger_transactions" ("reversal_of_transaction_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."royalty_ledger_entries"
  ADD COLUMN IF NOT EXISTS "transaction_id" text;
ALTER TABLE "label_suite"."royalty_ledger_entries"
  DROP CONSTRAINT IF EXISTS "royalty_ledger_entries_transaction_id_royalty_ledger_transactions_id_fk";
ALTER TABLE "label_suite"."royalty_ledger_entries"
  ADD CONSTRAINT "royalty_ledger_entries_transaction_id_royalty_ledger_transactions_id_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "label_suite"."royalty_ledger_transactions"("id");
CREATE INDEX IF NOT EXISTS "royalty_ledger_entries_transaction_idx"
  ON "label_suite"."royalty_ledger_entries" ("transaction_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."royalty_import_currency_totals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_import_currency_totals";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_import_currency_totals"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_calculation_runs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_calculation_runs";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_calculation_runs"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_ledger_transactions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_ledger_transactions";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_ledger_transactions"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_import_currency_totals";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_import_currency_totals"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('import_id', 'royalty_imports');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_calculation_runs";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_calculation_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('reversed_by_run_id', 'royalty_calculation_runs');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('reversal_of_transaction_id', 'royalty_ledger_transactions');
DROP TRIGGER IF EXISTS "royalty_ledger_entries_transaction_same_org" ON "label_suite"."royalty_ledger_entries";
CREATE TRIGGER "royalty_ledger_entries_transaction_same_org" BEFORE INSERT OR UPDATE OF "transaction_id", "org_id" ON "label_suite"."royalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('transaction_id', 'royalty_ledger_transactions');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_import_currency_totals";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_import_currency_totals"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_calculation_runs";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_calculation_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
