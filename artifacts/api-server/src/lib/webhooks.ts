import crypto from "crypto";
import { db, webhooksTable, webhookDeliveryLogsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";

export const WEBHOOK_EVENTS = [
  "form.submitted",
  "deal.stage_changed",
  "contact.created",
  "subscription.created",
  "subscription.updated",
  "automation.triggered",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Fire outbound webhooks for the given event, scoped to the user who owns them.
 * Only webhooks belonging to `userId` that subscribe to `event` are dispatched.
 */
export async function fireWebhook(
  event: WebhookEvent,
  payload: Record<string, unknown>,
  userId: number,
): Promise<void> {
  let hooks: (typeof webhooksTable.$inferSelect)[];
  try {
    hooks = await db
      .select()
      .from(webhooksTable)
      .where(and(
        eq(webhooksTable.isActive, true),
        eq(webhooksTable.userId, userId),
      ));
  } catch (err) {
    logger.error({ err }, "fireWebhook: failed to fetch webhooks");
    return;
  }

  const subscribed = hooks.filter((w) => (w.events as string[]).includes(event));
  for (const hook of subscribed) {
    void deliverWithRetry(hook, event, payload, 0, null);
  }
}

async function deliverWithRetry(
  hook: typeof webhooksTable.$inferSelect,
  event: string,
  payload: Record<string, unknown>,
  attempt: number,
  logId: number | null,
): Promise<void> {
  const body = JSON.stringify({
    event,
    data: payload,
    webhookId: hook.id,
    deliveredAt: new Date().toISOString(),
  });
  const sig = crypto
    .createHmac("sha256", hook.secret)
    .update(body)
    .digest("hex");

  let responseCode: number | null = null;
  let success = false;

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": `sha256=${sig}`,
        "X-Webhook-Event": event,
        "User-Agent": "DoubtlessCRM-Webhooks/1.0",
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);
    responseCode = resp.status;
    success = resp.status >= 200 && resp.status < 300;
  } catch (err) {
    logger.warn(
      { webhookId: hook.id, event, attempt, err: (err as Error).message },
      "Webhook delivery failed",
    );
  }

  let resolvedLogId = logId;
  try {
    if (attempt === 0) {
      // First attempt: insert a new log row and capture its ID for retries
      const [log] = await db.insert(webhookDeliveryLogsTable).values({
        webhookId: hook.id,
        event,
        payload,
        responseCode,
        attempts: 1,
        success,
        lastAttemptAt: new Date(),
      }).returning({ id: webhookDeliveryLogsTable.id });
      resolvedLogId = log?.id ?? null;
    } else if (resolvedLogId !== null) {
      // Subsequent attempts: update the exact row by its primary key
      await db
        .update(webhookDeliveryLogsTable)
        .set({
          responseCode,
          attempts: attempt + 1,
          success,
          lastAttemptAt: new Date(),
        })
        .where(eq(webhookDeliveryLogsTable.id, resolvedLogId));
    }
  } catch (err) {
    logger.error({ err }, "Failed to log webhook delivery");
  }

  if (!success && attempt < 2) {
    const delay = Math.pow(2, attempt) * 1000;
    setTimeout(() => {
      void deliverWithRetry(hook, event, payload, attempt + 1, resolvedLogId);
    }, delay);
  }
}
