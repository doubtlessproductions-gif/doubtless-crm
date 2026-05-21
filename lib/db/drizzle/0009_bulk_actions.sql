ALTER TABLE "contacts" ADD COLUMN "assigned_to" integer;
--> statement-breakpoint
ALTER TABLE "custom_form_submissions" ADD COLUMN "status" text NOT NULL DEFAULT 'new';
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
