CREATE TABLE "label_suite"."dsp_pitch_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT 'true-nature' NOT NULL,
	"dsp_pitch_id" text NOT NULL,
	"release_id" text NOT NULL,
	"airtable_base_id" text,
	"airtable_record_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "label_suite"."dsp_pitch_releases" ADD CONSTRAINT "dsp_pitch_releases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."dsp_pitch_releases" ADD CONSTRAINT "dsp_pitch_releases_dsp_pitch_id_dsp_pitches_id_fk" FOREIGN KEY ("dsp_pitch_id") REFERENCES "label_suite"."dsp_pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."dsp_pitch_releases" ADD CONSTRAINT "dsp_pitch_releases_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "label_suite"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dsp_pitch_releases_org_id_idx" ON "label_suite"."dsp_pitch_releases" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dsp_pitch_releases_pitch_id_idx" ON "label_suite"."dsp_pitch_releases" USING btree ("dsp_pitch_id");--> statement-breakpoint
CREATE INDEX "dsp_pitch_releases_release_id_idx" ON "label_suite"."dsp_pitch_releases" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dsp_pitch_releases_pitch_release_unique_idx" ON "label_suite"."dsp_pitch_releases" USING btree ("org_id","dsp_pitch_id","release_id");