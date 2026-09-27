-- Preserve the operational deadline metadata used by the enrichment seed.
ALTER TABLE "label_suite"."grant_deadlines"
  ADD COLUMN IF NOT EXISTS "classification" text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS "source_url" text,
  ADD COLUMN IF NOT EXISTS "deadline_time" text,
  ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'Europe/Copenhagen';

-- Make grant_deadlines idempotent: enforce unique (org_id, grant_id, deadline_date)
-- so legacy rows can be updated by date rather than duplicated by ID.
CREATE UNIQUE INDEX IF NOT EXISTS "grant_deadlines_org_grant_date_unique_idx"
  ON "label_suite"."grant_deadlines" ("org_id", "grant_id", "deadline_date");
