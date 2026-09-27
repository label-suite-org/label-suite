ALTER TABLE "label_suite"."royalties_revenue" ADD COLUMN "work_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD COLUMN "track_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD COLUMN "statement_id" text;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD CONSTRAINT "royalties_revenue_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "label_suite"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_suite"."royalties_revenue" ADD CONSTRAINT "royalties_revenue_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "label_suite"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "royalties_revenue_work_id_idx" ON "label_suite"."royalties_revenue" USING btree ("work_id");