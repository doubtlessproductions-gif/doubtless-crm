import { pgTable, serial, text, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { dealsTable, contactsTable } from "./crm";
import { artistsTable } from "./templates";

export const pageStatusEnum = pgEnum("page_status", ["draft", "published"]);

// ── Block type definitions (stored as JSONB) ──────────────────────────────────

export interface TextBlock    { id: string; type: "text";    content: string }
export interface HeadingBlock { id: string; type: "heading"; text: string; level: 1 | 2 | 3 }
export interface ImageBlock   { id: string; type: "image";   url: string; alt?: string; caption?: string }
export interface VideoBlock   { id: string; type: "video";   url: string; title?: string }
export interface AudioBlock   { id: string; type: "audio";   url: string; title?: string }
export interface EmbedBlock   { id: string; type: "embed";   url: string; title?: string }
export interface DividerBlock { id: string; type: "divider" }
export interface GridBlock    { id: string; type: "grid";    columns: 2 | 3; children: ContentBlock[] }

export type ContentBlock =
  | TextBlock | HeadingBlock | ImageBlock | VideoBlock
  | AudioBlock | EmbedBlock | DividerBlock | GridBlock;

// ── Table ─────────────────────────────────────────────────────────────────────

export const projectPagesTable = pgTable("project_pages", {
  id:          serial("id").primaryKey(),
  title:       text("title").notNull(),
  slug:        text("slug").notNull().unique(),
  description: text("description"),
  blocks:      jsonb("blocks").notNull().default([]).$type<ContentBlock[]>(),
  status:      pageStatusEnum("status").notNull().default("draft"),
  dealId:      integer("deal_id").references(() => dealsTable.id, { onDelete: "set null" }),
  contactId:   integer("contact_id").references(() => contactsTable.id),
  artistId:    integer("artist_id").references(() => artistsTable.id, { onDelete: "set null" }),
  createdBy:   integer("created_by").references(() => usersTable.id),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export type ProjectPage = typeof projectPagesTable.$inferSelect;
