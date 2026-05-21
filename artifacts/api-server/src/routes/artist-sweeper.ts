import { Router } from "express";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { z } from "zod";
import {
  db, artistsTable, artistSweepConfigTable, artistSweepCandidateTable,
  artistAiAnalysisTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { runSweep } from "../lib/sweeper-cron.js";
import { enrichArtist } from "../lib/artist-enrichment.js";
import { scanSingle } from "../lib/duplicate-detector.js";
import { upsertCandidates } from "./artist-duplicates.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /artist-sweeper/config ────────────────────────────────────────────────
router.get("/config", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const [cfg] = await db
    .select()
    .from(artistSweepConfigTable)
    .where(eq(artistSweepConfigTable.userId, userId))
    .limit(1);

  if (!cfg) {
    res.json({
      id: null,
      userId,
      genres: [],
      platforms: ["spotify", "youtube"],
      minFollowers: 1000,
      maxFollowers: null,
      minPopularity: 0,
      frequencyHours: 24,
      enabled: false,
      lastRunAt: null,
      lastRunCount: 0,
    });
    return;
  }

  res.json(cfg);
});

// ── PUT /artist-sweeper/config ────────────────────────────────────────────────
const ConfigBody = z.object({
  genres:         z.array(z.string()).min(0).max(50),
  platforms:      z.array(z.enum(["spotify", "youtube", "bandcamp", "groover"])).min(1),
  minFollowers:   z.number().int().min(0).default(1000),
  maxFollowers:   z.number().int().min(0).nullable().optional(),
  minPopularity:  z.number().int().min(0).max(100).default(0),
  frequencyHours: z.number().int().min(1).max(720).default(24),
  enabled:        z.boolean().default(true),
});

router.put("/config", requireAuth, async (req, res) => {
  const parse = ConfigBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const userId = req.user!.userId;
  const [existing] = await db
    .select({ id: artistSweepConfigTable.id })
    .from(artistSweepConfigTable)
    .where(eq(artistSweepConfigTable.userId, userId))
    .limit(1);

  const values = {
    ...parse.data,
    userId,
    updatedBy: userId,
    updatedAt: new Date(),
  };

  let cfg;
  if (existing) {
    [cfg] = await db.update(artistSweepConfigTable)
      .set(values)
      .where(eq(artistSweepConfigTable.id, existing.id))
      .returning();
  } else {
    [cfg] = await db.insert(artistSweepConfigTable)
      .values({ ...values, createdAt: new Date() })
      .returning();
  }

  res.json(cfg);
});

// ── POST /artist-sweeper/run ──────────────────────────────────────────────────
router.post("/run", requireAuth, async (req, res) => {
  try {
    const result = await runSweep(req.user!.userId);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Manual sweep trigger failed");
    res.status(500).json({ error: msg });
  }
});

// ── GET /artist-sweeper/candidates ────────────────────────────────────────────
router.get("/candidates", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const status = (req.query["status"] as string) || "new";
  const limit  = Math.min(200, parseInt((req.query["limit"] as string) ?? "100", 10) || 100);
  const offset = Math.max(0, parseInt((req.query["offset"] as string) ?? "0", 10) || 0);

  const rows = await db
    .select()
    .from(artistSweepCandidateTable)
    .where(and(
      eq(artistSweepCandidateTable.status, status as "new" | "imported" | "dismissed"),
      eq(artistSweepCandidateTable.discoveredForUserId, userId),
    ))
    .orderBy(desc(artistSweepCandidateTable.discoveredAt))
    .limit(limit)
    .offset(offset);

  res.json(rows);
});

