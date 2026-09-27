-- Phase 1 financial lifecycle integrity. This migration preserves legacy
-- values in place; its guards apply only to subsequent mutations.
CREATE TABLE IF NOT EXISTS "label_suite"."royalty_lifecycle_contexts" (
  "transaction_id" bigint NOT NULL,
  "backend_pid" integer NOT NULL,
  "org_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "database_principal" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "consumed_at" timestamp,
  PRIMARY KEY ("transaction_id", "backend_pid")
);
REVOKE ALL ON TABLE "label_suite"."royalty_lifecycle_contexts" FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."establish_royalty_lifecycle_context"(
  p_org_id text,
  p_actor_user_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "label_suite"."org_memberships" membership
    WHERE membership.org_id = p_org_id
      AND membership.user_id = p_actor_user_id
      AND membership.role IN ('owner', 'operator')
  ) THEN
    RAISE EXCEPTION 'Royalty lifecycle actor must be an owner or operator for the organization'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM "label_suite"."royalty_lifecycle_contexts"
  WHERE created_at < now() - interval '1 day';

  INSERT INTO "label_suite"."royalty_lifecycle_contexts" (
    "transaction_id", "backend_pid", "org_id", "actor_user_id", "database_principal", "consumed_at"
  ) VALUES (
    txid_current(), pg_backend_pid(), p_org_id, p_actor_user_id, session_user, NULL
  ) ON CONFLICT ("transaction_id", "backend_pid") DO UPDATE
  SET "org_id" = EXCLUDED."org_id",
      "actor_user_id" = EXCLUDED."actor_user_id",
      "database_principal" = EXCLUDED."database_principal",
      "created_at" = now(),
      "consumed_at" = NULL;
END;
$$;
REVOKE ALL ON FUNCTION "label_suite"."establish_royalty_lifecycle_context"(text, text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_lifecycle_authorized"(
  p_org_id text,
  p_expected_actor_user_id text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  context_org_id text;
  context_actor_user_id text;
BEGIN
  UPDATE "label_suite"."royalty_lifecycle_contexts" context
  SET consumed_at = clock_timestamp()
  WHERE context.transaction_id = txid_current()
    AND context.backend_pid = pg_backend_pid()
    AND context.database_principal = session_user
    AND context.consumed_at IS NULL
    AND context.org_id = p_org_id
    AND (p_expected_actor_user_id IS NULL OR context.actor_user_id = p_expected_actor_user_id)
  RETURNING context.org_id, context.actor_user_id
  INTO context_org_id, context_actor_user_id
  ;

  IF context_org_id IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT context.org_id, context.actor_user_id
  INTO context_org_id, context_actor_user_id
  FROM "label_suite"."royalty_lifecycle_contexts" context
  WHERE context.transaction_id = txid_current()
    AND context.backend_pid = pg_backend_pid()
    AND context.database_principal = session_user;

  IF context_org_id IS NULL THEN
    RAISE EXCEPTION 'Restricted royalty lifecycle context is required in the current transaction'
      USING ERRCODE = '42501';
  END IF;
  IF context_org_id IS DISTINCT FROM p_org_id THEN
    RAISE EXCEPTION 'Restricted royalty lifecycle context does not match organization'
      USING ERRCODE = '42501';
  END IF;
  IF p_expected_actor_user_id IS NOT NULL AND context_actor_user_id IS DISTINCT FROM p_expected_actor_user_id THEN
    RAISE EXCEPTION 'Restricted royalty lifecycle context does not match ledger actor'
      USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION 'Restricted royalty lifecycle context is required in the current transaction'
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION "label_suite"."assert_royalty_lifecycle_authorized"(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "label_suite"."assert_royalty_lifecycle_authorized"(text, text) TO PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_status_transition"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (TG_TABLE_NAME = 'royalty_imports' AND NEW.status = 'received')
      OR (TG_TABLE_NAME = 'royalty_calculation_runs' AND NEW.status = 'draft')
      OR (TG_TABLE_NAME = 'royalty_statements' AND NEW.status = 'draft')
      OR (TG_TABLE_NAME = 'royalty_payouts' AND NEW.status = 'draft') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Canonical financial row on % must start in its initial lifecycle state', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'royalty_imports' THEN
    IF OLD.status = 'completed'
      AND NEW.status = 'parsed'
      AND OLD.source = 'airtable_sheet'
      AND NEW.source = 'airtable_sheet'
      AND OLD.id ~ '^royalty_import_[0-9a-f]{24}$'
      AND NEW.id = OLD.id
      AND NEW.org_id = OLD.org_id THEN
      RETURN NEW;
    END IF;
    IF (OLD.status = 'received' AND NEW.status = 'parsing')
      OR (OLD.status = 'parsing' AND NEW.status = 'parsed')
      OR (OLD.status = 'parsing' AND NEW.status = 'failed')
      OR (OLD.status = 'parsed' AND NEW.status = 'superseded') THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'royalty_calculation_runs' THEN
    IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
      PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id, NEW.approved_by);
      RETURN NEW;
    END IF;
    IF OLD.status = 'approved' AND NEW.status = 'reversed' THEN
      PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id);
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'royalty_statements' THEN
    IF (OLD.status = 'draft' AND NEW.status = 'calculated')
      OR (OLD.status = 'calculated' AND NEW.status = 'reviewed') THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'reviewed' AND NEW.status = 'issued' THEN
      PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id);
      RETURN NEW;
    END IF;
    IF OLD.status = 'issued' AND NEW.status = 'closed' THEN
      PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id);
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'royalty_payouts' THEN
    IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'approved' AND NEW.status = 'recorded' THEN
      PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id);
      IF nullif(btrim(NEW.reference), '') IS NULL OR NEW.paid_at IS NULL THEN
        RAISE EXCEPTION 'Recorded payout requires an external reference and effective date'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF (OLD.status = 'draft' AND NEW.status = 'failed')
      OR (OLD.status = 'approved' AND NEW.status = 'failed') THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'recorded' AND NEW.status = 'reversed' THEN
      PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id);
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Invalid royalty lifecycle transition on %: % -> %', TG_TABLE_NAME, OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_reversal_header"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  original_status text;
  original_org_id text;
