DO $$ BEGIN
  CREATE TYPE "artist_outreach_message_type" AS ENUM('dm','email','proposal','recommendation');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "artist_outreach_message_status" AS ENUM('draft','approved','sent','replied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "artist_outreach_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "artist_id" integer NOT NULL REFERENCES "artists"("id") ON DELETE CASCADE,
  "type" "artist_outreach_message_type" NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "status" "artist_outreach_message_status" NOT NULL DEFAULT 'draft',
  "context_notes" text,
  "recipient_email" text,
  "created_by" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "approved_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "sent_at" timestamp,
  "replied_at" timestamp,
  "reply_notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