// ── POST /artist-sweeper/candidates/:id/import ────────────────────────────────
router.post("/candidates/:id/import", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = req.user!.userId;
  const [cand] = await db
    .select()
    .from(artistSweepCandidateTable)
    .where(and(
      eq(artistSweepCandidateTable.id, id),
      eq(artistSweepCandidateTable.discoveredForUserId, userId),
    ))
    .limit(1);

  if (!cand) { res.status(404).json({ error: "Candidate not found" }); return; }
  if (cand.status === "imported" && cand.importedArtistId) {
    res.json({ artistId: cand.importedArtistId, alreadyExists: true });
    return;
  }

  // Check if already on roster
  const col = cand.source === "spotify" ? artistsTable.spotifyId : artistsTable.youtubeChannelId;
  const [existing] = await db.select({ id: artistsTable.id }).from(artistsTable)
    .where(eq(col, cand.sourceId)).limit(1);

  if (existing) {
    await db.update(artistSweepCandidateTable)
      .set({ status: "imported", importedArtistId: existing.id })
      .where(eq(artistSweepCandidateTable.id, id));
    res.json({ artistId: existing.id, alreadyExists: true });
    return;
  }

  const streamingLinks: Record<string, string> = {};
  if (cand.source === "spotify")  streamingLinks["spotify"]  = cand.profileUrl;
  else                            streamingLinks["youtube"]  = cand.profileUrl;

  const genres = (cand.genres as string[]) ?? [];

  const [row] = await db.insert(artistsTable).values({
    name:           cand.name,
    genre:          genres[0] ?? null,
    bio:            cand.bio ?? null,
    tags:           genres,
    imageUrl:       cand.imageUrl ?? null,
    streamingLinks,
    socialLinks:    {},
    createdBy:      userId,
    ...(cand.source === "spotify"
      ? { spotifyId: cand.sourceId }
      : { youtubeChannelId: cand.sourceId }),
  }).returning({ id: artistsTable.id });

  const artistId = row!.id;

  await db.update(artistSweepCandidateTable)
    .set({ status: "imported", importedArtistId: artistId })
    .where(eq(artistSweepCandidateTable.id, id));

  res.status(201).json({ artistId, alreadyExists: false });

  setImmediate(async () => {
    try {
      await enrichArtist(artistId, userId);
    } catch (err) {
      logger.warn({ err, artistId }, "Post-import enrichment failed");
    }
    try {
      const [imported] = await db.select().from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
      if (!imported) return;
      const roster = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt));
      const dupes = scanSingle(imported, roster, 0.85);
      await upsertCandidates(dupes);
    } catch (err) {
      logger.warn({ err, artistId }, "Post-import duplicate scan failed");
    }
  });
});

// ── POST /artist-sweeper/candidates/:id/dismiss ───────────────────────────────
router.post("/candidates/:id/dismiss", requireAuth, async (req, res) => {
  const id = parseInt(String(req.params["id"]), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const userId = req.user!.userId;
  await db.update(artistSweepCandidateTable)
    .set({ status: "dismissed", dismissedBy: userId, dismissedAt: new Date() })
    .where(and(
      eq(artistSweepCandidateTable.id, id),
      eq(artistSweepCandidateTable.discoveredForUserId, userId),
    ));

  res.json({ ok: true });
});

// ── POST /artist-sweeper/candidates/batch ─────────────────────────────────────
router.post("/candidates/batch", requireAuth, async (req, res) => {
  const parse = z.object({
    ids:    z.array(z.number().int()),
    action: z.enum(["dismiss"]),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const userId = req.user!.userId;
  await db.update(artistSweepCandidateTable)
    .set({ status: "dismissed", dismissedBy: userId, dismissedAt: new Date() })
    .where(and(
      eq(artistSweepCandidateTable.status, "new"),
      eq(artistSweepCandidateTable.discoveredForUserId, userId),
    ));

  res.json({ dismissed: parse.data.ids.length });
});

// ── POST /artist-sweeper/enrich/:artistId ────────────────────────────────────
router.post("/enrich/:artistId", requireAuth, async (req, res) => {
  const artistId = parseInt(String(req.params["artistId"]), 10);
  if (isNaN(artistId)) { res.status(400).json({ error: "Invalid artistId" }); return; }

  try {
    await enrichArtist(artistId, req.user!.userId);
    const [analysis] = await db.select()
      .from(artistAiAnalysisTable)
      .where(eq(artistAiAnalysisTable.artistId, artistId))
      .limit(1);
    res.json({ ok: true, analysis: analysis ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, artistId }, "Manual enrich failed");
    res.status(500).json({ error: msg });
  }
});

export default router;
