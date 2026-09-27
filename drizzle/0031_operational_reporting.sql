CREATE TABLE "label_suite"."reporting_weeks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "reporting_weeks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."release_reporting" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"reporting_week_id" text NOT NULL,
	"release_id" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"priority" text DEFAULT 'P2',
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "release_reporting_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "release_reporting_reporting_week_id_reporting_weeks_id_fk" FOREIGN KEY ("reporting_week_id") REFERENCES "label_suite"."reporting_weeks"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "release_reporting_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD COLUMN "project_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD COLUMN "status" text DEFAULT 'scheduled' NOT NULL;
--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD COLUMN "call_type" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "linked_campaign_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "linked_contact_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "owner_contact_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "project_id" text;
--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD CONSTRAINT "calls_project_id_budget_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "label_suite"."budget_projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_linked_campaign_id_campaigns_id_fk" FOREIGN KEY ("linked_campaign_id") REFERENCES "label_suite"."campaigns"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_linked_contact_id_contacts_id_fk" FOREIGN KEY ("linked_contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_owner_contact_id_contacts_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_project_id_budget_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "label_suite"."budget_projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reporting_weeks_org_start_idx" ON "label_suite"."reporting_weeks" USING btree ("org_id","start_date");
--> statement-breakpoint
CREATE INDEX "reporting_weeks_org_end_idx" ON "label_suite"."reporting_weeks" USING btree ("org_id","end_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "reporting_weeks_org_dates_unique_idx" ON "label_suite"."reporting_weeks" USING btree ("org_id","start_date","end_date");
--> statement-breakpoint
CREATE INDEX "release_reporting_org_id_idx" ON "label_suite"."release_reporting" USING btree ("org_id");
--> statement-breakpoint
CREATE INDEX "release_reporting_week_id_idx" ON "label_suite"."release_reporting" USING btree ("reporting_week_id");
--> statement-breakpoint
CREATE INDEX "release_reporting_release_id_idx" ON "label_suite"."release_reporting" USING btree ("release_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "release_reporting_org_week_release_unique_idx" ON "label_suite"."release_reporting" USING btree ("org_id","reporting_week_id","release_id");
--> statement-breakpoint
CREATE INDEX "calls_project_id_idx" ON "label_suite"."calls" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "calls_status_idx" ON "label_suite"."calls" USING btree ("org_id","status");
--> statement-breakpoint
CREATE INDEX "ops_tasks_linked_campaign_id_idx" ON "label_suite"."ops_tasks" USING btree ("linked_campaign_id");
--> statement-breakpoint
CREATE INDEX "ops_tasks_linked_contact_id_idx" ON "label_suite"."ops_tasks" USING btree ("linked_contact_id");
--> statement-breakpoint
CREATE INDEX "ops_tasks_owner_contact_id_idx" ON "label_suite"."ops_tasks" USING btree ("owner_contact_id");
--> statement-breakpoint
CREATE INDEX "ops_tasks_project_id_idx" ON "label_suite"."ops_tasks" USING btree ("project_id");
