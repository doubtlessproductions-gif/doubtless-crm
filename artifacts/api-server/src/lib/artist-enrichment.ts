import { db, artistsTable, artistAiAnalysisTable, parseLabelStatus } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSpotifyArtistById } from "./spotify.js";
import { getYoutubeChannelById } from "./youtube.js";
import { generateArtistAnalysis, generateCandidateHook } from "./artist-ai.js";
import { logger } from "./logger.js";

export interface EnrichmentData {
  spotifyFollowers?: number;
  spotifyPopularity?: number;
  youtubeSubscribers?: number;
  youtubeVideoCount?: number;
  genres?: string[];
  imageUrl?: string | null;
  streamingLinks?: Record<string, string>;
  socialLinks?: Record<string, string>;
}

function followersToEstimate(n: number): string | null {
  if (n >= 1_000_000) return "1M+";
  if (n >= 100_000)   return "100K-1M";
  if (n >= 10_000)    return "10K-100K";
  if (n >= 1_000)     return "1K-10K";
  if (n > 0)          return "<1K";
  return null;
}

async function enrichFromSpotify(spotifyId: string): Promise<Partial<EnrichmentData>> {
  try {
    const data = await getSpotifyArtistById(spotifyId);
    return {
      spotifyFollowers: data.followers,
      spotifyPopularity: data.popularity,
      genres: data.genres,
      imageUrl: data.imageUrl,
      streamingLinks: { spotify: data.profileUrl },
    };
  } catch (err) {
    logger.warn({ err, spotifyId }, "Enrichment: Spotify fetch failed");
    return {};
  }
}

async function enrichFromYoutube(channelId: string): Promise<Partial<EnrichmentData>> {
  try {
    const data = await getYoutubeChannelById(channelId);
    return {
      youtubeSubscribers: data.subscriberCount,
      youtubeVideoCount: data.videoCount,
      streamingLinks: { youtube: data.profileUrl },
    };
  } catch (err) {
    logger.warn({ err, channelId }, "Enrichment: YouTube fetch failed");
    return {};
  }
}

/**
 * Enrich an existing roster artist: re-fetch live stats from Spotify/YouTube,
 * update the artist record, then run AI analysis with the enriched data.
 */
export async function enrichArtist(artistId: number, triggeredBy?: number): Promise<void> {
  const [artist] = await db.select().from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
  if (!artist) return;

  const enrichment: EnrichmentData = {};

  if (artist.spotifyId) {
    Object.assign(enrichment, await enrichFromSpotify(artist.spotifyId));
  }
  if (artist.youtubeChannelId) {
    const yt = await enrichFromYoutube(artist.youtubeChannelId);
    enrichment.youtubeSubscribers = yt.youtubeSubscribers;
    enrichment.youtubeVideoCount  = yt.youtubeVideoCount;
    if (!enrichment.streamingLinks?.["youtube"] && yt.streamingLinks?.["youtube"]) {
      enrichment.streamingLinks = { ...(enrichment.streamingLinks ?? {}), youtube: yt.streamingLinks["youtube"] };
    }
  }

  // Update artist record with real data
  const updates: Partial<typeof artistsTable.$inferInsert> = {};

  if (enrichment.imageUrl !== undefined && enrichment.imageUrl !== null) {
    updates.imageUrl = enrichment.imageUrl;
  }

  const followers = enrichment.spotifyFollowers ?? enrichment.youtubeSubscribers ?? 0;
  const estimate  = followersToEstimate(followers);
  if (estimate) updates.followersEstimate = estimate;

  if (enrichment.genres?.length) {
    updates.genre = enrichment.genres[0] ?? null;
    updates.tags  = enrichment.genres;
  }

  const mergedStreaming = { ...(artist.streamingLinks as Record<string, string> ?? {}), ...(enrichment.streamingLinks ?? {}) };
  if (Object.keys(mergedStreaming).length) updates.streamingLinks = mergedStreaming;

  if (Object.keys(updates).length) {
    await db.update(artistsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(artistsTable.id, artistId));
  }

  // Re-run AI analysis with fresh data
  try {
    const result = await generateArtistAnalysis({
      name:              artist.name,
      genre:             (updates.genre as string | null | undefined) ?? artist.genre,
      bio:               artist.bio,
      tags:              ((updates.tags as string[] | undefined) ?? (artist.tags as string[]) ?? []),
      socialLinks:       artist.socialLinks as Record<string, string>,
      streamingLinks:    mergedStreaming,
      labelStatus:       parseLabelStatus(artist.labelStatus).join(", ") || undefined,
      outreachStatus:    artist.outreachStatus ?? undefined,
      revenuePotential:  artist.revenuePotential ?? undefined,
      followers,
      popularity:        enrichment.spotifyPopularity,
    });

    const hook = await generateCandidateHook({
      name:     artist.name,
      genres:   ((updates.tags as string[] | undefined) ?? (artist.tags as string[]) ?? []),
      followers,
      popularity: enrichment.spotifyPopularity,
    }).catch(() => null);

    await db.insert(artistAiAnalysisTable)
      .values({
        artistId,
        ...result,
        spotifyFollowers:   enrichment.spotifyFollowers  ?? null,
        spotifyPopularity:  enrichment.spotifyPopularity ?? null,
        youtubeSubscribers: enrichment.youtubeSubscribers ?? null,
        youtubeVideoCount:  enrichment.youtubeVideoCount  ?? null,
        outreachHook:       hook,
        enrichedAt:         new Date(),
        generatedBy:        triggeredBy ?? null,
      })
      .onConflictDoUpdate({
        target: artistAiAnalysisTable.artistId,
        set: {
          ...result,
          spotifyFollowers:   enrichment.spotifyFollowers  ?? null,
          spotifyPopularity:  enrichment.spotifyPopularity ?? null,
          youtubeSubscribers: enrichment.youtubeSubscribers ?? null,
          youtubeVideoCount:  enrichment.youtubeVideoCount  ?? null,
          outreachHook:       hook,
          enrichedAt:         new Date(),
          generatedBy:        triggeredBy ?? null,
          updatedAt:          new Date(),
        },
      });

    logger.info({ artistId, leadTier: result.leadTier }, "Enrichment: AI analysis complete");
  } catch (err) {
    logger.error({ err, artistId }, "Enrichment: AI analysis failed");
  }
}
