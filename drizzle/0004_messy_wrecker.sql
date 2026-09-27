CREATE TABLE "label_suite"."documents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doc_type" text,
	"release_id" text,
	"artist_id" text,
	"contact_id" text,
	"status" text DEFAULT 'draft',
	"file_link" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_name" text NOT NULL,
	"asset_type" text,
	"linked_artist_id" text,
	"linked_release_id" text,
	"version" text,
	"approval_status" text DEFAULT 'pending',
	"delivery_status" text DEFAULT 'not_sent',
	"file_link" text,
	"notes" text,
	"date_uploaded" date,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."side_artists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"artist_id" text,
	"release_id" text,
	"type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."documents" ADD CONSTRAINT "documents_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."documents" ADD CONSTRAINT "documents_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."media_assets" ADD CONSTRAINT "media_assets_linked_artist_id_artists_id_fk" FOREIGN KEY ("linked_artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."media_assets" ADD CONSTRAINT "media_assets_linked_release_id_releases_id_fk" FOREIGN KEY ("linked_release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."side_artists" ADD CONSTRAINT "side_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."side_artists" ADD CONSTRAINT "side_artists_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;