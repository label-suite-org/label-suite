CREATE TABLE "label_suite"."samply_comment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"samply_event_id" text NOT NULL,
	"remote_comment_id" text NOT NULL,
	"release_id" text,
	"track_id" text,
	"ops_task_id" text,
	"comment_status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."samply_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"label" text DEFAULT 'Samply' NOT NULL,
	"base_url" text DEFAULT 'https://samply.app/api/v0' NOT NULL,
	"status" text DEFAULT 'configured' NOT NULL,
	"account_email" text,
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."samply_events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"event_type" text NOT NULL,
	"remote_event_id" text NOT NULL,
	"remote_project_id" text,
	"remote_box_id" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."samply_files" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"samply_project_id" text NOT NULL,
	"track_id" text,
	"work_id" text,
	"media_asset_id" text,
	"document_id" text,
	"remote_box_id" text NOT NULL,
	"remote_stack_id" text,
	"file_name" text NOT NULL,
	"source_storage_key" text,
	"sync_status" text DEFAULT 'synced' NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."samply_players" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"samply_project_id" text NOT NULL,
	"release_id" text,
	"remote_player_id" text NOT NULL,
	"player_type" text DEFAULT 'review' NOT NULL,
	"name" text NOT NULL,
	"embed_url" text,
	"share_url" text,
	"public" boolean DEFAULT false NOT NULL,
	"downloads_enabled" boolean DEFAULT false NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"quality" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "label_suite"."samply_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"release_id" text,
	"campaign_id" text,
	"remote_project_id" text NOT NULL,
	"remote_project_name" text,
	"primary_player_id" text,
	"upload_enabled" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."samply_comment_links" ADD CONSTRAINT "samply_comment_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_comment_links" ADD CONSTRAINT "samply_comment_links_samply_event_id_samply_events_id_fk" FOREIGN KEY ("samply_event_id") REFERENCES "label_suite"."samply_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_comment_links" ADD CONSTRAINT "samply_comment_links_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_comment_links" ADD CONSTRAINT "samply_comment_links_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_comment_links" ADD CONSTRAINT "samply_comment_links_ops_task_id_ops_tasks_id_fk" FOREIGN KEY ("ops_task_id") REFERENCES "label_suite"."ops_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_connections" ADD CONSTRAINT "samply_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_events" ADD CONSTRAINT "samply_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_files" ADD CONSTRAINT "samply_files_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_files" ADD CONSTRAINT "samply_files_samply_project_id_samply_projects_id_fk" FOREIGN KEY ("samply_project_id") REFERENCES "label_suite"."samply_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_files" ADD CONSTRAINT "samply_files_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_files" ADD CONSTRAINT "samply_files_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "label_suite"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_files" ADD CONSTRAINT "samply_files_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "label_suite"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_files" ADD CONSTRAINT "samply_files_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "label_suite"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_players" ADD CONSTRAINT "samply_players_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_players" ADD CONSTRAINT "samply_players_samply_project_id_samply_projects_id_fk" FOREIGN KEY ("samply_project_id") REFERENCES "label_suite"."samply_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_players" ADD CONSTRAINT "samply_players_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_projects" ADD CONSTRAINT "samply_projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_projects" ADD CONSTRAINT "samply_projects_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."samply_projects" ADD CONSTRAINT "samply_projects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "label_suite"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "samply_comment_links_org_id_idx" ON "label_suite"."samply_comment_links" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "samply_comment_links_event_id_idx" ON "label_suite"."samply_comment_links" USING btree ("samply_event_id");--> statement-breakpoint
CREATE INDEX "samply_comment_links_release_id_idx" ON "label_suite"."samply_comment_links" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "samply_comment_links_track_id_idx" ON "label_suite"."samply_comment_links" USING btree ("org_id","track_id");--> statement-breakpoint
CREATE INDEX "samply_comment_links_ops_task_id_idx" ON "label_suite"."samply_comment_links" USING btree ("org_id","ops_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "samply_comment_links_remote_unique_idx" ON "label_suite"."samply_comment_links" USING btree ("org_id","remote_comment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "samply_connections_org_unique_idx" ON "label_suite"."samply_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "samply_connections_status_idx" ON "label_suite"."samply_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "samply_events_org_id_idx" ON "label_suite"."samply_events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "samply_events_type_idx" ON "label_suite"."samply_events" USING btree ("org_id","event_type");--> statement-breakpoint
CREATE INDEX "samply_events_project_idx" ON "label_suite"."samply_events" USING btree ("org_id","remote_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "samply_events_remote_unique_idx" ON "label_suite"."samply_events" USING btree ("org_id","remote_event_id");--> statement-breakpoint
CREATE INDEX "samply_files_org_id_idx" ON "label_suite"."samply_files" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "samply_files_project_id_idx" ON "label_suite"."samply_files" USING btree ("samply_project_id");--> statement-breakpoint
CREATE INDEX "samply_files_track_id_idx" ON "label_suite"."samply_files" USING btree ("org_id","track_id");--> statement-breakpoint
CREATE INDEX "samply_files_work_id_idx" ON "label_suite"."samply_files" USING btree ("org_id","work_id");--> statement-breakpoint
CREATE INDEX "samply_files_media_asset_id_idx" ON "label_suite"."samply_files" USING btree ("org_id","media_asset_id");--> statement-breakpoint
CREATE INDEX "samply_files_document_id_idx" ON "label_suite"."samply_files" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "samply_files_remote_box_unique_idx" ON "label_suite"."samply_files" USING btree ("org_id","remote_box_id");--> statement-breakpoint
CREATE INDEX "samply_players_org_id_idx" ON "label_suite"."samply_players" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "samply_players_project_id_idx" ON "label_suite"."samply_players" USING btree ("samply_project_id");--> statement-breakpoint
CREATE INDEX "samply_players_release_id_idx" ON "label_suite"."samply_players" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "samply_players_remote_unique_idx" ON "label_suite"."samply_players" USING btree ("org_id","remote_player_id");--> statement-breakpoint
CREATE INDEX "samply_projects_org_id_idx" ON "label_suite"."samply_projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "samply_projects_release_id_idx" ON "label_suite"."samply_projects" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "samply_projects_campaign_id_idx" ON "label_suite"."samply_projects" USING btree ("org_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "samply_projects_remote_unique_idx" ON "label_suite"."samply_projects" USING btree ("org_id","remote_project_id");
