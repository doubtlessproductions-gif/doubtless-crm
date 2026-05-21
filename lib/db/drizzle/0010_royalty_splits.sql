CREATE TABLE "royalty_splits" (
  "id" serial PRIMARY KEY NOT NULL,
  "royalty_id" integer NOT NULL,
  "contact_id" integer,
  "name" text NOT NULL,
  "percentage" integer NOT NULL DEFAULT 0,
  "statement_sent_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

ALTER TABLE "royalty_splits" ADD CONSTRAINT "royalty_splits_royalty_id_royalties_id_fk" FOREIGN KEY ("royalty_id") REFERENCES "public"."royalties"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "royalty_splits" ADD CONSTRAINT "royalty_splits_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;
