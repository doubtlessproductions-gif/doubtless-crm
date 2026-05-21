import {
  pgTable, serial, text, timestamp, integer, boolean, jsonb, pgEnum, real, unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { artistsTable } from "./templates";

// ── Artist Relationships ───────────────────────────────────────────────────────

export const artistRelationshipTypeEnum = pgEnum("artist_relationship_type", [
  "collaborator", "producer", "engineer", "venue", "label", "other",
]);

export const artistRelationshipsTable = pgTable("artist_relationships", {
  id:               serial("id").primaryKey(),
  fromArtistId:     integer("from_artist_id").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  toEntityId:       integer("to_entity_id"),
  toEntityType:     text("to_entity_type").notNull().default("artist"),
  toEntityName:     text("to_entity_name"),
  relationshipType: artistRelationshipTypeEnum("relationship_type").notNull(),
  notes:            text("notes"),
  createdBy:        integer("created_by").notNull().references(() => usersTable.id),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});

export type ArtistRelationship = typeof artistRelationshipsTable.$inferSelect;

// ── Enums ──────────────────────────────────────────────────────────────────────
export const artistOutreachStatusEnum = pgEnum("artist_outreach_status", [
  "new", "contacted", "in_talks", "signed", "passed",
]);

export const artistLeadTierEnum = pgEnum("artist_lead_tier", [
  "hot", "warm", "cold", "inactive",
]);

// ── AI Analysis Results ────────────────────────────────────────────────────────
export const artistAiAnalysisTable = pgTable("artist_ai_analysis", {
  id:                    serial("id").primaryKey(),
  artistId:              integer("artist_id").notNull().unique().references(() => artistsTable.id, { onDelete: "cascade" }),
  summary:               text("summary").notNull(),
  brandingScore:         integer("branding_score").notNull().default(0),      // 0–100
  growthScore:           integer("growth_score").notNull().default(0),        // 0–100
  professionalismScore:  integer("professionalism_score").notNull().default(0), // 0–100
  leadTier:              artistLeadTierEnum("lead_tier").notNull().default("cold"),
  recommendations:       jsonb("recommendations").$type<string[]>().notNull().default([]),
  generatedBy:           integer("generated_by").references(() => usersTable.id, { onDelete: "set null" }),
  // enrichment columns — populated by auto-enrich after import / weekly rescorer
  spotifyFollowers:      integer("spotify_followers"),
  spotifyPopularity:     integer("spotify_popularity"),
  youtubeSubscribers:    integer("youtube_subscribers"),
  youtubeVideoCount:     integer("youtube_video_count"),
  outreachHook:          text("outreach_hook"),   // AI-generated 1-sentence pitch hook
  enrichedAt:            timestamp("enriched_at"),
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
});

export type ArtistAiAnalysis = typeof artistAiAnalysisTable.$inferSelect;

// ── Per-Artist Tasks ───────────────────────────────────────────────────────────
export const artistTasksTable = pgTable("artist_tasks", {
  id:          serial("id").primaryKey(),
  artistId:    integer("artist_id").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  title:       text("title").notNull(),
  dueDate:     text("due_date"),             // ISO date string (YYYY-MM-DD), nullable
  assigneeId:  integer("assignee_id").references(() => usersTable.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdBy:   integer("created_by").notNull().references(() => usersTable.id),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type ArtistTask = typeof artistTasksTable.$inferSelect;

// ── Outreach Messages ──────────────────────────────────────────────────────────
export const artistOutreachMessageTypeEnum = pgEnum("artist_outreach_message_type", [
  "dm", "email", "proposal", "recommendation",
]);
export const artistOutreachMessageStatusEnum = pgEnum("artist_outreach_message_status", [
  "draft", "approved", "sent", "replied",
]);

export const artistOutreachMessagesTable = pgTable("artist_outreach_messages", {
  id:          serial("id").primaryKey(),
  artistId:    integer("artist_id").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  type:        artistOutreachMessageTypeEnum("type").notNull(),
  subject:     text("subject"),
  body:        text("body").notNull(),
  status:      artistOutreachMessageStatusEnum("status").notNull().default("draft"),
  contextNotes: text("context_notes"),
  recipientEmail: text("recipient_email"),
  createdBy:   integer("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  approvedBy:  integer("approved_by").references(() => usersTable.id, { onDelete: "set null" }),
  sentAt:      timestamp("sent_at"),
  repliedAt:   timestamp("replied_at"),
  replyNotes:  text("reply_notes"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type ArtistOutreachMessage = typeof artistOutreachMessagesTable.$inferSelect;

// ── Artist Conversation Notes (structured history: outreach sends, replies, manual) ──
export const artistNoteTypeEnum = pgEnum("artist_note_type", [
  "outreach_sent", "outreach_reply", "manual",
]);

export const artistNotesTable = pgTable("artist_notes", {
  id:             serial("id").primaryKey(),
  artistId:       integer("artist_id").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  authorId:       integer("author_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type:           artistNoteTypeEnum("type").notNull().default("manual"),
  subject:        text("subject"),
  body:           text("body").notNull(),
  sentTo:         text("sent_to"),
  outreachMsgId:  integer("outreach_msg_id"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
});

export type ArtistNote = typeof artistNotesTable.$inferSelect;

// ── Saved Views (per-user filter presets) ─────────────────────────────────────
export const artistSavedViewsTable = pgTable("artist_saved_views", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  filters:   jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ArtistSavedView = typeof artistSavedViewsTable.$inferSelect;

// ── Genre Sweep Config (one row per user) ────────────────────────────────────
export const artistSweepConfigTable = pgTable("artist_sweep_config", {
  id:             serial("id").primaryKey(),
  userId:         integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  genres:         jsonb("genres").$type<string[]>().notNull().default([]),
  platforms:      jsonb("platforms").$type<string[]>().notNull().default(["spotify", "youtube"]),
  minFollowers:   integer("min_followers").notNull().default(1000),
  maxFollowers:   integer("max_followers"),                          // null = no upper limit
  minPopularity:  integer("min_popularity").notNull().default(0),   // Spotify 0-100
  frequencyHours: integer("frequency_hours").notNull().default(24), // how often to auto-sweep
  enabled:        boolean("enabled").notNull().default(true),
  lastRunAt:      timestamp("last_run_at"),
  lastRunCount:   integer("last_run_count").notNull().default(0),
  updatedBy:      integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdUniq: unique("artist_sweep_config_user_id_uniq").on(table.userId),
}));

export type ArtistSweepConfig = typeof artistSweepConfigTable.$inferSelect;

// ── Sweep Candidates ───────────────────────────────────────────────────────────
export const sweepCandidateStatusEnum = pgEnum("sweep_candidate_status", [
  "new", "imported", "dismissed",
]);

export const artistSweepCandidateTable = pgTable("artist_sweep_candidates", {
  id:                  serial("id").primaryKey(),
  source:              text("source").notNull(),       // "spotify" | "youtube"
  sourceId:            text("source_id").notNull(),    // unique per user (see constraint below)
  discoveredForUserId: integer("discovered_for_user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  name:                text("name").notNull(),
  genres:              jsonb("genres").$type<string[]>().notNull().default([]),
  followers:           integer("followers"),
  popularity:          integer("popularity"),           // Spotify 0–100
  imageUrl:            text("image_url"),
  profileUrl:          text("profile_url").notNull(),
  bio:                 text("bio"),
  aiHook:              text("ai_hook"),                // AI 1-sentence outreach hook
  aiLeadTier:          artistLeadTierEnum("ai_lead_tier"),
  aiScore:             integer("ai_score"),             // 0-100 composite
  status:              sweepCandidateStatusEnum("status").notNull().default("new"),
  importedArtistId:    integer("imported_artist_id").references(() => artistsTable.id, { onDelete: "set null" }),
  dismissedBy:         integer("dismissed_by").references(() => usersTable.id, { onDelete: "set null" }),
  dismissedAt:         timestamp("dismissed_at"),
  discoveredAt:        timestamp("discovered_at").notNull().defaultNow(),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sourceUserUniq: unique("artist_sweep_cand_source_user_uniq").on(table.sourceId, table.discoveredForUserId),
}));

export type ArtistSweepCandidate = typeof artistSweepCandidateTable.$inferSelect;

// ── Duplicate Candidates ────────────────────────────────────────────────────────
export const artistDuplicateCandidateStatusEnum = pgEnum("artist_duplicate_candidate_status", [
  "pending", "dismissed", "merged",
]);

export const artistDuplicateCandidatesTable = pgTable("artist_duplicate_candidates", {
  id:              serial("id").primaryKey(),
  artistIdA:       integer("artist_id_a").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  artistIdB:       integer("artist_id_b").notNull().references(() => artistsTable.id, { onDelete: "cascade" }),
  confidenceScore: real("confidence_score").notNull(),
  evidence:        jsonb("evidence").$type<string[]>().notNull().default([]),
  status:          artistDuplicateCandidateStatusEnum("status").notNull().default("pending"),
  reviewedBy:      integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt:      timestamp("reviewed_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
});

export type ArtistDuplicateCandidate = typeof artistDuplicateCandidatesTable.$inferSelect;

// ── Custom Label Statuses ───────────────────────────────────────────────────
export const customLabelStatusesTable = pgTable("custom_label_statuses", {
  id:          serial("id").primaryKey(),
  key:         text("key").notNull().unique(),
  name:        text("name").notNull(),
  colorClass:  text("color_class").notNull().default("bg-zinc-100 text-zinc-700 border-zinc-300"),
  createdBy:   integer("created_by").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export type CustomLabelStatus = typeof customLabelStatusesTable.$inferSelect;
