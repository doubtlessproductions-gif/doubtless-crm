// Weekly rescorer — every Sunday at 2 AM re-enriches roster artists that have
// a Spotify or YouTube ID but stale (or missing) enrichment data.
import cron from "node-cron";
import { db, artistsTable } from "@workspace/db";
import { isNull, isNotNull, or, and } from "drizzle-orm";
import { enrichArtist } from "./artist-enrichment.js";
import { logger } from "./logger.js";

const MAX_PER_RUN   = 100;
const DELAY_BETWEEN = 400; // ms between artists to stay within API rate limits

export function startRescorerCron() {
  // Sunday 2 AM
  cron.schedule("0 2 * * 0", async () => {
    try {
      const eligible = await db
        .select({ id: artistsTable.id })
        .from(artistsTable)
        .where(
          and(
            isNull(artistsTable.deletedAt),
            or(
              isNotNull(artistsTable.spotifyId),
              isNotNull(artistsTable.youtubeChannelId),
            ),
          ),
        )
        .limit(MAX_PER_RUN);

      logger.info({ count: eligible.length }, "Rescorer: starting weekly run");

      let success = 0;
      for (const { id } of eligible) {
        try {
          await enrichArtist(id);
          success++;
        } catch (err) {
          logger.warn({ err, artistId: id }, "Rescorer: enrichment failed for artist");
        }
        await new Promise<void>(r => setTimeout(r, DELAY_BETWEEN));
      }

      logger.info({ attempted: eligible.length, success }, "Rescorer: weekly run complete");
    } catch (err) {
      logger.error({ err }, "Rescorer cron: fatal error");
    }
  });

  logger.info("Artist rescorer cron started (Sunday 2 AM)");
}
