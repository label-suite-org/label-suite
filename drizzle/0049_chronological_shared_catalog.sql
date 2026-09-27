ALTER TABLE "label_suite"."orgs"
  ADD COLUMN IF NOT EXISTS "catalog_prefix" text DEFAULT 'CAT' NOT NULL,
  ADD COLUMN IF NOT EXISTS "catalog_number_width" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
UPDATE "label_suite"."orgs"
SET "catalog_prefix" = CASE WHEN "id" = 'true-nature' THEN 'TN' ELSE COALESCE("catalog_prefix", 'CAT') END,
    "catalog_number_width" = COALESCE("catalog_number_width", 3)
WHERE "id" = 'true-nature' OR "catalog_prefix" IS NULL OR "catalog_number_width" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."catalog_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "entry_type" text DEFAULT 'release' NOT NULL,
  "title" text NOT NULL,
  "release_id" text,
  "release_date" text,
  "status" text DEFAULT 'planned' NOT NULL,
  "catalog_number" text,
  "catalog_number_locked" boolean DEFAULT false NOT NULL,
  "catalog_number_source" text DEFAULT 'generated' NOT NULL,
  "sort_position" integer DEFAULT 0 NOT NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "catalog_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "catalog_entries_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_entries_org_id_idx" ON "label_suite"."catalog_entries" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_entries_org_date_position_idx" ON "label_suite"."catalog_entries" ("org_id", "release_date", "sort_position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_entries_org_release_idx" ON "label_suite"."catalog_entries" ("org_id", "release_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_entries_org_release_entry_unique_idx" ON "label_suite"."catalog_entries" ("org_id", "release_id") WHERE "entry_type" = 'release' AND "release_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_entries_org_number_unique_idx" ON "label_suite"."catalog_entries" ("org_id", "catalog_number") WHERE "catalog_number" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "label_suite"."catalog_entries" (
  "id", "org_id", "entry_type", "title", "release_id", "release_date", "status",
  "catalog_number_source", "sort_position", "notes", "created_at", "updated_at"
)
SELECT
  'release:' || r."id",
  r."org_id",
  'release',
  r."title",
  r."id",
  r."release_date",
  CASE lower(coalesce(r."status", 'draft'))
    WHEN 'released' THEN 'published'
    WHEN 'scheduled' THEN 'scheduled'
    WHEN 'archived' THEN 'archived'
    ELSE 'planned'
  END,
  'generated',
  0,
  r."notes",
  r."created_at",
  r."updated_at"
FROM "label_suite"."releases" r
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
WITH ordered AS (
  SELECT
    ce."id",
    o."catalog_prefix",
    o."catalog_number_width",
    row_number() OVER (
      PARTITION BY ce."org_id"
      ORDER BY ce."release_date" ASC NULLS LAST, ce."created_at" ASC NULLS LAST, ce."id" ASC
    ) AS catalog_rank
  FROM "label_suite"."catalog_entries" ce
  INNER JOIN "label_suite"."orgs" o ON o."id" = ce."org_id"
  WHERE ce."catalog_number" IS NULL
    AND ce."catalog_number_source" = 'generated'
)
UPDATE "label_suite"."catalog_entries" ce
SET "catalog_number" = ordered."catalog_prefix" || lpad(ordered.catalog_rank::text, ordered."catalog_number_width", '0'),
    "catalog_number_locked" = (ce."status" = 'published'),
    "updated_at" = now()
FROM ordered
WHERE ce."id" = ordered."id";
--> statement-breakpoint
ALTER TABLE "label_suite"."catalog_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."catalog_entries";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."catalog_entries"
USING ("org_id" = "label_suite"."current_org_id"())
WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."catalog_entries";
--> statement-breakpoint
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."catalog_entries"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
