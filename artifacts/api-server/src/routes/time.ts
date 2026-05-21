import { Router } from "express";
import { db, timeEntriesTable, timeSettingsTable, dealsTable, usersTable, contactsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sum, count, sql, ne } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { z } from "zod";

const router = Router();

const TimeEntryBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  durationMinutes: z.number().int().positive(),
  category: z.enum(["recording", "mixing", "mastering", "video", "admin", "other"]),
  description: z.string().max(2000).optional().nullable(),
  userId: z.number().int().positive().optional(),
});

const TimeSettingsBody = z.object({
  targetHourlyRate: z.number().positive(),
  currency: z.string().min(1).max(10),
  memberRates: z.array(z.object({
    userId: z.number().int().positive(),
    targetHourlyRate: z.number().positive().nullable(),
  })).optional(),
});

async function ensureTimeSettings() {
  const [existing] = await db.select().from(timeSettingsTable).where(eq(timeSettingsTable.workspaceId, 1)).limit(1);
  if (!existing) {
    const [created] = await db.insert(timeSettingsTable).values({ workspaceId: 1 }).returning();
    return created;
  }
  return existing;
}

// ── GET /api/deals/:dealId/time — list entries for deal ───────────────────────
router.get("/deals/:dealId/time", requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (isNaN(dealId)) { res.status(400).json({ error: "Invalid dealId" }); return; }

  const entries = await db
    .select({
      id: timeEntriesTable.id,
      dealId: timeEntriesTable.dealId,
      userId: timeEntriesTable.userId,
      userName: usersTable.name,
      date: timeEntriesTable.date,
      durationMinutes: timeEntriesTable.durationMinutes,
      category: timeEntriesTable.category,
      description: timeEntriesTable.description,
      createdAt: timeEntriesTable.createdAt,
      updatedAt: timeEntriesTable.updatedAt,
    })
    .from(timeEntriesTable)
    .leftJoin(usersTable, eq(timeEntriesTable.userId, usersTable.id))
    .where(eq(timeEntriesTable.dealId, dealId))
    .orderBy(desc(timeEntriesTable.date));

  const settings = await ensureTimeSettings();

  res.json({ entries, settings });
});

// ── POST /api/deals/:dealId/time — create entry ───────────────────────────────
router.post("/deals/:dealId/time", requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (isNaN(dealId)) { res.status(400).json({ error: "Invalid dealId" }); return; }

  const parsed = TimeEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { date, durationMinutes, category, description, userId } = parsed.data;

  const targetUserId = userId ?? req.user!.userId;
  if (targetUserId !== req.user!.userId && req.user!.role !== "admin" && req.user!.role !== "manager") {
    res.status(403).json({ error: "Cannot log time for another user" }); return;
  }

  const [entry] = await db.insert(timeEntriesTable).values({
    dealId,
    userId: targetUserId,
    date,
    durationMinutes,
    category,
    description: description ?? null,
  }).returning();

  const [userRow] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, entry.userId)).limit(1);

  res.status(201).json({ ...entry, userName: userRow?.name ?? null });
});

