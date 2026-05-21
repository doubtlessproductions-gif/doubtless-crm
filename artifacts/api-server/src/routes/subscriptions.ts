import { Router } from "express";
import { z } from "zod/v4";
import { eq, desc } from "drizzle-orm";
import { db, subscriptionPlansTable, clientSubscriptionsTable, contactsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { auditLog } from "../lib/audit.js";
import { notifyAll } from "../lib/notify.js";
import { getUncachableStripeClient } from "../lib/stripe.js";
import { fireWebhook } from "../lib/webhooks.js";

const router = Router();

// ── Plans ─────────────────────────────────────────────────────────────────────

const planSchema = z.object({
  name:               z.string().min(1),
  description:        z.string().optional(),
  priceMonthly:       z.string().regex(/^\d+(\.\d{1,2})?$/),
  priceYearly:        z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  features:           z.array(z.string()).optional(),
  quotas:             z.record(z.string(), z.number()).optional(),
  isActive:           z.boolean().optional(),
});

router.get("/plans", requireAuth, async (_req, res) => {
  const plans = await db.select().from(subscriptionPlansTable).orderBy(desc(subscriptionPlansTable.createdAt));
  res.json(plans);
});

router.post("/plans", requireAuth, async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payload" }); return; }
  const d = parsed.data;

  let stripeProductId: string | null = null;
  let stripePriceMonthly: string | null = null;
  let stripePriceYearly: string | null = null;

  try {
    const stripeClient = await getUncachableStripeClient();
    if (stripeClient) {
      const product = await stripeClient.products.create({
        name: d.name,
        description: d.description ?? undefined,
      });
      stripeProductId = product.id;

      const monthly = await stripeClient.prices.create({
        product: product.id,
        unit_amount: Math.round(parseFloat(d.priceMonthly) * 100),
        currency: "usd",
        recurring: { interval: "month" },
      });
      stripePriceMonthly = monthly.id;

      if (d.priceYearly) {
        const yearly = await stripeClient.prices.create({
          product: product.id,
          unit_amount: Math.round(parseFloat(d.priceYearly) * 100),
          currency: "usd",
          recurring: { interval: "year" },
        });
        stripePriceYearly = yearly.id;
      }
    }
  } catch {
    // Stripe not configured — store plan without Stripe IDs
  }

  const [plan] = await db.insert(subscriptionPlansTable).values({
    name:               d.name,
    description:        d.description ?? null,
    priceMonthly:       d.priceMonthly,
    priceYearly:        d.priceYearly ?? null,
    features:           d.features ?? [],
    quotas:             d.quotas ?? {},
    stripeProductId,
    stripePriceMonthly,
    stripePriceYearly,
    isActive:           d.isActive ?? true,
  }).returning();

  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "subscription_plan.created", entityType: "subscription_plan", entityId: plan.id, entityLabel: plan.name, req });
  res.status(201).json(plan);
});

router.put("/plans/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payload" }); return; }
  const d = parsed.data;
  const [plan] = await db.update(subscriptionPlansTable).set({
    name:         d.name,
    description:  d.description ?? null,
    priceMonthly: d.priceMonthly,
    priceYearly:  d.priceYearly ?? null,
    features:     d.features ?? [],
    quotas:       d.quotas ?? {},
    isActive:     d.isActive ?? true,
    updatedAt:    new Date(),
  }).where(eq(subscriptionPlansTable.id, id)).returning();
  if (!plan) { res.status(404).json({ error: "Not found" }); return; }
  res.json(plan);
});

router.delete("/plans/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await db.update(subscriptionPlansTable).set({ isActive: false, updatedAt: new Date() }).where(eq(subscriptionPlansTable.id, id));
  res.json({ ok: true });
});

// ── Client Subscriptions ──────────────────────────────────────────────────────

