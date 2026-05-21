import { Router } from "express";
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { db, artistProfilesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

const ArtistProfileBody = z.object({
  royaltySplitPct: z.coerce.number().int().min(0).max(100).optional(),
  bankDetails:     z.record(z.string(), z.string()).optional(),
  contractStart:   z.string().nullable().optional(),
  contractEnd:     z.string().nullable().optional(),
  tier:            z.enum(["standard", "silver", "gold", "platinum"]).optional(),
  managerId:       z.coerce.number().int().positive().nullable().optional(),
  notes:           z.string().nullable().optional(),
});

type ProfileInsert = typeof artistProfilesTable.$inferInsert;
type ProfileUpdate = Partial<ProfileInsert>;

// GET /artist-profiles/:artistId
router.get("/:artistId", requireAuth, async (req, res) => {
  const artistId = Number(req.params.artistId);
  try {
    const [row] = await db.select().from(artistProfilesTable)
      .where(eq(artistProfilesTable.artistId, artistId));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getArtistProfile failed");
    res.status(500).json({ error: "Failed to get artist profile" });
  }
});

// PUT /artist-profiles/:artistId  — upsert
router.put("/:artistId", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const artistId = Number(req.params.artistId);
  const parsed = ArtistProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  try {
    const [existing] = await db.select({ id: artistProfilesTable.id })
      .from(artistProfilesTable)
      .where(eq(artistProfilesTable.artistId, artistId));

    let row;
    if (existing) {
      const updates: ProfileUpdate = { updatedAt: new Date() };
      if (d.royaltySplitPct !== undefined) updates.royaltySplitPct = d.royaltySplitPct;
      if (d.bankDetails     !== undefined) updates.bankDetails     = d.bankDetails;
      if (d.contractStart   !== undefined) updates.contractStart   = d.contractStart ?? null;
      if (d.contractEnd     !== undefined) updates.contractEnd     = d.contractEnd ?? null;
      if (d.tier            !== undefined) updates.tier            = d.tier;
      if (d.managerId       !== undefined) updates.managerId       = d.managerId ?? null;
      if (d.notes           !== undefined) updates.notes           = d.notes ?? null;

      [row] = await db.update(artistProfilesTable)
        .set(updates)
        .where(eq(artistProfilesTable.artistId, artistId))
        .returning();
    } else {
      const insert: ProfileInsert = {
        artistId,
        royaltySplitPct: d.royaltySplitPct ?? 50,
        bankDetails:     d.bankDetails ?? {},
        contractStart:   d.contractStart ?? null,
        contractEnd:     d.contractEnd ?? null,
        tier:            d.tier ?? "standard",
        managerId:       d.managerId ?? null,
        notes:           d.notes ?? null,
      };
      [row] = await db.insert(artistProfilesTable).values(insert).returning();
    }

    res.json(row);
  } catch (err) {
    req.log.error({ err }, "upsertArtistProfile failed");
    res.status(500).json({ error: "Failed to upsert artist profile" });
  }
});

export default router;
