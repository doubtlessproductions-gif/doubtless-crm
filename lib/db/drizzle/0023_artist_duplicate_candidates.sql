-- Add soft-delete column to artists
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- Duplicate candidate status enum
DO $$ BEGIN
  CREATE TYPE "public"."artist_duplicate_candidate_status" AS ENUM('pending', 'dismissed', 'merged');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Duplicate candidates table
CREATE TABLE IF NOT EXISTS "artist_duplicate_candidates" (
  "id" serial PRIMARY KEY NOT NULL,
  "artist_id_a" integer NOT NULL REFERENCES "artists"("id") ON DELETE CASCADE,
  "artist_id_b" integer NOT NULL REFERENCES "artists"("id") ON DELETE CASCADE,
  "confidence_score" real NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" "artist_duplicate_candidate_status" DEFAULT 'pending' NOT NULL,
  "reviewed_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "artist_duplicate_candidates_pair_unique" UNIQUE("artist_id_a","artist_id_b")
);
