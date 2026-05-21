import { pgTable, serial, text, timestamp, integer, jsonb, boolean, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// ── Field types supported by the builder ─────────────────────────────────────
export const customFormFieldTypeEnum = pgEnum("custom_form_field_type", [
  // Basic
  "short_text", "long_text", "email", "phone", "number", "date",
  // Contact
  "full_name", "url", "time", "address",
  // Choice
  "dropdown", "radio", "checkbox_group", "checkbox", "yes_no",
  // Scale / Rating
  "rating", "scale", "slider",
  // Contract & Signature
  "signature", "initials", "date_signed", "contract_text", "legal_agreement",
  // Layout
  "heading", "divider", "statement", "instructions", "spacer",
]);

export const customFormStatusEnum = pgEnum("custom_form_status", ["draft", "published", "archived"]);

// ── CRM field mapping ─────────────────────────────────────────────────────────
export type CrmFieldMapping = "name" | "email" | "phone" | "company" | "notes";

// ── All supported field type strings ─────────────────────────────────────────
export type CustomFormFieldType =
  | "short_text" | "long_text" | "email" | "phone" | "number" | "date"
  | "full_name" | "url" | "time" | "address"
  | "dropdown" | "radio" | "checkbox_group" | "checkbox" | "yes_no"
  | "rating" | "scale" | "slider"
  | "signature" | "initials" | "date_signed" | "contract_text" | "legal_agreement"
  | "heading" | "divider" | "statement" | "instructions" | "spacer";

// ── Field definition stored in JSONB ─────────────────────────────────────────
export interface CustomFormField {
  id: string;
  type: CustomFormFieldType | string;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  options?: string[];
  content?: string;
  crmField?: CrmFieldMapping;
  // Scale / slider config
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  // Rating
  maxStars?: number;
  // Matrix
  matrixRows?: string[];
  matrixCols?: string[];
  // Yes/No labels
  yesLabel?: string;
  noLabel?: string;
}

// ── Forms ─────────────────────────────────────────────────────────────────────
export const customFormsTable = pgTable("custom_forms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  fields: jsonb("fields").notNull().default([]).$type<CustomFormField[]>(),
  status: customFormStatusEnum("status").notNull().default("draft"),
  submitButtonLabel: text("submit_button_label").notNull().default("Submit"),
  successMessage: text("success_message").notNull().default("Thank you! Your response has been recorded."),
  createContact: boolean("create_contact").notNull().default(false),
  createDeal: boolean("create_deal").notNull().default(false),
  dealStage: text("deal_stage"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Submissions ───────────────────────────────────────────────────────────────
export const customFormSubmissionsTable = pgTable("custom_form_submissions", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").notNull().references(() => customFormsTable.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  submitterIp: text("submitter_ip"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  submitterName: text("submitter_name"),
  submitterEmail: text("submitter_email"),
  status: text("status").notNull().default("new"),
});

export type CustomForm = typeof customFormsTable.$inferSelect;
export type CustomFormSubmission = typeof customFormSubmissionsTable.$inferSelect;
