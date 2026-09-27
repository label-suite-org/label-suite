ALTER TABLE "label_suite"."orgs"
  ADD COLUMN "legal_name" text,
  ADD COLUMN "timezone" text DEFAULT 'Europe/Copenhagen',
  ADD COLUMN "currency" text DEFAULT 'DKK',
  ADD COLUMN "validation_sweep_mode" text DEFAULT 'manual',
  ADD COLUMN "default_release_policy" text DEFAULT 'readiness_gates',
  ADD COLUMN "isrc_country_code" text,
  ADD COLUMN "isrc_registrant_code" text;

UPDATE "label_suite"."orgs"
SET
  "timezone" = COALESCE("timezone", 'Europe/Copenhagen'),
  "currency" = COALESCE("currency", 'DKK'),
  "validation_sweep_mode" = COALESCE("validation_sweep_mode", 'manual'),
  "default_release_policy" = COALESCE("default_release_policy", 'readiness_gates')
WHERE
  "timezone" IS NULL
  OR "currency" IS NULL
  OR "validation_sweep_mode" IS NULL
  OR "default_release_policy" IS NULL;

UPDATE "label_suite"."orgs"
SET
  "isrc_country_code" = COALESCE("isrc_country_code", 'DK'),
  "isrc_registrant_code" = COALESCE("isrc_registrant_code", 'O7P')
WHERE "id" = 'true-nature';
