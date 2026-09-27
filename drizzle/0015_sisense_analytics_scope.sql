ALTER TABLE "label_suite"."analytics_import_files" ADD COLUMN "artist_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD COLUMN "track_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD COLUMN "artist_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD COLUMN "track_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD COLUMN "artist_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD COLUMN "track_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD COLUMN "artist_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD COLUMN "release_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD COLUMN "track_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD CONSTRAINT "analytics_import_files_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD CONSTRAINT "analytics_import_files_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_files" ADD CONSTRAINT "analytics_import_files_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD CONSTRAINT "analytics_import_runs_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD CONSTRAINT "analytics_import_runs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_import_runs" ADD CONSTRAINT "analytics_import_runs_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD CONSTRAINT "analytics_metric_changes_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD CONSTRAINT "analytics_metric_changes_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_changes" ADD CONSTRAINT "analytics_metric_changes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD CONSTRAINT "analytics_metric_rows_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD CONSTRAINT "analytics_metric_rows_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."analytics_metric_rows" ADD CONSTRAINT "analytics_metric_rows_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_import_files_artist_id_idx" ON "label_suite"."analytics_import_files" USING btree ("org_id","artist_id");--> statement-breakpoint
CREATE INDEX "analytics_import_files_release_id_idx" ON "label_suite"."analytics_import_files" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "analytics_import_files_track_id_idx" ON "label_suite"."analytics_import_files" USING btree ("org_id","track_id");--> statement-breakpoint
CREATE INDEX "analytics_import_runs_artist_id_idx" ON "label_suite"."analytics_import_runs" USING btree ("org_id","artist_id");--> statement-breakpoint
CREATE INDEX "analytics_import_runs_release_id_idx" ON "label_suite"."analytics_import_runs" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "analytics_import_runs_track_id_idx" ON "label_suite"."analytics_import_runs" USING btree ("org_id","track_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_artist_id_idx" ON "label_suite"."analytics_metric_changes" USING btree ("org_id","artist_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_release_id_idx" ON "label_suite"."analytics_metric_changes" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_changes_track_id_idx" ON "label_suite"."analytics_metric_changes" USING btree ("org_id","track_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_rows_artist_id_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","artist_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_rows_release_id_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "analytics_metric_rows_track_id_idx" ON "label_suite"."analytics_metric_rows" USING btree ("org_id","track_id");