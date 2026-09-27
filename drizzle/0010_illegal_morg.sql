CREATE TABLE "label_suite"."org_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."org_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."org_invitations" ADD CONSTRAINT "org_invitations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."org_memberships" ADD CONSTRAINT "org_memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."org_memberships" ADD CONSTRAINT "org_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_invitations_org_id_idx" ON "label_suite"."org_invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_invitations_email_idx" ON "label_suite"."org_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitations_token_unique_idx" ON "label_suite"."org_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "org_memberships_org_id_idx" ON "label_suite"."org_memberships" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_memberships_user_id_idx" ON "label_suite"."org_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_memberships_org_user_unique_idx" ON "label_suite"."org_memberships" USING btree ("org_id","user_id");--> statement-breakpoint
INSERT INTO "label_suite"."org_memberships" ("id", "org_id", "user_id", "role")
SELECT 'true-nature:' || "id", 'true-nature', "id", 'owner'
FROM "label_suite"."user"
ON CONFLICT ("org_id", "user_id") DO NOTHING;
