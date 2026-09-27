CREATE TABLE "label_suite"."email_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"campaign_id" text,
	"station_id" text,
	"template_id" text,
	"subject" text NOT NULL,
	"body" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"sender_email" text,
	"error_message" text,
	"brevo_message_id" text,
	"sent_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."email_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."email_logs" ADD CONSTRAINT "email_logs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."email_logs" ADD CONSTRAINT "email_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "label_suite"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."email_logs" ADD CONSTRAINT "email_logs_station_id_radio_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "label_suite"."radio_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."email_logs" ADD CONSTRAINT "email_logs_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "label_suite"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."email_templates" ADD CONSTRAINT "email_templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_logs_org_id_idx" ON "label_suite"."email_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "email_logs_campaign_id_idx" ON "label_suite"."email_logs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "email_logs_station_id_idx" ON "label_suite"."email_logs" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "email_logs_status_idx" ON "label_suite"."email_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_templates_org_id_idx" ON "label_suite"."email_templates" USING btree ("org_id");