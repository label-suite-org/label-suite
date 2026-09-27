CREATE TABLE "label_suite"."airtable_record_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"airtable_base_id" text NOT NULL,
	"airtable_table_name" text NOT NULL,
	"airtable_record_id" text NOT NULL,
	"postgres_table_name" text NOT NULL,
	"postgres_record_id" text NOT NULL,
	"import_batch_id" text,
	"record_hash" text,
	"imported_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "airtable_record_mappings_source_unique_idx" ON "label_suite"."airtable_record_mappings" USING btree ("airtable_base_id","airtable_table_name","airtable_record_id");--> statement-breakpoint
CREATE INDEX "airtable_record_mappings_postgres_idx" ON "label_suite"."airtable_record_mappings" USING btree ("postgres_table_name","postgres_record_id");--> statement-breakpoint
CREATE INDEX "airtable_record_mappings_import_batch_idx" ON "label_suite"."airtable_record_mappings" USING btree ("import_batch_id");