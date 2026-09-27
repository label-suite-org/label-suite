ALTER TABLE "label_suite"."media_asset_files" ALTER COLUMN "media_asset_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "label_suite"."media_asset_files" ADD COLUMN "source_postgres_table" text;--> statement-breakpoint
ALTER TABLE "label_suite"."media_asset_files" ADD COLUMN "source_postgres_record_id" text;--> statement-breakpoint
CREATE INDEX "media_asset_files_source_idx" ON "label_suite"."media_asset_files" USING btree ("source_postgres_table","source_postgres_record_id");