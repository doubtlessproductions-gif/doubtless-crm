import { Router } from "express";
import {
  db,
  usersTable,
  activityTable,
  contactsTable,
  dealsTable,
  auditLogsTable,
  clientSubscriptionsTable,
  subscriptionPlansTable,
  calendarEventsTable,
} from "@workspace/db";
import { eq, count, gte, sum, ne, desc, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/stats", requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  const [totalUsersRow] = await db.select({ count: count() }).from(usersTable);
  const [totalContactsRow] = await db.select({ count: count() }).from(contactsTable);
  const [openDealsRow] = await db
    .select({ count: count() })
    .from(dealsTable)
    .where(and(ne(dealsTable.stage, "won"), ne(dealsTable.stage, "lost")));
  const [wonDealsRow] = await db
    .select({ count: count() })
    .from(dealsTable)
    .where(eq(dealsTable.stage, "won"));
  const [pipelineValueRow] = await db
    .select({ total: sum(dealsTable.value) })
    .from(dealsTable)
    .where(ne(dealsTable.stage, "lost"));

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [activeTodayRow] = await db
    .select({ count: count() })
    .from(activityTable)
    .where(gte(activityTable.createdAt, oneDayAgo));

  const [totalLoginsRow] = await db
    .select({ count: count() })
    .from(activityTable)
    .where(eq(activityTable.type, "login"));

  const [user] = await db
    .select({ createdAt: usersTable.createdAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  // Pipeline value by stage (bar chart)
  const stageRows = await db
    .select({ stage: dealsTable.stage, total: sum(dealsTable.value), dealCount: count() })
    .from(dealsTable)
    .where(and(ne(dealsTable.stage, "lost"), ne(dealsTable.stage, "won")))
    .groupBy(dealsTable.stage);

  const pipelineByStage = stageRows.map((r) => ({
    stage: r.stage,
    value: Number(r.total ?? 0),
    count: Number(r.dealCount ?? 0),
  }));

  // MRR from active subscriptions
  const [mrrRow] = await db
    .select({ mrr: sum(subscriptionPlansTable.priceMonthly) })
    .from(clientSubscriptionsTable)
    .leftJoin(subscriptionPlansTable, eq(clientSubscriptionsTable.planId, subscriptionPlansTable.id))
    .where(eq(clientSubscriptionsTable.status, "active"));

  // Win rate last 90 days
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [wonRecentRow] = await db
    .select({ count: count() })
    .from(dealsTable)
    .where(and(eq(dealsTable.stage, "won"), gte(dealsTable.closedAt, ninetyDaysAgo)));
  const [lostRecentRow] = await db
    .select({ count: count() })
    .from(dealsTable)
    .where(and(eq(dealsTable.stage, "lost"), gte(dealsTable.updatedAt, ninetyDaysAgo)));

  const wonCount = Number(wonRecentRow?.count ?? 0);
  const lostCount = Number(lostRecentRow?.count ?? 0);
  const totalClosed = wonCount + lostCount;
  const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : null;

  // Revenue trend — last 6 months of won deals grouped by month
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  sixMonthsAgo.setDate(1);

  const revenueTrendRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', closed_at), 'YYYY-MM') AS month,
      COALESCE(SUM(value::numeric), 0)::float AS revenue
    FROM deals
    WHERE stage = 'won' AND closed_at >= ${sixMonthsAgo}
    GROUP BY month
    ORDER BY month ASC
  `);

  const revenueTrend = (revenueTrendRows.rows as Array<{ month: string; revenue: number }>).map(
    (r) => ({ month: r.month, revenue: Number(r.revenue) }),
  );

  // Top 5 contacts by total deal value
  const topContactsRows = await db.execute(sql`
    SELECT c.id, c.name, c.company,
      COALESCE(SUM(d.value::numeric), 0)::float AS total_value,
      COUNT(d.id)::int AS deal_count
    FROM contacts c
    LEFT JOIN deals d ON d.contact_id = c.id AND d.stage != 'lost'
    GROUP BY c.id, c.name, c.company
    ORDER BY total_value DESC NULLS LAST
    LIMIT 5
  `);

  const topContacts = (
    topContactsRows.rows as Array<{
      id: number;
      name: string;
      company: string | null;
      total_value: number;
      deal_count: number;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    company: r.company,
    totalValue: Number(r.total_value),
    dealCount: Number(r.deal_count),
  }));

  // Upcoming calendar events (next 3)
  const now = new Date();
  const upcomingEvents = await db
    .select()
    .from(calendarEventsTable)
    .where(gte(calendarEventsTable.startTime, now))
    .orderBy(calendarEventsTable.startTime)
    .limit(3);

  res.json({
    totalUsers: Number(totalUsersRow?.count ?? 0),
    activeToday: Number(activeTodayRow?.count ?? 0),
    totalLogins: Number(totalLoginsRow?.count ?? 0),
    memberSince: user?.createdAt ?? new Date(),
    totalContacts: Number(totalContactsRow?.count ?? 0),
    openDeals: Number(openDealsRow?.count ?? 0),
    pipelineValue: Number(pipelineValueRow?.total ?? 0),
    wonDeals: Number(wonDealsRow?.count ?? 0),
    mrr: Number(mrrRow?.mrr ?? 0),
    winRate,
    pipelineByStage,
    revenueTrend,
    topContacts,
    upcomingEvents: upcomingEvents.map((e) => ({
      id: e.id,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      meetLink: e.meetLink,
    })),
  });
});

router.get("/activity", requireAuth, async (_req, res) => {
  const items = await db
    .select()
    .from(auditLogsTable)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10);

  res.json(
    items.map((item) => ({
      id: item.id,
      action: item.action,
      description: item.entityLabel
        ? `${item.action.replace(/\./g, " ")} — ${item.entityLabel}`
        : item.action.replace(/\./g, " "),
      actorName: item.userName ?? "System",
      entityType: item.entityType,
      entityId: item.entityId,
      entityLabel: item.entityLabel,
      createdAt: item.createdAt,
    })),
  );
});

export default router;
