import { Router } from "express";
import {
  db, dealsTable, activityTable, usersTable, timeEntriesTable,
  timeSettingsTable, roleQuotasTable, userQuotasTable, artistsTable, projectsTable,
  dealNotesTable, contactsTable, emailLogsTable,
  customFormsTable, customFormSubmissionsTable,
} from "@workspace/db";
import { eq, count, sum, gte, and, sql, ne, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/pipeline", requireAuth, async (_req, res) => {
  const stages = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;

  const rows = await db
    .select({
      stage: dealsTable.stage,
      count: count(),
      value: sum(dealsTable.value),
    })
    .from(dealsTable)
    .groupBy(dealsTable.stage);

  const map = new Map(rows.map((r) => [r.stage, r]));

  res.json(
    stages.map((stage) => ({
      stage,
      count: Number(map.get(stage)?.count ?? 0),
      value: Number(map.get(stage)?.value ?? 0),
    })),
  );
});

router.get("/revenue", requireAuth, async (_req, res) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const rows = await db
    .select({
      month: sql<string>`to_char(${dealsTable.createdAt}, 'YYYY-MM')`,
      pipelineValue: sum(dealsTable.value),
      dealCount: count(),
    })
    .from(dealsTable)
    .where(gte(dealsTable.createdAt, sixMonthsAgo))
    .groupBy(sql`to_char(${dealsTable.createdAt}, 'YYYY-MM')`)
    .orderBy(sql`to_char(${dealsTable.createdAt}, 'YYYY-MM')`);

  const wonRows = await db
    .select({
      month: sql<string>`to_char(${dealsTable.createdAt}, 'YYYY-MM')`,
      wonValue: sum(dealsTable.value),
    })
    .from(dealsTable)
    .where(and(gte(dealsTable.createdAt, sixMonthsAgo), eq(dealsTable.stage, "won")))
    .groupBy(sql`to_char(${dealsTable.createdAt}, 'YYYY-MM')`);

  const wonMap = new Map(wonRows.map((r) => [r.month, Number(r.wonValue ?? 0)]));

  res.json(
    rows.map((r) => ({
      month: r.month,
      pipelineValue: Number(r.pipelineValue ?? 0),
      wonValue: wonMap.get(r.month) ?? 0,
      dealCount: Number(r.dealCount ?? 0),
    })),
  );
});

router.get("/activity", requireAuth, async (_req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      date: sql<string>`to_char(${activityTable.createdAt}, 'YYYY-MM-DD')`,
      count: count(),
    })
    .from(activityTable)
    .where(gte(activityTable.createdAt, thirtyDaysAgo))
    .groupBy(sql`to_char(${activityTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${activityTable.createdAt}, 'YYYY-MM-DD')`);

  // Fill in missing days with 0
  const result: { date: string; count: number }[] = [];
  const dataMap = new Map(rows.map((r) => [r.date, Number(r.count)]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: dataMap.get(key) ?? 0 });
  }

  res.json(result);
});

router.get("/win-rate", requireAuth, async (_req, res) => {
  const [wonRow] = await db.select({ count: count() }).from(dealsTable).where(eq(dealsTable.stage, "won"));
  const [lostRow] = await db.select({ count: count() }).from(dealsTable).where(eq(dealsTable.stage, "lost"));
  const [openRow] = await db
    .select({ count: count() })
    .from(dealsTable)
    .where(sql`${dealsTable.stage} NOT IN ('won', 'lost')`);

  const won = Number(wonRow?.count ?? 0);
  const lost = Number(lostRow?.count ?? 0);
  const openDeals = Number(openRow?.count ?? 0);
  const totalClosed = won + lost;
  const winRate = totalClosed > 0 ? Math.round((won / totalClosed) * 100) : 0;

  res.json({ winRate, totalClosed, won, lost, openDeals });
});

