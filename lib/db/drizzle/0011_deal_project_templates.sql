CREATE TABLE "deal_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "default_value" numeric(12, 2),
  "default_stage" "deal_stage" NOT NULL DEFAULT 'lead',
  "deliverable_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "estimated_hours" integer,
  "created_by" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "deal_templates" ADD CONSTRAINT "deal_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

CREATE TABLE "project_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "default_status" text NOT NULL DEFAULT 'planning',
  "media_version_categories" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "estimated_hours" integer,
  "created_by" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
