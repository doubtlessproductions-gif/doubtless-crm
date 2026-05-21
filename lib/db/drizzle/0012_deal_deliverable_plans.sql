CREATE TABLE "deal_deliverable_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "deal_id" integer NOT NULL,
  "deliverable_type" text NOT NULL,
  "template_id" integer,
  "is_completed" boolean DEFAULT false NOT NULL,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_deliverable_plans" ADD CONSTRAINT "deal_deliverable_plans_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
