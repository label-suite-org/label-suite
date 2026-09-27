-- Canonicalize the observed Sisense importer indexes without rewriting the
-- importer-owned staging data that is already present in production.
CREATE INDEX IF NOT EXISTS "idx_spotify_source_date" ON "label_suite"."staging_spotify_streams_source" ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spotify_source_source" ON "label_suite"."staging_spotify_streams_source" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_apple_source_date" ON "label_suite"."staging_apple_streams_source" ("date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_apple_source_source" ON "label_suite"."staging_apple_streams_source" ("source_of_stream");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spotify_demo_gender_age" ON "label_suite"."staging_spotify_demographics" ("gender", "age_group");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spotify_superfans_city" ON "label_suite"."staging_spotify_superfans_city" ("city");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spotify_superfans_country" ON "label_suite"."staging_spotify_superfans_city" ("country");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_spotify_playlists_streams" ON "label_suite"."staging_spotify_playlists" ("streams" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_shazams_city" ON "label_suite"."staging_shazams_city" ("city");
