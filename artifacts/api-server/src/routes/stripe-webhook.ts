import { type RequestHandler } from "express";
import { db, invoicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripe.js";
import { logger } from "../lib/logger.js";
import { notifyUsersWithPref } from "../lib/notify-email.js";

// POST /api/stripe/webhook
// Receives Stripe events with a raw body for signature verification.
// Requires STRIPE_WEBHOOK_SECRET env var in non-development environments.
export const stripeWebhookHandler: RequestHandler = async (req, res) => {
  const sig = req.headers["stripe-signature"] as string | undefined;
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  const isDev = process.env["NODE_ENV"] === "development";

  const stripe = await getUncachableStripeClient();
  if (!stripe) {
    logger.warn("Stripe webhook received but Stripe client unavailable");
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  let event;

  if (webhookSecret) {
    // Signing secret configured — always verify the signature
    if (!sig) {
      logger.warn("Stripe webhook received without stripe-signature header");
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
    } catch (err) {
      logger.warn({ err }, "Stripe webhook signature verification failed");
      res.status(400).json({ error: "Webhook signature verification failed" });
      return;
    }
  } else if (isDev) {
    // Development only: allow unsigned payloads when no secret is configured.
    // This path is intentionally blocked in production (see below).
    logger.warn("STRIPE_WEBHOOK_SECRET not set — accepting unsigned webhook in development mode");
    try {
      event = JSON.parse((req.body as Buffer).toString("utf8")) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  } else {
    // Production / staging without a webhook secret — reject immediately.
    logger.error("STRIPE_WEBHOOK_SECRET is not set in a non-development environment — webhook rejected");
    res.status(503).json({ error: "Webhook endpoint is not configured on this server" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      id: string;
      payment_status: string;
      metadata?: { invoiceId?: string; invoiceNumber?: string };
    };

    const invoiceIdStr = session.metadata?.invoiceId;
    if (!invoiceIdStr) {
      logger.info({ sessionId: session.id }, "Stripe checkout session completed — no invoiceId in metadata, skipping");
      res.json({ received: true });
      return;
    }

    const invoiceId = parseInt(invoiceIdStr);
    if (isNaN(invoiceId)) {
      logger.warn({ invoiceIdStr, sessionId: session.id }, "Invalid invoiceId in Stripe session metadata");
      res.json({ received: true });
      return;
    }

    if (session.payment_status !== "paid") {
      logger.info({ invoiceId, paymentStatus: session.payment_status }, "Checkout session completed but payment not yet paid");
      res.json({ received: true });
      return;
    }

    const [existing] = await db
      .select({ id: invoicesTable.id, status: invoicesTable.status, number: invoicesTable.number, stripeCheckoutSessionId: invoicesTable.stripeCheckoutSessionId })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .limit(1);

    if (!existing) {
      logger.warn({ invoiceId }, "Stripe webhook: invoice not found");
      res.json({ received: true });
      return;
    }

    if (existing.status === "paid") {
      logger.info({ invoiceId }, "Stripe webhook: invoice already paid, skipping update");
      res.json({ received: true });
      return;
    }

    // Log if this event came from a different session than the most recently stored one.
    // We do NOT reject on mismatch because clients may retry (multi-tab, expired session) and pay
    // an earlier valid session; Stripe signature verification already guarantees this is authentic.
    if (existing.stripeCheckoutSessionId && existing.stripeCheckoutSessionId !== session.id) {
      logger.info({ invoiceId, storedSessionId: existing.stripeCheckoutSessionId, paidSessionId: session.id }, "Stripe webhook: paid session differs from most recent stored session — accepting legitimate payment");
    }

    await db
      .update(invoicesTable)
      .set({ status: "paid", paidAt: new Date(), stripeCheckoutSessionId: session.id, updatedAt: new Date() })
      .where(eq(invoicesTable.id, invoiceId));

    logger.info({ invoiceId, sessionId: session.id }, "Invoice marked as paid via Stripe webhook");

    void notifyUsersWithPref(
      "portalMessage",
      `Invoice paid: ${existing.number}`,
      `Invoice <strong>${existing.number}</strong> has been paid via Stripe Checkout.`,
    );
  }

  res.json({ received: true });
};
