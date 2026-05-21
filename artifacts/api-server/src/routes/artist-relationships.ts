import { Router } from "express";
import { db, artistRelationshipsTable, artistsTable, artistAiAnalysisTable, parseLabelStatus } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth, requireReadAuth, requireRole } from "../middlewares/auth.js";
import { z } from "zod";

const router = Router();

const requireARManager = [requireAuth, requireRole("owner", "admin", "manager", "ar")];

// ── Network graph data ───────────────────────────────────────────────────────

router.get("/graph", requireReadAuth, async (req, res) => {
  const [artists, relationships] = await Promise.all([
    db.select({
      id: artistsTable.id,
      name: artistsTable.name,
      genre: artistsTable.genre,
      city: artistsTable.city,
      state: artistsTable.state,
      labelStatus: artistsTable.labelStatus,
      outreachStatus: artistsTable.outreachStatus,
      leadTier: artistAiAnalysisTable.leadTier,
    }).from(artistsTable)
      .leftJoin(artistAiAnalysisTable, eq(artistAiAnalysisTable.artistId, artistsTable.id))
      .where(isNull(artistsTable.deletedAt)),
    db.select().from(artistRelationshipsTable),
  ]);

  const artistIds = new Set(artists.map(a => a.id));

  // Artist→artist links
  const artistLinks = relationships
    .filter(r => r.toEntityType === "artist" && r.toEntityId !== null && artistIds.has(r.toEntityId!))
    .map(r => ({
      id: r.id,
      source: r.fromArtistId,
      target: r.toEntityId as number,
      type: r.relationshipType,
    }));

  // Build virtual nodes for non-artist entities (producer, engineer, venue, label)
  const externalNodeMap = new Map<string, { id: number; name: string; nodeType: "external"; entityType: string }>();
  let extNodeId = -1;
  for (const r of relationships) {
    if (r.toEntityType === "artist") continue;
    if (!r.toEntityName) continue;
    const key = `${r.toEntityType}||${r.toEntityName}`;
    if (!externalNodeMap.has(key)) {
      externalNodeMap.set(key, {
        id: extNodeId--,
        name: r.toEntityName,
        nodeType: "external",
        entityType: r.toEntityType,
      });
    }
  }

  const externalLinks = relationships
    .filter(r => r.toEntityType !== "artist" && r.toEntityName)
    .map(r => {
      const key = `${r.toEntityType}||${r.toEntityName}`;
      const extNode = externalNodeMap.get(key)!;
      return { id: r.id, source: r.fromArtistId, target: extNode.id, type: r.relationshipType };
    });

  const allRelationships = relationships.map(r => ({
    id: r.id,
    fromArtistId: r.fromArtistId,
    toEntityId: r.toEntityId,
    toEntityType: r.toEntityType,
    toEntityName: r.toEntityName,
    relationshipType: r.relationshipType,
    notes: r.notes,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));

  res.json({
    nodes: [
      ...artists.map(a => ({ ...a, nodeType: "artist" })),
      ...Array.from(externalNodeMap.values()),
    ],
    links: [...artistLinks, ...externalLinks],
    allRelationships,
  });
});

// ── Territory stats ──────────────────────────────────────────────────────────

router.get("/territory-stats", requireReadAuth, async (req, res) => {
  const sinceParam = req.query.since as string | undefined;
  const sinceDays = sinceParam ? parseInt(sinceParam) : null;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sinceDate = sinceDays ? new Date(now.getTime() - sinceDays * 24 * 60 * 60 * 1000) : null;

  const allArtists = await db.select({
    id: artistsTable.id,
    city: artistsTable.city,
    state: artistsTable.state,
    country: artistsTable.country,
    lat: artistsTable.lat,
    lng: artistsTable.lng,
    genre: artistsTable.genre,
    labelStatus: artistsTable.labelStatus,
    outreachStatus: artistsTable.outreachStatus,
    createdAt: artistsTable.createdAt,
    leadTier: artistAiAnalysisTable.leadTier,
  }).from(artistsTable)
    .leftJoin(artistAiAnalysisTable, eq(artistAiAnalysisTable.artistId, artistsTable.id))
    .where(isNull(artistsTable.deletedAt));

  // Apply optional date range filter for main aggregation
  const artists = sinceDate
    ? allArtists.filter(a => a.createdAt >= sinceDate)
    : allArtists;

  type CityEntry = {
    city: string; state: string | null; country: string | null;
    lat: number | null; lng: number | null;
    count: number;
    labelBreakdown: Record<string, number>;
    outreachBreakdown: Record<string, number>;
    genreBreakdown: Record<string, number>;
    leadTierBreakdown: Record<string, number>;
    topGenre: string | null;
    averageLeadTier: string | null;
    outreachSent: number;
    responded: number;
    responseRate: number;
    recentCount: number;
    growthRate: number | null;
  };

  const cityMap = new Map<string, CityEntry>();

  for (const a of artists) {
    if (!a.city) continue;
    const key = `${a.city}|||${a.state ?? ""}|||${a.country ?? ""}`;
    if (!cityMap.has(key)) {
      cityMap.set(key, {
        city: a.city, state: a.state ?? null, country: a.country ?? null,
        lat: null, lng: null,
        count: 0,
        labelBreakdown: {},
        outreachBreakdown: {},
        genreBreakdown: {},
        leadTierBreakdown: {},
        topGenre: null,
        averageLeadTier: null,
        outreachSent: 0,
        responded: 0,
        responseRate: 0,
        recentCount: 0,
        growthRate: null,
      });
    }
    const entry = cityMap.get(key)!;
    entry.count++;

    if (a.lat != null && entry.lat == null) {
      entry.lat = a.lat;
      entry.lng = a.lng ?? null;
    }

    for (const s of parseLabelStatus(a.labelStatus)) {
      entry.labelBreakdown[s] = (entry.labelBreakdown[s] ?? 0) + 1;
    }
    entry.outreachBreakdown[a.outreachStatus] = (entry.outreachBreakdown[a.outreachStatus] ?? 0) + 1;

    if (a.genre) {
      entry.genreBreakdown[a.genre] = (entry.genreBreakdown[a.genre] ?? 0) + 1;
    }

    if (a.leadTier) {
      entry.leadTierBreakdown[a.leadTier] = (entry.leadTierBreakdown[a.leadTier] ?? 0) + 1;
    }

    if (a.outreachStatus !== "new") {
      entry.outreachSent++;
      if (a.outreachStatus === "in_talks" || a.outreachStatus === "signed") {
        entry.responded++;
      }
    }
  }

  // Compute growth rate using ALL artists (last 30 days vs prior 30 days), regardless of date filter
  const growthMap = new Map<string, { recent: number; previous: number }>();
  for (const a of allArtists) {
    if (!a.city) continue;
    const key = `${a.city}|||${a.state ?? ""}|||${a.country ?? ""}`;
    if (!growthMap.has(key)) growthMap.set(key, { recent: 0, previous: 0 });
    const g = growthMap.get(key)!;
    if (a.createdAt >= thirtyDaysAgo) g.recent++;
    else if (a.createdAt >= sixtyDaysAgo) g.previous++;
  }

  const cities: CityEntry[] = [...cityMap.values()].map(entry => {
    const topGenreEntry = Object.entries(entry.genreBreakdown).sort((a, b) => b[1] - a[1])[0];
    const responseRate = entry.outreachSent > 0
      ? Math.round((entry.responded / entry.outreachSent) * 100)
      : 0;
    const gKey = `${entry.city}|||${entry.state ?? ""}|||${entry.country ?? ""}`;
    const g = growthMap.get(gKey);
    const recentCount = g?.recent ?? 0;
    const growthRate = g
      ? g.previous > 0 ? Math.round(((g.recent - g.previous) / g.previous) * 100)
        : g.recent > 0 ? 100 : 0
      : null;
    // averageLeadTier = most common tier, weighted hot > warm > cold > inactive
    const LEAD_TIER_ORDER = ["hot", "warm", "cold", "inactive"];
    const averageLeadTier = LEAD_TIER_ORDER.find(t => (entry.leadTierBreakdown[t] ?? 0) > 0) ?? null;
    return { ...entry, topGenre: topGenreEntry?.[0] ?? null, responseRate, recentCount, growthRate, averageLeadTier };
  }).sort((a, b) => b.count - a.count);

  res.json({
    cities,
    total: artists.length,
    withCity: artists.filter(a => a.city).length,
    geocoded: artists.filter(a => a.lat != null).length,
  });
});

// ── Relationships CRUD ────────────────────────────────────────────────────────

const RelBody = z.object({
  toEntityId: z.number().int().positive().optional().nullable(),
  toEntityType: z.enum(["artist", "producer", "engineer", "venue", "label"]).default("artist"),
  toEntityName: z.string().min(1).max(200).optional().nullable(),
  relationshipType: z.enum(["collaborator", "producer", "engineer", "venue", "label", "other"]),
  notes: z.string().max(1000).optional().nullable(),
});

const RelPatchBody = z.object({
  relationshipType: z.enum(["collaborator", "producer", "engineer", "venue", "label", "other"]).optional(),
  notes: z.string().max(1000).optional().nullable(),
  toEntityName: z.string().min(1).max(200).optional().nullable(),
});

router.get("/:id/relationships", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  if (isNaN(artistId)) { res.status(400).json({ error: "Invalid artist id" }); return; }
  const rels = await db.select().from(artistRelationshipsTable)
    .where(eq(artistRelationshipsTable.fromArtistId, artistId));
  res.json(rels);
});

