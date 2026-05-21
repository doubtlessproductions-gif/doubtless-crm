import {
  pgTable, serial, text, timestamp, integer, boolean, jsonb, date, pgEnum,
} from "drizzle-orm/pg-core";
import { usersTable }     from "./users";
import { artistsTable }   from "./templates";
import { releasesTable }  from "./releases";
import { contactsTable }  from "./crm";

// ── Enums ──────────────────────────────────────────────────────────────────

export const artistTierEnum = pgEnum("artist_tier", [
  "standard", "silver", "gold", "platinum",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "planning", "in_progress", "mixing", "mastering", "delivered", "archived",
]);

export const releaseAssetTypeEnum = pgEnum("release_asset_type", [
  "audio_master", "cover_art", "music_video", "social_clip", "press_photo", "lyrics_sheet", "other",
]);

export const royaltyStatusEnum = pgEnum("royalty_status", [
  "pending", "processing", "paid", "disputed",
]);

export const contentPlatformEnum = pgEnum("content_platform", [
  "instagram", "tiktok", "twitter", "youtube", "facebook", "linkedin", "email", "sms",
]);

export const contentPostStatusEnum = pgEnum("content_post_status", [
  "draft", "scheduled", "posted", "cancelled",
]);

export const videoProjectStatusEnum = pgEnum("video_project_status", [
  "uploading", "processing", "watermarked", "unlocked", "failed",
]);

// ── Artist Profiles ────────────────────────────────────────────────────────

