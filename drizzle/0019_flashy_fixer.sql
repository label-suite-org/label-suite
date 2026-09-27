CREATE TABLE "label_suite"."budget_line_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"budget_line_item_id" text NOT NULL,
	"document_id" text NOT NULL,
	"link_type" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_documents" ADD CONSTRAINT "budget_line_documents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_documents" ADD CONSTRAINT "budget_line_documents_budget_line_item_id_budget_line_items_id_fk" FOREIGN KEY ("budget_line_item_id") REFERENCES "label_suite"."budget_line_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."budget_line_documents" ADD CONSTRAINT "budget_line_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "label_suite"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bli_documents_org_id_idx" ON "label_suite"."budget_line_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "bli_documents_line_id_idx" ON "label_suite"."budget_line_documents" USING btree ("budget_line_item_id");--> statement-breakpoint
CREATE INDEX "bli_documents_doc_id_idx" ON "label_suite"."budget_line_documents" USING btree ("document_id");