ALTER TABLE "label_suite"."org_invitations" ADD COLUMN "normalized_email" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD COLUMN "token_digest" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD COLUMN "invited_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD COLUMN "accepted_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD COLUMN "revoked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD COLUMN "last_sent_at" timestamp;
--> statement-breakpoint
UPDATE "label_suite"."org_invitations"
SET "normalized_email" = lower(btrim("email"));
--> statement-breakpoint
UPDATE "label_suite"."org_invitations"
SET "status" = 'revoked', "revoked_at" = now(), "updated_at" = now()
WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ALTER COLUMN "normalized_email" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "label_suite"."org_invitations_token_unique_idx";
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" DROP COLUMN "token";
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD CONSTRAINT "org_invitations_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD CONSTRAINT "org_invitations_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitations_token_digest_unique_idx" ON "label_suite"."org_invitations" USING btree ("token_digest");
--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitations_pending_email_unique_idx" ON "label_suite"."org_invitations" USING btree ("org_id", "normalized_email") WHERE "status" = 'pending';
