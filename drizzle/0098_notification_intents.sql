CREATE TABLE label_suite.notification_source_receipts (
  org_id text NOT NULL, user_id text NOT NULL, category text NOT NULL,
  preference_generation integer NOT NULL, source_key text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,user_id,category,preference_generation,source_key),
  FOREIGN KEY (org_id,user_id,category) REFERENCES label_suite.notification_preferences(org_id,user_id,category) ON DELETE CASCADE
);
ALTER TABLE label_suite.notification_source_receipts ENABLE ROW LEVEL SECURITY;
CREATE INDEX notification_source_retention_idx ON label_suite.notification_source_receipts(org_id,user_id,created_at);
ALTER TABLE label_suite.notification_source_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_source_owner ON label_suite.notification_source_receipts
USING (org_id=label_suite.current_org_id() AND user_id=label_suite.current_user_id())
WITH CHECK (org_id=label_suite.current_org_id() AND user_id=label_suite.current_user_id());
--> statement-breakpoint
CREATE TABLE label_suite.notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL, user_id text NOT NULL, category text NOT NULL,
  preference_generation integer NOT NULL, source_key text NOT NULL,
  record_kind text NOT NULL, record_id text NOT NULL,
  occurred_at timestamp NOT NULL, expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,user_id,category) REFERENCES label_suite.notification_preferences(org_id,user_id,category) ON DELETE CASCADE
);
CREATE UNIQUE INDEX notification_intent_source_idx ON label_suite.notification_intents(org_id,user_id,category,preference_generation,source_key);
CREATE INDEX notification_intent_expiry_idx ON label_suite.notification_intents(org_id,user_id,expires_at);
ALTER TABLE label_suite.notification_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.notification_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_intent_owner ON label_suite.notification_intents
USING (org_id=label_suite.current_org_id() AND user_id=label_suite.current_user_id())
WITH CHECK (org_id=label_suite.current_org_id() AND user_id=label_suite.current_user_id());
