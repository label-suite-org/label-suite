CREATE TABLE "label_suite"."budget_line_variance_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"line_id" text NOT NULL,
	"requested_by_user_id" text,
	"requested_action" text NOT NULL,
	"current_value" text,
	"requested_value" text,
	"variance_reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."funding_source_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"funding_source_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"occurred_at" timestamp DEFAULT now(),
	"note" text
);
--> statement-breakpoint
ALTER TABLE "label_suite"."funding_sources" ADD COLUMN "application_date" text;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_sources" ADD COLUMN "decision_date" text;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_sources" ADD COLUMN "grant_amount_received" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_sources" ADD COLUMN "grant_reporting_due" text;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_variance_requests" ADD CONSTRAINT "budget_line_variance_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_variance_requests" ADD CONSTRAINT "budget_line_variance_requests_line_id_budget_line_items_id_fk" FOREIGN KEY ("line_id") REFERENCES "label_suite"."budget_line_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_source_events" ADD CONSTRAINT "funding_source_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."funding_source_events" ADD CONSTRAINT "funding_source_events_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "label_suite"."funding_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bli_variance_requests_org_id_idx" ON "label_suite"."budget_line_variance_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bli_variance_requests_line_id_idx" ON "label_suite"."budget_line_variance_requests" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "bli_variance_requests_status_idx" ON "label_suite"."budget_line_variance_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "funding_source_events_org_id_idx" ON "label_suite"."funding_source_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "funding_source_events_fs_id_idx" ON "label_suite"."funding_source_events" USING btree ("funding_source_id");--> statement-breakpoint
CREATE INDEX "funding_source_events_occurred_at_idx" ON "label_suite"."funding_source_events" USING btree ("occurred_at");