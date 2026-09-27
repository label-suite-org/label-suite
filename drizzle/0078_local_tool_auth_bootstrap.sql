DROP POLICY IF EXISTS "local_tool_tokens_authentication_bootstrap" ON "label_suite"."local_tool_tokens";
CREATE POLICY "local_tool_tokens_authentication_bootstrap" ON "label_suite"."local_tool_tokens"
  FOR SELECT
  USING (
    "id" = nullif(current_setting('app.current_local_tool_token_id', true), '')
  );
