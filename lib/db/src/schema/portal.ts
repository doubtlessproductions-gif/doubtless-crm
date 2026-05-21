import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { contactsTable } from "./crm";

export const portalUsersTable = pgTable("portal_users", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id")
    .notNull()
    .unique()
    .references(() => contactsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  inviteToken: text("invite_token").unique(),
  inviteAcceptedAt: timestamp("invite_accepted_at"),
  lastLoginAt: timestamp("last_login_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const portalNotificationsTable = pgTable("portal_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => portalUsersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PortalUser = typeof portalUsersTable.$inferSelect;
export type PortalNotification = typeof portalNotificationsTable.$inferSelect;
