import { pgTable, serial, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { dealsTable } from "./crm";

export const deliverableStatusEnum = pgEnum("deliverable_status", [
  "uploaded",
  "shared",
  "approved",
]);

export const deliverablesTable = pgTable("deliverables", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull(),
  shareToken: text("share_token").unique(),
  sharePassword: text("share_password"),
  expiresAt: timestamp("expires_at"),
  status: deliverableStatusEnum("status").notNull().default("uploaded"),
  uploadedBy: integer("uploaded_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const deliverableCommentsTable = pgTable("deliverable_comments", {
  id: serial("id").primaryKey(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverablesTable.id, { onDelete: "cascade" }),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email"),
  timestampSeconds: integer("timestamp_seconds"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Deliverable = typeof deliverablesTable.$inferSelect;
export type DeliverableComment = typeof deliverableCommentsTable.$inferSelect;
export type DeliverableStatus = typeof deliverableStatusEnum.enumValues[number];

export const dealDeliverablePlansTable = pgTable("deal_deliverable_plans", {
  id:              serial("id").primaryKey(),
  dealId:          integer("deal_id").notNull().references(() => dealsTable.id, { onDelete: "cascade" }),
  deliverableType: text("deliverable_type").notNull(),
  templateId:      integer("template_id"),
  isCompleted:     boolean("is_completed").notNull().default(false),
  completedAt:     timestamp("completed_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export type DealDeliverablePlan = typeof dealDeliverablePlansTable.$inferSelect;
