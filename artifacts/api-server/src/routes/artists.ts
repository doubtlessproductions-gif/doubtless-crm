import { Router } from "express";
import {
  db, artistsTable, artistAiAnalysisTable, artistTasksTable, releasesTable, dealsTable, contactsTable, contentPostsTable, parseLabelStatus, customLabelStatusesTable,
  artistRelationshipsTable, userPermissionsTable,
} from "@workspace/db";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { auditLog } from "../lib/audit.js";
import { generateArtistAnalysis } from "../lib/artist-ai.js";
import { scanSingle, scanRoster } from "../lib/duplicate-detector.js";
import { upsertCandidates } from "./artist-duplicates.js";
import { logger } from "../lib/logger.js";
import { geocodeCity } from "../lib/geocoder.js";
import { z } from "zod";

const router = Router();

// ── Validation ──────────────────────────────────────────────────────────────

const ArtistBody = z.object({
  name: z.string().min(1),
  genre: z.string().optional().nullable(),
  labelStatus: z.array(z.string()).default([]),
  bio: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  outreachStatus: z.enum(["new", "contacted", "in_talks", "signed", "passed"]).default("new"),
  revenuePotential: z.string().optional().nullable(),
  followersEstimate: z.string().optional().nullable(),
  engagementLevel: z.enum(["low", "medium", "high"]).optional().nullable(),
  streamingLinks: z.record(z.string()).default({}),
  socialLinks: z.record(z.string()).default({}),
  tags: z.array(z.string()).default([]),
  contactId: z.number().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  spotifyId: z.string().optional().nullable(),
  youtubeChannelId: z.string().optional().nullable(),
  photoUrls: z.array(z.string()).default([]),
  originCity: z.string().optional().nullable(),
  originState: z.string().optional().nullable(),
  originCountry: z.string().optional().nullable(),
});

// ── List (with filters) ─────────────────────────────────────────────────────

router.get("/", requireReadAuth, async (req, res) => {
  const {
    search, leadTier, outreachStatus, genre, city, state, followersEstimate, engagementLevel, labelStatus,
  } = req.query as Record<string, string | undefined>;

  // Fetch artists with optional AI analysis joined
  const artists = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt)).orderBy(artistsTable.name);

  // Fetch all AI analyses in one query for efficient join
  const analyses = await db.select().from(artistAiAnalysisTable);
  const analysisMap = new Map(analyses.map(a => [a.artistId, a]));

  let results = artists.map(a => ({ ...fmtArtist(a), aiAnalysis: analysisMap.get(a.id) ?? null }));

  // Apply filters
  if (search) {
    const q = search.toLowerCase();
    results = results.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.genre ?? "").toLowerCase().includes(q) ||
      (a.city ?? "").toLowerCase().includes(q) ||
      (a.state ?? "").toLowerCase().includes(q),
    );
  }
  if (leadTier) {
    results = results.filter(a => a.aiAnalysis?.leadTier === leadTier);
  }
  if (outreachStatus) {
    results = results.filter(a => a.outreachStatus === outreachStatus);
  }
  if (genre) {
    const q = genre.toLowerCase();
    results = results.filter(a => (a.genre ?? "").toLowerCase().includes(q));
  }
  if (city) {
    const q = city.toLowerCase();
    results = results.filter(a => (a.city ?? "").toLowerCase().includes(q));
  }
  if (state) {
    const q = state.toLowerCase();
    results = results.filter(a => (a.state ?? "").toLowerCase().includes(q));
  }
  if (followersEstimate) {
    results = results.filter(a => a.followersEstimate === followersEstimate);
  }
  if (engagementLevel) {
    results = results.filter(a => a.engagementLevel === engagementLevel);
  }
  if (labelStatus) {
    results = results.filter(a => parseLabelStatus(a.labelStatus).includes(labelStatus));
  }

  res.json(results);
});

