import { Router } from "express";
import { db, releasesTable, rolloutActionsTable, artistsTable, contactsTable, messageThreadsTable, videoProjectsTable } from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { handleRolloutAction } from "../lib/rollout-cron.js";
import { getSpotifyArtistById, getSpotifyTrackById } from "../lib/spotify.js";
import { getYoutubeChannelById, getYoutubeVideoById } from "../lib/youtube.js";
import { z } from "zod";

const router = Router();

// ── Default rollout template (matches the spec) ───────────────────────────────

const DEFAULT_ROLLOUT = [
  { phase: "tease",    offsetDays: -14, actions: [{ type: "create_post",   payload: { text: "Something coming..." } }] },
  { phase: "announce", offsetDays: -7,  actions: [{ type: "create_post",   payload: { text: "New drop incoming" } }] },
  { phase: "engage",   offsetDays: -3,  actions: [{ type: "drop_video",    payload: {} }] },
  { phase: "drop",     offsetDays: 0,   actions: [{ type: "publish_page",  payload: {} }, { type: "unlock_content", payload: { price: 5 } }] },
  { phase: "post",     offsetDays: 3,   actions: [{ type: "create_post",   payload: { text: "Out now everywhere" } }] },
] as const;

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ReleaseBody = z.object({
  artistId:        z.number().int().positive().optional().nullable(),
  artistName:      z.string().max(200).optional().nullable(),
  title:           z.string().min(1).max(200),
  releaseDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
  audioUrl:        z.string().url().optional().nullable().or(z.literal("")),
  coverArtUrl:     z.string().url().optional().nullable().or(z.literal("")),
  status:          z.enum(["draft", "scheduled", "live"]).optional(),
  genre:           z.string().max(100).optional().nullable(),
  upc:             z.string().max(50).optional().nullable(),
  catalogNumber:   z.string().max(100).optional().nullable(),
  releaseType:     z.enum(["single", "ep", "album", "mixtape", "compilation"]).optional().nullable(),
  isrc:            z.string().max(20).optional().nullable(),
  label:           z.string().max(200).optional().nullable(),
  notes:           z.string().max(5000).optional().nullable(),
  explicit:        z.boolean().optional(),
  language:        z.string().max(100).optional().nullable(),
  distributorName: z.string().max(200).optional().nullable(),
  spotifyTrackId:  z.string().max(100).optional().nullable(),
  youtubeVideoId:  z.string().max(100).optional().nullable(),
});

// ── GET /api/releases ─────────────────────────────────────────────────────────
router.get("/", requireAuth, async (_req, res) => {
  const releases = await db.select()
    .from(releasesTable)
    .orderBy(desc(releasesTable.releaseDate));
  res.json(releases);
});

// ── POST /api/releases ────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const parse = ReleaseBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const [release] = await db.insert(releasesTable).values({
    artistId:        d.artistId ?? null,
    artistName:      d.artistName ?? null,
    title:           d.title,
    releaseDate:     d.releaseDate,
    audioUrl:        d.audioUrl || null,
    coverArtUrl:     d.coverArtUrl || null,
    status:          d.status ?? "draft",
    genre:           d.genre ?? null,
    upc:             d.upc ?? null,
    catalogNumber:   d.catalogNumber ?? null,
    releaseType:     d.releaseType ?? null,
    isrc:            d.isrc ?? null,
    label:           d.label ?? null,
    notes:           d.notes ?? null,
    explicit:        d.explicit ?? false,
    language:        d.language ?? null,
    distributorName: d.distributorName ?? null,
    spotifyTrackId:  d.spotifyTrackId ?? null,
    youtubeVideoId:  d.youtubeVideoId ?? null,
    createdBy:       req.user!.userId,
  }).returning();

  res.status(201).json(release);
});

// ── POST /api/releases/bulk — CSV import (parsed client-side, sent as JSON) ────
router.post("/bulk", requireAuth, async (req, res) => {
  const parse = z.array(ReleaseBody.extend({ title: z.string().min(1).max(200) })).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const imported: (typeof releasesTable.$inferSelect)[] = [];
  const errors: { row: number; title: string; error: string }[] = [];

  for (let i = 0; i < parse.data.length; i++) {
    const r = parse.data[i]!;
    try {
      const [release] = await db.insert(releasesTable).values({
        artistId:      r.artistId ?? null,
        artistName:    r.artistName ?? null,
        title:         r.title,
        releaseDate:   r.releaseDate,
        audioUrl:      r.audioUrl || null,
        coverArtUrl:   r.coverArtUrl || null,
        status:        r.status ?? "draft",
        genre:         r.genre ?? null,
        upc:           r.upc ?? null,
        catalogNumber: r.catalogNumber ?? null,
        createdBy:     req.user!.userId,
      }).returning();
      imported.push(release!);
    } catch (e) {
      errors.push({ row: i + 1, title: r.title, error: String(e) });
    }
  }

  res.status(errors.length === parse.data.length ? 422 : 201).json({
    imported: imported.length,
    errors,
    releases: imported,
  });
});

