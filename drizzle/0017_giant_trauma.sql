CREATE TABLE "label_suite"."budget_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"name" text NOT NULL,
	"artist_id" text,
	"release_id" text,
	"status" text DEFAULT 'planning',
	"currency" text DEFAULT 'USD',
	"total_planned" real DEFAULT 0,
	"baseline_funding" real DEFAULT 0,
	"track_count" real,
	"singles_count" real,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."funding_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending',
	"amount_planned" real DEFAULT 0,
	"amount_confirmed" real DEFAULT 0,
	"restricted_to" text,
	"funder" text,
	"deadline" text,
	"reporting_required" real DEFAULT 0,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "funding_source_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "planned_amount" real;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "forecast_amount" real;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "committed_amount" real;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "paid_amount" real;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "spend_month" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "lock_status" text DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "eligibility_tag" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "variance_reason" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "label_suite"."budget_projects" ADD CONSTRAINT "budget_projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_projects" ADD CONSTRAINT "budget_projects_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_projects" ADD CONSTRAINT "budget_projects_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_sources" ADD CONSTRAINT "funding_sources_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_sources" ADD CONSTRAINT "funding_sources_project_id_budget_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "label_suite"."budget_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_projects_org_id_idx" ON "label_suite"."budget_projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "budget_projects_release_id_idx" ON "label_suite"."budget_projects" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "budget_projects_artist_id_idx" ON "label_suite"."budget_projects" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "funding_sources_org_id_idx" ON "label_suite"."funding_sources" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "funding_sources_project_id_idx" ON "label_suite"."funding_sources" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD CONSTRAINT "budget_line_items_project_id_budget_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "label_suite"."budget_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD CONSTRAINT "budget_line_items_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "label_suite"."funding_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_line_items_project_id_idx" ON "label_suite"."budget_line_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "budget_line_items_funding_source_id_idx" ON "label_suite"."budget_line_items" USING btree ("funding_source_id");