// ── GET /api/analytics/team — team performance leaderboard ───────────────────
router.get("/team", requireAuth, async (_req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfMonthStr = startOfMonth.toISOString().slice(0, 10);
  const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const startOfQuarterStr = startOfQuarter.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const teamUsers = await db
    .select({
      id:               usersTable.id,
      name:             usersTable.name,
      role:             usersTable.role,
      targetHourlyRate: usersTable.targetHourlyRate,
    })
    .from(usersTable)
    .where(ne(usersTable.userType, "portal"));

  const userIds = teamUsers.map((u) => u.id);
  if (userIds.length === 0) { res.json({ members: [] }); return; }

  // Fetch everything in parallel
  const [
    settingsRows,
    allDeals,
    hoursRows,
    quotaRows,
    userQuotaRows,
    allArtists,
    allProjects,
    dealsThisWeek,
    notesThisWeek,
    contactsThisWeek,
    emailsThisMonth,
    formSubsThisMonth,
  ] = await Promise.all([
    db.select().from(timeSettingsTable).where(eq(timeSettingsTable.workspaceId, 1)).limit(1),
    db.select({
      assignedTo: dealsTable.assignedTo,
      createdBy:  dealsTable.createdBy,
      contactId:  dealsTable.contactId,
      stage:      dealsTable.stage,
      value:      dealsTable.value,
      closedAt:   dealsTable.closedAt,
      createdAt:  dealsTable.createdAt,
    }).from(dealsTable),
    db.select({
      userId: timeEntriesTable.userId,
      total:  sum(timeEntriesTable.durationMinutes),
    }).from(timeEntriesTable).where(gte(timeEntriesTable.date, startOfMonthStr)).groupBy(timeEntriesTable.userId),
    db.select().from(roleQuotasTable),
    db.select().from(userQuotasTable),
    // Signed artists (linked via contactId for deal→contact→artist derivation)
    db.select({
      contactId:   artistsTable.contactId,
      labelStatus: artistsTable.labelStatus,
      createdAt:   artistsTable.createdAt,
    }).from(artistsTable).where(sql`${artistsTable.labelStatus}::jsonb @> '["signed"]'::jsonb`),
    // All projects per creator
    db.select({
      createdBy: projectsTable.createdBy,
      createdAt: projectsTable.createdAt,
    }).from(projectsTable),
    // Deals created this week per user
    db.select({ createdBy: dealsTable.createdBy, cnt: count() })
      .from(dealsTable).where(gte(dealsTable.createdAt, sevenDaysAgo))
      .groupBy(dealsTable.createdBy),
    // Notes added this week per user
    db.select({ authorId: dealNotesTable.authorId, cnt: count() })
      .from(dealNotesTable).where(gte(dealNotesTable.createdAt, sevenDaysAgo))
      .groupBy(dealNotesTable.authorId),
    // Contacts created this week per user
    db.select({ createdBy: contactsTable.createdBy, cnt: count() })
      .from(contactsTable).where(gte(contactsTable.createdAt, sevenDaysAgo))
      .groupBy(contactsTable.createdBy),
    // Templates sent this month per user (email_logs.sent_by)
    db.select({ sentBy: emailLogsTable.sentBy, cnt: count() })
      .from(emailLogsTable).where(gte(emailLogsTable.sentAt, startOfMonth))
      .groupBy(emailLogsTable.sentBy),
    // Form submissions this month on forms created by each user
    db.select({ createdBy: customFormsTable.createdBy, cnt: count() })
      .from(customFormSubmissionsTable)
      .innerJoin(customFormsTable, eq(customFormSubmissionsTable.formId, customFormsTable.id))
      .where(gte(customFormSubmissionsTable.submittedAt, startOfMonth))
      .groupBy(customFormsTable.createdBy),
  ]);

  const workspaceRate = Number(settingsRows[0]?.targetHourlyRate ?? 100);
  const hoursMap = new Map(hoursRows.map((r) => [r.userId, Number(r.total ?? 0)]));

  // Build quota lookups: prefer per-user override over role default
  const roleQuotaMap = new Map<string, number>();
  for (const q of quotaRows) roleQuotaMap.set(`${q.role}:${q.metricKey}`, Number(q.targetValue));
  const userQuotaMap = new Map<string, number>();
  for (const q of userQuotaRows) userQuotaMap.set(`${q.userId}:${q.metricKey}`, Number(q.targetValue));
  const getQuota = (uid: number, role: string, key: string): number | null => {
    const uk = `${uid}:${key}`;
    if (userQuotaMap.has(uk)) return userQuotaMap.get(uk)!;
    return roleQuotaMap.get(`${role}:${key}`) ?? null;
  };

  // Activity this week lookup: userId -> count
  const dealsWeekMap  = new Map(dealsThisWeek.map((r) => [r.createdBy, Number(r.cnt)]));
  const notesWeekMap  = new Map(notesThisWeek.map((r) => [r.authorId, Number(r.cnt)]));
  const contactWeekMap = new Map(contactsThisWeek.map((r) => [r.createdBy, Number(r.cnt)]));
  // Marketing KPI lookup: userId -> count
  const emailsMonthMap = new Map(emailsThisMonth.map((r) => [r.sentBy, Number(r.cnt)]));
  const formSubsMonthMap = new Map(
    formSubsThisMonth.filter((r) => r.createdBy != null).map((r) => [r.createdBy!, Number(r.cnt)])
  );

  const members = teamUsers.map((u) => {
    const assignedDeals = allDeals.filter((d) => d.assignedTo === u.id);
    const wonDeals  = assignedDeals.filter((d) => d.stage === "won");
    const openDeals = assignedDeals.filter((d) => !["won", "lost"].includes(d.stage));
    const lostDeals = assignedDeals.filter((d) => d.stage === "lost");
    const closedDeals = wonDeals.length + lostDeals.length;

    const wonMonth   = wonDeals.filter((d) => (d.closedAt ?? d.createdAt) >= startOfMonth);
    const wonQuarter = wonDeals.filter((d) => (d.closedAt ?? d.createdAt) >= startOfQuarter);

    const revenueMonth   = wonMonth.reduce((a, d) => a + Number(d.value ?? 0), 0);
    const revenueAllTime = wonDeals.reduce((a, d) => a + Number(d.value ?? 0), 0);
    const pipelineValue  = openDeals.reduce((a, d) => a + Number(d.value ?? 0), 0);
    const hoursThisMonth = Number(((hoursMap.get(u.id) ?? 0) / 60).toFixed(1));
    const winRate        = closedDeals > 0 ? Math.round((wonDeals.length / closedDeals) * 100) : 0;
    const effectiveRate  = u.targetHourlyRate != null ? Number(u.targetHourlyRate) : workspaceRate;

    // Artist & project counts — artists derived from won deal → contact → artist linkage
    const wonContactIds      = new Set(wonDeals.map((d) => d.contactId).filter((c) => c != null));
    const wonMonthContactIds = new Set(
      wonDeals.filter((d) => (d.closedAt ?? d.createdAt) >= startOfMonth)
        .map((d) => d.contactId).filter((c) => c != null)
    );
    const artistsSigned      = allArtists.filter((a) => a.contactId != null && wonContactIds.has(a.contactId)).length;
    const artistsSignedMonth = allArtists.filter((a) => a.contactId != null && wonMonthContactIds.has(a.contactId)).length;
    const projectsBooked      = allProjects.filter((p) => p.createdBy === u.id).length;
    const projectsBookedMonth = allProjects.filter((p) =>
      p.createdBy === u.id && new Date(p.createdAt) >= startOfMonth
    ).length;

    // Activity this week — aggregate + per-dimension
    const activityDealsThisWeek    = dealsWeekMap.get(u.id)   ?? 0;
    const activityNotesThisWeek    = notesWeekMap.get(u.id)   ?? 0;
    const activityContactsThisWeek = contactWeekMap.get(u.id) ?? 0;
    const activityThisWeek         = activityDealsThisWeek + activityNotesThisWeek + activityContactsThisWeek;

    // Marketing KPIs this month
    const templatesSentMonth    = emailsMonthMap.get(u.id)   ?? 0;
    const formSubmissionsMonth  = formSubsMonthMap.get(u.id) ?? 0;

    // Quota targets — per-user override takes priority over role default
    const qDeals     = getQuota(u.id, u.role, "deals_closed");
    const qRevenue   = getQuota(u.id, u.role, "revenue_closed");
    const qHours     = getQuota(u.id, u.role, "hours_logged");
    const qArtists   = getQuota(u.id, u.role, "artists_signed");
    const qProjects  = getQuota(u.id, u.role, "projects_booked");
    const qTemplates = getQuota(u.id, u.role, "templates_sent");
    const qForms     = getQuota(u.id, u.role, "form_submissions");

    return {
      userId:              u.id,
      name:                u.name,
      role:                u.role,
      targetHourlyRate:    u.targetHourlyRate != null ? Number(u.targetHourlyRate) : null,
      effectiveRate,
      dealsClosedMonth:    wonMonth.length,
      dealsClosedQuarter:  wonQuarter.length,
      dealsClosedAllTime:  wonDeals.length,
      revenueClosedMonth:  revenueMonth,
      revenueClosedAllTime: revenueAllTime,
      openDeals:           openDeals.length,
      pipelineValue,
      hoursThisMonth,
      winRate,
      artistsSigned,
      artistsSignedMonth,
      projectsBooked,
      projectsBookedMonth,
      templatesSentMonth,
      formSubmissionsMonth,
      activityThisWeek,
      activityDealsThisWeek,
      activityNotesThisWeek,
      activityContactsThisWeek,
      // Quota targets
      quotaDealsMonth:       qDeals,
      quotaRevenueMonth:     qRevenue,
      quotaHoursMonth:       qHours,
      quotaArtistsMonth:     qArtists,
      quotaProjectsMonth:    qProjects,
      quotaTemplatesMonth:   qTemplates,
      quotaFormsMonth:       qForms,
      // Quota progress (0-100)
      quotaDealsProgress:      qDeals     != null && qDeals     > 0 ? Math.round((wonMonth.length       / qDeals)     * 100) : null,
      quotaRevenueProgress:    qRevenue   != null && qRevenue   > 0 ? Math.round((revenueMonth          / qRevenue)   * 100) : null,
      quotaHoursProgress:      qHours     != null && qHours     > 0 ? Math.round((hoursThisMonth        / qHours)     * 100) : null,
      quotaArtistsProgress:    qArtists   != null && qArtists   > 0 ? Math.round((artistsSignedMonth    / qArtists)   * 100) : null,
      quotaProjectsProgress:   qProjects  != null && qProjects  > 0 ? Math.round((projectsBookedMonth   / qProjects)  * 100) : null,
      quotaTemplatesProgress:  qTemplates != null && qTemplates > 0 ? Math.round((templatesSentMonth    / qTemplates) * 100) : null,
      quotaFormsProgress:      qForms     != null && qForms     > 0 ? Math.round((formSubmissionsMonth  / qForms)     * 100) : null,
    };
  });

  res.json({ members });
});

