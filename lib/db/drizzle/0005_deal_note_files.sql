ALTER TABLE "deal_notes" ADD COLUMN IF NOT EXISTS "file_url" text;
ALTER TABLE "deal_notes" ADD COLUMN IF NOT EXISTS "file_name" text;
ALTER TABLE "deal_notes" ALTER COLUMN "content" SET DEFAULT '';
