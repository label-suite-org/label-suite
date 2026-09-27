DROP POLICY IF EXISTS "org_invitations_authentication_bootstrap" ON "label_suite"."org_invitations";
CREATE POLICY "org_invitations_authentication_bootstrap" ON "label_suite"."org_invitations"
  FOR SELECT
  USING (
    "token_digest" IS NOT NULL
    AND "token_digest" = nullif(current_setting('app.current_invitation_token_digest', true), '')
  );
