CREATE TABLE label_suite.tour_receipts (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id),
 project_id text NOT NULL REFERENCES label_suite.budget_projects(id), sha256 text NOT NULL,
 task_id text, document_id integer, status text NOT NULL DEFAULT 'uploading',
 content text NOT NULL DEFAULT '', error text, entry_id text REFERENCES label_suite.tour_money_entries(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tour_receipt_hash_unique ON label_suite.tour_receipts(org_id,sha256);
CREATE UNIQUE INDEX tour_receipt_document_unique ON label_suite.tour_receipts(org_id,document_id);
CREATE INDEX tour_receipt_project_idx ON label_suite.tour_receipts(org_id,project_id);
ALTER TABLE label_suite.tour_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.tour_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tour_receipts_tenant ON label_suite.tour_receipts
USING(org_id=label_suite.current_org_id()) WITH CHECK(org_id=label_suite.current_org_id());
