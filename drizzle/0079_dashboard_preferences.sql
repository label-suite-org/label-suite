CREATE TABLE IF NOT EXISTS "label_suite"."dashboard_preferences" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "user_id" text NOT NULL REFERENCES "label_suite"."user"("id"),
  "schema_version" integer DEFAULT 1 NOT NULL,
  "pinned_indicator_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "section_order" jsonb DEFAULT '["releases","tasks","catalog","analytics","royalties","funding"]'::jsonb NOT NULL,
  "hidden_section_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "dashboard_preferences_schema_version_check" CHECK (schema_version > 0),
  CONSTRAINT "dashboard_preferences_pins_check" CHECK (
    jsonb_typeof(pinned_indicator_ids) = 'array'
    AND jsonb_array_length(pinned_indicator_ids) <= 3
  ),
  CONSTRAINT "dashboard_preferences_section_order_check" CHECK (
    jsonb_typeof(section_order) = 'array'
    AND jsonb_array_length(section_order) = 6
  ),
  CONSTRAINT "dashboard_preferences_hidden_sections_check" CHECK (
    jsonb_typeof(hidden_section_ids) = 'array'
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_preferences_org_id_idx"
  ON "label_suite"."dashboard_preferences" ("org_id");
CREATE INDEX IF NOT EXISTS "dashboard_preferences_user_id_idx"
  ON "label_suite"."dashboard_preferences" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_preferences_org_user_unique_idx"
  ON "label_suite"."dashboard_preferences" ("org_id", "user_id");
--> statement-breakpoint
ALTER TABLE "label_suite"."dashboard_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_suite"."dashboard_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dashboard_preferences_personal_isolation" ON "label_suite"."dashboard_preferences";
CREATE POLICY "dashboard_preferences_personal_isolation" ON "label_suite"."dashboard_preferences"
  USING (
    "org_id" = "label_suite"."current_org_id"()
    AND "user_id" = "label_suite"."current_user_id"()
  )
  WITH CHECK (
    "org_id" = "label_suite"."current_org_id"()
    AND "user_id" = "label_suite"."current_user_id"()
  );
