ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "assignee_ids" text[] NOT NULL DEFAULT ARRAY[]::text[];
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "labels" text[] NOT NULL DEFAULT ARRAY[]::text[];
--> statement-breakpoint
ALTER TABLE "label_suite"."ops_tasks" ADD COLUMN "dependency_ids" text[] NOT NULL DEFAULT ARRAY[]::text[];