export const artistProfilesTable = pgTable("artist_profiles", {
  id:              serial("id").primaryKey(),
  artistId:        integer("artist_id").notNull().unique().references(() => artistsTable.id, { onDelete: "cascade" }),
  royaltySplitPct: integer("royalty_split_pct").notNull().default(50),
  bankDetails:     jsonb("bank_details").$type<Record<string, string>>().default({}),
  contractStart:   date("contract_start"),
  contractEnd:     date("contract_end"),
  tier:            artistTierEnum("tier").notNull().default("standard"),
  managerId:       integer("manager_id").references(() => usersTable.id, { onDelete: "set null" }),
  notes:           text("notes"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

// ── Projects ───────────────────────────────────────────────────────────────

export const projectsTable = pgTable("projects", {
  id:          serial("id").primaryKey(),
  title:       text("title").notNull(),
  description: text("description"),
  artistId:    integer("artist_id").references(() => artistsTable.id, { onDelete: "set null" }),
  releaseId:   integer("release_id").references(() => releasesTable.id, { onDelete: "set null" }),
  contactId:   integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  status:      projectStatusEnum("status").notNull().default("planning"),
  deadline:    date("deadline"),
  budgetCents: integer("budget_cents"),
  createdBy:   integer("created_by").notNull().references(() => usersTable.id),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

// ── Release Assets ─────────────────────────────────────────────────────────

export const releaseAssetsTable = pgTable("release_assets", {
  id:           serial("id").primaryKey(),
  releaseId:    integer("release_id").notNull().references(() => releasesTable.id, { onDelete: "cascade" }),
  type:         releaseAssetTypeEnum("type").notNull(),
  filename:     text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType:     text("mime_type").notNull(),
  sizeBytes:    integer("size_bytes").notNull(),
  storageKey:   text("storage_key").notNull(),
  notes:        text("notes"),
  uploadedBy:   integer("uploaded_by").notNull().references(() => usersTable.id),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

// ── Royalties ──────────────────────────────────────────────────────────────

export const royaltiesTable = pgTable("royalties", {
  id:          serial("id").primaryKey(),
  artistId:    integer("artist_id").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  releaseId:   integer("release_id").references(() => releasesTable.id, { onDelete: "set null" }),
  periodStart: date("period_start").notNull(),
  periodEnd:   date("period_end").notNull(),
  streamCount: integer("stream_count").notNull().default(0),
  grossCents:  integer("gross_cents").notNull().default(0),
  netCents:    integer("net_cents").notNull().default(0),
  splitPct:    integer("split_pct").notNull().default(50),
  status:      royaltyStatusEnum("status").notNull().default("pending"),
  paidAt:      timestamp("paid_at"),
  notes:       text("notes"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

// ── Royalty Splits ─────────────────────────────────────────────────────────

export const royaltySplitsTable = pgTable("royalty_splits", {
  id:               serial("id").primaryKey(),
  royaltyId:        integer("royalty_id").notNull().references(() => royaltiesTable.id, { onDelete: "cascade" }),
  contactId:        integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  name:             text("name").notNull(),
  percentage:       integer("percentage").notNull().default(0),
  statementSentAt:  timestamp("statement_sent_at"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});

export type RoyaltySplit = typeof royaltySplitsTable.$inferSelect;

// ── Content Posts ──────────────────────────────────────────────────────────

export const contentPostsTable = pgTable("content_posts", {
  id:          serial("id").primaryKey(),
  releaseId:   integer("release_id").references(() => releasesTable.id, { onDelete: "set null" }),
  platform:    contentPlatformEnum("platform").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  copy:        text("copy").notNull().default(""),
  mediaUrls:   jsonb("media_urls").$type<string[]>().default([]),
  status:      contentPostStatusEnum("status").notNull().default("draft"),
  postedAt:     timestamp("posted_at"),
  publishError: text("publish_error"),
  createdBy:    integer("created_by").notNull().references(() => usersTable.id),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

// ── Video Projects ─────────────────────────────────────────────────────────

export const videoProjectsTable = pgTable("video_projects", {
  id:                 serial("id").primaryKey(),
  releaseId:          integer("release_id").references(() => releasesTable.id, { onDelete: "set null" }),
  artistId:           integer("artist_id").references(() => artistsTable.id, { onDelete: "set null" }),
  contactId:          integer("contact_id").references(() => contactsTable.id, { onDelete: "set null" }),
  title:              text("title").notNull(),
  description:        text("description"),
  status:             videoProjectStatusEnum("status").notNull().default("uploading"),
  originalKey:        text("original_key"),
  watermarkedKey:     text("watermarked_key"),
  previewKey:         text("preview_key"),
  thumbnailKey:       text("thumbnail_key"),
  durationSeconds:    integer("duration_seconds"),
  sizeBytes:          integer("size_bytes"),
  downloadEnabled:    boolean("download_enabled").notNull().default(false),
  stripeInvoiceId:    text("stripe_invoice_id"),
  stripeInvoiceUrl:   text("stripe_invoice_url"),
  invoiceAmountCents: integer("invoice_amount_cents"),
  lockedAt:           timestamp("locked_at"),
  unlockedAt:         timestamp("unlocked_at"),
  uploadedBy:         integer("uploaded_by").notNull().references(() => usersTable.id),
  createdAt:          timestamp("created_at").notNull().defaultNow(),
  updatedAt:          timestamp("updated_at").notNull().defaultNow(),
});

// ── Media Versions ─────────────────────────────────────────────────────────
// Version history for mixes, masters, videos, artwork per studio/video project.

export const mediaVersionStatusEnum = pgEnum("media_version_status", [
  "pending", "approved", "rejected", "superseded",
]);

export const mediaVersionCategoryEnum = pgEnum("media_version_category", [
  "mix", "master", "stems", "video", "artwork", "radio_edit", "clean_edit", "other",
]);

export const mediaVersionsTable = pgTable("media_versions", {
  id:            serial("id").primaryKey(),
  entityType:    text("entity_type").notNull(),  // "studio_project" | "video_project" | "release"
  entityId:      integer("entity_id").notNull(),
  versionNumber: integer("version_number").notNull().default(1),
  label:         text("label").notNull(),        // "Mix v1", "Master v2 - Radio Edit"
  category:      mediaVersionCategoryEnum("category").notNull().default("mix"),
  storageKey:    text("storage_key"),            // object storage key
  fileName:      text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType:      text("mime_type"),
  notes:         text("notes"),
  status:        mediaVersionStatusEnum("status").notNull().default("pending"),
  uploadedBy:    integer("uploaded_by").notNull().references(() => usersTable.id),
  approvedBy:    integer("approved_by").references(() => usersTable.id),
  approvedAt:    timestamp("approved_at"),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
});

export type MediaVersion         = typeof mediaVersionsTable.$inferSelect;
export type MediaVersionStatus   = (typeof mediaVersionStatusEnum.enumValues)[number];
export type MediaVersionCategory = (typeof mediaVersionCategoryEnum.enumValues)[number];

// ── Types ──────────────────────────────────────────────────────────────────

export type ArtistProfile = typeof artistProfilesTable.$inferSelect;
export type Project       = typeof projectsTable.$inferSelect;
export type ReleaseAsset  = typeof releaseAssetsTable.$inferSelect;
export type Royalty       = typeof royaltiesTable.$inferSelect;
export type ContentPost   = typeof contentPostsTable.$inferSelect;
export type VideoProject  = typeof videoProjectsTable.$inferSelect;

export type VideoProjectStatus = typeof videoProjectStatusEnum.enumValues[number];
export type ProjectStatus      = typeof projectStatusEnum.enumValues[number];
export type RoyaltyStatus      = typeof royaltyStatusEnum.enumValues[number];
export type ContentPostStatus  = typeof contentPostStatusEnum.enumValues[number];
