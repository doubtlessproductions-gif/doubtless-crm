import { pgTable, serial, text, integer, jsonb, timestamp, date, pgEnum, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const releaseStatusEnum       = pgEnum("release_status",        ["draft", "scheduled", "live"]);
export const rolloutActionStatusEnum = pgEnum("rollout_action_status", ["pending", "running", "done", "failed"]);

// ── Releases ──────────────────────────────────────────────────────────────────

export const releasesTable = pgTable("releases", {
  id:            serial("id").primaryKey(),
  artistId:      integer("artist_id"),
  artistName:    text("artist_name"),
  title:         text("title").notNull(),
  releaseDate:   date("release_date").notNull(),
  audioUrl:      text("audio_url"),
  coverArtUrl:   text("cover_art_url"),
  status:        releaseStatusEnum("status").notNull().default("draft"),
  genre:           text("genre"),
  upc:             text("upc"),
  catalogNumber:   text("catalog_number"),
  releaseType:     text("release_type"),        // single | ep | album | mixtape | compilation
  isrc:            text("isrc"),
  label:           text("label"),
  notes:           text("notes"),
  explicit:        boolean("explicit").notNull().default(false),
  language:        text("language"),
  distributorName: text("distributor_name"),
  spotifyTrackId:  text("spotify_track_id"),    // for streaming stats lookup
  youtubeVideoId:  text("youtube_video_id"),    // for YouTube video stats
  createdBy:       integer("created_by").references(() => usersTable.id),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  updatedAt:     timestamp("updated_at").notNull().defaultNow(),
});

// ── Rollout actions (one row per scheduled action) ────────────────────────────

export const rolloutActionsTable = pgTable("rollout_actions", {
  id:           serial("id").primaryKey(),
  releaseId:    integer("release_id").notNull().references(() => releasesTable.id, { onDelete: "cascade" }),
  phase:        text("phase").notNull(),         // tease | announce | engage | drop | post
  type:         text("type").notNull(),          // create_post | send_email | drop_video | unlock_content | publish_page
  scheduledFor: timestamp("scheduled_for").notNull(),
  payload:      jsonb("payload").notNull().default({}),
  status:       rolloutActionStatusEnum("status").notNull().default("pending"),
  completedAt:  timestamp("completed_at"),
  error:        text("error"),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type Release       = typeof releasesTable.$inferSelect;
export type RolloutAction = typeof rolloutActionsTable.$inferSelect;
