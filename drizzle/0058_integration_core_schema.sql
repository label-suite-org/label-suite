CREATE TABLE IF NOT EXISTS "label_suite"."integration_providers" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "auth_type" text DEFAULT 'none' NOT NULL,
  "status" text DEFAULT 'planned' NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "integration_providers_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_providers_auth_type_check"
    CHECK ("auth_type" IN ('api_key', 'oauth', 'manual_import', 'webhook', 'none')),
  CONSTRAINT "integration_providers_status_check"
    CHECK ("status" IN ('planned', 'private_beta', 'active', 'deprecated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_providers_org_key_unique_idx"
  ON "label_suite"."integration_providers" ("org_id", "key");
CREATE INDEX IF NOT EXISTS "integration_providers_org_id_idx"
  ON "label_suite"."integration_providers" ("org_id");
CREATE INDEX IF NOT EXISTS "integration_providers_category_idx"
  ON "label_suite"."integration_providers" ("org_id", "category");
CREATE INDEX IF NOT EXISTS "integration_providers_status_idx"
  ON "label_suite"."integration_providers" ("org_id", "status");
--> statement-breakpoint
INSERT INTO "label_suite"."integration_providers" ("id", "org_id", "key", "name", "category", "capabilities", "auth_type", "status")
VALUES
  ('provider_samply', 'true-nature', 'samply', 'Samply', 'assets', '["review_delivery","comments","uploads"]'::jsonb, 'api_key', 'active'),
  ('provider_gmail', 'true-nature', 'gmail', 'Gmail', 'crm', '["oauth_connect","contact_enrichment"]'::jsonb, 'oauth', 'active'),
  ('provider_warm', 'true-nature', 'warm', 'WARM', 'airplay', '["manual_import","airplay_evidence"]'::jsonb, 'manual_import', 'planned')
ON CONFLICT ("org_id", "key") DO UPDATE
SET "name" = EXCLUDED."name",
    "category" = EXCLUDED."category",
    "capabilities" = EXCLUDED."capabilities",
    "auth_type" = EXCLUDED."auth_type",
    "status" = EXCLUDED."status",
    "updated_at" = now();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."integration_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "provider_id" text NOT NULL,
  "label" text NOT NULL,
  "status" text DEFAULT 'connected' NOT NULL,
  "auth_ref" text,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_checked_at" timestamp,
  "last_successful_sync_at" timestamp,
  "created_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "integration_connections_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_connections_provider_id_integration_providers_id_fk"
    FOREIGN KEY ("provider_id") REFERENCES "label_suite"."integration_providers"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_connections_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_connections_status_check"
    CHECK ("status" IN ('connected', 'needs_attention', 'paused', 'revoked'))
);
--> statement-breakpoint
-- Legacy production-shape recovery. This block runs before any new connection
-- indexes are installed, and keeps the old provider_key/auth columns readable
-- while the old application is still serving during container replacement.
DO $$
DECLARE
  unresolved_provider_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'label_suite'
      AND table_name = 'integration_connections'
      AND column_name = 'provider_key'
  ) THEN
    ALTER TABLE "label_suite"."integration_connections"
      ADD COLUMN IF NOT EXISTS "provider_id" text,
      ADD COLUMN IF NOT EXISTS "last_checked_at" timestamp,
      ADD COLUMN IF NOT EXISTS "last_successful_sync_at" timestamp,
      ADD COLUMN IF NOT EXISTS "auth_type" text,
      ADD COLUMN IF NOT EXISTS "last_import_at" timestamp,
      ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{}'::jsonb;

    ALTER TABLE "label_suite"."integration_connections"
      ALTER COLUMN "provider_key" DROP DEFAULT,
      ALTER COLUMN "auth_type" SET DEFAULT 'none';
    UPDATE "label_suite"."integration_connections"
    SET "settings" = '{}'::jsonb
    WHERE "settings" IS NULL;
    ALTER TABLE "label_suite"."integration_connections"
      ALTER COLUMN "settings" SET DEFAULT '{}'::jsonb,
      ALTER COLUMN "settings" SET NOT NULL;
    INSERT INTO "label_suite"."integration_providers"
      ("id", "org_id", "key", "name", "category", "capabilities", "auth_type", "status")
    SELECT
      'provider_legacy_' || md5(c."org_id" || ':' || c."provider_key"),
      c."org_id",
      c."provider_key",
      initcap(replace(c."provider_key", '_', ' ')),
      'legacy',
      '[]'::jsonb,
      coalesce(min(nullif(c."auth_type", '')) FILTER (WHERE c."auth_type" IN ('api_key', 'oauth', 'manual_import', 'webhook', 'none')), 'none'),
      'planned'
    FROM "label_suite"."integration_connections" c
    WHERE c."provider_key" IS NOT NULL
    GROUP BY c."org_id", c."provider_key"
    ON CONFLICT ("org_id", "key") DO NOTHING;

    UPDATE "label_suite"."integration_connections" c
    SET "provider_id" = p."id"
    FROM "label_suite"."integration_providers" p
    WHERE p."org_id" = c."org_id"
      AND p."key" = c."provider_key"
      AND c."provider_id" IS NULL;

    SELECT count(*) INTO unresolved_provider_count
    FROM "label_suite"."integration_connections"
    WHERE "provider_id" IS NULL OR "provider_key" IS NULL;
    IF unresolved_provider_count > 0 THEN
      RAISE EXCEPTION '0058 could not map % legacy integration connection provider(s)', unresolved_provider_count;
    END IF;

    ALTER TABLE "label_suite"."integration_connections"
      ALTER COLUMN "created_by" DROP NOT NULL;

    EXECUTE $compat_function$
      CREATE OR REPLACE FUNCTION "label_suite"."integration_connections_provider_compatibility"()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, label_suite
      AS $compat_body$
      DECLARE
        resolved_provider_org text;
        resolved_provider_key text;
        resolved_provider_auth_type text;
      BEGIN
        IF NEW."provider_id" IS NULL AND NEW."provider_key" IS NULL THEN
          RAISE EXCEPTION 'integration connection requires provider_id or provider_key';
        END IF;

        IF NEW."provider_id" IS NULL THEN
          SELECT p."id"
          INTO NEW."provider_id"
          FROM "label_suite"."integration_providers" p
          WHERE p."org_id" = NEW."org_id"
            AND p."key" = NEW."provider_key";
          IF NOT FOUND THEN
            RAISE EXCEPTION 'provider_key % is not registered for organization %', NEW."provider_key", NEW."org_id";
          END IF;
        END IF;

        SELECT p."org_id", p."key", p."auth_type"
        INTO resolved_provider_org, resolved_provider_key, resolved_provider_auth_type
        FROM "label_suite"."integration_providers" p
        WHERE p."id" = NEW."provider_id";
        IF NOT FOUND THEN
          RAISE EXCEPTION 'provider_id % does not exist', NEW."provider_id";
        END IF;
        IF resolved_provider_org IS DISTINCT FROM NEW."org_id" THEN
          RAISE EXCEPTION 'provider_id % belongs to organization %, not %', NEW."provider_id", resolved_provider_org, NEW."org_id";
        END IF;
        IF NEW."provider_key" IS NOT NULL
           AND NEW."provider_key" IS DISTINCT FROM resolved_provider_key THEN
          RAISE EXCEPTION 'provider_key/provider_id mismatch';
        END IF;
        IF NEW."auth_type" IS NULL
           OR (NEW."auth_type" = 'none' AND resolved_provider_auth_type <> 'none') THEN
          NEW."auth_type" := resolved_provider_auth_type;
        ELSIF resolved_provider_auth_type <> 'none'
           AND NEW."auth_type" IS DISTINCT FROM resolved_provider_auth_type THEN
          RAISE EXCEPTION 'auth_type/provider_id mismatch';
        END IF;
        NEW."provider_key" := resolved_provider_key;
        RETURN NEW;
      END;
      $compat_body$;
    $compat_function$;
    DROP TRIGGER IF EXISTS integration_connections_provider_compatibility
      ON "label_suite"."integration_connections";
    CREATE TRIGGER integration_connections_provider_compatibility
      BEFORE INSERT OR UPDATE ON "label_suite"."integration_connections"
      FOR EACH ROW EXECUTE FUNCTION "label_suite"."integration_connections_provider_compatibility"();

    ALTER TABLE "label_suite"."integration_connections"
      ALTER COLUMN "provider_key" SET NOT NULL,
      ALTER COLUMN "provider_id" SET NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'label_suite.integration_connections'::regclass
      AND conname = left('integration_connections_provider_id_integration_providers_id_fk', 63)
  ) THEN
    ALTER TABLE "label_suite"."integration_connections"
      ADD CONSTRAINT "integration_connections_provider_id_integration_providers_id_fk"
      FOREIGN KEY ("provider_id") REFERENCES "label_suite"."integration_providers"("id") NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_org_provider_label_unique_idx"
  ON "label_suite"."integration_connections" ("org_id", "provider_id", "label");
