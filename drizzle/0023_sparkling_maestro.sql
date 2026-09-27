ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "last_contacted_at" timestamp;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "follow_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "priority" text DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "pitch_angle" text;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD COLUMN "updated_at" timestamp DEFAULT now();--> statement-breakpoint
CREATE INDEX "campaign_stations_status_idx" ON "label_suite"."campaign_stations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaign_stations_follow_up_at_idx" ON "label_suite"."campaign_stations" USING btree ("follow_up_at");