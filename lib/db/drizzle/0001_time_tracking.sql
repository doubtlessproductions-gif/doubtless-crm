CREATE TYPE "public"."time_category" AS ENUM('recording', 'mixing', 'mastering', 'video', 'admin', 'other');--> statement-breakpoint
CREATE TABLE "time_entries" (
        "id" serial PRIMARY KEY NOT NULL,
        "deal_id" integer,
        "user_id" integer NOT NULL,
        "date" date NOT NULL,
        "duration_minutes" integer NOT NULL,
        "category" "time_category" DEFAULT 'other' NOT NULL,
        "description" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_settings" (
        "id" serial PRIMARY KEY NOT NULL,
        "workspace_id" integer DEFAULT 1 NOT NULL,
        "target_hourly_rate" numeric(10, 2) DEFAULT '100' NOT NULL,
        "currency" text DEFAULT 'USD' NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
