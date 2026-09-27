CREATE TABLE IF NOT EXISTS "label_suite"."campaign_activity_proposal_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "campaign_id" text NOT NULL REFERENCES "label_suite"."campaigns"("id") ON DELETE CASCADE,
  "lead_id" text REFERENCES "label_suite"."campaign_leads"("id") ON DELETE SET NULL,
  "proposal_key" text NOT NULL,
  "rule_key" text NOT NULL,
  "rule_version" integer NOT NULL,
  "decision" text NOT NULL,
  "reason" text,
  "decided_by" text REFERENCES "label_suite"."user"("id") ON DELETE SET NULL,
  "decided_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "campaign_activity_proposal_decisions_decision_check" CHECK ("decision" IN ('dismissed', 'resolved'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_activity_proposal_decisions_org_campaign_proposal_unique_idx" ON "label_suite"."campaign_activity_proposal_decisions" ("org_id", "campaign_id", "proposal_key");
CREATE INDEX IF NOT EXISTS "campaign_activity_proposal_decisions_campaign_id_idx" ON "label_suite"."campaign_activity_proposal_decisions" ("org_id", "campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_activity_proposal_decisions_lead_id_idx" ON "label_suite"."campaign_activity_proposal_decisions" ("org_id", "lead_id");
CREATE INDEX IF NOT EXISTS "campaign_activity_proposal_decisions_decision_idx" ON "label_suite"."campaign_activity_proposal_decisions" ("org_id", "campaign_id", "decision");
--> statement-breakpoint
ALTER TABLE "label_suite"."campaign_activity_proposal_decisions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "label_suite"."campaign_activity_proposal_decisions";
CREATE POLICY "tenant_isolation" ON "label_suite"."campaign_activity_proposal_decisions"
  USING ("org_id" = "label_suite"."current_org_id"())
  WITH CHECK ("org_id" = "label_suite"."current_org_id"());
--> statement-breakpoint
DROP TRIGGER IF EXISTS "same_org_references" ON "label_suite"."campaign_activity_proposal_decisions";
CREATE TRIGGER "same_org_references"
BEFORE INSERT OR UPDATE ON "label_suite"."campaign_activity_proposal_decisions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."enforce_same_org_references"(
  'campaign_id', 'campaigns',
  'lead_id', 'campaign_leads'
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "audit_row_changes" ON "label_suite"."campaign_activity_proposal_decisions";
CREATE TRIGGER "audit_row_changes"
AFTER INSERT OR UPDATE OR DELETE ON "label_suite"."campaign_activity_proposal_decisions"
FOR EACH ROW EXECUTE FUNCTION "label_suite"."write_audit_log"();
