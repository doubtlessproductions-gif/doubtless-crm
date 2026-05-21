import { Router } from "express";
import { eq, and, or, isNull, inArray, sql } from "drizzle-orm";
import {
  db, artistsTable, artistDuplicateCandidatesTable,
  artistOutreachMessagesTable, artistTasksTable, artistNotesTable,
  artistAiAnalysisTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { scanSingle, scanRoster } from "../lib/duplicate-detector.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure artistIdA < artistIdB (canonical ordering). */
function ordered(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/** Upsert a batch of candidates, skipping already-resolved (dismissed/merged) pairs. */
export async function upsertCandidates(
  candidates: { artistIdA: number; artistIdB: number; confidenceScore: number; evidence: string[] }[],
) {
  if (candidates.length === 0) return;
  for (const c of candidates) {
    const [idA, idB] = ordered(c.artistIdA, c.artistIdB);
    await db
      .insert(artistDuplicateCandidatesTable)
      .values({ artistIdA: idA, artistIdB: idB, confidenceScore: c.confidenceScore, evidence: c.evidence })
      .onConflictDoUpdate({
        target: [artistDuplicateCandidatesTable.artistIdA, artistDuplicateCandidatesTable.artistIdB],
        set: {
          confidenceScore: c.confidenceScore,
          evidence: c.evidence,
          status: "pending",
        },
        where: eq(artistDuplicateCandidatesTable.status, "pending"),
      });
  }
}

// ── List pending duplicates ────────────────────────────────────────────────────

router.get("/duplicates", requireAuth, async (req, res) => {
  const { status = "pending" } = req.query as { status?: string };

  const rows = await db
    .select()
    .from(artistDuplicateCandidatesTable)
    .where(
      status === "all"
        ? undefined
        : eq(artistDuplicateCandidatesTable.status, status as "pending" | "dismissed" | "merged"),
    )
    .orderBy(sql`${artistDuplicateCandidatesTable.confidenceScore} DESC`);

  if (rows.length === 0) { res.json([]); return; }

  const artistIds = [...new Set(rows.flatMap(r => [r.artistIdA, r.artistIdB]))];
  const artists = await db
    .select()
    .from(artistsTable)
    .where(inArray(artistsTable.id, artistIds));
  const artistMap = new Map(artists.map(a => [a.id, a]));

  const result = rows.map(r => ({
    ...r,
    artistA: artistMap.get(r.artistIdA) ?? null,
    artistB: artistMap.get(r.artistIdB) ?? null,
  }));

  res.json(result);
});

// ── Dismiss / skip a candidate ─────────────────────────────────────────────────

const PatchBody = z.object({
  status: z.enum(["dismissed", "pending"]),
});

router.patch("/duplicates/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = PatchBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [row] = await db
    .update(artistDuplicateCandidatesTable)
    .set({
      status: parse.data.status,
      reviewedBy: req.user!.userId,
      reviewedAt: new Date(),
    })
    .where(eq(artistDuplicateCandidatesTable.id, id))
    .returning();

  if (!row) { res.status(404).json({ error: "Candidate not found" }); return; }
  res.json(row);
});

// ── Merge two artists ──────────────────────────────────────────────────────────

const MergeBody = z.object({
  primaryId:        z.number().int().positive(),
  secondaryId:      z.number().int().positive(),
  fieldPreferences: z.record(z.enum(["a", "b"])).optional().default({}),
});

router.post("/merge", requireAuth, async (req, res) => {
  const parse = MergeBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { primaryId, secondaryId, fieldPreferences } = parse.data;
  if (primaryId === secondaryId) {
    res.status(400).json({ error: "primaryId and secondaryId must be different" });
    return;
  }

  const [primary, secondary] = await Promise.all([
    db.select().from(artistsTable).where(eq(artistsTable.id, primaryId)).limit(1),
    db.select().from(artistsTable).where(eq(artistsTable.id, secondaryId)).limit(1),
  ]);

  if (!primary[0] || !secondary[0]) {
    res.status(404).json({ error: "One or both artists not found" });
    return;
  }

  const p = primary[0];
  const s = secondary[0];

  // Build field overrides from preferences (pref "b" = take secondary's value)
  type ArtistField = keyof typeof p;
  const mergeableFields: ArtistField[] = [
    "name", "genre", "bio", "email", "phone", "city", "state",
    "labelStatus", "outreachStatus", "revenuePotential", "followersEstimate",
    "engagementLevel", "spotifyId", "youtubeChannelId",
    "streamingLinks", "socialLinks", "tags",
  ];

  const updates: Partial<typeof p> = Object.fromEntries(
    mergeableFields
      .filter(field => fieldPreferences[field] === "b")
      .map(field => [field, s[field]]),
  ) as Partial<typeof p>;

  // Run transactionally
  await db.transaction(async (tx) => {
    // 1. Re-parent outreach messages
    await tx
      .update(artistOutreachMessagesTable)
      .set({ artistId: primaryId })
      .where(eq(artistOutreachMessagesTable.artistId, secondaryId));

    // 2. Re-parent tasks
    await tx
      .update(artistTasksTable)
      .set({ artistId: primaryId })
      .where(eq(artistTasksTable.artistId, secondaryId));

    // 3. Re-parent notes
    await tx
      .update(artistNotesTable)
      .set({ artistId: primaryId })
      .where(eq(artistNotesTable.artistId, secondaryId));

    // 4. Re-parent AI analysis — only if primary has none
    const [existingAnalysis] = await tx
      .select({ id: artistAiAnalysisTable.id })
      .from(artistAiAnalysisTable)
      .where(eq(artistAiAnalysisTable.artistId, primaryId))
      .limit(1);

    if (!existingAnalysis) {
      await tx
        .update(artistAiAnalysisTable)
        .set({ artistId: primaryId })
        .where(eq(artistAiAnalysisTable.artistId, secondaryId));
    } else {
      await tx
        .delete(artistAiAnalysisTable)
        .where(eq(artistAiAnalysisTable.artistId, secondaryId));
    }

    // 5. Apply field preferences to primary
    if (Object.keys(updates).length > 0) {
      await tx
        .update(artistsTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(artistsTable.id, primaryId));
    }

    // 6. Soft-delete secondary
    await tx
      .update(artistsTable)
      .set({ deletedAt: new Date() })
      .where(eq(artistsTable.id, secondaryId));

    // 7. Mark the merged pair as "merged"; dismiss all other pending candidates
    //    involving the secondary (which is now soft-deleted) to clear the queue.
    const [idA, idB] = ordered(primaryId, secondaryId);
    await tx
      .update(artistDuplicateCandidatesTable)
      .set({ status: "merged", reviewedBy: req.user!.userId, reviewedAt: new Date() })
      .where(
        and(
          eq(artistDuplicateCandidatesTable.artistIdA, idA),
          eq(artistDuplicateCandidatesTable.artistIdB, idB),
        ),
      );

    // Dismiss remaining pending candidates that reference the deleted secondary
    await tx
      .update(artistDuplicateCandidatesTable)
      .set({ status: "dismissed", reviewedBy: req.user!.userId, reviewedAt: new Date() })
      .where(
        and(
          eq(artistDuplicateCandidatesTable.status, "pending"),
          or(
            eq(artistDuplicateCandidatesTable.artistIdA, secondaryId),
            eq(artistDuplicateCandidatesTable.artistIdB, secondaryId),
          ),
        ),
      );
  });

  logger.info({ primaryId, secondaryId, userId: req.user!.userId }, "Artist merge complete");

  // Return updated primary
  const [merged] = await db.select().from(artistsTable).where(eq(artistsTable.id, primaryId)).limit(1);
  res.json({ ok: true, artist: merged });
});

// ── Manual scan trigger ────────────────────────────────────────────────────────

router.post("/duplicates/scan", requireAuth, async (req, res) => {
  const artists = await db
    .select()
    .from(artistsTable)
    .where(isNull(artistsTable.deletedAt));

  const candidates = scanRoster(artists, 0.40);
  await upsertCandidates(candidates);

  logger.info({ artistCount: artists.length, candidateCount: candidates.length }, "Duplicate scan complete");
  res.json({ scanned: artists.length, candidates: candidates.length });
});

export default router;
