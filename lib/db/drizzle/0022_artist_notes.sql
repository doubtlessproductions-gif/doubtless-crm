DO $$ BEGIN
  CREATE TYPE "artist_note_type" AS ENUM('outreach_sent','outreach_reply','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "artist_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "artist_id" integer NOT NULL REFERENCES "artists"("id") ON DELETE CASCADE,
  "author_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "artist_note_type" NOT NULL DEFAULT 'manual',
  "subject" text,
  "body" text NOT NULL,
  "sent_to" text,
  "outreach_msg_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);
