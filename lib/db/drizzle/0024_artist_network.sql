-- Add geographic columns to artists
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "country" text;
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "lat" real;
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "lng" real;

-- Artist relationship type enum
DO $$ BEGIN
  CREATE TYPE "public"."artist_relationship_type" AS ENUM('collaborator', 'producer', 'engineer', 'venue', 'label', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Artist relationships table
CREATE TABLE IF NOT EXISTS "artist_relationships" (
  "id" serial PRIMARY KEY NOT NULL,
  "from_artist_id" integer NOT NULL REFERENCES "artists"("id") ON DELETE CASCADE,
  "to_entity_id" integer,
  "to_entity_type" text NOT NULL DEFAULT 'artist',
  "to_entity_name" text,
  "relationship_type" "artist_relationship_type" NOT NULL,
  "notes" text,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "artist_relationships_from_artist_idx" ON "artist_relationships" ("from_artist_id");
