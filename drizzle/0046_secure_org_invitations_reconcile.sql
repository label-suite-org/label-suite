ALTER TABLE "label_suite"."org_invitations"
  ADD COLUMN IF NOT EXISTS "normalized_email" text,
  ADD COLUMN IF NOT EXISTS "token_digest" text,
  ADD COLUMN IF NOT EXISTS "invited_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "accepted_by_user_id" text,
  ADD COLUMN IF NOT EXISTS "revoked_at" timestamp,
  ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp;
--> statement-breakpoint
UPDATE "label_suite"."org_invitations"
SET "normalized_email" = lower(btrim("email"))
WHERE "normalized_email" IS NULL;
--> statement-breakpoint
UPDATE "label_suite"."org_invitations"
SET "status" = 'revoked', "revoked_at" = now(), "updated_at" = now()
WHERE "status" = 'pending'
  AND "token_digest" IS NULL;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ALTER COLUMN "normalized_email" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "label_suite"."org_invitations_token_unique_idx";
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" DROP COLUMN IF EXISTS "token";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'org_invitations_invited_by_user_id_user_id_fk'
      AND conrelid = 'label_suite.org_invitations'::regclass
  ) THEN
    ALTER TABLE "label_suite"."org_invitations"
      ADD CONSTRAINT "org_invitations_invited_by_user_id_user_id_fk"
      FOREIGN KEY ("invited_by_user_id") REFERENCES "label_suite"."user"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'org_invitations_accepted_by_user_id_user_id_fk'
      AND conrelid = 'label_suite.org_invitations'::regclass
  ) THEN
    ALTER TABLE "label_suite"."org_invitations"
      ADD CONSTRAINT "org_invitations_accepted_by_user_id_user_id_fk"
      FOREIGN KEY ("accepted_by_user_id") REFERENCES "label_suite"."user"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_invitations_token_digest_unique_idx"
  ON "label_suite"."org_invitations" USING btree ("token_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "org_invitations_pending_email_unique_idx"
  ON "label_suite"."org_invitations" USING btree ("org_id", "normalized_email")
  WHERE "status" = 'pending';
