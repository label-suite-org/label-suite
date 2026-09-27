-- A cancellation must survive a lost registration response or a request arriving late.
CREATE TABLE label_suite.notification_device_attempts (
  session_id text NOT NULL REFERENCES label_suite."session"(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  user_id text NOT NULL REFERENCES label_suite."user"(id) ON DELETE CASCADE,
  cancelled boolean NOT NULL DEFAULT false,
  registered boolean NOT NULL DEFAULT false,
  PRIMARY KEY (session_id, attempt_id)
);
ALTER TABLE label_suite.notification_device_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE label_suite.notification_device_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_attempt_owner ON label_suite.notification_device_attempts
USING (user_id = label_suite.current_user_id()) WITH CHECK (user_id = label_suite.current_user_id());
DO $$ BEGIN
  EXECUTE format('CREATE POLICY notification_attempt_registration_owner ON label_suite.notification_device_attempts TO %I USING (true) WITH CHECK (true)', current_user);
END $$;
ALTER TABLE label_suite.notification_devices ADD COLUMN attempt_id uuid;
CREATE UNIQUE INDEX notification_device_attempt_idx ON label_suite.notification_devices(session_id, attempt_id);
--> statement-breakpoint
DROP FUNCTION label_suite.register_notification_device(text,text,text,text);
CREATE FUNCTION label_suite.register_notification_device(
  p_session text, p_token text, p_topic text, p_environment text, p_attempt uuid
) RETURNS TABLE(device_id uuid, device_generation integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, label_suite AS $$
DECLARE
  actor text := label_suite.current_user_id();
  workspace text := label_suite.current_org_id();
  member_role text;
  attempt label_suite.notification_device_attempts%ROWTYPE;
BEGIN
  -- Registration and cancellation share this lock, including before a device exists.
  PERFORM 1 FROM label_suite."session"
    WHERE id = p_session AND "userId" = actor AND "expiresAt" > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT role INTO member_role FROM label_suite.org_memberships
    WHERE org_id = workspace AND user_id = actor FOR UPDATE;
  IF NOT FOUND OR member_role = 'payee' THEN RETURN; END IF;
  PERFORM 1 FROM label_suite.notification_preferences
    WHERE org_id = workspace AND user_id = actor AND enabled_at IS NOT NULL
      AND enabled_role = member_role AND (category <> 'requested_reviews' OR member_role = 'owner') FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO label_suite.notification_device_attempts(session_id, attempt_id, user_id)
    VALUES (p_session, p_attempt, actor) ON CONFLICT DO NOTHING;
  SELECT * INTO attempt FROM label_suite.notification_device_attempts
    WHERE session_id = p_session AND attempt_id = p_attempt FOR UPDATE;
  IF attempt.cancelled THEN RETURN; END IF;
  IF attempt.registered THEN
    -- Retrying a completed attempt never reclaims a token rebound by another attempt.
    RETURN QUERY SELECT id, generation FROM label_suite.notification_devices
      WHERE session_id = p_session AND attempt_id = p_attempt AND user_id = actor
        AND token = p_token AND topic = p_topic AND environment = p_environment;
    RETURN;
  END IF;
  RETURN QUERY
    INSERT INTO label_suite.notification_devices AS device (user_id,session_id,token,topic,environment,attempt_id)
    VALUES (actor,p_session,p_token,p_topic,p_environment,p_attempt)
    ON CONFLICT (topic,environment,token) DO UPDATE SET
      user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, attempt_id = EXCLUDED.attempt_id,
      generation = device.generation + 1, updated_at = clock_timestamp()
    RETURNING device.id, device.generation;
  UPDATE label_suite.notification_device_attempts SET registered = true
    WHERE session_id = p_session AND attempt_id = p_attempt;
END;
$$;
REVOKE ALL ON FUNCTION label_suite.register_notification_device(text,text,text,text,uuid) FROM PUBLIC;