// ── GET /api/analytics/team/:userId — individual member detail ────────────────
router.get("/team/:userId", requireAuth, async (req, res) => {
  const userId = Number(req.params["userId"]);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid userId" }); return; }

  const now = new Date();
  const startOfMonth   = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfMonthStr = startOfMonth.toISOString().slice(0, 10);
  const startOfQuarter  = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const sixMonthsAgo   = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 10);

  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, targetHourlyRate: usersTable.targetHourlyRate })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [
    myDeals,
    hoursHistory,
    categoryBreakdown,
    settings,
    quotaRows,
    myArtists,
    myProjects,
    templatesSentRows,
    formSubsRows,
    userQuotaRows,
  ] = await Promise.all([
    db.select({
      id: dealsTable.id, title: dealsTable.title, stage: dealsTable.stage,
      contactId: dealsTable.contactId,
      value: dealsTable.value, closedAt: dealsTable.closedAt, createdAt: dealsTable.createdAt,
    }).from(dealsTable).where(eq(dealsTable.assignedTo, userId)),

    db.select({
      month: sql<string>`to_char(${timeEntriesTable.date}::date, 'YYYY-MM')`,
      minutes: sum(timeEntriesTable.durationMinutes),
    }).from(timeEntriesTable)
      .where(and(eq(timeEntriesTable.userId, userId), gte(timeEntriesTable.date, sixMonthsAgoStr)))
      .groupBy(sql`to_char(${timeEntriesTable.date}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${timeEntriesTable.date}::date, 'YYYY-MM')`),

    db.select({ category: timeEntriesTable.category, minutes: sum(timeEntriesTable.durationMinutes) })
      .from(timeEntriesTable)
      .where(eq(timeEntriesTable.userId, userId))
      .groupBy(timeEntriesTable.category),

    db.select().from(timeSettingsTable).where(eq(timeSettingsTable.workspaceId, 1)).limit(1),
    db.select().from(roleQuotasTable),

    // Signed artists — fetched globally; linked via deal→contact→artist
    db.select({ contactId: artistsTable.contactId, createdAt: artistsTable.createdAt })
      .from(artistsTable)
      .where(sql`${artistsTable.labelStatus}::jsonb @> '["signed"]'::jsonb`),

    // Projects booked (all-time + this month)
    db.select({ createdAt: projectsTable.createdAt })
      .from(projectsTable)
      .where(eq(projectsTable.createdBy, userId)),

    // Marketing: templates sent this month
    db.select({ cnt: count() })
      .from(emailLogsTable)
      .where(and(eq(emailLogsTable.sentBy, userId), gte(emailLogsTable.sentAt, startOfMonth))),

    // Marketing: form submissions this month on this user's forms
    db.select({ cnt: count() })
      .from(customFormSubmissionsTable)
      .innerJoin(customFormsTable, eq(customFormSubmissionsTable.formId, customFormsTable.id))
      .where(and(eq(customFormsTable.createdBy, userId), gte(customFormSubmissionsTable.submittedAt, startOfMonth))),

    // Per-user quota overrides for this member
    db.select().from(userQuotasTable).where(eq(userQuotasTable.userId, userId)),
  ]);

  // Fill missing months
  const hoursMap = new Map(hoursHistory.map((r) => [r.month, Number(r.minutes ?? 0)]));
  const monthlyHours: { month: string; hours: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyHours.push({ month: key, hours: Number(((hoursMap.get(key) ?? 0) / 60).toFixed(1)) });
  }

  const workspaceRate   = Number(settings[0]?.targetHourlyRate ?? 100);
  const effectiveRate   = user.targetHourlyRate != null ? Number(user.targetHourlyRate) : workspaceRate;

  const wonDeals  = myDeals.filter((d) => d.stage === "won");
  const lostDeals = myDeals.filter((d) => d.stage === "lost");
  const closedDeals = wonDeals.length + lostDeals.length;
  const winRate   = closedDeals > 0 ? Math.round((wonDeals.length / closedDeals) * 100) : 0;

  const wonMonth   = wonDeals.filter((d) => (d.closedAt ?? d.createdAt) >= startOfMonth);
  const wonQuarter = wonDeals.filter((d) => (d.closedAt ?? d.createdAt) >= startOfQuarter);

  const revenueClosedMonth   = wonMonth.reduce((a, d) => a + Number(d.value ?? 0), 0);
  const revenueClosedAllTime = wonDeals.reduce((a, d) => a + Number(d.value ?? 0), 0);

  // Hours this month
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const hoursThisMonth  = Number(((hoursMap.get(currentMonthKey) ?? 0) / 60).toFixed(1));

  // Marketing KPIs
  const templatesSentMonth   = Number(templatesSentRows[0]?.cnt ?? 0);
  const formSubmissionsMonth = Number(formSubsRows[0]?.cnt ?? 0);

  // Artists signed — via won deal → contact → artist linkage
  const wonDealContactIds      = new Set(wonDeals.map((d) => d.contactId).filter((c) => c != null));
  const wonDealMonthContactIds = new Set(
    wonDeals.filter((d) => (d.closedAt ?? d.createdAt) >= startOfMonth)
      .map((d) => d.contactId).filter((c) => c != null)
  );
  const artistsSignedAllTime = myArtists.filter((a) => a.contactId != null && wonDealContactIds.has(a.contactId)).length;
  const artistsSignedMonth   = myArtists.filter((a) => a.contactId != null && wonDealMonthContactIds.has(a.contactId)).length;
  const projectsBookedAllTime = myProjects.length;
  const projectsBookedMonth   = myProjects.filter((p) => new Date(p.createdAt) >= startOfMonth).length;

  // Quota lookup — per-user override takes priority over role default
  const roleQuotaMapDetail = new Map<string, number>();
  for (const q of quotaRows) {
    if (q.role === user.role) roleQuotaMapDetail.set(q.metricKey, Number(q.targetValue));
  }
  const userQuotaMapDetail = new Map<string, number>();
  for (const q of userQuotaRows) userQuotaMapDetail.set(q.metricKey, Number(q.targetValue));
  const getQ = (key: string): number | null =>
    userQuotaMapDetail.has(key) ? userQuotaMapDetail.get(key)! :
    roleQuotaMapDetail.has(key) ? roleQuotaMapDetail.get(key)! : null;

  const qDeals     = getQ("deals_closed");
  const qRevenue   = getQ("revenue_closed");
  const qHours     = getQ("hours_logged");
  const qArtists   = getQ("artists_signed");
  const qProjects  = getQ("projects_booked");
  const qTemplates = getQ("templates_sent");
  const qForms     = getQ("form_submissions");

  res.json({
    userId:               user.id,
    name:                 user.name,
    role:                 user.role,
    targetHourlyRate:     user.targetHourlyRate != null ? Number(user.targetHourlyRate) : null,
    effectiveRate,
    winRate,
    // Deals (periodized)
    dealsClosedMonth:     wonMonth.length,
    dealsClosedQuarter:   wonQuarter.length,
    dealsClosedAllTime:   wonDeals.length,
    totalDeals:           myDeals.length,
    wonDeals:             wonDeals.length,
    // Revenue
    revenueClosedMonth,
    revenueClosedAllTime,
    totalRevenue:         revenueClosedAllTime,
    // Hours
    hoursThisMonth,
    targetHoursMonth:     qHours ?? null,
    monthlyHours,
    categoryBreakdown:    categoryBreakdown.map((r) => ({
      category: r.category,
      hours: Number(((Number(r.minutes ?? 0)) / 60).toFixed(1)),
    })),
    // Artists & Projects
    artistsSignedAllTime,
    artistsSignedMonth,
    projectsBookedAllTime,
    projectsBookedMonth,
    // Marketing KPIs
    templatesSentMonth,
    formSubmissionsMonth,
    // Quota targets
    quotaDealsMonth:      qDeals,
    quotaRevenueMonth:    qRevenue,
    quotaHoursMonth:      qHours,
    quotaArtistsMonth:    qArtists,
    quotaProjectsMonth:   qProjects,
    quotaTemplatesMonth:  qTemplates,
    quotaFormsMonth:      qForms,
    // Quota progress (0-100, null = no quota set)
    quotaDealsProgress:      qDeals     != null && qDeals     > 0 ? Math.round((wonMonth.length       / qDeals)     * 100) : null,
    quotaRevenueProgress:    qRevenue   != null && qRevenue   > 0 ? Math.round((revenueClosedMonth    / qRevenue)   * 100) : null,
    quotaHoursProgress:      qHours     != null && qHours     > 0 ? Math.round((hoursThisMonth        / qHours)     * 100) : null,
    quotaArtistsProgress:    qArtists   != null && qArtists   > 0 ? Math.round((artistsSignedMonth    / qArtists)   * 100) : null,
    quotaProjectsProgress:   qProjects  != null && qProjects  > 0 ? Math.round((projectsBookedMonth   / qProjects)  * 100) : null,
    quotaTemplatesProgress:  qTemplates != null && qTemplates > 0 ? Math.round((templatesSentMonth    / qTemplates) * 100) : null,
    quotaFormsProgress:      qForms     != null && qForms     > 0 ? Math.round((formSubmissionsMonth  / qForms)     * 100) : null,
    recentDeals: myDeals.slice(0, 5).map((d) => ({
      id: d.id, title: d.title, stage: d.stage, value: Number(d.value ?? 0),
    })),
  });
});

export default router;
