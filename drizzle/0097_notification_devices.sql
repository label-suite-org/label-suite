CREATE TABLE "label_suite"."notification_devices" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES label_suite."user"(id) ON DELETE CASCADE,
  session_id text REFERENCES label_suite."session"(id) ON DELETE SET NULL,
  token text NOT NULL,
  topic text NOT NULL,
  environment text NOT NULL,
  generation integer NOT NULL DEFAULT 1,
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT notification_device_environment_check CHECK (environment IN ('sandbox','production')),
  CONSTRAINT notification_device_token_check CHECK (length(token) <= 1024 AND token ~ '^([0-9a-f]{2})+$'),
  CONSTRAINT notification_device_generation_check CHECK (generation > 0)
);
CREATE UNIQUE INDEX notification_device_token_idx ON label_suite.notification_devices(topic,environment,token);
ALTER TABLE label_suite.notification_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.notification_devices FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_device_owner ON label_suite.notification_devices
USING (user_id = label_suite.current_user_id()) WITH CHECK (user_id = label_suite.current_user_id());
-- The existing migration principal owns the definer routine. Runtime must use a
-- different principal (enforced by the runtime provisioning script).
DO $$ BEGIN
  EXECUTE format('CREATE POLICY notification_device_registration_owner ON label_suite.notification_devices TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
--> statement-breakpoint
-- Rebinding a token must invalidate its old owner even under recipient RLS.
-- No caller-selected user, topic or environment is accepted by the HTTP API.
CREATE FUNCTION label_suite.register_notification_device(
  p_session text, p_token text, p_topic text, p_environment text
) RETURNS TABLE(device_id uuid, device_generation integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, label_suite AS $$
DECLARE
  actor text := label_suite.current_user_id();
  workspace text := label_suite.current_org_id();
  member_role text;
BEGIN
  PERFORM 1 FROM label_suite."session"
    WHERE id = p_session AND "userId" = actor AND "expiresAt" > clock_timestamp()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT role INTO member_role FROM label_suite.org_memberships
    WHERE org_id = workspace AND user_id = actor FOR UPDATE;
  IF NOT FOUND OR member_role = 'payee' THEN RETURN; END IF;
  PERFORM 1 FROM label_suite.notification_preferences
    WHERE org_id = workspace AND user_id = actor AND enabled_at IS NOT NULL
      AND enabled_role = member_role
      AND (category <> 'requested_reviews' OR member_role = 'owner')
    FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY
    INSERT INTO label_suite.notification_devices AS device (user_id,session_id,token,topic,environment)
    VALUES (actor,p_session,p_token,p_topic,p_environment)
    ON CONFLICT (topic,environment,token) DO UPDATE SET
      user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id,
      generation = CASE WHEN device.user_id = EXCLUDED.user_id AND device.session_id = EXCLUDED.session_id
        THEN device.generation ELSE device.generation + 1 END,
      updated_at = clock_timestamp()
    RETURNING device.id, device.generation;
END;
$$;
REVOKE ALL ON FUNCTION label_suite.register_notification_device(text,text,text,text) FROM PUBLIC;
