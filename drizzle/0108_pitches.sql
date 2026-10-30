CREATE TABLE label_suite.pitches (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id),
 campaign_id text REFERENCES label_suite.campaigns(id), sync_deal_id text REFERENCES label_suite.sync_deals(id),
 release_id text NOT NULL REFERENCES label_suite.releases(id), contact_id text NOT NULL REFERENCES label_suite.contacts(id),
 task_id text REFERENCES label_suite.ops_tasks(id), version integer NOT NULL DEFAULT 1,
 title text NOT NULL, message text NOT NULL, credits text NOT NULL, rights_note text NOT NULL, reply_email text NOT NULL,
 artist_name text NOT NULL, artwork_url text, remote_project_id text NOT NULL, recordings jsonb NOT NULL,
 downloads boolean NOT NULL DEFAULT false, token text NOT NULL, player_id text,
 link_state text NOT NULL DEFAULT 'draft', status text NOT NULL DEFAULT 'draft', sent_date date,
 response_note text NOT NULL DEFAULT '', created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
 CONSTRAINT pitches_context CHECK(num_nonnulls(campaign_id, sync_deal_id) = 1),
 CONSTRAINT pitches_link_state CHECK(link_state in ('draft','preparing','ready','revoking','revoked')),
 CONSTRAINT pitches_status CHECK(status in ('draft','sent','replied','closed'))
);
CREATE INDEX pitches_org_campaign_idx ON label_suite.pitches(org_id,campaign_id);
CREATE INDEX pitches_org_sync_idx ON label_suite.pitches(org_id,sync_deal_id);
--> statement-breakpoint
ALTER TABLE label_suite.pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.pitches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON label_suite.pitches USING(org_id = label_suite.current_org_id()) WITH CHECK(org_id = label_suite.current_org_id());
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.pitches FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('campaign_id','campaigns','sync_deal_id','sync_deals','release_id','releases','contact_id','contacts','task_id','ops_tasks');
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.pitches FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
