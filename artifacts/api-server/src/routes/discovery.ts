import { Router } from "express";
import { isNull, eq, inArray } from "drizzle-orm";
import { db, artistsTable } from "@workspace/db";
import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { searchSpotifyArtists } from "../lib/spotify.js";
import { searchYoutubeChannels } from "../lib/youtube.js";
import { scanSingle } from "../lib/duplicate-detector.js";
import { upsertCandidates } from "./artist-duplicates.js";
import { logger } from "../lib/logger.js";
import { z } from "zod";

const router = Router();

// ── GET /discovery/spotify/search ────────────────────────────────────────────

router.get("/spotify/search", requireReadAuth, async (req, res) => {
  const q = (req.query["q"] as string | undefined)?.trim();
  if (!q) { res.status(400).json({ error: "q is required" }); return; }
  const limit  = Math.min(50, parseInt((req.query["limit"]  as string) ?? "20", 10) || 20);
  const offset = Math.max(0,  parseInt((req.query["offset"] as string) ?? "0",  10) || 0);
  const genre  = (req.query["genre"] as string | undefined)?.trim() || undefined;

  try {
    const { results, total, offset: returnedOffset, limit: returnedLimit } =
      await searchSpotifyArtists(q, genre, limit, offset);

    const spotifyIds = results.map(r => r.id);
    const existing = spotifyIds.length
      ? await db.select({ spotifyId: artistsTable.spotifyId, id: artistsTable.id })
          .from(artistsTable)
          .where(inArray(artistsTable.spotifyId, spotifyIds))
      : [];
    const importedMap = new Map(existing.map(a => [a.spotifyId, a.id]));

    res.json({
      results: results.map(r => ({ ...r, importedArtistId: importedMap.get(r.id) ?? null })),
      total,
      offset: returnedOffset,
      limit: returnedLimit,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    if (msg.includes("SPOTIFY_CLIENT_ID")) {
      res.status(503).json({ error: "Spotify API keys are not configured.", missingKey: "SPOTIFY_CLIENT_ID" });
      return;
    }

    // Only classify as Premium-required when Spotify's own error message confirms it
    const errObj = err as { status?: number; body?: string };
    if (errObj.status === 403) {
      const body = errObj.body ?? "";
      const isPremium = /premium/i.test(body);
      res.status(503).json({
        error: isPremium
          ? "Spotify search requires a Spotify Premium subscription for the app owner."
          : "Spotify returned 403 — check that the app credentials are correct.",
        missingKey: isPremium ? "SPOTIFY_PREMIUM" : "SPOTIFY_CREDENTIALS",
      });
      return;
    }

    res.status(500).json({ error: msg });
  }
});

// ── GET /discovery/youtube/search ────────────────────────────────────────────

router.get("/youtube/search", requireReadAuth, async (req, res) => {
  const q = (req.query["q"] as string | undefined)?.trim();
  if (!q) { res.status(400).json({ error: "q is required" }); return; }
  const limit     = Math.min(50, parseInt((req.query["limit"] as string) ?? "20", 10) || 20);
  const pageToken = (req.query["pageToken"] as string | undefined)?.trim() || undefined;

  try {
    const { results, nextPageToken, totalResults } = await searchYoutubeChannels(q, limit, pageToken);

    const channelIds = results.map(r => r.id);
    const existing = channelIds.length
      ? await db.select({ youtubeChannelId: artistsTable.youtubeChannelId, id: artistsTable.id })
          .from(artistsTable)
          .where(inArray(artistsTable.youtubeChannelId, channelIds))
      : [];
    const importedMap = new Map(existing.map(a => [a.youtubeChannelId, a.id]));

    res.json({
      results: results.map(r => ({ ...r, importedArtistId: importedMap.get(r.id) ?? null })),
      nextPageToken,
      totalResults,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("YOUTUBE_API_KEY")) {
      res.status(503).json({ error: "YouTube API key is not configured.", missingKey: "YOUTUBE_API_KEY" });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

// ── POST /discovery/import ────────────────────────────────────────────────────

const ImportBody = z.object({
  source:     z.enum(["spotify", "youtube", "bandcamp", "groover"]),
  sourceId:   z.string().min(1),
  name:       z.string().min(1),
  genres:     z.array(z.string()).default([]),
  imageUrl:   z.string().nullable().optional(),
  profileUrl: z.string(),
  bio:        z.string().nullable().optional(),
});

router.post("/import", requireAuth, async (req, res) => {
  const parse = ImportBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { source, sourceId, name, genres, imageUrl, profileUrl, bio } = parse.data;

  // Dedup check for platforms with dedicated DB columns
  if (source === "spotify" || source === "youtube") {
    const col = source === "spotify" ? artistsTable.spotifyId : artistsTable.youtubeChannelId;
    const [existing] = await db.select({ id: artistsTable.id }).from(artistsTable)
      .where(eq(col, sourceId)).limit(1);
    if (existing) {
      res.json({ artistId: existing.id, alreadyExists: true });
      return;
    }
  }

  const streamingLinks: Record<string, string> = {};
  const socialLinks:   Record<string, string> = {};
  if (source === "spotify")  streamingLinks["spotify"]  = profileUrl;
  if (source === "youtube")  streamingLinks["youtube"]  = profileUrl;
  if (source === "bandcamp") streamingLinks["bandcamp"] = profileUrl;
  if (source === "groover")  socialLinks["groover"]     = profileUrl;

  const [row] = await db.insert(artistsTable).values({
    name,
    genre: genres[0] ?? null,
    bio: bio ?? null,
    tags: genres,
    imageUrl: imageUrl ?? null,
    streamingLinks,
    socialLinks,
    createdBy: req.user!.userId,
    ...(source === "spotify" ? { spotifyId: sourceId }      : {}),
    ...(source === "youtube" ? { youtubeChannelId: sourceId } : {}),
  }).returning({ id: artistsTable.id });

  const artistId = row!.id;
  res.status(201).json({ artistId, alreadyExists: false });

  // Post-import background work: enrich stats + AI analysis + duplicate scan
  setImmediate(async () => {
    // 1. Auto-enrich with live Spotify/YouTube stats and run AI analysis
    try {
      const { enrichArtist } = await import("../lib/artist-enrichment.js");
      await enrichArtist(artistId, req.user!.userId);
    } catch (err) {
      logger.warn({ err, artistId }, "Post-discovery-import enrichment failed");
    }

    // 2. Duplicate scan
    try {
      const [imported] = await db.select().from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
      if (!imported) return;
      const roster = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt));
      const candidates = scanSingle(imported, roster, 0.85);
      await upsertCandidates(candidates);
    } catch (err) {
      logger.warn({ err, artistId }, "Post-discovery-import duplicate scan failed");
    }
  });
});

export default router;
