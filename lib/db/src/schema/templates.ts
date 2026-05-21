import { pgTable, serial, text, timestamp, integer, boolean, pgEnum, jsonb, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { contactsTable } from "./crm";

export const templateTypeEnum = pgEnum("template_type", ["email", "proposal", "sms"]);

export const templatesTable = pgTable("templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: templateTypeEnum("type").notNull().default("email"),
  subject: text("subject"),
  body: text("body").notNull(),
  variables: text("variables").array().notNull().default([]),
  isShared: boolean("is_shared").notNull().default(false),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const paymentLinksTable = pgTable("payment_links", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id"),
  title: text("title").notNull(),
  amount: integer("amount").notNull(), // in cents
  currency: text("currency").notNull().default("usd"),
  stripePaymentLinkId: text("stripe_payment_link_id"),
  stripeUrl: text("stripe_url"),
  status: text("status").notNull().default("active"), // active | expired | completed
  description: text("description"),
  source: text("source").notNull().default("stripe"), // stripe | hubspot | manual
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarEventsTable = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  dealId: integer("deal_id"),
  contactId: integer("contact_id"),
  googleEventId: text("google_event_id"),
  title: text("title").notNull(),
  description: text("description"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  attendeeEmails: text("attendee_emails").array().notNull().default([]),
  meetLink: text("meet_link"),
  meetingUrl: text("meeting_url"),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Template = typeof templatesTable.$inferSelect;
export type PaymentLink = typeof paymentLinksTable.$inferSelect;
export type CalendarEvent = typeof calendarEventsTable.$inferSelect;

// ── PHASE 4: ARTIST ROSTER ────────────────────────────────────────────────

export const artistsTable = pgTable("artists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  genre: text("genre"),
  labelStatus: text("label_status").notNull().default('["unsigned"]'),
  bio: text("bio"),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  lat: real("lat"),
  lng: real("lng"),
  streamingLinks: jsonb("streaming_links").$type<Record<string, string>>().notNull().default({}),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  tags: text("tags").array().notNull().default([]),
  outreachStatus: text("outreach_status").notNull().default("new"), // new|contacted|in_talks|signed|passed
  revenuePotential: text("revenue_potential"),                      // free-text tier or dollar estimate
  followersEstimate: text("followers_estimate"),                    // follower bucket: <1K|1K-10K|10K-100K|100K+
  engagementLevel: text("engagement_level"),                        // low|medium|high
  imageUrl: text("image_url"),                                        // Profile image (from Spotify/YouTube on import)
  photoUrls: jsonb("photo_urls").$type<string[]>().notNull().default([]), // Gallery photos (pasted URLs)
  originCity: text("origin_city"),
  originState: text("origin_state"),
  originCountry: text("origin_country"),
  spotifyId: text("spotify_id"),                                     // Spotify artist ID for duplicate guard
  youtubeChannelId: text("youtube_channel_id"),                      // YouTube channel ID for duplicate guard
  contactId: integer("contact_id").references(() => contactsTable.id),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

export type Artist = typeof artistsTable.$inferSelect;
export type ArtistLabelStatus = string;

// ── OUTLOOK EMAIL LOG ─────────────────────────────────────────────────────
export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  to: text("to").array().notNull(),
  cc: text("cc").array().notNull().default([]),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  contactId: integer("contact_id").references(() => contactsTable.id),
  dealId: integer("deal_id"),
  sentBy: integer("sent_by").notNull().references(() => usersTable.id),
  outlookMessageId: text("outlook_message_id"),
});

export type EmailLog = typeof emailLogsTable.$inferSelect;

// ── SMTP EMAIL SENDS (template-based) ────────────────────────────────────────
export const emailSendsTable = pgTable("email_sends", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  templateId: integer("template_id").references(() => templatesTable.id, { onDelete: "set null" }),
  toEmail: text("to_email").notNull(),
  subject: text("subject"),
  status: text("status").notNull().default("sent"), // "sent" | "failed"
  error: text("error"),
  sentBy: integer("sent_by").references(() => usersTable.id),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export type EmailSend = typeof emailSendsTable.$inferSelect;

// ── INVOICE EMAIL TEMPLATES ───────────────────────────────────────────────────
export const invoiceEmailTemplatesTable = pgTable("invoice_email_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type InvoiceEmailTemplate = typeof invoiceEmailTemplatesTable.$inferSelect;
