ALTER TABLE label_suite.fan_signups ADD COLUMN success_url text, ADD COLUMN success_label text NOT NULL DEFAULT 'Continue';
CREATE TABLE label_suite.fan_messages (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id), artist_id text NOT NULL REFERENCES label_suite.artists(id),
 revision integer NOT NULL DEFAULT 1, audience jsonb NOT NULL, content jsonb NOT NULL, status text NOT NULL DEFAULT 'draft', scheduled_at timestamptz,
 recipient_ids jsonb NOT NULL DEFAULT '[]'::jsonb, recipient_count integer NOT NULL DEFAULT 0,
 provider_list_id integer, provider_campaign_id integer, report jsonb, failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fan_messages_status_check CHECK(status IN ('draft','scheduled','preparing','submitting','submitted','sent','cancelled','review'))
);
CREATE INDEX fan_messages_artist_idx ON label_suite.fan_messages(org_id,artist_id);
CREATE UNIQUE INDEX fan_messages_provider_unique ON label_suite.fan_messages(org_id,provider_campaign_id);
CREATE TABLE label_suite.fan_activity (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id), message_id text NOT NULL REFERENCES label_suite.fan_messages(id),
 subscription_id text NOT NULL REFERENCES label_suite.fan_subscriptions(id) ON DELETE CASCADE, kind text NOT NULL, occurred_at timestamptz NOT NULL
);
CREATE INDEX fan_activity_subscription_idx ON label_suite.fan_activity(org_id,subscription_id,occurred_at);
--> statement-breakpoint
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['fan_messages','fan_activity'] LOOP
  EXECUTE format('ALTER TABLE label_suite.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE label_suite.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY tenant_isolation ON label_suite.%I USING (org_id=label_suite.current_org_id()) WITH CHECK (org_id=label_suite.current_org_id())',relation);
 END LOOP;
END $$;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.fan_messages FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('artist_id','artists');
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.fan_activity FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('message_id','fan_messages','subscription_id','fan_subscriptions');
