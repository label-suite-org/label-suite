-- The Sisense CSV importer already owns these staging relations in production.
-- Adopt their observed contract without changing, truncating, or rewriting any
-- existing import data. Materialized-view refreshes remain the importer's job.
CREATE TABLE IF NOT EXISTS "label_suite"."staging_tracks_cumulative" (
  "id" serial PRIMARY KEY,
  "track_title" text NOT NULL,
  "primary_artist" text,
  "spotify_streams" bigint,
  "apple_streams" bigint,
  "amazon_streams" bigint,
  "pandora_streams" bigint,
  "combined_streams" bigint,
  "streams_growth" numeric,
  "youtube_views" bigint,
  "tiktok_views" bigint,
  "combined_views" bigint,
  "views_growth" numeric,
  "imported_at" timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."staging_spotify_streams_source" (
  "id" serial PRIMARY KEY,
  "date" date NOT NULL,
  "source" text NOT NULL,
  "streams" bigint NOT NULL DEFAULT 0,
  "imported_at" timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."staging_apple_streams_source" (
  "id" serial PRIMARY KEY,
  "date" date NOT NULL,
  "source_of_stream" text NOT NULL,
  "streams" bigint NOT NULL DEFAULT 0,
  "imported_at" timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."staging_spotify_demographics" (
  "id" serial PRIMARY KEY,
  "gender" text,
  "age_group" text,
  "active_stream_rate" numeric,
  "average_completion_rate" numeric,
  "average_streams_per_user" numeric,
  "streams" bigint NOT NULL DEFAULT 0,
  "imported_at" timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."staging_spotify_superfans_city" (
  "id" serial PRIMARY KEY,
  "city" text NOT NULL,
  "country" text,
  "superfans" bigint NOT NULL DEFAULT 0,
  "active_streams" bigint NOT NULL DEFAULT 0,
  "streams" bigint NOT NULL DEFAULT 0,
  "active_stream_rate" numeric,
  "imported_at" timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."staging_spotify_playlists" (
  "id" serial PRIMARY KEY,
  "playlist_name" text,
  "playlist_source_uri" text,
  "playlist_owner_id" text,
  "latest_position" int,
  "streams" bigint NOT NULL DEFAULT 0,
  "average_completion_rate" numeric,
  "average_streams_per_user" numeric,
  "imported_at" timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "label_suite"."staging_shazams_city" (
  "id" serial PRIMARY KEY,
  "city" text NOT NULL,
  "state" text,
  "country" text,
  "shazams" bigint NOT NULL DEFAULT 0,
  "imported_at" timestamptz DEFAULT now()
);
