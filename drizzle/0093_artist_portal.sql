CREATE TABLE label_suite.artist_portals (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES label_suite.orgs(id),
  artist_id text NOT NULL REFERENCES label_suite.artists(id),
  artist_name text NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  agreements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(agreements) = 'array'),
  revoked_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX artist_portals_org_artist_idx ON label_suite.artist_portals(org_id, artist_id);
CREATE UNIQUE INDEX artist_portals_token_hash_idx ON label_suite.artist_portals(token_hash);
--> statement-breakpoint
CREATE TABLE label_suite.artist_portal_submissions (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES label_suite.orgs(id),
  portal_id text NOT NULL REFERENCES label_suite.artist_portals(id),
  request_id text NOT NULL,
  details jsonb NOT NULL CHECK (jsonb_typeof(details) = 'object'),
  reviewed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX artist_portal_submissions_request_idx ON label_suite.artist_portal_submissions(portal_id, request_id);
CREATE INDEX artist_portal_submissions_org_portal_idx ON label_suite.artist_portal_submissions(org_id, portal_id);
--> statement-breakpoint
ALTER TABLE label_suite.artist_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.artist_portals FORCE ROW LEVEL SECURITY;
ALTER TABLE label_suite.artist_portal_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.artist_portal_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON label_suite.artist_portals
  USING (org_id = label_suite.current_org_id()) WITH CHECK (org_id = label_suite.current_org_id());
CREATE POLICY tenant_isolation ON label_suite.artist_portal_submissions
  USING (org_id = label_suite.current_org_id()) WITH CHECK (org_id = label_suite.current_org_id());
-- Link access can read only its explicitly shared archive, never the workspace.
CREATE POLICY artist_link_read ON label_suite.artist_portals FOR SELECT
  USING (token_hash = nullif(current_setting('app.artist_portal_hash', true), '') AND revoked_at IS NULL);
CREATE POLICY artist_link_read ON label_suite.artist_portal_submissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM label_suite.artist_portals p WHERE p.id = portal_id
    AND p.org_id = artist_portal_submissions.org_id AND p.revoked_at IS NULL
    AND p.token_hash = nullif(current_setting('app.artist_portal_hash', true), '')));
CREATE POLICY artist_link_submit ON label_suite.artist_portal_submissions FOR INSERT
  WITH CHECK (reviewed_at IS NULL AND EXISTS (SELECT 1 FROM label_suite.artist_portals p WHERE p.id = portal_id
    AND p.org_id = artist_portal_submissions.org_id AND p.revoked_at IS NULL
    AND p.token_hash = nullif(current_setting('app.artist_portal_hash', true), '')));
--> statement-breakpoint
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.artist_portals
  FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('artist_id', 'artists');
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.artist_portal_submissions
  FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('portal_id', 'artist_portals');
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.artist_portals
  FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
CREATE TRIGGER audit_row_changes AFTER INSERT OR UPDATE OR DELETE ON label_suite.artist_portal_submissions
  FOR EACH ROW EXECUTE FUNCTION label_suite.write_audit_log();
