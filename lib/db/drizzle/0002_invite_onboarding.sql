ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "user_type" text NOT NULL DEFAULT 'team';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "allowed_tabs" jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL DEFAULT 'user',
	"invited_by" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