BEGIN
  IF NEW.reversal_of_transaction_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT transaction.posting_status, transaction.org_id
  INTO original_status, original_org_id
  FROM "label_suite"."royalty_ledger_transactions" transaction
  WHERE transaction.id = NEW.reversal_of_transaction_id
  FOR UPDATE;

  IF original_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'Original ledger transaction must already be posted before creating a reversal'
      USING ERRCODE = '23514';
  END IF;
  IF original_org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'Cross-organization reference is not allowed for reversal_of_transaction_id'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "label_suite"."royalty_ledger_transactions" reversal
    WHERE reversal.reversal_of_transaction_id = NEW.reversal_of_transaction_id
      AND reversal.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Only one reversal ledger transaction is allowed for an original transaction'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_reversal_entry_groups"(
  p_reversal_transaction_id text,
  p_original_transaction_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "label_suite"."royalty_ledger_entries"
    WHERE transaction_id = p_reversal_transaction_id
  ) OR EXISTS (
    WITH original_groups AS (
      SELECT entry_type, contact_id, currency, sum(amount) AS amount
      FROM "label_suite"."royalty_ledger_entries"
      WHERE transaction_id = p_original_transaction_id
      GROUP BY entry_type, contact_id, currency
    ), reversal_groups AS (
      SELECT entry_type, contact_id, currency, sum(amount) AS amount
      FROM "label_suite"."royalty_ledger_entries"
      WHERE transaction_id = p_reversal_transaction_id
      GROUP BY entry_type, contact_id, currency
    )
    SELECT 1
    FROM original_groups original
    FULL OUTER JOIN reversal_groups reversal
      ON reversal.entry_type = original.entry_type
      AND reversal.contact_id = original.contact_id
      AND reversal.currency = original.currency
    WHERE coalesce(original.amount, 0) + coalesce(reversal.amount, 0) <> 0
  ) THEN
    RAISE EXCEPTION 'Reversal ledger entries must exactly negate the original entry groups'
      USING ERRCODE = '23514';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_ledger_transition"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  reversal_actor_user_id text;
  reversal_transaction_id text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.posting_status = 'draft' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Canonical financial row on royalty_ledger_transactions must start in its initial lifecycle state'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.posting_status = NEW.posting_status THEN
    RETURN NEW;
  END IF;

  -- The row update already holds this lock. Taking it explicitly makes the
  -- shared header-lock contract clear to the transition and child-entry guards.
  PERFORM 1
  FROM "label_suite"."royalty_ledger_transactions" transaction
  WHERE transaction.id = OLD.id
  FOR UPDATE;

  IF OLD.posting_status = 'draft' AND NEW.posting_status = 'posted' THEN
    PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id, NEW.actor_user_id);
    IF NEW.actor_user_id IS NULL OR nullif(btrim(NEW.evidence_reference), '') IS NULL THEN
      RAISE EXCEPTION 'Posted ledger transaction actor_user_id and evidence_reference are required'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.reversal_of_transaction_id IS NOT NULL THEN
      PERFORM "label_suite"."assert_royalty_reversal_entry_groups"(NEW.id, NEW.reversal_of_transaction_id);
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.posting_status = 'posted' AND NEW.posting_status = 'reversed' THEN
    SELECT reversal.id, reversal.actor_user_id
    INTO reversal_transaction_id, reversal_actor_user_id
    FROM "label_suite"."royalty_ledger_transactions" reversal
    WHERE reversal.org_id = OLD.org_id
      AND reversal.reversal_of_transaction_id = OLD.id
      AND reversal.posting_status = 'posted'
      AND reversal.actor_user_id IS NOT NULL
      AND nullif(btrim(reversal.evidence_reference), '') IS NOT NULL;
    IF reversal_transaction_id IS NULL THEN
      RAISE EXCEPTION 'Linked posted reversal transaction is required before reversing a posted transaction'
        USING ERRCODE = '23514';
    END IF;
    PERFORM "label_suite"."assert_royalty_lifecycle_authorized"(NEW.org_id, reversal_actor_user_id);
    PERFORM "label_suite"."assert_royalty_reversal_entry_groups"(reversal_transaction_id, OLD.id);
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid royalty lifecycle transition on royalty_ledger_transactions: % -> %', OLD.posting_status, NEW.posting_status
    USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_statement_immutability"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('issued', 'closed') THEN
    RAISE EXCEPTION 'Issued or closed royalty statements are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('issued', 'closed') THEN
    IF OLD.status = 'issued' AND NEW.status = 'closed' THEN
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.org_id IS DISTINCT FROM OLD.org_id
        OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
        OR NEW.period_start IS DISTINCT FROM OLD.period_start
        OR NEW.period_end IS DISTINCT FROM OLD.period_end
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
        OR NEW.earnings_amount IS DISTINCT FROM OLD.earnings_amount
        OR NEW.adjustments_amount IS DISTINCT FROM OLD.adjustments_amount
        OR NEW.payout_amount IS DISTINCT FROM OLD.payout_amount
        OR NEW.closing_balance IS DISTINCT FROM OLD.closing_balance
        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
        OR NEW.due_date IS DISTINCT FROM OLD.due_date
        OR NEW.notes IS DISTINCT FROM OLD.notes
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Issued-to-closed royalty statement transition may change only explicit lifecycle transition metadata'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.closed_at IS NULL THEN
        RAISE EXCEPTION 'Closing an issued royalty statement requires closed_at metadata'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Issued or closed royalty statements are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_statement_line_immutability"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  target_statement_ids text[];
