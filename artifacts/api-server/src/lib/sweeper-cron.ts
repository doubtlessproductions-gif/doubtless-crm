// Artist genre sweeper — checks every hour if any user's sweep is due, then
// queries Spotify and YouTube for new artists matching their configured genres
// and stores them as per-user candidates for A&R review.
import cron from "node-cron";
import { db, artistsTable, artistSweepConfigTable, artistSweepCandidateTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { searchSpotifyArtists } from "./spotify.js";
import { searchYoutubeChannels } from "./youtube.js";
import { generateCandidateHook } from "./artist-ai.js";
import { logger } from "./logger.js";

const DELAY_MS = 600; // 600 ms between API calls to stay within rate limits

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * Execute one full sweep run for a specific user (or global if no userId).
 * Returns totals for logging / manual trigger responses.
 */
export async function runSweep(userId?: number): Promise<{ found: number; inserted: number; genres: string[] }> {
  // Load the correct config — scoped to userId if provided, else global (null userId)
  const [cfg] = userId !== undefined
    ? await db.select().from(artistSweepConfigTable)
        .where(eq(artistSweepConfigTable.userId, userId))
        .limit(1)
    : await db.select().from(artistSweepConfigTable)
        .where(isNull(artistSweepConfigTable.userId))
        .limit(1);

  if (!cfg || !cfg.genres.length) return { found: 0, inserted: 0, genres: [] };

  const genres    = cfg.genres as string[];
  const platforms = cfg.platforms as string[];
  const forUserId = userId ?? null;

  logger.info({ genres, platforms, userId: forUserId }, "Artist sweeper: starting run");

  // Build exclusion sets — existing roster
  const roster = await db
    .select({ spotifyId: artistsTable.spotifyId, ytId: artistsTable.youtubeChannelId })
    .from(artistsTable)
    .where(isNull(artistsTable.deletedAt));

  const rosterSpotify = new Set(roster.map(r => r.spotifyId).filter(Boolean) as string[]);
  const rosterYoutube = new Set(roster.map(r => r.ytId).filter(Boolean) as string[]);

  // Build exclusion sets — existing candidates for this user
  const existingCands = forUserId !== null
    ? await db
        .select({ sourceId: artistSweepCandidateTable.sourceId })
        .from(artistSweepCandidateTable)
        .where(eq(artistSweepCandidateTable.discoveredForUserId, forUserId))
    : await db
        .select({ sourceId: artistSweepCandidateTable.sourceId })
        .from(artistSweepCandidateTable)
        .where(isNull(artistSweepCandidateTable.discoveredForUserId));

  const knownCandIds = new Set(existingCands.map(c => c.sourceId));

  let found = 0;
  const toInsert: Array<typeof artistSweepCandidateTable.$inferInsert> = [];

  for (const genre of genres) {
    // ── Spotify ──────────────────────────────────────────────────────────
    if (platforms.includes("spotify")) {
      try {
        const { results } = await searchSpotifyArtists(genre, genre, 50, 0);
        for (const a of results) {
          found++;
          if (rosterSpotify.has(a.id))  continue;
          if (knownCandIds.has(a.id))   continue;
          if (cfg.minFollowers && a.followers < cfg.minFollowers) continue;
          if (cfg.maxFollowers && a.followers > cfg.maxFollowers) continue;
          if (cfg.minPopularity && a.popularity < cfg.minPopularity) continue;
          toInsert.push({
            source:              "spotify",
            sourceId:            a.id,
            discoveredForUserId: forUserId,
            name:                a.name,
            genres:              a.genres,
            followers:           a.followers,
            popularity:          a.popularity,
            imageUrl:            a.imageUrl,
            profileUrl:          a.profileUrl,
          });
          knownCandIds.add(a.id);
        }
      } catch (err) {
        logger.warn({ err, genre }, "Sweeper: Spotify search failed");
      }
      await sleep(DELAY_MS);
    }

    // ── YouTube ──────────────────────────────────────────────────────────
    if (platforms.includes("youtube")) {
      try {
        const { results } = await searchYoutubeChannels(`${genre} music`, 20);
        for (const ch of results) {
          found++;
          if (rosterYoutube.has(ch.id)) continue;
          if (knownCandIds.has(ch.id))  continue;
          if (cfg.minFollowers && ch.subscriberCount < cfg.minFollowers) continue;
          toInsert.push({
            source:              "youtube",
            sourceId:            ch.id,
            discoveredForUserId: forUserId,
            name:                ch.name,
            genres:              ch.topicCategories.slice(0, 5),
            followers:           ch.subscriberCount,
            popularity:          null,
            imageUrl:            ch.thumbnailUrl,
            profileUrl:          ch.profileUrl,
            bio:                 ch.description?.slice(0, 500) ?? null,
          });
          knownCandIds.add(ch.id);
        }
      } catch (err) {
        logger.warn({ err, genre }, "Sweeper: YouTube search failed");
      }
      await sleep(DELAY_MS);
    }
  }

  // Insert in batches of 50
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 50) {
    const batch = toInsert.slice(i, i + 50);
    await db.insert(artistSweepCandidateTable).values(batch).onConflictDoNothing();
    inserted += batch.length;
  }

  // Update this user's config with run stats
  await db.update(artistSweepConfigTable)
    .set({ lastRunAt: new Date(), lastRunCount: inserted, updatedAt: new Date() })
    .where(eq(artistSweepConfigTable.id, cfg.id));

  logger.info({ found, inserted, userId: forUserId }, "Artist sweeper: run complete");

  // Async: generate AI hooks for all new candidates (fire-and-forget)
  const hooksInput = toInsert.map(c => ({
    sourceId:            c.sourceId,
    discoveredForUserId: c.discoveredForUserId,
    name:                c.name,
    genres:              c.genres ?? [],
    followers:           c.followers ?? null,
    popularity:          c.popularity ?? null,
  }));
  setImmediate(() => {
    generateHooksForCandidates(hooksInput).catch(err =>
      logger.warn({ err }, "Sweeper: background hook generation failed")
    );
  });

  return { found, inserted, genres };
}

