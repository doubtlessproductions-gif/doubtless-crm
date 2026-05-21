import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  numeric,
  pgEnum,
  boolean,
  jsonb,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const dealStageEnum = pgEnum("deal_stage", [
  "lead",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

export const dealPriorityEnum = pgEnum("deal_priority", ["low", "medium", "high"]);

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "manager", "artist", "engineer", "ar", "intern"]);

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  organization: text("organization"),
  tags: text("tags").array().notNull().default([]),
  notes: text("notes"),
  assignedTo: integer("assigned_to").references(() => usersTable.id),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }),
  stage: dealStageEnum("stage").notNull().default("lead"),
  priority: dealPriorityEnum("priority").notNull().default("medium"),
  expectedCloseDate: date("expected_close_date"),
  contactId: integer("contact_id").references(() => contactsTable.id),
  assignedTo: integer("assigned_to").references(() => usersTable.id),
  notes: text("notes"),
  closedAt: timestamp("closed_at"),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const dealNotesTable = pgTable("deal_notes", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id")
    .notNull()
    .references(() => dealsTable.id),
  authorId: integer("author_id")
    .notNull()
    .references(() => usersTable.id),
  content: text("content").notNull().default(""),
  fileUrl:  text("file_url"),
  fileName: text("file_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const themeSettingsTable = pgTable("theme_settings", {
  id: serial("id").primaryKey(),
  primaryColor: text("primary_color").notNull().default("#4f46e5"),
  accentColor: text("accent_color").notNull().default("#7c3aed"),
  logoUrl: text("logo_url"),
  companyName: text("company_name").notNull().default("My CRM"),
  sidebarConfig: jsonb("sidebar_config"),
  invoiceRemindersEnabled: boolean("invoice_reminders_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Time Tracking ─────────────────────────────────────────────────────────────

export const timeCategoryEnum = pgEnum("time_category", [
  "recording",
  "mixing",
  "mastering",
  "video",
  "admin",
  "other",
]);

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  date: date("date").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  category: timeCategoryEnum("category").notNull().default("other"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const timeSettingsTable = pgTable("time_settings", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull().default(1),
  targetHourlyRate: numeric("target_hourly_rate", { precision: 10, scale: 2 }).notNull().default("100"),
  currency: text("currency").notNull().default("USD"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ── Role Quotas ───────────────────────────────────────────────────────────────
// One row per (role, metricKey). targetValue is the monthly quota target.

export const roleQuotasTable = pgTable("role_quotas", {
  id:          serial("id").primaryKey(),
  role:        text("role").notNull(),
  metricKey:   text("metric_key").notNull(),   // e.g. "deals_closed", "revenue_closed", "hours_logged"
  targetValue: numeric("target_value", { precision: 12, scale: 2 }).notNull().default("0"),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("role_quotas_role_metric_idx").on(t.role, t.metricKey)]);

export type RoleQuota = typeof roleQuotasTable.$inferSelect;

// ── Custom Quota Categories ───────────────────────────────────────────────────
// Admin-defined quota types beyond the built-in metric keys.

export const customQuotaCategoriesTable = pgTable("custom_quota_categories", {
  id:          serial("id").primaryKey(),
  label:       text("label").notNull(),
  unit:        text("unit").notNull().default("count"),  // "count" | "currency" | "hours" | custom
  description: text("description"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type CustomQuotaCategory = typeof customQuotaCategoriesTable.$inferSelect;

// ── Per-User Quota Overrides ──────────────────────────────────────────────────
// Per-user quota targets. Takes precedence over role_quotas for that user.

export const userQuotasTable = pgTable("user_quotas", {
  id:          serial("id").primaryKey(),
  userId:      integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  metricKey:   text("metric_key").notNull(),
  targetValue: numeric("target_value", { precision: 12, scale: 2 }).notNull().default("0"),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("user_quotas_user_metric_idx").on(t.userId, t.metricKey)]);

export type UserQuota = typeof userQuotasTable.$inferSelect;

// ── Role-Based Page Permissions ───────────────────────────────────────────────
// Single-row table (id = 1). permissions JSONB maps page key → allowed roles[].
// Missing key = all roles may access. Empty array = nobody (except admin).

export const rolePermissionsTable = pgTable("role_permissions", {
  id:          serial("id").primaryKey(),
  permissions: jsonb("permissions").$type<Record<string, string[]>>().notNull().default({}),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type RolePermissions = typeof rolePermissionsTable.$inferSelect;

export type TimeEntry = typeof timeEntriesTable.$inferSelect;
export type TimeSettings = typeof timeSettingsTable.$inferSelect;
export type TimeCategory = (typeof timeCategoryEnum.enumValues)[number];

// ── AUTOMATION ENGINE ─────────────────────────────────────────────────────────

export interface AutomationCondition {
  field: string;       // e.g. "deal.stage", "deal.value", "contact.tag"
  operator: string;    // "equals" | "not_equals" | "contains" | "gt" | "lt"
  value: string | number | boolean;
}

export interface AutomationAction {
  type: string;        // "send_email" | "add_note" | "update_stage" | "send_notification" | "create_activity" | "add_tag"
  config: Record<string, unknown>;
}

export const automationsTable = pgTable("automations", {
  id:            serial("id").primaryKey(),
  name:          text("name").notNull(),
  description:   text("description"),
  trigger:       text("trigger").notNull(), // "deal.created" | "deal.stage_changed" | "contact.created" | "invoice.paid" | "form.submitted" | "release.scheduled" | "project.status_changed"
  triggerConfig: jsonb("trigger_config").$type<Record<string, unknown>>().notNull().default({}),
  conditions:    jsonb("conditions").$type<AutomationCondition[]>().notNull().default([]),
  actions:       jsonb("actions").$type<AutomationAction[]>().notNull().default([]),
  enabled:       boolean("enabled").notNull().default(true),
  runCount:      integer("run_count").notNull().default(0),
  lastRunAt:     timestamp("last_run_at"),
  createdBy:     integer("created_by").notNull().references(() => usersTable.id),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});

export const automationRunsTable = pgTable("automation_runs", {
  id:           serial("id").primaryKey(),
  automationId: integer("automation_id").notNull().references(() => automationsTable.id, { onDelete: "cascade" }),
  trigger:      text("trigger").notNull(),
  payload:      jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  actionsRun:   integer("actions_run").notNull().default(0),
  status:       text("status").notNull().default("success"), // "success" | "partial" | "failed"
  error:        text("error"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type Automation    = typeof automationsTable.$inferSelect;
export type AutomationRun = typeof automationRunsTable.$inferSelect;

// ── SUBSCRIPTION PLANS + CLIENT SUBSCRIPTIONS ─────────────────────────────────

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id:                  serial("id").primaryKey(),
  name:                text("name").notNull(),           // "Artist Essentials", "Studio Unlimited"
  description:         text("description"),
  priceMonthly:        numeric("price_monthly", { precision: 10, scale: 2 }).notNull().default("0"),
  priceYearly:         numeric("price_yearly",  { precision: 10, scale: 2 }),
  features:            jsonb("features").$type<string[]>().notNull().default([]),
  quotas:              jsonb("quotas").$type<Record<string, number>>().notNull().default({}),
  stripeProductId:     text("stripe_product_id"),
  stripePriceMonthly:  text("stripe_price_monthly"),
  stripePriceYearly:   text("stripe_price_yearly"),
  isActive:            boolean("is_active").notNull().default(true),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});

export const clientSubscriptionsTable = pgTable("client_subscriptions", {
  id:                  serial("id").primaryKey(),
  contactId:           integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  planId:              integer("plan_id").notNull().references(() => subscriptionPlansTable.id),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId:    text("stripe_customer_id"),
  status:              text("status").notNull().default("active"), // "active" | "past_due" | "cancelled" | "paused"
  interval:            text("interval").notNull().default("monthly"), // "monthly" | "yearly"
  currentPeriodStart:  timestamp("current_period_start"),
  currentPeriodEnd:    timestamp("current_period_end"),
  cancelAtPeriodEnd:   boolean("cancel_at_period_end").notNull().default(false),
  notes:               text("notes"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});

export type SubscriptionPlan       = typeof subscriptionPlansTable.$inferSelect;
export type ClientSubscription     = typeof clientSubscriptionsTable.$inferSelect;

// ── INVOICES ──────────────────────────────────────────────────────────────────

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export const invoicesTable = pgTable("invoices", {
  id:          serial("id").primaryKey(),
  contactId:   integer("contact_id").notNull().references(() => contactsTable.id, { onDelete: "cascade" }),
  dealId:      integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  number:      text("number").notNull().unique(),   // e.g. "INV-0042"
  lineItems:   jsonb("line_items").$type<InvoiceLineItem[]>().notNull().default([]),
  subtotal:    numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate:     numeric("tax_rate",  { precision: 5, scale: 2 }).notNull().default("0"),
  taxAmount:   numeric("tax_amount",{ precision: 12, scale: 2 }).notNull().default("0"),
  total:       numeric("total",     { precision: 12, scale: 2 }).notNull().default("0"),
  status:      text("status").notNull().default("draft"), // draft | sent | paid | overdue
  dueDate:     date("due_date"),
  sentAt:      timestamp("sent_at"),
  paidAt:      timestamp("paid_at"),
  notes:       text("notes"),
  paymentTerms: text("payment_terms"),
  viewToken:   text("view_token"),
  viewedAt:    timestamp("viewed_at"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  remindersSent:    integer("reminders_sent").notNull().default(0),
  overdueAlertSent: boolean("overdue_alert_sent").notNull().default(false),
  createdBy:   integer("created_by").notNull().references(() => usersTable.id),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type Invoice     = typeof invoicesTable.$inferSelect;

// ── Deal Templates ────────────────────────────────────────────────────────────

export const dealTemplatesTable = pgTable("deal_templates", {
  id:               serial("id").primaryKey(),
  name:             text("name").notNull(),
  description:      text("description"),
  defaultValue:     numeric("default_value", { precision: 12, scale: 2 }),
  defaultStage:     dealStageEnum("default_stage").notNull().default("lead"),
  deliverableTypes: jsonb("deliverable_types").$type<string[]>().notNull().default([]),
  estimatedHours:   integer("estimated_hours"),
  createdBy:        integer("created_by").notNull().references(() => usersTable.id),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});

export type DealTemplate = typeof dealTemplatesTable.$inferSelect;

// ── Project Templates ─────────────────────────────────────────────────────────

export const projectTemplatesTable = pgTable("project_templates", {
  id:                     serial("id").primaryKey(),
  name:                   text("name").notNull(),
  description:            text("description"),
  defaultStatus:          text("default_status").notNull().default("planning"),
  mediaVersionCategories: jsonb("media_version_categories").$type<string[]>().notNull().default([]),
  estimatedHours:         integer("estimated_hours"),
  createdBy:              integer("created_by").notNull().references(() => usersTable.id),
  createdAt:              timestamp("created_at").notNull().defaultNow(),
  updatedAt:              timestamp("updated_at").notNull().defaultNow(),
});

export type ProjectTemplate = typeof projectTemplatesTable.$inferSelect;

export type Contact = typeof contactsTable.$inferSelect;
export type Deal = typeof dealsTable.$inferSelect;
export type DealNote = typeof dealNotesTable.$inferSelect;
export type ThemeSettings = typeof themeSettingsTable.$inferSelect;
export type DealStage = (typeof dealStageEnum.enumValues)[number];
export type UserRole = (typeof userRoleEnum.enumValues)[number];
