import { pgTable, serial, text, timestamp, integer, boolean, jsonb, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userRoleEnum } from "./crm";

export const usersTable = pgTable("users", {
  id:           serial("id").primaryKey(),
  name:         text("name").notNull(),
  email:        text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role:         userRoleEnum("role").notNull().default("intern"),
  userType:     text("user_type").notNull().default("team"),
  allowedTabs:        jsonb("allowed_tabs").$type<string[]>(), // null = all tabs visible
  targetHourlyRate:   numeric("target_hourly_rate", { precision: 10, scale: 2 }), // null = use workspace default
  colorMode:          text("color_mode").notNull().default("light"),  // "light" | "dark"
  notificationPrefs:  jsonb("notification_prefs").$type<Record<string, boolean>>(), // per-event email prefs
  createdAt:          timestamp("created_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const activityTable = pgTable("activity", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id),
  type:        text("type").notNull(),
  description: text("description").notNull(),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type Activity = typeof activityTable.$inferSelect;

// ── PER-USER EMAIL SETTINGS (SMTP / company email) ────────────────────────────
export const userEmailSettingsTable = pgTable("user_email_settings", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().unique().references(() => usersTable.id),
  fromName:   text("from_name").notNull().default(""),
  fromEmail:  text("from_email").notNull().default(""),
  smtpHost:   text("smtp_host").notNull().default(""),
  smtpPort:   integer("smtp_port").notNull().default(587),
  smtpUser:   text("smtp_user").notNull().default(""),
  smtpPass:   text("smtp_pass").notNull().default(""),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  updatedAt:  timestamp("updated_at").notNull().defaultNow(),
});

export type UserEmailSettings = typeof userEmailSettingsTable.$inferSelect;

// ── PER-USER INTEGRATION CONNECTIONS ──────────────────────────────────────────
export const userConnectionsTable = pgTable("user_connections", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  provider:    text("provider").notNull(), // 'outlook' | 'onedrive' | 'dropbox'
  displayName: text("display_name").notNull().default(""),
  credentials: jsonb("credentials").$type<Record<string, unknown>>(), // {access_token} for dropbox; outlook stores {access_token,refresh_token,expires_at,email}
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("user_connections_user_provider_idx").on(t.userId, t.provider)]);

export type UserConnection = typeof userConnectionsTable.$inferSelect;

// ── WORKSPACE-LEVEL (SHARED) SOCIAL CONNECTIONS ────────────────────────────────
// Admin connects once; all team members can publish via these shared credentials.
export const workspaceConnectionsTable = pgTable("workspace_connections", {
  id:          serial("id").primaryKey(),
  provider:    text("provider").notNull().unique(), // one entry per provider
  displayName: text("display_name").notNull().default(""),
  credentials: jsonb("credentials").$type<Record<string, unknown>>(),
  connectedBy: integer("connected_by").references(() => usersTable.id, { onDelete: "set null" }),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
});

export type WorkspaceConnection = typeof workspaceConnectionsTable.$inferSelect;

// ── CUSTOM STREAMING / SOCIAL PLATFORMS ───────────────────────────────────────
// Workspace-level registry of custom platform templates (e.g. Deezel, SoundXchange).
// These appear as preset options in the artist create/edit form.
export const customPlatformsTable = pgTable("custom_platforms", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  linkType:  text("link_type").notNull().default("streaming"), // "streaming" | "social"
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CustomPlatform = typeof customPlatformsTable.$inferSelect;

// ── STAFF INVITES ─────────────────────────────────────────────────────────────
export const staffInvitesTable = pgTable("staff_invites", {
  id:        serial("id").primaryKey(),
  email:     text("email").notNull(),
  role:      userRoleEnum("role").notNull().default("intern"),
  invitedBy: integer("invited_by").notNull().references(() => usersTable.id),
  token:     text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt:    timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type StaffInvite = typeof staffInvitesTable.$inferSelect;

// ── AUDIT LOGS ────────────────────────────────────────────────────────────────
// Immutable append-only table. Never update or delete rows.
export const auditLogsTable = pgTable("audit_logs", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName:    text("user_name"),          // snapshot at time of action
  action:      text("action").notNull(),   // e.g. "deal.created", "file.downloaded", "user.login"
  entityType:  text("entity_type"),        // "deal" | "contact" | "user" | "file" | etc
  entityId:    integer("entity_id"),
  entityLabel: text("entity_label"),       // human-readable name at time of action
  metadata:    jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ipAddress:   text("ip_address"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type AuditLog = typeof auditLogsTable.$inferSelect;

// ── ADVANCED PER-USER PERMISSIONS ─────────────────────────────────────────────
// Granular action-level permissions per user. Overrides role defaults.
export const userPermissionsTable = pgTable("user_permissions", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().unique().references(() => usersTable.id, { onDelete: "cascade" }),
  permissions: jsonb("permissions").$type<Record<string, boolean>>().notNull().default({}),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type UserPermissions = typeof userPermissionsTable.$inferSelect;

// ── IN-APP NOTIFICATIONS ───────────────────────────────────────────────────────
export const notificationsTable = pgTable("notifications", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type:      text("type").notNull(),        // "form_submission" | "deal_stage" | "message" | "automation" | "subscription" | "deliverable" | "portal_message"
  title:     text("title").notNull(),
  body:      text("body").notNull(),
  linkHref:  text("link_href").notNull(),
  isRead:    boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Notification = typeof notificationsTable.$inferSelect;

// ── WEBHOOKS ───────────────────────────────────────────────────────────────────
export const webhooksTable = pgTable("webhooks", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  url:       text("url").notNull(),
  secret:    text("secret").notNull(),
  events:    jsonb("events").$type<string[]>().notNull().default([]),
  isActive:  boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Webhook = typeof webhooksTable.$inferSelect;

export const webhookDeliveryLogsTable = pgTable("webhook_delivery_logs", {
  id:            serial("id").primaryKey(),
  webhookId:     integer("webhook_id").notNull().references(() => webhooksTable.id, { onDelete: "cascade" }),
  event:         text("event").notNull(),
  payload:       jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  responseCode:  integer("response_code"),
  attempts:      integer("attempts").notNull().default(1),
  success:       boolean("success").notNull().default(false),
  lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
});

export type WebhookDeliveryLog = typeof webhookDeliveryLogsTable.$inferSelect;

// ── API KEYS ───────────────────────────────────────────────────────────────────
export const apiKeysTable = pgTable("api_keys", {
  id:         serial("id").primaryKey(),
  userId:     integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:       text("name").notNull(),
  keyHash:    text("key_hash").notNull().unique(),
  prefix:     text("prefix").notNull(),   // first 8 chars after "apk_" for display
  scopes:     jsonb("scopes").$type<string[]>(), // null = all resources allowed
  lastUsedAt: timestamp("last_used_at"),
  createdAt:  timestamp("created_at").notNull().defaultNow(),
  revokedAt:  timestamp("revoked_at"),
});

export type ApiKey = typeof apiKeysTable.$inferSelect;

// ── INBOUND WEBHOOK QUEUE ─────────────────────────────────────────────────────
export const webhookInboundQueueTable = pgTable("webhook_inbound_queue", {
  id:          serial("id").primaryKey(),
  deliveryId:  text("delivery_id").unique(),            // X-Webhook-Delivery-Id for idempotency
  event:       text("event").notNull(),
  payload:     jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status:      text("status").notNull().default("pending"), // pending | processing | done | failed
  attempts:    integer("attempts").notNull().default(0),
  lastError:   text("last_error"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  processedAt: timestamp("processed_at"),
});

export type WebhookInboundQueue = typeof webhookInboundQueueTable.$inferSelect;