async function generateHooksForCandidates(
  candidates: Array<{
    sourceId: string;
    discoveredForUserId: number | null | undefined;
    name: string;
    genres: string[];
    followers?: number | null;
    popularity?: number | null;
  }>
) {
  for (const c of candidates) {
    try {
      const hook = await generateCandidateHook({
        name:       c.name,
        genres:     c.genres,
        followers:  c.followers ?? 0,
        popularity: c.popularity ?? undefined,
      });

      // Update by sourceId + discoveredForUserId to avoid touching other users' rows
      const condition = c.discoveredForUserId != null
        ? and(
            eq(artistSweepCandidateTable.sourceId, c.sourceId),
            eq(artistSweepCandidateTable.discoveredForUserId, c.discoveredForUserId),
          )
        : and(
            eq(artistSweepCandidateTable.sourceId, c.sourceId),
            isNull(artistSweepCandidateTable.discoveredForUserId),
          );

      await db.update(artistSweepCandidateTable)
        .set({ aiHook: hook })
        .where(condition);
    } catch {
      // non-fatal
    }
    await sleep(200);
  }
}

export function startSweeperCron() {
  // Check every hour whether any user's sweep is due
  cron.schedule("0 * * * *", async () => {
    try {
      // Find all user configs that have enabled=true and genres set
      const configs = await db.select({
        id:             artistSweepConfigTable.id,
        userId:         artistSweepConfigTable.userId,
        enabled:        artistSweepConfigTable.enabled,
        frequencyHours: artistSweepConfigTable.frequencyHours,
        lastRunAt:      artistSweepConfigTable.lastRunAt,
        genres:         artistSweepConfigTable.genres,
      }).from(artistSweepConfigTable);

      const now = Date.now();

      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        if (!(cfg.genres as string[]).length) continue;

        const nextRun = cfg.lastRunAt
          ? cfg.lastRunAt.getTime() + cfg.frequencyHours * 3_600_000
          : 0;
        if (now < nextRun) continue;

        // Run sweep for this user (or global if userId is null)
        const uid = cfg.userId ?? undefined;
        await runSweep(uid);

        // Brief pause between user sweeps to avoid hammering the APIs
        await sleep(2000);
      }
    } catch (err) {
      logger.error({ err }, "Artist sweeper cron: error");
    }
  });

  logger.info("Artist sweeper cron started (hourly check, per-user configs)");
}
