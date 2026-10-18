CREATE TABLE label_suite.tour_money_entries (
  id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id),
  project_id text NOT NULL REFERENCES label_suite.budget_projects(id), source_key text NOT NULL,
  data jsonb NOT NULL, voided boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tour_money_source_unique ON label_suite.tour_money_entries(org_id,source_key);
CREATE INDEX tour_money_project_idx ON label_suite.tour_money_entries(org_id,project_id);
CREATE TABLE label_suite.tour_square_connections (
  connection_id text PRIMARY KEY REFERENCES label_suite.integration_connections(id),
  org_id text NOT NULL REFERENCES label_suite.orgs(id), project_id text NOT NULL REFERENCES label_suite.budget_projects(id),
  merchant_id text NOT NULL, client_id text NOT NULL, encrypted_token text NOT NULL,
  begin_at timestamptz NOT NULL, end_at timestamptz NOT NULL, enabled boolean NOT NULL DEFAULT false,
  last_attempt_at timestamptz, last_success_at timestamptz, error text, held_count integer NOT NULL DEFAULT 0,
  CONSTRAINT tour_square_period_check CHECK(end_at > begin_at)
);
CREATE UNIQUE INDEX tour_square_project_unique ON label_suite.tour_square_connections(org_id,project_id);
CREATE UNIQUE INDEX tour_square_merchant_unique ON label_suite.tour_square_connections(org_id,merchant_id);
ALTER TABLE label_suite.tour_money_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.tour_money_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tour_money_tenant ON label_suite.tour_money_entries
USING(org_id=label_suite.current_org_id()) WITH CHECK(org_id=label_suite.current_org_id());
ALTER TABLE label_suite.tour_square_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.tour_square_connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tour_square_tenant ON label_suite.tour_square_connections
USING(org_id=label_suite.current_org_id()) WITH CHECK(org_id=label_suite.current_org_id());
