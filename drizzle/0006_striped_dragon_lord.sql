CREATE INDEX "artists_name_idx" ON "label_suite"."artists" USING btree ("name");--> statement-breakpoint
CREATE INDEX "artists_contact_id_idx" ON "label_suite"."artists" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_spotify_id_unique_idx" ON "label_suite"."artists" USING btree ("spotify_id") WHERE "label_suite"."artists"."spotify_id" is not null;--> statement-breakpoint
CREATE INDEX "budget_line_items_release_id_idx" ON "label_suite"."budget_line_items" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "budget_line_items_category_id_idx" ON "label_suite"."budget_line_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "bugs_status_idx" ON "label_suite"."bugs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bugs_source_record_idx" ON "label_suite"."bugs" USING btree ("source_table","source_record_id");--> statement-breakpoint
CREATE INDEX "bugs_auto_generated_status_idx" ON "label_suite"."bugs" USING btree ("auto_generated","status");--> statement-breakpoint
CREATE INDEX "calls_contact_id_idx" ON "label_suite"."calls" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "calls_release_id_idx" ON "label_suite"."calls" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "calls_start_idx" ON "label_suite"."calls" USING btree ("start");--> statement-breakpoint
CREATE INDEX "campaign_stations_campaign_id_idx" ON "label_suite"."campaign_stations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_stations_station_id_idx" ON "label_suite"."campaign_stations" USING btree ("station_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_stations_pair_unique_idx" ON "label_suite"."campaign_stations" USING btree ("campaign_id","station_id");--> statement-breakpoint
CREATE INDEX "campaigns_linked_release_id_idx" ON "label_suite"."campaigns" USING btree ("linked_release_id");--> statement-breakpoint
CREATE INDEX "campaigns_linked_artist_id_idx" ON "label_suite"."campaigns" USING btree ("linked_artist_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "label_suite"."campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_name_idx" ON "label_suite"."contacts" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique_idx" ON "label_suite"."contacts" USING btree ("email") WHERE "label_suite"."contacts"."email" is not null;--> statement-breakpoint
CREATE INDEX "documents_release_id_idx" ON "label_suite"."documents" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "documents_artist_id_idx" ON "label_suite"."documents" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "documents_contact_id_idx" ON "label_suite"."documents" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "label_suite"."documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dsp_pitches_release_id_idx" ON "label_suite"."dsp_pitches" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "dsp_pitches_status_idx" ON "label_suite"."dsp_pitches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_assets_linked_artist_id_idx" ON "label_suite"."media_assets" USING btree ("linked_artist_id");--> statement-breakpoint
CREATE INDEX "media_assets_linked_release_id_idx" ON "label_suite"."media_assets" USING btree ("linked_release_id");--> statement-breakpoint
CREATE INDEX "media_assets_approval_status_idx" ON "label_suite"."media_assets" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "ops_tasks_linked_artist_id_idx" ON "label_suite"."ops_tasks" USING btree ("linked_artist_id");--> statement-breakpoint
CREATE INDEX "ops_tasks_linked_release_id_idx" ON "label_suite"."ops_tasks" USING btree ("linked_release_id");--> statement-breakpoint
CREATE INDEX "ops_tasks_status_idx" ON "label_suite"."ops_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ops_tasks_due_date_idx" ON "label_suite"."ops_tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "radio_stations_name_idx" ON "label_suite"."radio_stations" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "radio_stations_call_sign_unique_idx" ON "label_suite"."radio_stations" USING btree ("call_sign") WHERE "label_suite"."radio_stations"."call_sign" is not null;--> statement-breakpoint
CREATE INDEX "releases_artist_id_idx" ON "label_suite"."releases" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "releases_status_idx" ON "label_suite"."releases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "releases_release_date_idx" ON "label_suite"."releases" USING btree ("release_date");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_upc_ean_unique_idx" ON "label_suite"."releases" USING btree ("upc_ean") WHERE "label_suite"."releases"."upc_ean" is not null;--> statement-breakpoint
CREATE INDEX "roles_contact_id_idx" ON "label_suite"."roles" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "roles_work_id_idx" ON "label_suite"."roles" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "roles_work_scope_idx" ON "label_suite"."roles" USING btree ("work_id","scope");--> statement-breakpoint
CREATE INDEX "royalties_revenue_artist_id_idx" ON "label_suite"."royalties_revenue" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "royalties_revenue_release_id_idx" ON "label_suite"."royalties_revenue" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "royalties_revenue_source_contact_id_idx" ON "label_suite"."royalties_revenue" USING btree ("source_contact_id");--> statement-breakpoint
CREATE INDEX "royalties_revenue_period_idx" ON "label_suite"."royalties_revenue" USING btree ("statement_period");--> statement-breakpoint
CREATE INDEX "side_artists_artist_id_idx" ON "label_suite"."side_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "side_artists_release_id_idx" ON "label_suite"."side_artists" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "tracks_release_id_idx" ON "label_suite"."tracks" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "tracks_work_id_idx" ON "label_suite"."tracks" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "tracks_release_position_idx" ON "label_suite"."tracks" USING btree ("release_id","position");--> statement-breakpoint
CREATE INDEX "tracks_isrc_idx" ON "label_suite"."tracks" USING btree ("isrc");--> statement-breakpoint
CREATE INDEX "works_title_idx" ON "label_suite"."works" USING btree ("title");--> statement-breakpoint
CREATE UNIQUE INDEX "works_isrc_unique_idx" ON "label_suite"."works" USING btree ("isrc") WHERE "label_suite"."works"."isrc" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "works_iswc_unique_idx" ON "label_suite"."works" USING btree ("iswc") WHERE "label_suite"."works"."iswc" is not null;