import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const fileLinksTable = pgTable("file_links", {
  id:           serial("id").primaryKey(),
  userId:       integer("user_id").notNull(),
  fileId:       text("file_id").notNull(),
  fileName:     text("file_name"),
  fileWebUrl:   text("file_web_url"),
  fileMimeType: text("file_mime_type"),
  entityType:   text("entity_type").notNull(),
  entityId:     integer("entity_id").notNull(),
  linkedAt:     timestamp("linked_at").defaultNow().notNull(),
});
