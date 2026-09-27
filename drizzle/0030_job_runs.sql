CREATE TABLE "label_suite"."job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"job_type" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"result" jsonb,
	"error" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "job_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "job_runs_org_started_at_idx" ON "label_suite"."job_runs" USING btree ("org_id","started_at");
--> statement-breakpoint
CREATE INDEX "job_runs_type_status_idx" ON "label_suite"."job_runs" USING btree ("job_type","status");
--> statement-breakpoint
CREATE INDEX "job_runs_status_started_at_idx" ON "label_suite"."job_runs" USING btree ("status","started_at");
