CREATE TABLE "label_suite"."media_asset_files" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"media_asset_id" text NOT NULL,
	"airtable_base_id" text,
	"airtable_table_name" text,
	"airtable_record_id" text,
	"airtable_field_name" text,
	"airtable_attachment_id" text,
	"file_name" text NOT NULL,
	"content_type" text,
	"file_size" integer,
	"source_url" text,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"storage_etag" text,
	"copied_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."media_asset_files" ADD CONSTRAINT "media_asset_files_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."media_asset_files" ADD CONSTRAINT "media_asset_files_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "label_suite"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_asset_files_org_id_idx" ON "label_suite"."media_asset_files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "media_asset_files_media_asset_id_idx" ON "label_suite"."media_asset_files" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_files_airtable_attachment_unique_idx" ON "label_suite"."media_asset_files" USING btree ("org_id","airtable_base_id","airtable_table_name","airtable_record_id","airtable_attachment_id") WHERE "label_suite"."media_asset_files"."airtable_attachment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_files_storage_key_unique_idx" ON "label_suite"."media_asset_files" USING btree ("storage_bucket","storage_key");