CREATE INDEX IF NOT EXISTS "integration_connections_org_id_idx"
  ON "label_suite"."integration_connections" ("org_id");
CREATE INDEX IF NOT EXISTS "integration_connections_provider_id_idx"
  ON "label_suite"."integration_connections" ("provider_id");
CREATE INDEX IF NOT EXISTS "integration_connections_status_idx"
  ON "label_suite"."integration_connections" ("org_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."external_object_links" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "connection_id" text NOT NULL,
  "provider_key" text NOT NULL,
  "external_object_type" text NOT NULL,
  "external_object_id" text NOT NULL,
  "external_object_url" text,
  "label_suite_object_type" text NOT NULL,
  "label_suite_object_id" text NOT NULL,
  "match_method" text DEFAULT 'manual' NOT NULL,
  "match_confidence" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "external_object_links_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "external_object_links_connection_id_integration_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "external_object_links_match_method_check"
    CHECK ("match_method" IN ('manual', 'isrc', 'upc', 'title_artist', 'provider_callback', 'import_rule')),
  CONSTRAINT "external_object_links_status_check"
    CHECK ("status" IN ('active', 'needs_review', 'ignored', 'archived')),
  CONSTRAINT "external_object_links_confidence_check"
    CHECK ("match_confidence" IS NULL OR ("match_confidence" >= 0 AND "match_confidence" <= 100))
);
--> statement-breakpoint
-- Legacy external links used real confidence scores, nullable metadata, and
-- a created_by column. Normalize only the incompatible shape, preserving all
-- legacy columns and rows.
DO $$
DECLARE
  confidence_type text;
