CREATE TABLE label_suite.sync_deals (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id),
 production text NOT NULL, version integer NOT NULL DEFAULT 1,
 artist_id text REFERENCES label_suite.artists(id), release_id text REFERENCES label_suite.releases(id),
 track_id text REFERENCES label_suite.tracks(id), contact_id text REFERENCES label_suite.contacts(id),
 asset_id text REFERENCES label_suite.media_assets(id), task_id text REFERENCES label_suite.ops_tasks(id),
 licensee text, details jsonb NOT NULL CONSTRAINT sync_details_object CHECK(jsonb_typeof(details) = 'object'),
 created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX sync_deals_org_idx ON label_suite.sync_deals(org_id);
--> statement-breakpoint
CREATE TABLE label_suite.sync_revisions (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id),
 deal_id text NOT NULL REFERENCES label_suite.sync_deals(id), version integer NOT NULL,
 snapshot jsonb NOT NULL, actor_id text NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sync_revisions_deal_version_idx ON label_suite.sync_revisions(deal_id,version);
CREATE TABLE label_suite.sync_receipts (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id),
 deal_id text NOT NULL REFERENCES label_suite.sync_deals(id), amount numeric(20,8) NOT NULL CONSTRAINT sync_receipts_positive CHECK(amount > 0),
 currency text NOT NULL CONSTRAINT sync_receipts_currency CHECK(currency ~ '^[A-Z]{3}$'), received_date date NOT NULL, reference text NOT NULL,
 document_id text REFERENCES label_suite.documents(id), actor_id text NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX sync_receipts_org_deal_idx ON label_suite.sync_receipts(org_id,deal_id);
--> statement-breakpoint
ALTER TABLE label_suite.sync_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.sync_deals FORCE ROW LEVEL SECURITY;
ALTER TABLE label_suite.sync_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.sync_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE label_suite.sync_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.sync_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON label_suite.sync_deals USING(org_id = label_suite.current_org_id()) WITH CHECK(org_id = label_suite.current_org_id());
CREATE POLICY tenant_isolation ON label_suite.sync_revisions USING(org_id = label_suite.current_org_id()) WITH CHECK(org_id = label_suite.current_org_id());
CREATE POLICY tenant_isolation ON label_suite.sync_receipts USING(org_id = label_suite.current_org_id()) WITH CHECK(org_id = label_suite.current_org_id());
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.sync_deals FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('artist_id','artists','release_id','releases','track_id','tracks','contact_id','contacts','asset_id','media_assets','task_id','ops_tasks');
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.sync_revisions FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('deal_id','sync_deals');
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.sync_receipts FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('deal_id','sync_deals','document_id','documents');
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.sync_deals FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.sync_receipts FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
