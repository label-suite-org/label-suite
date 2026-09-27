CREATE TABLE "label_suite"."organizations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "name" text NOT NULL,
  "type" text,
  "website" text,
  "linkedin_url" text,
  "notes" text,
  "source" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "organizations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "label_suite"."contact_organizations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'true-nature' NOT NULL,
  "contact_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "title" text,
  "department" text,
  "relationship_type" text,
  "is_primary" boolean DEFAULT false,
  "source" text,
  "confidence" real,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "contact_organizations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "label_suite"."orgs"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "contact_organizations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "label_suite"."contacts"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "contact_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "label_suite"."organizations"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "organizations_org_id_idx" ON "label_suite"."organizations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "label_suite"."organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "organizations_type_idx" ON "label_suite"."organizations" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_org_name_unique_idx" ON "label_suite"."organizations" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "contact_organizations_org_id_idx" ON "label_suite"."contact_organizations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "contact_organizations_contact_id_idx" ON "label_suite"."contact_organizations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_organizations_organization_id_idx" ON "label_suite"."contact_organizations" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_organizations_unique_idx" ON "label_suite"."contact_organizations" USING btree ("org_id","contact_id","organization_id");--> statement-breakpoint
INSERT INTO "label_suite"."organizations" (
  "id",
  "org_id",
  "name",
  "type",
  "source",
  "created_at",
  "updated_at"
)
SELECT
  'airtable-org-' || md5(c.org_id || ':' || lower(trim(c.company))) AS id,
  c.org_id,
  trim(c.company) AS name,
  'company' AS type,
  'contacts.company backfill' AS source,
  now(),
  now()
FROM "label_suite"."contacts" c
WHERE c.company IS NOT NULL
  AND trim(c.company) <> ''
GROUP BY c.org_id, trim(c.company)
ON CONFLICT ("org_id", "name") DO NOTHING;
--> statement-breakpoint
INSERT INTO "label_suite"."contact_organizations" (
  "id",
  "org_id",
  "contact_id",
  "organization_id",
  "title",
  "relationship_type",
  "is_primary",
  "source",
  "confidence",
  "created_at",
  "updated_at"
)
SELECT
  'contact-org-' || md5(c.org_id || ':' || c.id || ':' || o.id) AS id,
  c.org_id,
  c.id,
  o.id,
  c.role,
  'works_at',
  true,
  'contacts.company backfill',
  0.85,
  now(),
  now()
FROM "label_suite"."contacts" c
INNER JOIN "label_suite"."organizations" o
  ON o.org_id = c.org_id
 AND o.name = trim(c.company)
WHERE c.company IS NOT NULL
  AND trim(c.company) <> ''
ON CONFLICT ("org_id", "contact_id", "organization_id") DO NOTHING;