BEGIN
  ALTER TABLE "label_suite"."external_object_links"
    ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;
  UPDATE "label_suite"."external_object_links"
  SET "metadata" = '{}'::jsonb
  WHERE "metadata" IS NULL;
  ALTER TABLE "label_suite"."external_object_links"
    ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb,
    ALTER COLUMN "metadata" SET NOT NULL;

  SELECT udt_name INTO confidence_type
  FROM information_schema.columns
  WHERE table_schema = 'label_suite'
    AND table_name = 'external_object_links'
    AND column_name = 'match_confidence';
  IF confidence_type IN ('float4', 'float8', 'numeric') THEN
    IF EXISTS (
      SELECT 1
      FROM "label_suite"."external_object_links"
      WHERE "match_confidence" IS NOT NULL
        AND ("match_confidence" < 0 OR "match_confidence" > 1)
    ) THEN
      RAISE EXCEPTION '0058 legacy match_confidence must be NULL or within normalized range 0..1';
    END IF;
    ALTER TABLE "label_suite"."external_object_links"
      ALTER COLUMN "match_confidence" TYPE integer
      USING CASE
        WHEN "match_confidence" IS NULL THEN NULL
        ELSE round("match_confidence" * 100)::integer
      END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'label_suite.external_object_links'::regclass
      AND conname = left('external_object_links_connection_id_integration_connections_id_fk', 63)
  ) THEN
    ALTER TABLE "label_suite"."external_object_links"
      ADD CONSTRAINT "external_object_links_connection_id_integration_connections_id_fk"
      FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_object_links_external_unique_idx"
  ON "label_suite"."external_object_links" ("org_id", "connection_id", "external_object_type", "external_object_id");
CREATE INDEX IF NOT EXISTS "external_object_links_org_id_idx"
  ON "label_suite"."external_object_links" ("org_id");
CREATE INDEX IF NOT EXISTS "external_object_links_connection_id_idx"
  ON "label_suite"."external_object_links" ("connection_id");
CREATE INDEX IF NOT EXISTS "external_object_links_provider_object_idx"
  ON "label_suite"."external_object_links" ("org_id", "provider_key", "external_object_type");
CREATE INDEX IF NOT EXISTS "external_object_links_label_suite_object_idx"
  ON "label_suite"."external_object_links" ("org_id", "label_suite_object_type", "label_suite_object_id");
