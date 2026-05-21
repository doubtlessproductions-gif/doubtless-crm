import cron from "node-cron";
import { db, artistsTable } from "@workspace/db";
import { isNull } from "drizzle-orm";
import { logger } from "./logger.js";
import { scanRoster } from "./duplicate-detector.js";
import { upsertCandidates } from "../routes/artist-duplicates.js";

export function startDuplicateCron() {
  // Nightly scan at 2:00 AM
  cron.schedule("0 2 * * *", async () => {
    logger.info("Duplicate cron: starting nightly scan");
    try {
      const artists = await db
        .select()
        .from(artistsTable)
        .where(isNull(artistsTable.deletedAt));

      const candidates = scanRoster(artists, 0.40);
      await upsertCandidates(candidates);

      logger.info(
        { artistCount: artists.length, candidateCount: candidates.length },
        "Duplicate cron: nightly scan complete",
      );
    } catch (err) {
      logger.error({ err }, "Duplicate cron: nightly scan failed");
    }
  });
}
