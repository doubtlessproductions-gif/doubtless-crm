CREATE TABLE "invoices" (
  "id" serial PRIMARY KEY NOT NULL,
  "contact_id" integer NOT NULL,
  "deal_id" integer,
  "number" text NOT NULL,
  "line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL DEFAULT '0',
  "tax_rate" numeric(5, 2) NOT NULL DEFAULT '0',
  "tax_amount" numeric(12, 2) NOT NULL DEFAULT '0',
  "total" numeric(12, 2) NOT NULL DEFAULT '0',
  "status" text NOT NULL DEFAULT 'draft',
  "due_date" date,
  "sent_at" timestamp,
  "paid_at" timestamp,
  "notes" text,
  "payment_terms" text,
  "view_token" text,
  "created_by" integer NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" ("number");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
