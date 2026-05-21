import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { dealsTable, contactsTable } from "./crm";
import { artistsTable } from "./templates";
import { releasesTable } from "./releases";

export const threadTypeEnum = pgEnum("thread_type", [
  "deal",
  "contact",
  "general",
  "review",
  "release",
  "dm",
  "group",
]);

export const messageThreadsTable = pgTable("message_threads", {
  id: serial("id").primaryKey(),
  type: threadTypeEnum("type").notNull().default("general"),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  contactId: integer("contact_id").references(() => contactsTable.id),
  artistId: integer("artist_id").references(() => artistsTable.id, { onDelete: "set null" }),
  releaseId: integer("release_id").references(() => releasesTable.id),
  title: text("title").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Review-mode: pinned reference file for the session
  reviewFileUrl: text("review_file_url"),
  reviewFileName: text("review_file_name"),
  // When true, final-delivery files in this thread require a completed payment
  isFinalLocked: boolean("is_final_locked").notNull().default(false),
  // Admin can manually mark payment received (e.g. cash / bank transfer)
  manuallyPaid: boolean("manually_paid").notNull().default(false),
  // Thread closed/completed flag
  isCompleted: boolean("is_completed").notNull().default(false),
  completedAt: timestamp("completed_at"),
  completedBy: integer("completed_by").references(() => usersTable.id),
});

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => messageThreadsTable.id),
  authorId: integer("author_id")
    .references(() => usersTable.id),
  portalAuthorId: integer("portal_author_id"),
  content: text("content").notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: bigint("file_size", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Marks this file message as the final deliverable — payment-gated download
  isFinalDelivery: boolean("is_final_delivery").notNull().default(false),
});

export const threadParticipantsTable = pgTable("thread_participants", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => messageThreadsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("thread_participants_thread_user_idx").on(t.threadId, t.userId)]);

export type MessageThread = typeof messageThreadsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type ThreadParticipant = typeof threadParticipantsTable.$inferSelect;
