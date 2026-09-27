-- Make grant_applications the lifecycle owner without changing coverage totals.
-- The deterministic id and funding_source_id guard make this safe to re-run.
INSERT INTO "label_suite"."grant_applications" (
  "id", "org_id", "project_id", "grant_id", "funding_source_id", "owner_contact_id",
  "status", "priority", "workflow_stage", "outcome", "amount_requested", "amount_awarded",
  "submission_deadline", "submitted_at", "decision_date", "reporting_due", "next_action",
  "next_action_due", "notes"
)
SELECT
  'legacy-grant-application-' || fs."id",
  fs."org_id",
  fs."project_id",
  NULL,
  fs."id",
  NULL,
  CASE WHEN NULLIF(fs."application_date", '') IS NOT NULL THEN 'submitted' ELSE COALESCE(fs."status", 'draft') END,
  'medium',
  CASE
    WHEN lower(COALESCE(fs."status", '')) = 'research' THEN 'research'
    WHEN lower(COALESCE(fs."status", '')) IN ('granted', 'awarded', 'confirmed') AND NULLIF(fs."grant_reporting_due", '') IS NOT NULL THEN 'reporting'
    WHEN lower(COALESCE(fs."status", '')) IN ('granted', 'awarded', 'confirmed', 'rejected') THEN 'closed'
    WHEN NULLIF(fs."application_date", '') IS NOT NULL THEN 'submitted'
    ELSE 'idea'
  END,
  CASE
    WHEN lower(COALESCE(fs."status", '')) IN ('granted', 'awarded', 'confirmed') THEN 'approved'
    WHEN lower(COALESCE(fs."status", '')) = 'rejected' THEN 'rejected'
    ELSE 'unknown'
  END,
  NULLIF(fs."amount_planned", 0),
  CASE WHEN lower(COALESCE(fs."status", '')) IN ('granted', 'awarded', 'confirmed') THEN NULLIF(fs."grant_amount_received", 0) ELSE NULL END,
  NULL,
  CASE WHEN fs."application_date" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN fs."application_date"::timestamp ELSE NULL END,
  CASE WHEN fs."decision_date" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN fs."decision_date"::date ELSE NULL END,
  CASE WHEN fs."grant_reporting_due" ~ '^\\d{4}-\\d{2}-\\d{2}' THEN fs."grant_reporting_due"::date ELSE NULL END,
  CASE WHEN lower(COALESCE(fs."status", '')) IN ('granted', 'awarded', 'confirmed') AND NULLIF(fs."grant_reporting_due", '') IS NOT NULL THEN 'Submit funder report' ELSE NULL END,
  NULL,
  'Migrated from legacy funding source ' || fs."id" || '.'
FROM "label_suite"."funding_sources" fs
WHERE lower(COALESCE(fs."type", '')) = 'grant'
  AND (
    NULLIF(fs."application_date", '') IS NOT NULL
    OR NULLIF(fs."decision_date", '') IS NOT NULL
    OR NULLIF(fs."grant_reporting_due", '') IS NOT NULL
    OR COALESCE(fs."grant_amount_received", 0) <> 0
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "label_suite"."grant_applications" existing
    WHERE existing."org_id" = fs."org_id"
      AND existing."funding_source_id" = fs."id"
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "label_suite"."funding_source_events" (
  "id", "org_id", "funding_source_id", "from_status", "to_status", "occurred_at", "note"
)
SELECT
  'legacy-grant-source-event-' || fs."id",
  fs."org_id",
  fs."id",
  fs."status",
  'confirmed',
  now(),
  'Legacy grant lifecycle migrated to grant application'
FROM "label_suite"."funding_sources" fs
WHERE lower(COALESCE(fs."status", '')) IN ('granted', 'awarded')
  AND NULLIF(fs."grant_amount_received", 0) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "label_suite"."funding_source_events" event
    WHERE event."id" = 'legacy-grant-source-event-' || fs."id"
  )
ON CONFLICT ("id") DO NOTHING;

UPDATE "label_suite"."funding_sources"
SET "status" = 'confirmed',
    "amount_confirmed" = COALESCE("amount_confirmed", "grant_amount_received", "amount_planned"),
    "updated_at" = now()
WHERE lower(COALESCE("status", '')) IN ('granted', 'awarded')
  AND NULLIF("grant_amount_received", 0) IS NOT NULL;

COMMENT ON COLUMN "label_suite"."funding_sources"."application_date" IS 'Deprecated: lifecycle is owned by grant_applications; retained for migration compatibility.';
COMMENT ON COLUMN "label_suite"."funding_sources"."decision_date" IS 'Deprecated: lifecycle is owned by grant_applications; retained for migration compatibility.';
COMMENT ON COLUMN "label_suite"."funding_sources"."grant_amount_received" IS 'Deprecated: lifecycle is owned by grant_applications; retained for migration compatibility.';
COMMENT ON COLUMN "label_suite"."funding_sources"."grant_reporting_due" IS 'Deprecated: lifecycle is owned by grant_applications; retained for migration compatibility.';
