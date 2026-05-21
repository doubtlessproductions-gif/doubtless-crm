// Inbound webhook queue processor.
// Picks up "pending" queue items every 10 seconds, applies optimistic locking
// to prevent concurrent processing, runs the business logic, and marks items
// "done" or "failed".  Failed items are retried up to MAX_ATTEMPTS times.
import { db, webhookInboundQueueTable, contactsTable, dealsTable, activityTable } from "@workspace/db";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import { fireWebhook } from "./webhooks.js";
import { logger } from "./logger.js";

const MAX_ATTEMPTS = 3;

// ── Per-event Zod schemas ─────────────────────────────────────────────────────

const NewLeadPayload = z.object({
  name:    z.string().min(1),
  email:   z.string().email().optional(),
  phone:   z.string().optional(),
  company: z.string().optional(),
  notes:   z.string().optional(),
  tags:    z.array(z.string()).optional().default([]),
});

const PipelinePayload = z.object({
  dealId: z.number().int().positive(),
  stage:  z.string().min(1),
  value:  z.number().optional(),
  notes:  z.string().optional(),
});

const SubscriptionPayload = z.object({
  event:     z.enum(["subscription.created", "subscription.updated"]),
  contactId: z.number().int().positive().optional(),
  planId:    z.number().int().positive().optional(),
  amount:    z.number().optional(),
  metadata:  z.record(z.unknown()).optional(),
});

const AutomationPayload = z.object({
  trigger:    z.string().min(1),
  entityId:   z.number().int().positive().optional(),
  entityType: z.string().optional(),
  metadata:   z.record(z.unknown()).optional(),
});

const TeamActivityPayload = z.object({
  type:        z.string().min(1),
  description: z.string().min(1),
});

// ── Business logic dispatcher ─────────────────────────────────────────────────

async function dispatch(item: typeof webhookInboundQueueTable.$inferSelect): Promise<void> {
  const { event, payload, userId } = item;

  switch (event) {
    case "new-lead": {
      const p = NewLeadPayload.parse(payload);
      const [contact] = await db.insert(contactsTable).values({
        name:      p.name,
        email:     p.email   ?? null,
        phone:     p.phone   ?? null,
        company:   p.company ?? null,
        notes:     p.notes   ?? null,
        tags:      p.tags    ?? [],
        createdBy: userId,
      }).returning();
      logger.info({ contactId: contact!.id, userId }, "Webhook queue: new-lead contact created");
      void fireWebhook("contact.created", {
        id: contact!.id, name: p.name, email: p.email ?? null, company: p.company ?? null,
      }, userId);
      break;
    }

    case "pipeline": {
      const p = PipelinePayload.parse(payload);
      const [deal] = await db.update(dealsTable)
        .set({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stage: p.stage as any,
          ...(p.value !== undefined ? { value: String(p.value) } : {}),
          ...(p.notes !== undefined ? { notes: p.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(dealsTable.id, p.dealId))
        .returning({ id: dealsTable.id, title: dealsTable.title, stage: dealsTable.stage });
      if (!deal) throw new Error(`Deal ${p.dealId} not found`);
      logger.info({ dealId: p.dealId, stage: p.stage, userId }, "Webhook queue: pipeline deal updated");
      void fireWebhook("deal.stage_changed", { dealId: p.dealId, stage: p.stage, title: deal.title }, userId);
      break;
    }

    case "subscriptions": {
      const p = SubscriptionPayload.parse(payload);
      logger.info({ event: p.event, userId }, "Webhook queue: subscription event");
      void fireWebhook(p.event, {
        contactId: p.contactId ?? null,
        planId:    p.planId   ?? null,
        amount:    p.amount   ?? null,
        metadata:  p.metadata ?? {},
      }, userId);
      break;
    }

    case "automation": {
      const p = AutomationPayload.parse(payload);
      await db.insert(activityTable).values({
        userId,
        type:        "automation.inbound",
        description: `Inbound trigger: ${p.trigger}${p.entityType ? ` on ${p.entityType}` : ""}${p.entityId ? ` #${p.entityId}` : ""}`,
      });
      logger.info({ trigger: p.trigger, userId }, "Webhook queue: automation trigger logged");
      void fireWebhook("automation.triggered", {
        trigger:    p.trigger,
        entityId:   p.entityId   ?? null,
        entityType: p.entityType ?? null,
        metadata:   p.metadata   ?? {},
      }, userId);
      break;
    }

    case "team-activity": {
      const p = TeamActivityPayload.parse(payload);
      await db.insert(activityTable).values({ userId, type: p.type, description: p.description });
      logger.info({ type: p.type, userId }, "Webhook queue: team-activity logged");
      break;
    }

    default:
      throw new Error(`Unknown webhook event type: "${event}"`);
  }
}

// ── Queue processor loop ──────────────────────────────────────────────────────

async function processQueue(): Promise<void> {
  const pending = await db
    .select()
    .from(webhookInboundQueueTable)
    .where(
      and(
        eq(webhookInboundQueueTable.status, "pending"),
        lt(webhookInboundQueueTable.attempts, MAX_ATTEMPTS),
      ),
    )
    .limit(20);

  if (pending.length === 0) return;
  logger.info({ count: pending.length }, "Webhook queue: processing batch");

  for (const item of pending) {
    // Optimistic lock — flip to "processing" so concurrent worker instances skip it
    const [locked] = await db
      .update(webhookInboundQueueTable)
      .set({ status: "processing", attempts: item.attempts + 1 })
      .where(
        and(
          eq(webhookInboundQueueTable.id, item.id),
          eq(webhookInboundQueueTable.status, "pending"),
        ),
      )
      .returning({ id: webhookInboundQueueTable.id });

    if (!locked) continue; // Another instance beat us to it

    try {
      await dispatch(item);
      await db
        .update(webhookInboundQueueTable)
        .set({ status: "done", processedAt: new Date() })
        .where(eq(webhookInboundQueueTable.id, item.id));
      logger.info({ id: item.id, event: item.event }, "Webhook queue: item done");
    } catch (err) {
      const isFinal = item.attempts + 1 >= MAX_ATTEMPTS;
      await db
        .update(webhookInboundQueueTable)
        .set({
          status:    isFinal ? "failed" : "pending",
          lastError: String(err),
        })
        .where(eq(webhookInboundQueueTable.id, item.id));
      logger.error(
        { err, id: item.id, event: item.event, attempt: item.attempts + 1, isFinal },
        "Webhook queue: item failed",
      );
    }
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

export function startWebhookQueueWorker(): void {
  setInterval(() => { void processQueue(); }, 10_000);
  logger.info("Webhook queue worker started (every 10 s)");
}
