ALTER TABLE "label_suite"."contacts" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "label_suite"."contacts" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "label_suite"."contacts" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "label_suite"."organizations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "label_suite"."organizations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "label_suite"."organizations" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "label_suite"."organizations" ADD COLUMN "image_url" text;--> statement-breakpoint
CREATE TABLE "label_suite"."gmail_connections" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "user_id" text NOT NULL,
  "email" text NOT NULL,
  "scope" text,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "token_type" text DEFAULT 'Bearer',
  "expires_at" timestamp,
  "status" text DEFAULT 'connected' NOT NULL,
  "last_scan_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "gmail_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "gmail_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "label_suite"."user"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."contact_enrichment_suggestions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "contact_id" text,
  "organization_id" text,
  "source_connection_id" text,
  "source_type" text DEFAULT 'gmail' NOT NULL,
  "field" text NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "confidence" real DEFAULT 0.5 NOT NULL,
  "evidence" jsonb,
  "status" text DEFAULT 'pending' NOT NULL,
  "applied_at" timestamp,
  "ignored_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "contact_enrichment_suggestions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "contact_enrichment_suggestions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "contact_enrichment_suggestions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "label_suite"."organizations"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "contact_enrichment_suggestions_source_connection_id_gmail_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "label_suite"."gmail_connections"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "gmail_connections_org_id_idx" ON "label_suite"."gmail_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "gmail_connections_user_id_idx" ON "label_suite"."gmail_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_connections_org_user_email_unique_idx" ON "label_suite"."gmail_connections" USING btree ("org_id","user_id","email");--> statement-breakpoint
CREATE INDEX "contact_enrichment_suggestions_org_id_idx" ON "label_suite"."contact_enrichment_suggestions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contact_enrichment_suggestions_contact_id_idx" ON "label_suite"."contact_enrichment_suggestions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_enrichment_suggestions_status_idx" ON "label_suite"."contact_enrichment_suggestions" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_enrichment_suggestions_unique_idx" ON "label_suite"."contact_enrichment_suggestions" USING btree ("org_id","contact_id","field","normalized_value","source_type");