// ── GET /api/releases/:id/artist — linked A&R artist + contact ────────────────
router.get("/:id/artist", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [release] = await db.select({ artistId: releasesTable.artistId })
    .from(releasesTable).where(eq(releasesTable.id, id)).limit(1);
  if (!release) { res.status(404).json({ error: "Not found" }); return; }
  if (!release.artistId) { res.status(404).json({ error: "No linked artist" }); return; }

  const [artist] = await db.select().from(artistsTable)
    .where(and(eq(artistsTable.id, release.artistId), isNull(artistsTable.deletedAt)))
    .limit(1);
  if (!artist) { res.status(404).json({ error: "Artist not found" }); return; }

  let contact = null;
  if (artist.contactId) {
    const [c] = await db.select().from(contactsTable)
      .where(eq(contactsTable.id, artist.contactId)).limit(1);
    contact = c ?? null;
  }

  res.json({ ...artist, contact });
});

// ── GET /api/releases/:id ─────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [release] = await db.select().from(releasesTable).where(eq(releasesTable.id, id)).limit(1);
  if (!release) { res.status(404).json({ error: "Not found" }); return; }
  res.json(release);
});

// ── PUT /api/releases/:id ─────────────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = ReleaseBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const [updated] = await db.update(releasesTable).set({
    artistId:        d.artistId ?? null,
    artistName:      d.artistName ?? null,
    title:           d.title,
    releaseDate:     d.releaseDate,
    audioUrl:        d.audioUrl || null,
    coverArtUrl:     d.coverArtUrl || null,
    status:          d.status ?? "draft",
    genre:           d.genre ?? null,
    upc:             d.upc ?? null,
    catalogNumber:   d.catalogNumber ?? null,
    releaseType:     d.releaseType ?? null,
    isrc:            d.isrc ?? null,
    label:           d.label ?? null,
    notes:           d.notes ?? null,
    explicit:        d.explicit ?? false,
    language:        d.language ?? null,
    distributorName: d.distributorName ?? null,
    spotifyTrackId:  d.spotifyTrackId ?? null,
    youtubeVideoId:  d.youtubeVideoId ?? null,
    updatedAt:       new Date(),
  }).where(eq(releasesTable.id, id)).returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── PATCH /api/releases/:id/link-artist ──────────────────────────────────────
