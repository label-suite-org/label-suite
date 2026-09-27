CREATE UNIQUE INDEX notification_intent_owner_idx ON label_suite.notification_intents(id,org_id,user_id);
CREATE TABLE label_suite.notification_deliveries (
  intent_id uuid NOT NULL, device_id uuid NOT NULL REFERENCES label_suite.notification_devices(id) ON DELETE CASCADE,
  device_generation integer NOT NULL, org_id text NOT NULL, user_id text NOT NULL,
  status text NOT NULL, attempts integer NOT NULL DEFAULT 1,
  next_attempt_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY(intent_id,device_id,device_generation),
  FOREIGN KEY(intent_id,org_id,user_id) REFERENCES label_suite.notification_intents(id,org_id,user_id) ON DELETE CASCADE,
  CONSTRAINT notification_delivery_status_check CHECK (status IN ('accepted','rejected','suppressed','invalid_device','retry')),
  CONSTRAINT notification_delivery_attempts_check CHECK (attempts > 0 AND device_generation > 0)
);
ALTER TABLE label_suite.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.notification_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_delivery_owner ON label_suite.notification_deliveries
USING (org_id=label_suite.current_org_id() AND user_id=label_suite.current_user_id())
WITH CHECK (org_id=label_suite.current_org_id() AND user_id=label_suite.current_user_id());