// ── GET /api/time — list all entries (with filters, supports CSV export) ──────
// NOTE: This must come BEFORE /time/:id routes so "settings" isn't caught as an id
router.get("/time", requireAuth, async (req, res) => {
  const { from, to, userId, dealId, category, format: fmt } = req.query as Record<string, string | undefined>;

  const VALID_CATEGORIES = ["recording", "mixing", "mastering", "video", "admin", "other"] as const;

  const userIdNum = userId ? Number(userId) : NaN;
  const dealIdNum = dealId ? Number(dealId) : NaN;

  if (userId && isNaN(userIdNum)) { res.status(400).json({ error: "Invalid userId" }); return; }
  if (dealId && isNaN(dealIdNum)) { res.status(400).json({ error: "Invalid dealId" }); return; }
  if (category && !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    res.status(400).json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` }); return;
  }

  const conditions = [];
  if (from) conditions.push(gte(timeEntriesTable.date, from));
  if (to) conditions.push(lte(timeEntriesTable.date, to));
  if (!isNaN(userIdNum)) conditions.push(eq(timeEntriesTable.userId, userIdNum));
  if (!isNaN(dealIdNum)) conditions.push(eq(timeEntriesTable.dealId, dealIdNum));
  if (category) conditions.push(eq(timeEntriesTable.category, category as typeof VALID_CATEGORIES[number]));

  const entries = await db
    .select({
      id: timeEntriesTable.id,
      dealId: timeEntriesTable.dealId,
      userId: timeEntriesTable.userId,
      userName: usersTable.name,
      userRate: usersTable.targetHourlyRate,
      dealTitle: dealsTable.title,
      contactName: contactsTable.name,
      date: timeEntriesTable.date,
      durationMinutes: timeEntriesTable.durationMinutes,
      category: timeEntriesTable.category,
      description: timeEntriesTable.description,
      createdAt: timeEntriesTable.createdAt,
    })
    .from(timeEntriesTable)
    .leftJoin(usersTable, eq(timeEntriesTable.userId, usersTable.id))
    .leftJoin(dealsTable, eq(timeEntriesTable.dealId, dealsTable.id))
    .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(timeEntriesTable.date));

  if (fmt === "csv") {
    const csvLines = [
      "Date,Deal,Artist / Client,Category,Staff,Hours,Rate Per Hr,Amount,Description",
      ...entries.map((e) => {
        const hours = (e.durationMinutes / 60).toFixed(2);
        const rate = e.userRate ? Number(e.userRate).toFixed(2) : "";
        const amount = e.userRate ? (e.durationMinutes / 60 * Number(e.userRate)).toFixed(2) : "";
        const cols = [
          e.date,
          e.dealTitle ?? "",
          e.contactName ?? "",
          e.category,
          e.userName ?? "",
          hours,
          rate,
          amount,
          (e.description ?? "").replace(/\n/g, " "),
        ];
        return cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
      }),
    ];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="time-entries.csv"`);
    res.send(csvLines.join("\n"));
    return;
  }

  res.json(entries);
});

// ── GET /api/time/settings — get target rate + per-member rates ───────────────
router.get("/time/settings", requireAuth, async (_req, res) => {
  const settings = await ensureTimeSettings();
  const memberRates = await db
    .select({ userId: usersTable.id, name: usersTable.name, role: usersTable.role, targetHourlyRate: usersTable.targetHourlyRate })
    .from(usersTable)
    .where(ne(usersTable.userType, "portal"))
    .orderBy(usersTable.name);
  res.json({ ...settings, memberRates });
});

// ── PUT /api/time/settings — update target rate + per-member rates (admin only)
// NOTE: Must come BEFORE /time/:id so "settings" isn't caught as an id param
router.put("/time/settings", requireAuth, requireRole("admin", "owner"), async (req, res) => {
  const parsed = TimeSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  await ensureTimeSettings();

  const [updated] = await db
    .update(timeSettingsTable)
    .set({
      targetHourlyRate: String(parsed.data.targetHourlyRate),
      currency: parsed.data.currency,
      updatedAt: new Date(),
    })
    .where(eq(timeSettingsTable.workspaceId, 1))
    .returning();

  // Batch-save per-member rates when provided
  if (parsed.data.memberRates?.length) {
    await Promise.all(
      parsed.data.memberRates.map(({ userId, targetHourlyRate }) =>
        db.update(usersTable)
          .set({ targetHourlyRate: targetHourlyRate != null ? String(targetHourlyRate) : null })
          .where(eq(usersTable.id, userId))
      )
    );
  }

  const memberRates = await db
    .select({ userId: usersTable.id, name: usersTable.name, role: usersTable.role, targetHourlyRate: usersTable.targetHourlyRate })
    .from(usersTable)
    .where(ne(usersTable.userType, "portal"))
    .orderBy(usersTable.name);

  res.json({ ...updated, memberRates });
});

// ── PUT /api/time/:id — update entry ─────────────────────────────────────────
router.put("/time/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const isOwner = existing.userId === req.user!.userId;
  const isPrivileged = ["owner", "admin", "manager"].includes(req.user!.role ?? "");
  if (!isOwner && !isPrivileged) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = TimeEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { date, durationMinutes, category, description } = parsed.data;

  const [updated] = await db.update(timeEntriesTable)
    .set({ date, durationMinutes, category, description: description ?? null, updatedAt: new Date() })
    .where(eq(timeEntriesTable.id, id))
    .returning();

  const [userRow] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.userId)).limit(1);

  res.json({ ...updated, userName: userRow?.name ?? null });
});

