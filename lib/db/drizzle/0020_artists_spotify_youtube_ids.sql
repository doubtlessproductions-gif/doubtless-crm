ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "spotify_id" text;
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "youtube_channel_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "artists_spotify_id_unique" ON "artists" ("spotify_id") WHERE "spotify_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "artists_youtube_channel_id_unique" ON "artists" ("youtube_channel_id") WHERE "youtube_channel_id" IS NOT NULL;
