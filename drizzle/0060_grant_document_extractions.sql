CREATE TABLE IF NOT EXISTS "label_suite"."grant_document_extractions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "document_id" text NOT NULL REFERENCES "label_suite"."documents"("id"),
  "source_storage_key" text NOT NULL,
  "source_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "extracted_text" text,
  "metadata" jsonb,
  "error" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_document_extractions_org_idx" ON "label_suite"."grant_document_extractions" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grant_document_extractions_document_idx" ON "label_suite"."grant_document_extractions" ("document_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grant_document_extractions_source_unique_idx" ON "label_suite"."grant_document_extractions" ("org_id", "document_id", "source_hash");
--> statement-breakpoint
ALTER TABLE "label_suite"."grant_document_extractions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."grant_document_extractions";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "label_suite"."grant_document_extractions"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS same_org_references ON label_suite.grant_document_extractions;
--> statement-breakpoint
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.grant_document_extractions
  FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('document_id', 'documents');
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_row_changes ON label_suite.grant_document_extractions;
--> statement-breakpoint
CREATE TRIGGER audit_row_changes
  AFTER INSERT OR UPDATE OR DELETE ON label_suite.grant_document_extractions
  FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
