import { pgTable, serial, text, timestamp, integer, jsonb, pgEnum, numeric } from "drizzle-orm/pg-core";
import { contactsTable } from "./crm";
import { dealsTable } from "./crm";

export const formTypeEnum = pgEnum("form_type", ["contact_intake", "staff_invoice", "general_inquiry"]);
export const formStatusEnum = pgEnum("form_status", ["new", "reviewed", "processed"]);

export const formSubmissionsTable = pgTable("form_submissions", {
  id: serial("id").primaryKey(),
  formType: formTypeEnum("form_type").notNull(),
  status: formStatusEnum("status").notNull().default("new"),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  contactId: integer("contact_id").references(() => contactsTable.id),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  // Denormalized quick-access fields
  submitterName: text("submitter_name"),
  submitterEmail: text("submitter_email"),
  serviceType: text("service_type"),
  invoiceAmount: numeric("invoice_amount", { precision: 12, scale: 2 }),
  notes: text("notes"),
});

export type FormSubmission = typeof formSubmissionsTable.$inferSelect;
export type FormType = (typeof formTypeEnum.enumValues)[number];
export type FormStatus = (typeof formStatusEnum.enumValues)[number];
