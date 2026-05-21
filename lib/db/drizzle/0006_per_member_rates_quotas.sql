ALTER TABLE "users" ADD COLUMN "target_hourly_rate" numeric(10, 2);--> statement-breakpoint
CREATE TABLE "role_quotas" (
  "id" serial PRIMARY KEY NOT NULL,
  "role" text NOT NULL,
  "metric_key" text NOT NULL,
  "target_value" numeric(12, 2) NOT NULL DEFAULT '0',
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "role_quotas_role_metric_idx" ON "role_quotas" ("role","metric_key");
