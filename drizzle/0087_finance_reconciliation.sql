-- Custom SQL migration file, put your code below! --
CREATE TABLE IF NOT EXISTS "label_suite"."finance_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "connection_id" text REFERENCES "label_suite"."integration_connections"("id"),
  "source_provider" text NOT NULL,
  "account_label" text NOT NULL,
  "external_transaction_id" text,
  "occurred_at" timestamp NOT NULL,
  "posted_at" timestamp,
  "amount" numeric(20, 8) NOT NULL,
  "currency" text NOT NULL,
  "direction" text NOT NULL,
  "description" text,
  "raw_evidence" jsonb NOT NULL,
  "raw_source_hash" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'unmatched' NOT NULL,
  "imported_by" text REFERENCES "label_suite"."user"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "finance_transactions_amount_positive_check" CHECK ("amount" > 0),
  CONSTRAINT "finance_transactions_direction_check" CHECK ("direction" in ('credit', 'debit')),
  CONSTRAINT "finance_transactions_status_check" CHECK ("status" in ('unmatched', 'partially_matched', 'matched', 'ignored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_transactions_org_source_idempotency_unique_idx" ON "label_suite"."finance_transactions" ("org_id", "source_provider", "account_label", "idempotency_key");
CREATE INDEX IF NOT EXISTS "finance_transactions_org_occurred_idx" ON "label_suite"."finance_transactions" ("org_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "finance_transactions_org_status_idx" ON "label_suite"."finance_transactions" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "finance_transactions_external_id_idx" ON "label_suite"."finance_transactions" ("org_id", "source_provider", "external_transaction_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."finance_transaction_matches" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "transaction_id" text NOT NULL REFERENCES "label_suite"."finance_transactions"("id") ON DELETE CASCADE,
  "match_type" text NOT NULL,
  "target_id" text NOT NULL,
  "allocated_amount" numeric(20, 8) NOT NULL,
  "rationale" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "actor_user_id" text REFERENCES "label_suite"."user"("id"),
  "reversed_at" timestamp,
  "reversed_by" text REFERENCES "label_suite"."user"("id"),
  "reversal_reason" text,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "finance_transaction_matches_type_check" CHECK ("match_type" in ('royalty_receipt', 'payout_batch', 'budget_spend')),
  CONSTRAINT "finance_transaction_matches_amount_positive_check" CHECK ("allocated_amount" > 0),
  CONSTRAINT "finance_transaction_matches_status_check" CHECK ("status" in ('active', 'reversed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_transaction_matches_org_transaction_idx" ON "label_suite"."finance_transaction_matches" ("org_id", "transaction_id");
CREATE INDEX IF NOT EXISTS "finance_transaction_matches_target_idx" ON "label_suite"."finance_transaction_matches" ("org_id", "match_type", "target_id");
CREATE INDEX IF NOT EXISTS "finance_transaction_matches_status_idx" ON "label_suite"."finance_transaction_matches" ("org_id", "status");
