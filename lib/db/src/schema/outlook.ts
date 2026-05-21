import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailLinksTable = pgTable("email_links", {
  id:                 serial("id").primaryKey(),
  userId:             integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  messageId:          text("message_id").notNull(),
  messageSubject:     text("message_subject"),
  messageSenderName:  text("message_sender_name"),
  messageSenderEmail: text("message_sender_email"),
  messageDate:        text("message_date"),
  entityType:         text("entity_type").notNull(),
  entityId:           integer("entity_id").notNull(),
  linkedAt:           timestamp("linked_at").defaultNow().notNull(),
});