BEGIN
  target_statement_ids := CASE
    WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.statement_id]
    WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.statement_id]
    ELSE ARRAY[OLD.statement_id, NEW.statement_id]
  END;
  IF EXISTS (
    SELECT 1 FROM "label_suite"."royalty_statements" statement
    WHERE statement.id = ANY(target_statement_ids)
      AND statement.status IN ('issued', 'closed')
  ) THEN
    RAISE EXCEPTION 'Statement lines for issued or closed royalty statements are append-only'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_ledger_transaction_immutability"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.posting_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Posted or reversed royalty ledger transactions are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.posting_status IN ('posted', 'reversed') THEN
    IF OLD.posting_status = 'posted' AND NEW.posting_status = 'reversed' THEN
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.org_id IS DISTINCT FROM OLD.org_id
        OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
        OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
        OR NEW.evidence_reference IS DISTINCT FROM OLD.evidence_reference
        OR NEW.reversal_of_transaction_id IS DISTINCT FROM OLD.reversal_of_transaction_id
        OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
        OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
        OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Posted-to-reversed royalty ledger transition may change only explicit lifecycle transition metadata'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted or reversed royalty ledger transactions are append-only'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_ledger_entry_immutability"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  target_transaction_ids text[];
BEGIN
  target_transaction_ids := CASE
    WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.transaction_id]
    WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.transaction_id]
    ELSE ARRAY[OLD.transaction_id, NEW.transaction_id]
  END;
  -- Lock every affected parent in a stable order. A concurrent posting or
  -- reversal holds this same transaction-header row lock until commit.
  PERFORM 1
  FROM "label_suite"."royalty_ledger_transactions" transaction
  WHERE transaction.id = ANY(target_transaction_ids)
  ORDER BY transaction.id
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM "label_suite"."royalty_ledger_transactions" transaction
    WHERE transaction.id = ANY(target_transaction_ids)
      AND transaction.posting_status IN ('posted', 'reversed')
  ) THEN
    RAISE EXCEPTION 'Entries for posted or reversed royalty ledger transactions are append-only'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_actor_membership"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF NEW.actor_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "label_suite"."org_memberships" membership
    WHERE membership.org_id = NEW.org_id AND membership.user_id = NEW.actor_user_id
  ) THEN
    RAISE EXCEPTION 'Royalty ledger actor must belong to the transaction organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."assert_royalty_calculation_approval_membership"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, label_suite
