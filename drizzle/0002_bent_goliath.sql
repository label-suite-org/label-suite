CREATE TABLE "label_suite"."royalties_revenue" (
	"id" text PRIMARY KEY NOT NULL,
	"record_name" text NOT NULL,
	"statement_period" text,
	"source" text,
	"artist_id" text,
	"release_id" text,
	"gross_revenue" real,
	"costs" real,
	"net_revenue" real,
	"paid_out" text DEFAULT 'unpaid',
	"payment_date" text,
	"notes" text,
	"revenue_type" text,
	"revenue_month" text,
	"source_contact_id" text,
	"payment_method" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD CONSTRAINT "royalties_revenue_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD CONSTRAINT "royalties_revenue_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD CONSTRAINT "royalties_revenue_source_contact_id_contacts_id_fk" FOREIGN KEY ("source_contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action;