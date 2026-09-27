CREATE INDEX IF NOT EXISTS "analytics_metric_rows_membership_idx"
  ON "label_suite"."analytics_metric_rows" ("org_id", "source", "widget_key", "artist_id", "last_seen_run_id");
