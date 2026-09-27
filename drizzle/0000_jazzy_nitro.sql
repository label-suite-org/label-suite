CREATE SCHEMA IF NOT EXISTS "label_suite";
--> statement-breakpoint
CREATE TABLE "label_suite"."artists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"spotify_id" text,
	"spotify_followers" integer,
	"spotify_popularity" integer,
	"pro" text,
	"ipi" text,
	"instagram" text,
	"tiktok" text,
	"contact_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."budget_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text
);
--> statement-breakpoint
CREATE TABLE "label_suite"."budget_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text,
	"category_id" text,
	"name" text NOT NULL,
	"amount" real NOT NULL,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."bugs" (
	"id" text PRIMARY KEY NOT NULL,
	"bug_key" text,
	"source_table" text,
	"source_record_id" text,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'P2',
	"status" text DEFAULT 'logged',
	"auto_generated" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "bugs_bug_key_unique" UNIQUE("bug_key")
);
--> statement-breakpoint
CREATE TABLE "label_suite"."calls" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"contact_id" text,
	"release_id" text,
	"start" timestamp,
	"end" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"company" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."dsp_pitches" (
	"id" text PRIMARY KEY NOT NULL,
	"release_id" text,
	"platform" text,
	"status" text DEFAULT 'draft',
	"sent_date" timestamp,
	"response" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."isrc_sequences" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"last_production_number" integer DEFAULT 0,
	"prefix" text DEFAULT 'DKO7P',
	CONSTRAINT "isrc_sequences_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "label_suite"."releases" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist_id" text,
	"release_date" text,
	"format" text,
	"upc_ean" text,
	"cover_art_url" text,
	"status" text DEFAULT 'draft',
	"delivery_status" text,
	"exploitation_scope" text,
	"notes" text,
	"release_ready" boolean DEFAULT false,
	"release_missing" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."roles" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text,
	"work_id" text,
	"role" text,
	"ownership_type" text,
	"scope" text,
	"percent_share" real,
	"clearance_status" text,
	"reviewed_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"release_id" text,
	"work_id" text,
	"position" integer,
	"version" text,
	"isrc" text,
	"audio_url" text,
	"duration" integer,
	"track_ready" boolean DEFAULT false,
	"track_missing" text,
	"clearance_progress" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."works" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"isrc" text,
	"iswc" text,
	"audio_url" text,
	"duration" integer,
	"genre" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."artists" ADD CONSTRAINT "artists_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD CONSTRAINT "budget_line_items_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_items" ADD CONSTRAINT "budget_line_items_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "label_suite"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."calls" ADD CONSTRAINT "calls_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."dsp_pitches" ADD CONSTRAINT "dsp_pitches_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."releases" ADD CONSTRAINT "releases_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."roles" ADD CONSTRAINT "roles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."roles" ADD CONSTRAINT "roles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "label_suite"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."tracks" ADD CONSTRAINT "tracks_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."tracks" ADD CONSTRAINT "tracks_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "label_suite"."works"("id") ON DELETE no action ON UPDATE no action;