CREATE INDEX IF NOT EXISTS "external_object_links_status_idx"
  ON "label_suite"."external_object_links" ("org_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."sync_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "connection_id" text NOT NULL,
  "provider_key" text NOT NULL,
  "job_type" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "started_at" timestamp,
  "finished_at" timestamp,
  "cursor_before" text,
  "cursor_after" text,
  "records_seen" integer DEFAULT 0 NOT NULL,
  "records_created" integer DEFAULT 0 NOT NULL,
  "records_updated" integer DEFAULT 0 NOT NULL,
  "records_failed" integer DEFAULT 0 NOT NULL,
  "triggered_by" text,
  "idempotency_key" text NOT NULL,
  "error_summary" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "sync_jobs_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "sync_jobs_connection_id_integration_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "sync_jobs_job_type_check"
    CHECK ("job_type" IN ('pull', 'push', 'webhook', 'manual_import', 'export', 'reconcile')),
  CONSTRAINT "sync_jobs_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'partial', 'cancelled')),
  CONSTRAINT "sync_jobs_counts_check"
    CHECK ("records_seen" >= 0 AND "records_created" >= 0 AND "records_updated" >= 0 AND "records_failed" >= 0)
);
--> statement-breakpoint
-- Legacy sync jobs did not have cursor/idempotency bookkeeping and allowed
-- nullable counters. Add the new contract without removing dry_run or any
-- other column the old worker may still read.
DO $$
BEGIN
  ALTER TABLE "label_suite"."sync_jobs"
    ADD COLUMN IF NOT EXISTS "cursor_before" text,
    ADD COLUMN IF NOT EXISTS "cursor_after" text,
    ADD COLUMN IF NOT EXISTS "idempotency_key" text,
    ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();

  UPDATE "label_suite"."sync_jobs"
  SET "records_seen" = coalesce("records_seen", 0),
      "records_created" = coalesce("records_created", 0),
      "records_updated" = coalesce("records_updated", 0),
      "records_failed" = coalesce("records_failed", 0),
      "idempotency_key" = coalesce("idempotency_key", md5(concat_ws(':', "org_id", "connection_id", "id"))),
      "updated_at" = coalesce("updated_at", "created_at", now());

  ALTER TABLE "label_suite"."sync_jobs"
    ALTER COLUMN "idempotency_key" SET DEFAULT md5(random()::text || clock_timestamp()::text),
    ALTER COLUMN "idempotency_key" SET NOT NULL,
    ALTER COLUMN "records_seen" SET DEFAULT 0,
    ALTER COLUMN "records_seen" SET NOT NULL,
    ALTER COLUMN "records_created" SET DEFAULT 0,
    ALTER COLUMN "records_created" SET NOT NULL,
    ALTER COLUMN "records_updated" SET DEFAULT 0,
    ALTER COLUMN "records_updated" SET NOT NULL,
    ALTER COLUMN "records_failed" SET DEFAULT 0,
    ALTER COLUMN "records_failed" SET NOT NULL,
    ALTER COLUMN "updated_at" SET DEFAULT now();

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'label_suite.sync_jobs'::regclass
      AND conname = left('sync_jobs_connection_id_integration_connections_id_fk', 63)
  ) THEN
    ALTER TABLE "label_suite"."sync_jobs"
      ADD CONSTRAINT "sync_jobs_connection_id_integration_connections_id_fk"
      FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_jobs_org_connection_idempotency_unique_idx"
  ON "label_suite"."sync_jobs" ("org_id", "connection_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "sync_jobs_org_created_idx"
  ON "label_suite"."sync_jobs" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "sync_jobs_connection_created_idx"
  ON "label_suite"."sync_jobs" ("connection_id", "created_at");
CREATE INDEX IF NOT EXISTS "sync_jobs_provider_status_idx"
  ON "label_suite"."sync_jobs" ("org_id", "provider_key", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."raw_integration_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "connection_id" text NOT NULL,
  "sync_job_id" text,
  "provider_key" text NOT NULL,
  "event_type" text NOT NULL,
  "external_object_type" text,
  "external_object_id" text,
  "idempotency_key" text NOT NULL,
  "occurred_at" timestamp,
  "received_at" timestamp DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_hash" text NOT NULL,
  "processing_status" text DEFAULT 'pending' NOT NULL,
  "processing_error" text,
  CONSTRAINT "raw_integration_events_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "raw_integration_events_connection_id_integration_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "raw_integration_events_sync_job_id_sync_jobs_id_fk"
    FOREIGN KEY ("sync_job_id") REFERENCES "label_suite"."sync_jobs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "raw_integration_events_processing_status_check"
    CHECK ("processing_status" IN ('pending', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_integration_events_org_connection_idempotency_unique_idx"
  ON "label_suite"."raw_integration_events" ("org_id", "connection_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "raw_integration_events_org_received_idx"
  ON "label_suite"."raw_integration_events" ("org_id", "received_at");
CREATE INDEX IF NOT EXISTS "raw_integration_events_sync_job_idx"
  ON "label_suite"."raw_integration_events" ("sync_job_id");
CREATE INDEX IF NOT EXISTS "raw_integration_events_provider_type_idx"
  ON "label_suite"."raw_integration_events" ("org_id", "provider_key", "event_type");
CREATE INDEX IF NOT EXISTS "raw_integration_events_payload_hash_idx"
  ON "label_suite"."raw_integration_events" ("org_id", "connection_id", "payload_hash");
CREATE INDEX IF NOT EXISTS "raw_integration_events_processing_status_idx"
  ON "label_suite"."raw_integration_events" ("org_id", "processing_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."integration_errors" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "connection_id" text NOT NULL,
  "sync_job_id" text,
  "severity" text DEFAULT 'warning' NOT NULL,
  "code" text,
  "message" text NOT NULL,
  "external_object_type" text,
  "external_object_id" text,
  "resolved_at" timestamp,
  "resolved_by" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "integration_errors_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_errors_connection_id_integration_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_errors_sync_job_id_sync_jobs_id_fk"
    FOREIGN KEY ("sync_job_id") REFERENCES "label_suite"."sync_jobs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_errors_resolved_by_user_id_fk"
    FOREIGN KEY ("resolved_by") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "integration_errors_severity_check"
    CHECK ("severity" IN ('info', 'warning', 'error', 'critical'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_errors_org_created_idx"
  ON "label_suite"."integration_errors" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "integration_errors_connection_severity_idx"
  ON "label_suite"."integration_errors" ("connection_id", "severity");
CREATE INDEX IF NOT EXISTS "integration_errors_resolution_idx"
  ON "label_suite"."integration_errors" ("org_id", "resolved_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."data_quality_issues" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "connection_id" text,
  "sync_job_id" text,
  "source" text NOT NULL,
  "issue_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "priority" text DEFAULT 'P2' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "label_suite_object_type" text,
  "label_suite_object_id" text,
  "external_object_type" text,
  "external_object_id" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "data_quality_issues_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "data_quality_issues_connection_id_integration_connections_id_fk"
    FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "data_quality_issues_sync_job_id_sync_jobs_id_fk"
    FOREIGN KEY ("sync_job_id") REFERENCES "label_suite"."sync_jobs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "data_quality_issues_priority_check"
    CHECK ("priority" IN ('P0', 'P1', 'P2', 'P3')),
  CONSTRAINT "data_quality_issues_status_check"
    CHECK ("status" IN ('open', 'triaged', 'resolved', 'ignored'))
);
--> statement-breakpoint
-- Legacy quality issues used dedupe_hash as a required identity and carried
-- resolution columns. Keep those columns, but make the new idempotency key the
-- required write contract for the replacement runtime.
DO $$
BEGIN
  ALTER TABLE "label_suite"."data_quality_issues"
    ADD COLUMN IF NOT EXISTS "idempotency_key" text,
    ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'label_suite'
      AND table_name = 'data_quality_issues'
      AND column_name = 'dedupe_hash'
  ) THEN
    UPDATE "label_suite"."data_quality_issues"
    SET "idempotency_key" = coalesce("idempotency_key", "dedupe_hash", md5(concat_ws(':', "org_id", "id")));
  ELSE
    UPDATE "label_suite"."data_quality_issues"
    SET "idempotency_key" = coalesce("idempotency_key", md5(concat_ws(':', "org_id", "id")));
  END IF;
  ALTER TABLE "label_suite"."data_quality_issues"
    ALTER COLUMN "idempotency_key" SET DEFAULT md5(random()::text || clock_timestamp()::text),
    ALTER COLUMN "idempotency_key" SET NOT NULL,
    ALTER COLUMN "details" SET DEFAULT '{}'::jsonb;
  UPDATE "label_suite"."data_quality_issues"
  SET "details" = '{}'::jsonb
  WHERE "details" IS NULL;
  ALTER TABLE "label_suite"."data_quality_issues"
    ALTER COLUMN "details" SET NOT NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'label_suite'
      AND table_name = 'data_quality_issues'
      AND column_name = 'dedupe_hash'
  ) THEN
    ALTER TABLE "label_suite"."data_quality_issues"
      ALTER COLUMN "dedupe_hash" DROP NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'label_suite.data_quality_issues'::regclass
      AND conname = left('data_quality_issues_connection_id_integration_connections_id_fk', 63)
  ) THEN
    ALTER TABLE "label_suite"."data_quality_issues"
      ADD CONSTRAINT "data_quality_issues_connection_id_integration_connections_id_fk"
      FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_quality_issues_org_priority_status_idx"
  ON "label_suite"."data_quality_issues" ("org_id", "priority", "status");
CREATE INDEX IF NOT EXISTS "data_quality_issues_source_idx"
  ON "label_suite"."data_quality_issues" ("org_id", "source");
CREATE INDEX IF NOT EXISTS "data_quality_issues_connection_idx"
  ON "label_suite"."data_quality_issues" ("connection_id");
CREATE INDEX IF NOT EXISTS "data_quality_issues_label_suite_object_idx"
  ON "label_suite"."data_quality_issues" ("org_id", "label_suite_object_type", "label_suite_object_id");
CREATE UNIQUE INDEX IF NOT EXISTS "data_quality_issues_org_idempotency_unique_idx"
  ON "label_suite"."data_quality_issues" ("org_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "actor_user_id" text,
  "actor_type" text DEFAULT 'user' NOT NULL,
  "event_type" text NOT NULL,
  "object_type" text NOT NULL,
  "object_id" text,
  "before" jsonb,
  "after" jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "audit_events_org_id_orgs_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "audit_events_actor_user_id_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "audit_events_actor_type_check"
    CHECK ("actor_type" IN ('user', 'system', 'integration'))
);
--> statement-breakpoint
-- The legacy audit_events ledger already has rows and requires object_id.
-- Relax only that legacy-only requirement and add the new before/after payloads.
DO $$
BEGIN
  ALTER TABLE "label_suite"."audit_events"
    ADD COLUMN IF NOT EXISTS "before" jsonb,
    ADD COLUMN IF NOT EXISTS "after" jsonb,
    ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;
  UPDATE "label_suite"."audit_events"
  SET "metadata" = '{}'::jsonb
  WHERE "metadata" IS NULL;
  ALTER TABLE "label_suite"."audit_events"
    ALTER COLUMN "object_id" DROP NOT NULL,
    ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb,
    ALTER COLUMN "metadata" SET NOT NULL;
END $$;
--> statement-breakpoint
-- CREATE TABLE IF NOT EXISTS does not apply its constraints to an existing
-- legacy relation. Install and validate the canonical checks and references
-- explicitly so the upgraded tables enforce the same contract as a clean DB.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('integration_connections', 'integration_connections_org_id_orgs_id_fk', $sql$ALTER TABLE "label_suite"."integration_connections" ADD CONSTRAINT "integration_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID$sql$),
      ('integration_connections', 'integration_connections_provider_id_integration_providers_id_fk', $sql$ALTER TABLE "label_suite"."integration_connections" ADD CONSTRAINT "integration_connections_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "label_suite"."integration_providers"("id") NOT VALID$sql$),
      ('integration_connections', 'integration_connections_created_by_user_id_fk', $sql$ALTER TABLE "label_suite"."integration_connections" ADD CONSTRAINT "integration_connections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "label_suite"."user"("id") NOT VALID$sql$),
      ('integration_connections', 'integration_connections_status_check', $sql$ALTER TABLE "label_suite"."integration_connections" ADD CONSTRAINT "integration_connections_status_check" CHECK ("status" IN ('connected', 'needs_attention', 'paused', 'revoked')) NOT VALID$sql$),
      ('external_object_links', 'external_object_links_org_id_orgs_id_fk', $sql$ALTER TABLE "label_suite"."external_object_links" ADD CONSTRAINT "external_object_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID$sql$),
      ('external_object_links', 'external_object_links_connection_id_integration_connections_id_fk', $sql$ALTER TABLE "label_suite"."external_object_links" ADD CONSTRAINT "external_object_links_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") NOT VALID$sql$),
      ('external_object_links', 'external_object_links_match_method_check', $sql$ALTER TABLE "label_suite"."external_object_links" ADD CONSTRAINT "external_object_links_match_method_check" CHECK ("match_method" IN ('manual', 'isrc', 'upc', 'title_artist', 'provider_callback', 'import_rule')) NOT VALID$sql$),
      ('external_object_links', 'external_object_links_status_check', $sql$ALTER TABLE "label_suite"."external_object_links" ADD CONSTRAINT "external_object_links_status_check" CHECK ("status" IN ('active', 'needs_review', 'ignored', 'archived')) NOT VALID$sql$),
      ('external_object_links', 'external_object_links_confidence_check', $sql$ALTER TABLE "label_suite"."external_object_links" ADD CONSTRAINT "external_object_links_confidence_check" CHECK ("match_confidence" IS NULL OR ("match_confidence" >= 0 AND "match_confidence" <= 100)) NOT VALID$sql$),
      ('sync_jobs', 'sync_jobs_org_id_orgs_id_fk', $sql$ALTER TABLE "label_suite"."sync_jobs" ADD CONSTRAINT "sync_jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID$sql$),
      ('sync_jobs', 'sync_jobs_connection_id_integration_connections_id_fk', $sql$ALTER TABLE "label_suite"."sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") NOT VALID$sql$),
      ('sync_jobs', 'sync_jobs_job_type_check', $sql$ALTER TABLE "label_suite"."sync_jobs" ADD CONSTRAINT "sync_jobs_job_type_check" CHECK ("job_type" IN ('pull', 'push', 'webhook', 'manual_import', 'export', 'reconcile')) NOT VALID$sql$),
      ('sync_jobs', 'sync_jobs_status_check', $sql$ALTER TABLE "label_suite"."sync_jobs" ADD CONSTRAINT "sync_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'partial', 'cancelled')) NOT VALID$sql$),
      ('sync_jobs', 'sync_jobs_counts_check', $sql$ALTER TABLE "label_suite"."sync_jobs" ADD CONSTRAINT "sync_jobs_counts_check" CHECK ("records_seen" >= 0 AND "records_created" >= 0 AND "records_updated" >= 0 AND "records_failed" >= 0) NOT VALID$sql$),
      ('data_quality_issues', 'data_quality_issues_org_id_orgs_id_fk', $sql$ALTER TABLE "label_suite"."data_quality_issues" ADD CONSTRAINT "data_quality_issues_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID$sql$),
      ('data_quality_issues', 'data_quality_issues_connection_id_integration_connections_id_fk', $sql$ALTER TABLE "label_suite"."data_quality_issues" ADD CONSTRAINT "data_quality_issues_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "label_suite"."integration_connections"("id") NOT VALID$sql$),
      ('data_quality_issues', 'data_quality_issues_sync_job_id_sync_jobs_id_fk', $sql$ALTER TABLE "label_suite"."data_quality_issues" ADD CONSTRAINT "data_quality_issues_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "label_suite"."sync_jobs"("id") NOT VALID$sql$),
      ('data_quality_issues', 'data_quality_issues_priority_check', $sql$ALTER TABLE "label_suite"."data_quality_issues" ADD CONSTRAINT "data_quality_issues_priority_check" CHECK ("priority" IN ('P0', 'P1', 'P2', 'P3')) NOT VALID$sql$),
      ('data_quality_issues', 'data_quality_issues_status_check', $sql$ALTER TABLE "label_suite"."data_quality_issues" ADD CONSTRAINT "data_quality_issues_status_check" CHECK ("status" IN ('open', 'triaged', 'resolved', 'ignored')) NOT VALID$sql$),
      ('audit_events', 'audit_events_org_id_orgs_id_fk', $sql$ALTER TABLE "label_suite"."audit_events" ADD CONSTRAINT "audit_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") NOT VALID$sql$),
      ('audit_events', 'audit_events_actor_user_id_user_id_fk', $sql$ALTER TABLE "label_suite"."audit_events" ADD CONSTRAINT "audit_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "label_suite"."user"("id") NOT VALID$sql$),
      ('audit_events', 'audit_events_actor_type_check', $sql$ALTER TABLE "label_suite"."audit_events" ADD CONSTRAINT "audit_events_actor_type_check" CHECK ("actor_type" IN ('user', 'system', 'integration')) NOT VALID$sql$)
    ) AS constraints(table_name, constraint_name, statement)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = format('label_suite.%I', item.table_name)::regclass
        AND conname = left(item.constraint_name, 63)
    ) THEN
      EXECUTE item.statement;
    END IF;
    EXECUTE format(
      'ALTER TABLE label_suite.%I VALIDATE CONSTRAINT %I',
      item.table_name,
      left(item.constraint_name, 63)
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_org_created_idx"
  ON "label_suite"."audit_events" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_events_event_type_idx"
  ON "label_suite"."audit_events" ("org_id", "event_type");
CREATE INDEX IF NOT EXISTS "audit_events_object_idx"
  ON "label_suite"."audit_events" ("org_id", "object_type", "object_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."integration_providers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."integration_providers";
CREATE POLICY "tenant_isolation" ON "label_suite"."integration_providers"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."integration_connections" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."integration_connections";
CREATE POLICY "tenant_isolation" ON "label_suite"."integration_connections"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."external_object_links" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."external_object_links";
CREATE POLICY "tenant_isolation" ON "label_suite"."external_object_links"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."sync_jobs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."sync_jobs";
CREATE POLICY "tenant_isolation" ON "label_suite"."sync_jobs"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."raw_integration_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."raw_integration_events";
CREATE POLICY "tenant_isolation" ON "label_suite"."raw_integration_events"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."integration_errors" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."integration_errors";
CREATE POLICY "tenant_isolation" ON "label_suite"."integration_errors"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."data_quality_issues" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."data_quality_issues";
CREATE POLICY "tenant_isolation" ON "label_suite"."data_quality_issues"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
ALTER TABLE "label_suite"."audit_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."audit_events";
CREATE POLICY "tenant_isolation" ON "label_suite"."audit_events"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS same_org_references ON label_suite.integration_connections;
CREATE TRIGGER same_org_references
BEFORE INSERT OR UPDATE ON label_suite.integration_connections
FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('provider_id', 'integration_providers');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.external_object_links;
CREATE TRIGGER same_org_references
BEFORE INSERT OR UPDATE ON label_suite.external_object_links
FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('connection_id', 'integration_connections');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.sync_jobs;
CREATE TRIGGER same_org_references
BEFORE INSERT OR UPDATE ON label_suite.sync_jobs
FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('connection_id', 'integration_connections');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.raw_integration_events;
CREATE TRIGGER same_org_references
BEFORE INSERT OR UPDATE ON label_suite.raw_integration_events
FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('connection_id', 'integration_connections', 'sync_job_id', 'sync_jobs');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.integration_errors;
CREATE TRIGGER same_org_references
BEFORE INSERT OR UPDATE ON label_suite.integration_errors
FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('connection_id', 'integration_connections', 'sync_job_id', 'sync_jobs');
DROP TRIGGER IF EXISTS same_org_references ON label_suite.data_quality_issues;
CREATE TRIGGER same_org_references
BEFORE INSERT OR UPDATE ON label_suite.data_quality_issues
FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('connection_id', 'integration_connections', 'sync_job_id', 'sync_jobs');
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.integration_providers;
CREATE TRIGGER audit_row_changes
AFTER INSERT OR UPDATE OR DELETE ON label_suite.integration_providers
FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.integration_connections;
CREATE TRIGGER audit_row_changes
AFTER INSERT OR UPDATE OR DELETE ON label_suite.integration_connections
FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.external_object_links;
CREATE TRIGGER audit_row_changes
AFTER INSERT OR UPDATE OR DELETE ON label_suite.external_object_links
FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.sync_jobs;
CREATE TRIGGER audit_row_changes
AFTER INSERT OR UPDATE OR DELETE ON label_suite.sync_jobs
FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.integration_errors;
CREATE TRIGGER audit_row_changes
AFTER INSERT OR UPDATE OR DELETE ON label_suite.integration_errors
FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.data_quality_issues;
CREATE TRIGGER audit_row_changes
AFTER INSERT OR UPDATE OR DELETE ON label_suite.data_quality_issues
FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