// ── DELETE /api/time/:id — delete entry ──────────────────────────────────────
router.delete("/time/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(timeEntriesTable).where(eq(timeEntriesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const isOwner = existing.userId === req.user!.userId;
  const isPrivileged = ["owner", "admin", "manager"].includes(req.user!.role ?? "");
  if (!isOwner && !isPrivileged) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(timeEntriesTable).where(eq(timeEntriesTable.id, id));
  res.json({ ok: true });
});

// ── GET /api/analytics/time — analytics time summary ─────────────────────────
router.get("/analytics/time", requireAuth, async (_req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfMonthStr = startOfMonth.toISOString().slice(0, 10);

  const [thisMonthRow] = await db
    .select({ total: sum(timeEntriesTable.durationMinutes) })
    .from(timeEntriesTable)
    .where(gte(timeEntriesTable.date, startOfMonthStr));

  const totalMinutesThisMonth = Number(thisMonthRow?.total ?? 0);

  // Fetch workspace settings and per-user rates in parallel
  const [settings, userRates, dealRows] = await Promise.all([
    ensureTimeSettings(),
    db.select({ id: usersTable.id, targetHourlyRate: usersTable.targetHourlyRate }).from(usersTable),
    db.select({
      dealId:       timeEntriesTable.dealId,
      dealTitle:    dealsTable.title,
      dealValue:    dealsTable.value,
      assignedTo:   dealsTable.assignedTo,
      totalMinutes: sum(timeEntriesTable.durationMinutes),
    })
    .from(timeEntriesTable)
    .leftJoin(dealsTable, eq(timeEntriesTable.dealId, dealsTable.id))
    .where(sql`${timeEntriesTable.dealId} IS NOT NULL`)
    .groupBy(timeEntriesTable.dealId, dealsTable.title, dealsTable.value, dealsTable.assignedTo)
    .orderBy(sql`sum(${timeEntriesTable.durationMinutes}) DESC`),
  ]);

  const workspaceTargetRate = Number(settings.targetHourlyRate);
  // Build per-user rate map (fallback to workspace rate)
  const userRateMap = new Map<number, number>(
    userRates.map((u) => [u.id, u.targetHourlyRate != null ? Number(u.targetHourlyRate) : workspaceTargetRate])
  );

  const dealCount = dealRows.length;
  const avgMinutesPerDeal = dealCount > 0
    ? Math.round(dealRows.reduce((acc, r) => acc + Number(r.totalMinutes ?? 0), 0) / dealCount)
    : 0;

  const top8 = dealRows.slice(0, 8).map((r) => ({
    dealId: r.dealId,
    dealTitle: r.dealTitle ?? `Deal #${r.dealId}`,
    hours: Number((Number(r.totalMinutes ?? 0) / 60).toFixed(1)),
  }));

  const top3 = dealRows.slice(0, 3).map((r) => ({
    dealId: r.dealId,
    dealTitle: r.dealTitle ?? `Deal #${r.dealId}`,
    hours: Number((Number(r.totalMinutes ?? 0) / 60).toFixed(1)),
  }));

  // Profitability distribution: use assigned user's personal rate (fallback workspace rate)
  const profitabilityDistribution = { on_track: 0, approaching: 0, over_budget: 0, no_value: 0 };
  for (const r of dealRows) {
    const hours = Number(r.totalMinutes ?? 0) / 60;
    const value = r.dealValue ? Number(r.dealValue) : null;
    if (!value || hours === 0) {
      profitabilityDistribution.no_value++;
    } else {
      const targetRate = r.assignedTo != null ? (userRateMap.get(r.assignedTo) ?? workspaceTargetRate) : workspaceTargetRate;
      const effectiveRate = value / hours;
      if (effectiveRate >= targetRate) {
        profitabilityDistribution.on_track++;
      } else if (effectiveRate >= targetRate * 0.8) {
        profitabilityDistribution.approaching++;
      } else {
        profitabilityDistribution.over_budget++;
      }
    }
  }

  res.json({
    totalHoursThisMonth: Number((totalMinutesThisMonth / 60).toFixed(1)),
    avgHoursPerDeal: Number((avgMinutesPerDeal / 60).toFixed(1)),
    top3MostTimeIntensive: top3,
    top8ForChart: top8,
    profitabilityDistribution,
  });
});

export default router;