router.post("/", requireAuth, async (req, res) => {
  const parse = ArtistBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const [row] = await db.insert(artistsTable).values({ ...parse.data, labelStatus: JSON.stringify(parse.data.labelStatus), createdBy: req.user!.userId }).returning();
  res.status(201).json({ ...fmtArtist(row!), aiAnalysis: null });

  void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "artist.created", entityType: "artist", entityId: row!.id, entityLabel: row!.name, metadata: { genre: row!.genre, labelStatus: row!.labelStatus }, req });

  // Background geocoding — only if city is set but lat/lng are blank
  if (row!.city && row!.lat == null) {
    setImmediate(() => { void geocodeArtistBackground(row!.id, row!.city!, row!.state, row!.country); });
  }

  // Auto-scan for high-confidence duplicates immediately after create (>=0.85)
  setImmediate(async () => {
    try {
      const roster = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt));
      const candidates = scanSingle(row!, roster, 0.85);
      await upsertCandidates(candidates);
    } catch (err) {
      logger.warn({ err, artistId: row!.id }, "Post-create duplicate scan failed");
    }
  });
});

// ── CSV export ──────────────────────────────────────────────────────────────

function csvRow(vals: (string | number | null | undefined)[]): string {
  return vals.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

router.get("/export.csv", requireAuth, async (req, res) => {
  const rows = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt)).orderBy(artistsTable.name);
  const lines = [
    csvRow(["ID", "Name", "Genre", "Label Status", "Outreach Status", "City", "State", "Revenue Potential", "Followers", "Email", "Phone", "Tags", "Bio", "Created At"]),
    ...rows.map(r => csvRow([
      r.id, r.name, r.genre, parseLabelStatus(r.labelStatus).join("; "), r.outreachStatus, r.city, r.state,
      r.revenuePotential, r.followersEstimate, r.email, r.phone,
      (r.tags ?? []).join("; "), (r.bio ?? "").replace(/\n/g, " "), r.createdAt.toISOString(),
    ])),
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="artists.csv"`);
  res.send(lines.join("\n"));
});

// ── CSV import ──────────────────────────────────────────────────────────────

const ImportBody = z.object({
  artists: z.array(z.object({
    name:        z.string().min(1),
    genre:       z.string().optional().nullable(),
    labelStatus: z.array(z.string()).optional().default([]),
    email:       z.string().optional().nullable(),
    phone:       z.string().optional().nullable(),
    tags:        z.array(z.string()).optional().default([]),
    bio:         z.string().optional().nullable(),
  })).min(1).max(1000),
});

router.post("/import", requireAuth, async (req, res) => {
  const parse = ImportBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid import payload" }); return; }

  const rows = parse.data.artists.map((a) => ({
    name: a.name, genre: a.genre ?? null, labelStatus: JSON.stringify(a.labelStatus ?? []),
    email: a.email ?? null, phone: a.phone ?? null, tags: a.tags ?? [],
    bio: a.bio ?? null, createdBy: req.user!.userId,
  }));

  let imported = 0;
  for (let i = 0; i < rows.length; i += 100) {
    await db.insert(artistsTable).values(rows.slice(i, i + 100));
    imported += Math.min(100, rows.length - i);
  }

  void auditLog({ userId: req.user!.userId, action: "artist.imported", entityType: "artist", entityId: 0, entityLabel: `${imported} artists`, metadata: { count: imported }, req });
  res.json({ imported });

  // Background duplicate scan after bulk import — high-confidence only (>=0.85)
  setImmediate(async () => {
    try {
      const roster = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt));
      const candidates = scanRoster(roster, 0.85);
      await upsertCandidates(candidates);
    } catch (err) {
      logger.warn({ err }, "Post-import duplicate scan failed");
    }
  });
});

// ── Bulk actions ────────────────────────────────────────────────────────────

const ArtistBulkBody = z.object({
  ids:    z.array(z.number().int().positive()).min(1).max(500),
  action: z.enum(["tag", "untag", "delete"]),
  tag:    z.string().min(1).max(100).optional(),
});

router.patch("/bulk", requireAuth, async (req, res) => {
  const parse = ArtistBulkBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { ids, action, tag } = parse.data;

  if (action === "delete") {
    await db.delete(artistsTable).where(inArray(artistsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }
  if (!tag) { res.status(400).json({ error: "tag required" }); return; }

  const artists = await db.select({ id: artistsTable.id, tags: artistsTable.tags }).from(artistsTable).where(inArray(artistsTable.id, ids));
  await Promise.all(artists.map(a => {
    const cur = (a.tags ?? []) as string[];
    const next = action === "tag" ? (cur.includes(tag) ? cur : [...cur, tag]) : cur.filter(t => t !== tag);
    return db.update(artistsTable).set({ tags: next, updatedAt: new Date() }).where(eq(artistsTable.id, a.id));
  }));
  res.json({ ok: true, affected: artists.length });
});

// ── Custom Label Statuses ──────────────────────────────────────────────────
// IMPORTANT: must be registered BEFORE /:id to avoid "label-statuses" being treated as an id

router.get("/label-statuses", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(customLabelStatusesTable)
    .orderBy(customLabelStatusesTable.createdAt);
  res.json(rows);
});

router.post("/label-statuses", requireAuth, async (req, res) => {
  const parse = z.object({
    name: z.string().min(1).max(60),
    colorClass: z.string().optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const { name, colorClass } = parse.data;
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const COLOR_OPTIONS = [
    "bg-pink-50 text-pink-700 border-pink-300",
    "bg-cyan-50 text-cyan-700 border-cyan-300",
    "bg-lime-50 text-lime-700 border-lime-300",
    "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-300",
    "bg-emerald-50 text-emerald-700 border-emerald-300",
    "bg-yellow-50 text-yellow-700 border-yellow-300",
    "bg-sky-50 text-sky-700 border-sky-300",
  ];
  const autoColor = COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)]!;
  const [row] = await db.insert(customLabelStatusesTable).values({
    key, name,
    colorClass: colorClass ?? autoColor,
    createdBy: req.user!.userId,
  }).onConflictDoNothing().returning();
  if (!row) { res.status(409).json({ error: "A status with that name already exists" }); return; }
  logger.info({ key, name }, "Custom label status created");
  res.status(201).json(row);
});

router.delete("/label-statuses/:key", requireAuth, async (req, res) => {
  await db.delete(customLabelStatusesTable)
    .where(eq(customLabelStatusesTable.key, String(req.params["key"])));
  res.json({ ok: true });
});

// ── Artist Network Graph ─────────────────────────────────────────────────────
// IMPORTANT: must be registered BEFORE /:id

router.get("/graph", requireReadAuth, async (req, res) => {
  const artists = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt));
  const analyses = await db.select().from(artistAiAnalysisTable);
  const relationships = await db.select().from(artistRelationshipsTable);

  const analysisMap = new Map(analyses.map(a => [a.artistId, a]));
  const artistIds = new Set(artists.map(a => a.id));

  // External entity nodes derived from non-artist relationship targets
  const externalMap = new Map<string, { id: number; name: string; entityType: string }>();
  let extCounter = -1;
  for (const rel of relationships) {
    if (rel.toEntityType !== "artist" && rel.toEntityName) {
      const key = `${rel.toEntityType}:${rel.toEntityName}`;
      if (!externalMap.has(key)) {
        externalMap.set(key, { id: extCounter--, name: rel.toEntityName, entityType: rel.toEntityType });
      }
    }
  }

  const artistNodes = artists.map(a => ({
    id: a.id,
    name: a.name,
    genre: a.genre ?? null,
    city: a.city ?? null,
    state: a.state ?? null,
    labelStatus: parseLabelStatus(a.labelStatus),
    outreachStatus: a.outreachStatus,
    leadTier: analysisMap.get(a.id)?.leadTier ?? null,
    nodeType: "artist",
  }));

  const externalNodes = Array.from(externalMap.values()).map(e => ({
    id: e.id,
    name: e.name,
    nodeType: "external",
    entityType: e.entityType,
    genre: null, city: null, state: null,
    labelStatus: [], outreachStatus: "new", leadTier: null,
  }));

  const links = relationships
    .filter(rel => {
      if (rel.toEntityType === "artist") return rel.toEntityId != null && artistIds.has(rel.toEntityId);
      return !!rel.toEntityName;
    })
    .map(rel => {
      const targetId = rel.toEntityType === "artist"
        ? rel.toEntityId!
        : externalMap.get(`${rel.toEntityType}:${rel.toEntityName}`)!.id;
      return { id: rel.id, source: rel.fromArtistId, target: targetId, type: rel.relationshipType };
    });

  res.json({
    nodes: [...artistNodes, ...externalNodes],
    links,
    allRelationships: relationships.map(r => ({
      id: r.id, fromArtistId: r.fromArtistId, toEntityId: r.toEntityId ?? null,
      toEntityType: r.toEntityType, toEntityName: r.toEntityName ?? null,
      relationshipType: r.relationshipType, notes: r.notes ?? null,
      createdBy: r.createdBy, createdAt: r.createdAt,
    })),
  });
});

// ── Territory Stats ──────────────────────────────────────────────────────────
// IMPORTANT: must be registered BEFORE /:id

router.get("/territory-stats", requireReadAuth, async (req, res) => {
  const { since } = req.query as Record<string, string | undefined>;
  const sinceDate = since ? new Date(Date.now() - parseInt(since) * 24 * 60 * 60 * 1000) : null;

  const artists = await db.select().from(artistsTable).where(isNull(artistsTable.deletedAt));
  const analyses = await db.select().from(artistAiAnalysisTable);
  const analysisMap = new Map(analyses.map(a => [a.artistId, a]));

  const total = artists.length;
  const withCity = artists.filter(a => !!a.city).length;
  const geocoded = artists.filter(a => a.lat != null).length;

  // Group by city+state+country key
  const cityMap = new Map<string, typeof artists>();
  for (const a of artists) {
    if (!a.city) continue;
    const key = `${a.city}|||${a.state ?? ""}|||${a.country ?? ""}`;
    const list = cityMap.get(key) ?? [];
    list.push(a);
    cityMap.set(key, list);
  }

  const cities = Array.from(cityMap.entries()).map(([key, group]) => {
    const [city, state, country] = key.split("|||") as [string, string, string];
    const first = group[0]!;

    const labelBreakdown: Record<string, number> = {};
    const outreachBreakdown: Record<string, number> = {};
    const genreBreakdown: Record<string, number> = {};
    const leadTierBreakdown: Record<string, number> = {};
    let outreachSent = 0, responded = 0, recentCount = 0;

    for (const a of group) {
      for (const l of parseLabelStatus(a.labelStatus)) {
        labelBreakdown[l] = (labelBreakdown[l] ?? 0) + 1;
      }
      outreachBreakdown[a.outreachStatus] = (outreachBreakdown[a.outreachStatus] ?? 0) + 1;
      if (a.outreachStatus !== "new") outreachSent++;
      if (a.outreachStatus === "in_talks" || a.outreachStatus === "signed") responded++;
      if (a.genre) genreBreakdown[a.genre] = (genreBreakdown[a.genre] ?? 0) + 1;
      const tier = analysisMap.get(a.id)?.leadTier;
      if (tier) leadTierBreakdown[tier] = (leadTierBreakdown[tier] ?? 0) + 1;
      if (sinceDate && a.createdAt >= sinceDate) recentCount++;
    }

    const topGenre = Object.entries(genreBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const tierOrder = ["hot", "warm", "cold", "inactive"];
    const averageLeadTier = tierOrder.find(t => (leadTierBreakdown[t] ?? 0) > 0) ?? null;
    const responseRate = outreachSent > 0 ? Math.round((responded / outreachSent) * 100) : 0;

    return {
      city, state: state || null, country: country || null,
      lat: first.lat != null ? parseFloat(String(first.lat)) : null,
      lng: first.lng != null ? parseFloat(String(first.lng)) : null,
      count: group.length,
      labelBreakdown, outreachBreakdown, genreBreakdown, leadTierBreakdown,
      topGenre, averageLeadTier,
      outreachSent, responded, responseRate,
      recentCount: sinceDate ? recentCount : group.length,
      growthRate: null,
    };
  }).sort((a, b) => b.count - a.count);

  res.json({ cities, total, withCity, geocoded });
});

// ── Get / Update / Delete single artist ─────────────────────────────────────

router.get("/:id", requireReadAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db.select().from(artistsTable).where(and(eq(artistsTable.id, id), isNull(artistsTable.deletedAt))).limit(1);
  if (!row) { res.status(404).json({ error: "Artist not found" }); return; }
  const [analysis] = await db.select().from(artistAiAnalysisTable).where(eq(artistAiAnalysisTable.artistId, id)).limit(1);
  res.json({ ...fmtArtist(row), aiAnalysis: analysis ?? null });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = ArtistBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  // Fetch old record to detect contact link changes
  const [exists] = await db.select({ id: artistsTable.id, contactId: artistsTable.contactId })
    .from(artistsTable).where(and(eq(artistsTable.id, id), isNull(artistsTable.deletedAt))).limit(1);
  if (!exists) { res.status(404).json({ error: "Artist not found" }); return; }
  const [row] = await db.update(artistsTable).set({ ...parse.data, labelStatus: JSON.stringify(parse.data.labelStatus), updatedAt: new Date() }).where(eq(artistsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Artist not found" }); return; }
  const [analysis] = await db.select().from(artistAiAnalysisTable).where(eq(artistAiAnalysisTable.artistId, id)).limit(1);
  res.json({ ...fmtArtist(row), aiAnalysis: analysis ?? null });

  void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "artist.updated", entityType: "artist", entityId: id, entityLabel: row.name, metadata: { labelStatus: row.labelStatus }, req });

  // Audit contact link changes separately
  if ((parse.data.contactId ?? null) !== (exists.contactId ?? null)) {
    if (parse.data.contactId) {
      void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "artist.contact_linked", entityType: "artist", entityId: id, entityLabel: row.name, metadata: { contactId: parse.data.contactId }, req });
    } else {
      void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "artist.contact_unlinked", entityType: "artist", entityId: id, entityLabel: row.name, metadata: { prevContactId: exists.contactId }, req });
    }
  }

  // Background geocoding — re-geocode if city set but coords are blank
  if (row.city && row.lat == null) {
    setImmediate(() => { void geocodeArtistBackground(row.id, row.city!, row.state, row.country); });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const role = req.user!.role ?? "";
  const roleCanDelete = ["owner", "admin"].includes(role);
  if (!roleCanDelete) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    const allowed = (permsRow?.permissions as Record<string, boolean> | null)?.["artists:delete"] === true;
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const result = await db.delete(artistsTable).where(eq(artistsTable.id, id)).returning();
  if (!result.length) { res.status(404).json({ error: "Artist not found" }); return; }
  res.status(204).end();
  void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "artist.deleted", entityType: "artist", entityId: id, entityLabel: result[0]!.name, req });
});

// ── AI Analysis ─────────────────────────────────────────────────────────────

router.post("/:id/ai-analysis", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const [artist] = await db.select().from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
  if (!artist) { res.status(404).json({ error: "Artist not found" }); return; }

  const result = await generateArtistAnalysis({
    name: artist.name,
    genre: artist.genre,
    bio: artist.bio,
    tags: artist.tags as string[],
    socialLinks: (artist.socialLinks ?? {}) as Record<string, string>,
    streamingLinks: (artist.streamingLinks ?? {}) as Record<string, string>,
    labelStatus: parseLabelStatus(artist.labelStatus).join(", ") || undefined,
    outreachStatus: artist.outreachStatus,
    revenuePotential: artist.revenuePotential,
  });

  // Upsert — update if exists, insert if not
  const existing = await db.select({ id: artistAiAnalysisTable.id }).from(artistAiAnalysisTable).where(eq(artistAiAnalysisTable.artistId, artistId)).limit(1);

  let analysis;
  if (existing.length) {
    [analysis] = await db.update(artistAiAnalysisTable)
      .set({ ...result, updatedAt: new Date() })
      .where(eq(artistAiAnalysisTable.artistId, artistId))
      .returning();
  } else {
    [analysis] = await db.insert(artistAiAnalysisTable)
      .values({ artistId, ...result, generatedBy: req.user!.userId })
      .returning();
  }

  res.json(analysis);
});

// ── Artist Tasks ─────────────────────────────────────────────────────────────

const TaskBody = z.object({
  title:      z.string().min(1),
  dueDate:    z.string().optional().nullable(),
  assigneeId: z.number().int().optional().nullable(),
  completed:  z.boolean().optional(),
});

router.get("/:id/tasks", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const tasks = await db.select().from(artistTasksTable)
    .where(eq(artistTasksTable.artistId, artistId))
    .orderBy(artistTasksTable.createdAt);
  res.json(tasks.map(fmtTask));
});

router.post("/:id/tasks", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const parse = TaskBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { title, dueDate, assigneeId } = parse.data;
  const [task] = await db.insert(artistTasksTable)
    .values({ artistId, title, dueDate: dueDate ?? null, assigneeId: assigneeId ?? null, createdBy: req.user!.userId })
    .returning();
  res.status(201).json(fmtTask(task!));
});

router.patch("/:id/tasks/:taskId", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const taskId = parseInt(req.params["taskId"] as string);
  const parse = TaskBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { title, dueDate, assigneeId, completed } = parse.data;
  const [task] = await db.update(artistTasksTable)
    .set({
      title,
      dueDate: dueDate ?? null,
      assigneeId: assigneeId ?? null,
      completedAt: completed === true ? new Date() : completed === false ? null : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(artistTasksTable.id, taskId), eq(artistTasksTable.artistId, artistId)))
    .returning();
  if (!task) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(fmtTask(task));
});

router.delete("/:id/tasks/:taskId", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const taskId = parseInt(req.params["taskId"] as string);
  await db.delete(artistTasksTable)
    .where(and(eq(artistTasksTable.id, taskId), eq(artistTasksTable.artistId, artistId)));
  res.status(204).end();
});

// ── Saved Views (mounted on router prefix /artists, but also exported separately) ─
// Note: saved views are handled in a separate router mounted at /artist-saved-views

// ── Formatters ───────────────────────────────────────────────────────────────

// ── Sub-resource: relationships ─────────────────────────────────────────────

const RelationshipBody = z.object({
  toEntityId:       z.number().int().optional().nullable(),
  toEntityType:     z.enum(["artist", "producer", "engineer", "venue", "label"]),
  toEntityName:     z.string().optional().nullable(),
  relationshipType: z.enum(["collaborator", "producer", "engineer", "venue", "label", "other"]),
  notes:            z.string().optional().nullable(),
});

router.get("/:id/relationships", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const rows = await db.select().from(artistRelationshipsTable)
    .where(eq(artistRelationshipsTable.fromArtistId, artistId));
  res.json(rows.map(r => ({
    id: r.id, fromArtistId: r.fromArtistId, toEntityId: r.toEntityId ?? null,
    toEntityType: r.toEntityType, toEntityName: r.toEntityName ?? null,
    relationshipType: r.relationshipType, notes: r.notes ?? null,
    createdBy: r.createdBy, createdAt: r.createdAt,
  })));
});

router.post("/:id/relationships", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const parse = RelationshipBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const [row] = await db.insert(artistRelationshipsTable)
    .values({ fromArtistId: artistId, ...parse.data, createdBy: req.user!.userId })
    .returning();
  res.status(201).json({
    id: row!.id, fromArtistId: row!.fromArtistId, toEntityId: row!.toEntityId ?? null,
    toEntityType: row!.toEntityType, toEntityName: row!.toEntityName ?? null,
    relationshipType: row!.relationshipType, notes: row!.notes ?? null,
    createdBy: row!.createdBy, createdAt: row!.createdAt,
  });
});

router.delete("/:id/relationships/:relId", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const relId = parseInt(req.params["relId"] as string);
  await db.delete(artistRelationshipsTable)
    .where(and(eq(artistRelationshipsTable.id, relId), eq(artistRelationshipsTable.fromArtistId, artistId)));
  res.status(204).end();
});

// ── Sub-resource: releases ──────────────────────────────────────────────────

router.get("/:id/releases", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const rows = await db.select().from(releasesTable)
    .where(eq(releasesTable.artistId, artistId))
    .orderBy(releasesTable.releaseDate);
  res.json(rows);
});

// ── Sub-resource: deals (via linked contact) ────────────────────────────────

router.get("/:id/deals", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const [artist] = await db.select({ contactId: artistsTable.contactId })
    .from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
  if (!artist) { res.json([]); return; }
  if (!artist.contactId) { res.json([]); return; }
  const rows = await db.select().from(dealsTable)
    .where(eq(dealsTable.contactId, artist.contactId))
    .orderBy(dealsTable.createdAt);
  res.json(rows);
});

// ── Sub-resource: contact ───────────────────────────────────────────────────

router.get("/:id/contact", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const [artist] = await db.select({ contactId: artistsTable.contactId })
    .from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
  if (!artist?.contactId) { res.json(null); return; }
  const [contact] = await db.select().from(contactsTable)
    .where(eq(contactsTable.id, artist.contactId)).limit(1);
  res.json(contact ?? null);
});

// ── Sub-resource: content posts (via releases) ──────────────────────────────

router.get("/:id/content-posts", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  // Get releases for this artist first
  const releases = await db.select({ id: releasesTable.id })
    .from(releasesTable).where(eq(releasesTable.artistId, artistId));
  if (!releases.length) { res.json([]); return; }
  const releaseIds = releases.map(r => r.id);
  const posts = await db.select().from(contentPostsTable)
    .where(inArray(contentPostsTable.releaseId, releaseIds))
    .orderBy(contentPostsTable.scheduledAt);
  res.json(posts);
});

function fmtArtist(r: typeof artistsTable.$inferSelect) {
  return {
    id: r.id, name: r.name, genre: r.genre, labelStatus: parseLabelStatus(r.labelStatus), bio: r.bio,
    email: r.email, phone: r.phone, city: r.city, state: r.state,
    country: r.country ?? null, lat: r.lat ?? null, lng: r.lng ?? null,
    outreachStatus: r.outreachStatus, revenuePotential: r.revenuePotential,
    followersEstimate: r.followersEstimate, engagementLevel: r.engagementLevel ?? null,
    streamingLinks: r.streamingLinks ?? {}, socialLinks: r.socialLinks ?? {},
    tags: r.tags, contactId: r.contactId, createdBy: r.createdBy,
    imageUrl: r.imageUrl ?? null,
    photoUrls: (r.photoUrls as string[]) ?? [],
    originCity: r.originCity ?? null,
    originState: r.originState ?? null,
    originCountry: r.originCountry ?? null,
    spotifyId: r.spotifyId ?? null, youtubeChannelId: r.youtubeChannelId ?? null,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

async function geocodeArtistBackground(artistId: number, city: string, state?: string | null, country?: string | null): Promise<void> {
  try {
    const coords = await geocodeCity(city, state, country);
    if (!coords) return;
    await db.update(artistsTable).set({ lat: coords.lat, lng: coords.lng, updatedAt: new Date() }).where(eq(artistsTable.id, artistId));
  } catch (err) {
    logger.warn({ err, artistId, city }, "Background geocode failed");
  }
}

function fmtTask(t: typeof artistTasksTable.$inferSelect) {
  return {
    id: t.id, artistId: t.artistId, title: t.title, dueDate: t.dueDate,
    assigneeId: t.assigneeId, completedAt: t.completedAt,
    createdBy: t.createdBy, createdAt: t.createdAt,
  };
}

export default router;
