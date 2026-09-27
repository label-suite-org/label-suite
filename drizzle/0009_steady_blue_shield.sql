ALTER TABLE "label_suite"."bugs" DROP CONSTRAINT "bugs_bug_key_unique";--> statement-breakpoint
ALTER TABLE "label_suite"."isrc_sequences" DROP CONSTRAINT "isrc_sequences_year_unique";--> statement-breakpoint
DROP INDEX "label_suite"."artists_spotify_id_unique_idx";--> statement-breakpoint
DROP INDEX "label_suite"."campaign_stations_pair_unique_idx";--> statement-breakpoint
DROP INDEX "label_suite"."contacts_email_unique_idx";--> statement-breakpoint
DROP INDEX "label_suite"."radio_stations_call_sign_unique_idx";--> statement-breakpoint
DROP INDEX "label_suite"."releases_upc_ean_unique_idx";--> statement-breakpoint
DROP INDEX "label_suite"."works_isrc_unique_idx";--> statement-breakpoint
DROP INDEX "label_suite"."works_iswc_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "bugs_bug_key_unique" ON "label_suite"."bugs" USING btree ("org_id","bug_key") WHERE "label_suite"."bugs"."bug_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "isrc_sequences_year_unique" ON "label_suite"."isrc_sequences" USING btree ("org_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_spotify_id_unique_idx" ON "label_suite"."artists" USING btree ("org_id","spotify_id") WHERE "label_suite"."artists"."spotify_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_stations_pair_unique_idx" ON "label_suite"."campaign_stations" USING btree ("org_id","campaign_id","station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique_idx" ON "label_suite"."contacts" USING btree ("org_id","email") WHERE "label_suite"."contacts"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "radio_stations_call_sign_unique_idx" ON "label_suite"."radio_stations" USING btree ("org_id","call_sign") WHERE "label_suite"."radio_stations"."call_sign" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "releases_upc_ean_unique_idx" ON "label_suite"."releases" USING btree ("org_id","upc_ean") WHERE "label_suite"."releases"."upc_ean" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "works_isrc_unique_idx" ON "label_suite"."works" USING btree ("org_id","isrc") WHERE "label_suite"."works"."isrc" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "works_iswc_unique_idx" ON "label_suite"."works" USING btree ("org_id","iswc") WHERE "label_suite"."works"."iswc" is not null;