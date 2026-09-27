CREATE TABLE "label_suite"."calendar_connections" (
  "org_id" text PRIMARY KEY REFERENCES "label_suite"."orgs"("id"),
  "google_sub" text NOT NULL, "email" text NOT NULL, "refresh_token" text,
  "calendar_id" text, "calendar_name" text, "origin" text NOT NULL,
  "last_synced_at" timestamp, "error" text
);
--> statement-breakpoint
CREATE TABLE "label_suite"."calendar_releases" (
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "release_id" text NOT NULL, "enabled" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("org_id", "release_id")
);
--> statement-breakpoint
CREATE TABLE "label_suite"."calendar_event_links" (
  "id" text PRIMARY KEY, "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "release_id" text NOT NULL, "kind" text NOT NULL CHECK ("kind" IN ('release', 'milestone', 'task')),
  "item_id" text NOT NULL, "title" text NOT NULL, "event_id" text NOT NULL,
  "base_date" text NOT NULL, "published" boolean NOT NULL DEFAULT false,
  "ignored" boolean NOT NULL DEFAULT false, "conflict" text, "google_date" text, "etag" text,
  "resolution" text CHECK ("resolution" IN ('suite', 'google')), "resolved_local_date" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_links_item_idx" ON "label_suite"."calendar_event_links" ("org_id", "kind", "item_id");
--> statement-breakpoint
CREATE INDEX "calendar_links_release_idx" ON "label_suite"."calendar_event_links" ("org_id", "release_id");
