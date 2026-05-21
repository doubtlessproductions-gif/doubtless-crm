import { Router } from "express";
import { db, paymentLinksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";

const router = Router();

const CreatePaymentLinkBody = z.object({
  title: z.string().min(1),
  amount: z.number().positive(), // dollars, will convert to cents
  currency: z.string().default("usd"),
  dealId: z.number().optional().nullable(),
});

router.get("/", requireAuth, async (_req, res) => {
  const rows = await db.select().from(paymentLinksTable).orderBy(paymentLinksTable.createdAt);
  res.json(rows.map(formatLink));
});

router.post("/", requireAuth, async (req, res) => {
  const parse = CreatePaymentLinkBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { title, amount, currency, dealId } = parse.data;
  const amountCents = Math.round(amount * 100);

  let stripePaymentLinkId: string | null = null;
  let stripeUrl: string | null = null;

  // Try Stripe if available
  try {
    const { getUncachableStripeClient } = await import("../lib/stripe.js");
    const stripe = await getUncachableStripeClient();
    if (stripe) {
      const product = await stripe.products.create({ name: title });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: amountCents,
        currency,
      });
      const link = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }] });
      stripePaymentLinkId = link.id;
      stripeUrl = link.url;
    }
  } catch (err) {
    // Stripe not configured yet — save without it
  }

  const [row] = await db
    .insert(paymentLinksTable)
    .values({
      title,
      amount: amountCents,
      currency,
      dealId: dealId ?? null,
      stripePaymentLinkId,
      stripeUrl,
      status: "active",
      createdBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(formatLink(row!));
});

// ── POST /api/payments/import-external — add link without Stripe ─────────────
const ImportExternalBody = z.object({
  title: z.string().min(1),
  amount: z.number().min(0), // dollars
  currency: z.string().default("usd"),
  url: z.string().url().optional().nullable(),
  source: z.enum(["hubspot", "manual"]).default("manual"),
  description: z.string().optional().nullable(),
  dealId: z.number().optional().nullable(),
});

router.post("/import-external", requireAuth, async (req, res) => {
  const parse = ImportExternalBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { title, amount, currency, url, source, description, dealId } = parse.data;
  const [row] = await db.insert(paymentLinksTable).values({
    title,
    amount: Math.round(amount * 100),
    currency,
    stripeUrl: url ?? null,
    source,
    description: description ?? null,
    dealId: dealId ?? null,
    status: "active",
    createdBy: req.user!.userId,
  }).returning();
  res.status(201).json(formatLink(row!));
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  await db.delete(paymentLinksTable).where(eq(paymentLinksTable.id, id));
  res.status(204).end();
});

function formatLink(row: typeof paymentLinksTable.$inferSelect) {
  return {
    id: row.id,
    dealId: row.dealId,
    title: row.title,
    amount: row.amount / 100,
    currency: row.currency,
    stripePaymentLinkId: row.stripePaymentLinkId,
    stripeUrl: row.stripeUrl,
    status: row.status,
    description: row.description ?? null,
    source: row.source ?? "stripe",
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export default router;
