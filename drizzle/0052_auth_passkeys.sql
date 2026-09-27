CREATE TABLE IF NOT EXISTS "label_suite"."passkey" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "publicKey" text NOT NULL,
  "userId" text NOT NULL,
  "credentialID" text NOT NULL,
  "counter" integer NOT NULL,
  "deviceType" text NOT NULL,
  "backedUp" boolean NOT NULL,
  "transports" text,
  "createdAt" timestamp DEFAULT now(),
  "aaguid" text,
  CONSTRAINT "passkey_userId_user_id_fk"
    FOREIGN KEY ("userId")
    REFERENCES "label_suite"."user"("id")
    ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_userId_idx"
  ON "label_suite"."passkey" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx"
  ON "label_suite"."passkey" ("credentialID");