const subscriptionSchema = z.object({
  contactId: z.number().int(),
  planId:    z.number().int(),
  interval:  z.enum(["monthly", "yearly"]).optional(),
  notes:     z.string().optional(),
});

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db
    .select({
      id:                 clientSubscriptionsTable.id,
      contactId:          clientSubscriptionsTable.contactId,
      contactName:        contactsTable.name,
      contactEmail:       contactsTable.email,
      planId:             clientSubscriptionsTable.planId,
      planName:           subscriptionPlansTable.name,
      priceMonthly:       subscriptionPlansTable.priceMonthly,
      priceYearly:        subscriptionPlansTable.priceYearly,
      status:             clientSubscriptionsTable.status,
      interval:           clientSubscriptionsTable.interval,
      currentPeriodStart: clientSubscriptionsTable.currentPeriodStart,
      currentPeriodEnd:   clientSubscriptionsTable.currentPeriodEnd,
      cancelAtPeriodEnd:  clientSubscriptionsTable.cancelAtPeriodEnd,
      notes:              clientSubscriptionsTable.notes,
      createdAt:          clientSubscriptionsTable.createdAt,
      stripeSubscriptionId: clientSubscriptionsTable.stripeSubscriptionId,
    })
    .from(clientSubscriptionsTable)
    .leftJoin(contactsTable, eq(clientSubscriptionsTable.contactId, contactsTable.id))
    .leftJoin(subscriptionPlansTable, eq(clientSubscriptionsTable.planId, subscriptionPlansTable.id))
    .orderBy(desc(clientSubscriptionsTable.createdAt));
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payload" }); return; }
  const d = parsed.data;

  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, d.planId)).limit(1);
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, d.contactId)).limit(1);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }

  const interval = d.interval ?? "monthly";
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + (interval === "yearly" ? 12 : 1));

  let stripeSubscriptionId: string | null = null;
  let stripeCustomerId: string | null = null;

  try {
    const stripeClient = await getUncachableStripeClient();
    const priceId = interval === "yearly" ? plan.stripePriceYearly : plan.stripePriceMonthly;
    if (stripeClient && priceId && contact.email) {
      const customer = await stripeClient.customers.create({ name: contact.name, email: contact.email ?? undefined });
      stripeCustomerId = customer.id;
      const sub = await stripeClient.subscriptions.create({
        customer: customer.id,
        items: [{ price: priceId }],
      });
      stripeSubscriptionId = sub.id;
    }
  } catch {
    // Stripe not fully configured
  }

  const [sub] = await db.insert(clientSubscriptionsTable).values({
    contactId:           d.contactId,
    planId:              d.planId,
    interval,
    status:              "active",
    currentPeriodStart:  now,
    currentPeriodEnd:    periodEnd,
    stripeSubscriptionId,
    stripeCustomerId,
    notes:               d.notes ?? null,
  }).returning();

  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "subscription.created", entityType: "subscription", entityId: sub.id, entityLabel: `${contact.name} → ${plan.name}`, req });
  void notifyAll(
    req.io ?? null,
    "subscription",
    "New retainer subscription",
    `${contact.name} subscribed to ${plan.name} (${interval})`,
    `/subscriptions`,
    req.user!.userId,
  );
  void fireWebhook("subscription.created", {
    subscriptionId: sub.id,
    contactId: d.contactId,
    contactName: contact.name,
    planId: d.planId,
    planName: plan.name,
    interval,
  }, req.user!.userId);
  res.status(201).json(sub);
});

router.patch("/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status as string;
  if (!["active", "past_due", "cancelled", "paused"].includes(status)) {
    res.status(400).json({ error: "Invalid status" }); return;
  }
  const [sub] = await db.update(clientSubscriptionsTable).set({ status, updatedAt: new Date() }).where(eq(clientSubscriptionsTable.id, id)).returning();
  if (!sub) { res.status(404).json({ error: "Not found" }); return; }

  void fireWebhook("subscription.updated", { subscriptionId: id, status }, req.user!.userId);
  if (status === "past_due" || status === "cancelled" || status === "active") {
    const [contact] = await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, sub.contactId)).limit(1);
    const [plan] = await db.select({ name: subscriptionPlansTable.name }).from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, sub.planId)).limit(1);
    const labels: Record<string, string> = { past_due: "past due", cancelled: "cancelled", active: "renewed/activated" };
    const titles: Record<string, string> = {
      past_due:  "Subscription past due",
      cancelled: "Subscription cancelled",
      active:    "Subscription renewed",
    };
    void notifyAll(
      req.io ?? null,
      "subscription",
      titles[status] ?? `Subscription ${labels[status] ?? status}`,
      `${contact?.name ?? "A client"}'s ${plan?.name ?? "subscription"} is now ${labels[status] ?? status}`,
      `/subscriptions`,
      req.user!.userId,
    );
  }

  res.json(sub);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await db.update(clientSubscriptionsTable).set({ status: "cancelled", cancelAtPeriodEnd: true, updatedAt: new Date() }).where(eq(clientSubscriptionsTable.id, id));
  res.json({ ok: true });
});

export default router;
