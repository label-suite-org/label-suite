CREATE TABLE "label_suite"."ops_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"task_name" text NOT NULL,
	"status" text DEFAULT 'todo',
	"priority" text DEFAULT 'P2',
	"owner" text,
	"due_date" date,
	"linked_artist_id" text,
	"linked_release_id" text,
	"notes" text,
	"next_action" text,
	"is_overdue" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_linked_artist_id_artists_id_fk" FOREIGN KEY ("linked_artist_id") REFERENCES "label_suite"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD CONSTRAINT "ops_tasks_linked_release_id_releases_id_fk" FOREIGN KEY ("linked_release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;