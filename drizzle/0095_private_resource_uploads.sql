CREATE TABLE "label_suite"."resource_upload_intents" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL REFERENCES "label_suite"."orgs"("id"),
  "actor_user_id" text NOT NULL REFERENCES "label_suite"."user"("id"),
  "client_request_id" text NOT NULL,
  "request" jsonb NOT NULL,
  "storage_bucket" text NOT NULL,
  "storage_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'prepared',
  "resource_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "resource_upload_intents_state_check" CHECK ((status = 'prepared' AND resource_id IS NULL) OR (status = 'completed' AND resource_id IS NOT NULL)),
  CONSTRAINT "resource_upload_intents_request_check" CHECK (jsonb_typeof(request) = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_upload_intents_request_idx" ON "label_suite"."resource_upload_intents" ("org_id", "actor_user_id", "client_request_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "resource_upload_intents_object_idx" ON "label_suite"."resource_upload_intents" ("storage_bucket", "storage_key");
