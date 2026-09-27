CREATE TABLE "label_suite"."campaign_stations" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text,
	"station_id" text,
	"status" text DEFAULT 'pending'
);
--> statement-breakpoint
CREATE TABLE "label_suite"."campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_name" text NOT NULL,
	"linked_release_id" text,
	"linked_artist_id" text,
	"campaign_type" text,
	"start_date" text,
	"end_date" text,
	"status" text DEFAULT 'planning',
	"owner" text,
	"goal" text,
	"budget_planned" real,
	"budget_actual" real,
	"kpi_summary" text,
	"notes" text,
	"performance_rating" integer,
	"main_platform" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."radio_stations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"call_sign" text,
	"frequency" text,
	"city" text,
	"state" text,
	"country" text,
	"email" text,
	"phone" text,
	"website" text,
	"dj_name" text,
	"tier" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD CONSTRAINT "campaign_stations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "label_suite"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_stations" ADD CONSTRAINT "campaign_stations_station_id_radio_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "label_suite"."radio_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."campaigns" ADD CONSTRAINT "campaigns_linked_release_id_releases_id_fk" FOREIGN KEY ("linked_release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."campaigns" ADD CONSTRAINT "campaigns_linked_artist_id_artists_id_fk" FOREIGN KEY ("linked_artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;