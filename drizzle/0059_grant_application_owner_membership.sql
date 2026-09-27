ALTER TABLE "label_suite"."grant_applications"
  ADD COLUMN IF NOT EXISTS "owner_user_id" text REFERENCES "label_suite"."user"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_applications_org_owner_user_idx"
  ON "label_suite"."grant_applications" ("org_id", "owner_user_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "label_suite"."enforce_grant_application_owner_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."owner_user_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "label_suite"."org_memberships" membership
    WHERE membership."org_id" = NEW."org_id"
      AND membership."user_id" = NEW."owner_user_id"
  ) THEN
    RAISE EXCEPTION 'Grant application owner must be a member of the same organization';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS enforce_grant_application_owner_membership ON "label_suite"."grant_applications";
--> statement-breakpoint
CREATE TRIGGER enforce_grant_application_owner_membership
  BEFORE INSERT OR UPDATE OF "org_id", "owner_user_id" ON "label_suite"."grant_applications"
  FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_grant_application_owner_membership"();
--> statement-breakpoint
UPDATE "label_suite"."grant_applications" application
SET "owner_user_id" = member."user_id"
FROM "label_suite"."contacts" contact
CROSS JOIN "label_suite"."org_memberships" member
JOIN "label_suite"."user" account ON account."id" = member."user_id"
WHERE application."org_id" = member."org_id"
  AND application."owner_contact_id" = contact."id"
  AND lower(btrim(contact."email")) = lower(btrim(account."email"))
  AND application."owner_user_id" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "label_suite"."org_memberships" duplicate_member
    JOIN "label_suite"."user" duplicate_account ON duplicate_account."id" = duplicate_member."user_id"
    WHERE duplicate_member."org_id" = application."org_id"
      AND lower(btrim(duplicate_account."email")) = lower(btrim(account."email"))
      AND duplicate_member."user_id" <> member."user_id"
  );