AS $$
BEGIN
  IF NEW.approved_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "label_suite"."org_memberships" membership
    WHERE membership.org_id = NEW.org_id AND membership.user_id = NEW.approved_by
  ) THEN
    RAISE EXCEPTION 'Royalty calculation approver must belong to the calculation organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "royalty_import_lifecycle" ON "label_suite"."royalty_imports";
CREATE TRIGGER "royalty_import_lifecycle"
BEFORE INSERT OR UPDATE OF "status" ON "label_suite"."royalty_imports"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_status_transition"();
DROP TRIGGER IF EXISTS "royalty_calculation_lifecycle" ON "label_suite"."royalty_calculation_runs";
CREATE TRIGGER "royalty_calculation_lifecycle"
BEFORE INSERT OR UPDATE OF "status" ON "label_suite"."royalty_calculation_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_status_transition"();
DROP TRIGGER IF EXISTS "royalty_statement_lifecycle" ON "label_suite"."royalty_statements";
CREATE TRIGGER "royalty_statement_lifecycle"
BEFORE INSERT OR UPDATE OF "status" ON "label_suite"."royalty_statements"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_status_transition"();
DROP TRIGGER IF EXISTS "royalty_payout_lifecycle" ON "label_suite"."royalty_payouts";
CREATE TRIGGER "royalty_payout_lifecycle"
BEFORE INSERT OR UPDATE OF "status" ON "label_suite"."royalty_payouts"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_status_transition"();
DROP TRIGGER IF EXISTS "royalty_ledger_transaction_lifecycle" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "royalty_ledger_transaction_lifecycle"
BEFORE INSERT OR UPDATE OF "posting_status" ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_ledger_transition"();
DROP TRIGGER IF EXISTS "royalty_ledger_reversal_header" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "royalty_ledger_reversal_header"
BEFORE INSERT OR UPDATE OF "reversal_of_transaction_id", "org_id" ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_reversal_header"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "royalty_statement_immutability" ON "label_suite"."royalty_statements";
CREATE TRIGGER "royalty_statement_immutability"
BEFORE UPDATE OR DELETE ON "label_suite"."royalty_statements"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_statement_immutability"();
DROP TRIGGER IF EXISTS "royalty_statement_line_immutability" ON "label_suite"."royalty_statement_lines";
CREATE TRIGGER "royalty_statement_line_immutability"
BEFORE INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_statement_lines"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_statement_line_immutability"();
DROP TRIGGER IF EXISTS "royalty_ledger_transaction_immutability" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "royalty_ledger_transaction_immutability"
BEFORE UPDATE OR DELETE ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_ledger_transaction_immutability"();
DROP TRIGGER IF EXISTS "royalty_ledger_entry_immutability" ON "label_suite"."royalty_ledger_entries";
CREATE TRIGGER "royalty_ledger_entry_immutability"
BEFORE INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_ledger_entry_immutability"();
DROP TRIGGER IF EXISTS "royalty_ledger_actor_membership" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "royalty_ledger_actor_membership"
BEFORE INSERT OR UPDATE OF "org_id", "actor_user_id" ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_actor_membership"();
DROP TRIGGER IF EXISTS "royalty_calculation_approval_membership" ON "label_suite"."royalty_calculation_runs";
CREATE TRIGGER "royalty_calculation_approval_membership"
BEFORE INSERT OR UPDATE OF "org_id", "approved_by" ON "label_suite"."royalty_calculation_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."assert_royalty_calculation_approval_membership"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_earnings";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_earnings"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('import_id', 'royalty_imports', 'work_id', 'works', 'track_id', 'tracks', 'release_id', 'releases', 'artist_id', 'artists');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_import_currency_totals";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_import_currency_totals"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('import_id', 'royalty_imports');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_split_snapshots";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_split_snapshots"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('work_id', 'works');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_split_lines";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_split_lines"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('snapshot_id', 'royalty_split_snapshots', 'contact_id', 'contacts', 'role_id', 'roles');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_statements";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_statements"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('contact_id', 'contacts');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_payouts";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_payouts"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('contact_id', 'contacts', 'statement_id', 'royalty_statements');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_statement_lines";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_statement_lines"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('statement_id', 'royalty_statements', 'earning_id', 'royalty_earnings', 'split_line_id', 'royalty_split_lines');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_calculation_runs";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_calculation_runs"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('reversed_by_run_id', 'royalty_calculation_runs');
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('reversal_of_transaction_id', 'royalty_ledger_transactions');
DROP TRIGGER IF EXISTS "royalty_ledger_entries_transaction_same_org" ON "label_suite"."royalty_ledger_entries";
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."royalty_ledger_entries";
CREATE TRIGGER "same_org_references" BEFORE INSERT OR UPDATE ON "label_suite"."royalty_ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"('contact_id', 'contacts', 'statement_id', 'royalty_statements', 'payout_id', 'royalty_payouts', 'transaction_id', 'royalty_ledger_transactions');
--> statement-breakpoint
ALTER TABLE "label_suite"."royalty_imports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_imports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_imports";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_imports" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_earnings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_earnings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_earnings";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_earnings" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_import_currency_totals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_import_currency_totals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_import_currency_totals";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_import_currency_totals" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_split_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_split_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_split_snapshots";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_split_snapshots" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_split_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_split_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_split_lines";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_split_lines" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_calculation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_calculation_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_calculation_runs";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_calculation_runs" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_statements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_statements";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_statements" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_payouts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_payouts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_payouts";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_payouts" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_statement_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_statement_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_statement_lines";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_statement_lines" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_ledger_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_ledger_transactions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_ledger_transactions";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_ledger_transactions" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."royalty_ledger_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."royalty_ledger_entries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."royalty_ledger_entries";
CREATE POLICY "tenant_isolation" ON "label_suite"."royalty_ledger_entries" USING ("org_id" = "label_suite"."current_org_id"()) WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."write_audit_log"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, label_suite
AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  target_org_id text;
  target_entity_id text;
  audit_actor_user_id text;
  protected_lifecycle_transition boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    target_org_id := new_row ->> 'org_id';
    target_entity_id := new_row ->> 'id';
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    target_org_id := coalesce(new_row ->> 'org_id', old_row ->> 'org_id');
    target_entity_id := coalesce(new_row ->> 'id', old_row ->> 'id');
    protected_lifecycle_transition :=
      (TG_TABLE_NAME = 'royalty_statements' AND (
        (old_row ->> 'status' = 'reviewed' AND new_row ->> 'status' = 'issued')
        OR (old_row ->> 'status' = 'issued' AND new_row ->> 'status' = 'closed')
      )) OR (TG_TABLE_NAME = 'royalty_payouts' AND (
        (old_row ->> 'status' = 'approved' AND new_row ->> 'status' = 'recorded')
        OR (old_row ->> 'status' = 'recorded' AND new_row ->> 'status' = 'reversed')
      ));
  ELSE
    old_row := to_jsonb(OLD);
    target_org_id := old_row ->> 'org_id';
    target_entity_id := old_row ->> 'id';
  END IF;

  IF protected_lifecycle_transition THEN
    SELECT context.actor_user_id
    INTO audit_actor_user_id
    FROM "label_suite"."royalty_lifecycle_contexts" context
    WHERE context.transaction_id = txid_current()
      AND context.backend_pid = pg_backend_pid()
      AND context.database_principal = session_user
      AND context.org_id = target_org_id
      AND context.consumed_at IS NOT NULL
    ORDER BY context.consumed_at DESC
    LIMIT 1;
    IF audit_actor_user_id IS NULL THEN
      RAISE EXCEPTION 'Validated lifecycle actor is required for protected royalty audit attribution'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    audit_actor_user_id := nullif(current_setting('app.current_user_id', true), '');
  END IF;

  INSERT INTO "label_suite"."audit_logs" (
    "id", "org_id", "actor_user_id", "request_id", "action", "entity_type",
    "entity_id", "before_data", "after_data", "created_at"
  ) VALUES (
    'audit_' || gen_random_uuid()::text,
    target_org_id,
    audit_actor_user_id,
    nullif(current_setting('app.request_id', true), ''),
    lower(TG_OP),
    TG_TABLE_NAME,
    target_entity_id,
    old_row,
    new_row,
    now()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_imports";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_imports" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_import_currency_totals";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_import_currency_totals" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_earnings";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_earnings" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_split_snapshots";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_split_snapshots" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_split_lines";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_split_lines" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_calculation_runs";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_calculation_runs" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_statements";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_statements" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_payouts";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_payouts" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_statement_lines";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_statement_lines" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_ledger_transactions";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_ledger_transactions" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."royalty_ledger_entries";
CREATE TRIGGER "audit_row_changes" AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."royalty_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
