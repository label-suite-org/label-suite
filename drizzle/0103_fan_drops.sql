CREATE TABLE label_suite.fan_drops (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id), artist_id text NOT NULL REFERENCES label_suite.artists(id),
 release_id text REFERENCES label_suite.releases(id), slug text NOT NULL, revision integer NOT NULL DEFAULT 1,
 content jsonb NOT NULL, published jsonb, published_revision integer,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fan_drops_publication_check CHECK ((published IS NULL) = (published_revision IS NULL))
);
CREATE UNIQUE INDEX fan_drops_org_slug_unique ON label_suite.fan_drops(org_id,slug);
CREATE INDEX fan_drops_artist_idx ON label_suite.fan_drops(org_id,artist_id);
CREATE TABLE label_suite.fans (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id), email text NOT NULL,
 provider_suppressed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fans_email_normalized CHECK(email=lower(trim(email)))
);
CREATE UNIQUE INDEX fans_org_email_unique ON label_suite.fans(org_id,email);
CREATE TABLE label_suite.fan_subscriptions (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id), fan_id text NOT NULL REFERENCES label_suite.fans(id) ON DELETE CASCADE,
 artist_id text NOT NULL REFERENCES label_suite.artists(id), name text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '',
 tags jsonb NOT NULL DEFAULT '[]'::jsonb, status text NOT NULL DEFAULT 'pending', consent_text text, consent_revision integer,
 consent_at timestamptz, confirmed_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fan_subscriptions_status_check CHECK(status IN ('pending','confirmed','unsubscribed')),
 CONSTRAINT fan_subscriptions_consent_check CHECK(status <> 'confirmed' OR (consent_at IS NOT NULL AND confirmed_at IS NOT NULL AND consent_text IS NOT NULL AND revoked_at IS NULL))
);
CREATE UNIQUE INDEX fan_subscriptions_scope_unique ON label_suite.fan_subscriptions(org_id,fan_id,artist_id);
CREATE INDEX fan_subscriptions_audience_idx ON label_suite.fan_subscriptions(org_id,artist_id,status);
CREATE TABLE label_suite.fan_signups (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES label_suite.orgs(id), drop_id text NOT NULL REFERENCES label_suite.fan_drops(id),
 subscription_id text NOT NULL REFERENCES label_suite.fan_subscriptions(id) ON DELETE CASCADE,
 name text NOT NULL, city text NOT NULL, show_id text, consent_text text NOT NULL, published_revision integer NOT NULL,
 confirmed_at timestamptz, expires_at timestamptz NOT NULL, email_status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT fan_signups_email_status_check CHECK(email_status IN ('queued','sending','submitted','unknown','failed','suppressed'))
);
CREATE INDEX fan_signups_drop_idx ON label_suite.fan_signups(org_id,drop_id,subscription_id);
CREATE TABLE label_suite.fan_rate_limits (
 org_id text NOT NULL REFERENCES label_suite.orgs(id), key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL
);
CREATE UNIQUE INDEX fan_rate_limits_key_unique ON label_suite.fan_rate_limits(org_id,key);
--> statement-breakpoint
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['fan_drops','fans','fan_subscriptions','fan_signups','fan_rate_limits'] LOOP
  EXECUTE format('ALTER TABLE label_suite.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE label_suite.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY tenant_isolation ON label_suite.%I USING (org_id=label_suite.current_org_id()) WITH CHECK (org_id=label_suite.current_org_id())',relation);
 END LOOP;
END $$;
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.fan_drops FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('artist_id','artists','release_id','releases');
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.fan_subscriptions FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('fan_id','fans','artist_id','artists');
CREATE TRIGGER same_org_references BEFORE INSERT OR UPDATE ON label_suite.fan_signups FOR EACH ROW EXECUTE FUNCTION label_suite.enforce_same_org_references('drop_id','fan_drops','subscription_id','fan_subscriptions');