router.post("/:id/relationships", ...requireARManager, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  if (isNaN(artistId)) { res.status(400).json({ error: "Invalid artist id" }); return; }
  const parse = RelBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { toEntityId, toEntityType, toEntityName, relationshipType, notes } = parse.data;
  const [row] = await db.insert(artistRelationshipsTable)
    .values({
      fromArtistId: artistId,
      toEntityId: toEntityId ?? null,
      toEntityType,
      toEntityName: toEntityName ?? null,
      relationshipType,
      notes: notes ?? null,
      createdBy: req.user!.userId,
    })
    .returning();
  res.status(201).json(row!);
});

router.patch("/:id/relationships/:relId", ...requireARManager, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const relId = parseInt(req.params["relId"] as string);
  if (isNaN(artistId) || isNaN(relId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parse = RelPatchBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const updates: Partial<typeof artistRelationshipsTable.$inferInsert> = {};
  if (parse.data.relationshipType !== undefined) updates.relationshipType = parse.data.relationshipType;
  if (parse.data.notes !== undefined) updates.notes = parse.data.notes ?? null;
  if (parse.data.toEntityName !== undefined) updates.toEntityName = parse.data.toEntityName ?? null;
  if (!Object.keys(updates).length) { res.status(400).json({ error: "No fields to update" }); return; }
  const [row] = await db.update(artistRelationshipsTable)
    .set(updates)
    .where(and(eq(artistRelationshipsTable.id, relId), eq(artistRelationshipsTable.fromArtistId, artistId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Relationship not found" }); return; }
  res.json(row);
});

router.delete("/:id/relationships/:relId", ...requireARManager, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const relId = parseInt(req.params["relId"] as string);
  if (isNaN(artistId) || isNaN(relId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await db.delete(artistRelationshipsTable)
    .where(and(eq(artistRelationshipsTable.id, relId), eq(artistRelationshipsTable.fromArtistId, artistId)))
    .returning();
  if (!result.length) { res.status(404).json({ error: "Relationship not found" }); return; }
  res.status(204).end();
});

export default router;