router.patch("/:id/link-artist", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = z.object({
    artistId: z.number().int().positive().nullable(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [updated] = await db.update(releasesTable)
    .set({ artistId: parse.data.artistId, updatedAt: new Date() })
    .where(eq(releasesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── GET /api/releases/:id/streaming-stats ─────────────────────────────────────
router.get("/:id/streaming-stats", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [release] = await db.select().from(releasesTable).where(eq(releasesTable.id, id)).limit(1);
  if (!release) { res.status(404).json({ error: "Not found" }); return; }

  let artistSpotify: Awaited<ReturnType<typeof getSpotifyArtistById>> | null = null;
  let trackSpotify:  Awaited<ReturnType<typeof getSpotifyTrackById>>  | null = null;
  let channelYT:     Awaited<ReturnType<typeof getYoutubeChannelById>> | null = null;
  let videoYT:       Awaited<ReturnType<typeof getYoutubeVideoById>>   | null = null;

  // Resolve linked artist's Spotify + YouTube IDs
  let artistSpotifyId: string | null = null;
  let artistYTChannelId: string | null = null;
  if (release.artistId) {
    const [artist] = await db
      .select({ spotifyId: artistsTable.spotifyId, youtubeChannelId: artistsTable.youtubeChannelId })
      .from(artistsTable).where(eq(artistsTable.id, release.artistId)).limit(1);
    artistSpotifyId   = artist?.spotifyId   ?? null;
    artistYTChannelId = artist?.youtubeChannelId ?? null;
  }

  const [sp_a, sp_t, yt_c, yt_v] = await Promise.allSettled([
    artistSpotifyId    ? getSpotifyArtistById(artistSpotifyId)      : Promise.resolve(null),
    release.spotifyTrackId ? getSpotifyTrackById(release.spotifyTrackId) : Promise.resolve(null),
    artistYTChannelId  ? getYoutubeChannelById(artistYTChannelId)   : Promise.resolve(null),
    release.youtubeVideoId ? getYoutubeVideoById(release.youtubeVideoId) : Promise.resolve(null),
  ]);

  if (sp_a.status === "fulfilled") artistSpotify = sp_a.value;
  if (sp_t.status === "fulfilled") trackSpotify  = sp_t.value;
  if (yt_c.status === "fulfilled") channelYT     = yt_c.value;
  if (yt_v.status === "fulfilled") videoYT       = yt_v.value;

  res.json({
    spotifyArtist:  artistSpotify,
    spotifyTrack:   trackSpotify,
    youtubeChannel: channelYT,
    youtubeVideo:   videoYT,
    errors: {
      spotifyArtist:  sp_a.status === "rejected" ? (sp_a.reason as Error).message : null,
      spotifyTrack:   sp_t.status === "rejected" ? (sp_t.reason as Error).message : null,
      youtubeChannel: yt_c.status === "rejected" ? (yt_c.reason as Error).message : null,
      youtubeVideo:   yt_v.status === "rejected" ? (yt_v.reason as Error).message : null,
    },
  });
});

// ── DELETE /api/releases/:id ──────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(releasesTable).where(eq(releasesTable.id, id));
  res.status(204).end();
});

// ── POST /api/releases/:id/schedule — generate rollout from template ──────────
router.post("/:id/schedule", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [release] = await db.select().from(releasesTable).where(eq(releasesTable.id, id)).limit(1);
  if (!release) { res.status(404).json({ error: "Not found" }); return; }

  // Delete existing pending actions (allow rescheduling)
  await db.delete(rolloutActionsTable)
    .where(and(eq(rolloutActionsTable.releaseId, id), eq(rolloutActionsTable.status, "pending")));

  const base = new Date(release.releaseDate + "T12:00:00Z");

  const rows = DEFAULT_ROLLOUT.flatMap(({ phase, offsetDays, actions }) => {
    const phaseDate = new Date(base);
    phaseDate.setDate(phaseDate.getDate() + offsetDays);
    return actions.map((a) => ({
      releaseId:    id,
      phase,
      type:         a.type,
      scheduledFor: phaseDate,
      payload:      a.payload as Record<string, unknown>,
    }));
  });

  const created = await db.insert(rolloutActionsTable).values(rows).returning();

  await db.update(releasesTable)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(eq(releasesTable.id, id));

  res.json({ actions: created, message: `Scheduled ${created.length} rollout actions` });
});

// ── GET /api/releases/:id/actions ─────────────────────────────────────────────
router.get("/:id/actions", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const actions = await db.select()
    .from(rolloutActionsTable)
    .where(eq(rolloutActionsTable.releaseId, id))
    .orderBy(rolloutActionsTable.scheduledFor);

  res.json(actions);
});

// ── POST /api/releases/:id/actions/:actionId/trigger — manual run ─────────────
router.post("/:id/actions/:actionId/trigger", requireAuth, async (req, res) => {
  const releaseId  = parseInt(req.params["id"] as string);
  const actionId   = parseInt(req.params["actionId"] as string);
  if (isNaN(releaseId) || isNaN(actionId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [release] = await db.select().from(releasesTable).where(eq(releasesTable.id, releaseId)).limit(1);
  if (!release) { res.status(404).json({ error: "Release not found" }); return; }

  const [action] = await db.select().from(rolloutActionsTable)
    .where(and(eq(rolloutActionsTable.id, actionId), eq(rolloutActionsTable.releaseId, releaseId)))
    .limit(1);
  if (!action) { res.status(404).json({ error: "Action not found" }); return; }

  await db.update(rolloutActionsTable).set({ status: "running" }).where(eq(rolloutActionsTable.id, actionId));

  try {
    await handleRolloutAction(action, release);
    const [updated] = await db.update(rolloutActionsTable)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(rolloutActionsTable.id, actionId))
      .returning();
    res.json(updated);
  } catch (err) {
    const [updated] = await db.update(rolloutActionsTable)
      .set({ status: "failed", error: String(err) })
      .where(eq(rolloutActionsTable.id, actionId))
      .returning();
    res.status(500).json({ error: String(err), action: updated });
  }
});

// ── GET /api/releases/:id/threads ─────────────────────────────────────────────
router.get("/:id/threads", requireAuth, async (req, res) => {
  const releaseId = parseInt(req.params["id"] as string);
  if (isNaN(releaseId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const threads = await db
    .select()
    .from(messageThreadsTable)
    .where(eq(messageThreadsTable.releaseId, releaseId))
    .orderBy(desc(messageThreadsTable.createdAt));
  res.json(threads);
});

// ── GET /api/releases/:id/video-projects ──────────────────────────────────────
router.get("/:id/video-projects", requireAuth, async (req, res) => {
  const releaseId = parseInt(req.params["id"] as string);
  if (isNaN(releaseId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const projects = await db
    .select()
    .from(videoProjectsTable)
    .where(eq(videoProjectsTable.releaseId, releaseId))
    .orderBy(desc(videoProjectsTable.createdAt));
  res.json(projects);
});

export default router;
