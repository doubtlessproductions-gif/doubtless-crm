import { Router } from "express";
import crypto from "crypto";
import { db, webhooksTable, webhookDeliveryLogsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { WEBHOOK_EVENTS } from "../lib/webhooks.js";
import { logger } from "../lib/logger.js";

const router = Router();

const WebhookBody = z.object({
  url:      z.string().url("Must be a valid URL"),
  secret:   z.string().min(8).max(256).optional(),
  events:   z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Select at least one event"),
  isActive: z.boolean().optional().default(true),
});

// ── GET /api/webhooks ─────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const rows = await db
    .select({
      id:        webhooksTable.id,
      url:       webhooksTable.url,
      events:    webhooksTable.events,
      isActive:  webhooksTable.isActive,
      createdAt: webhooksTable.createdAt,
      updatedAt: webhooksTable.updatedAt,
    })
    .from(webhooksTable)
    .where(eq(webhooksTable.userId, req.user!.userId))
    .orderBy(desc(webhooksTable.createdAt));
  res.json(rows);
});

// ── POST /api/webhooks ────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const parse = WebhookBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const secret = parse.data.secret ?? crypto.randomBytes(32).toString("hex");

  const [hook] = await db.insert(webhooksTable).values({
    userId:   req.user!.userId,
    url:      parse.data.url,
    secret,
    events:   parse.data.events,
    isActive: parse.data.isActive ?? true,
  }).returning();

  logger.info({ webhookId: hook!.id, userId: req.user!.userId }, "Webhook created");
  res.status(201).json({ ...hook, secret });
});

// ── POST /api/webhooks/sign ───────────────────────────────────────────────────
// Authenticated helper: computes HMAC-SHA256 of an arbitrary body string using
// the server's WEBHOOK_SECRET so callers can produce the X-Webhook-Signature header.
const SignBody = z.object({ body: z.string().min(1, "Body must not be empty") });

router.post("/sign", requireAuth, (req, res) => {
  const secret = process.env["WEBHOOK_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "WEBHOOK_SECRET is not configured on the server" });
    return;
  }
  const parse = SignBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(parse.data.body).digest("hex");
  res.json({ signature: sig });
});

// ── GET /api/webhooks/:id ─────────────────────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [hook] = await db.select().from(webhooksTable)
    .where(eq(webhooksTable.id, id)).limit(1);
  if (!hook || hook.userId !== req.user!.userId) { res.status(404).json({ error: "Not found" }); return; }
  res.json(hook);
});

// ── PUT /api/webhooks/:id ─────────────────────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = WebhookBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [existing] = await db.select({ userId: webhooksTable.userId })
    .from(webhooksTable).where(eq(webhooksTable.id, id)).limit(1);
  if (!existing || existing.userId !== req.user!.userId) { res.status(404).json({ error: "Not found" }); return; }

  const [hook] = await db.update(webhooksTable)
    .set({
      url:       parse.data.url,
      events:    parse.data.events,
      isActive:  parse.data.isActive ?? true,
      updatedAt: new Date(),
    })
    .where(eq(webhooksTable.id, id))
    .returning();

  res.json(hook);
});

// ── DELETE /api/webhooks/:id ──────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ userId: webhooksTable.userId })
    .from(webhooksTable).where(eq(webhooksTable.id, id)).limit(1);
  if (!existing || existing.userId !== req.user!.userId) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(webhooksTable).where(eq(webhooksTable.id, id));
  res.status(204).send();
});

// ── GET /api/webhooks/:id/logs ────────────────────────────────────────────────
router.get("/:id/logs", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [hook] = await db.select({ userId: webhooksTable.userId })
    .from(webhooksTable).where(eq(webhooksTable.id, id)).limit(1);
  if (!hook || hook.userId !== req.user!.userId) { res.status(404).json({ error: "Not found" }); return; }

  const logs = await db.select().from(webhookDeliveryLogsTable)
    .where(eq(webhookDeliveryLogsTable.webhookId, id))
    .orderBy(desc(webhookDeliveryLogsTable.lastAttemptAt))
    .limit(50);

  res.json(logs);
});

// ── POST /api/webhooks/:id/ping ───────────────────────────────────────────────
router.post("/:id/ping", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [hook] = await db.select().from(webhooksTable)
    .where(eq(webhooksTable.id, id)).limit(1);
  if (!hook || hook.userId !== req.user!.userId) { res.status(404).json({ error: "Not found" }); return; }

  const body = JSON.stringify({
    event: "ping",
    data: { message: "Test delivery from CRM" },
    webhookId: hook.id,
    deliveredAt: new Date().toISOString(),
  });

  const sig = crypto
    .createHmac("sha256", hook.secret)
    .update(body)
    .digest("hex");

  let responseCode: number | null = null;
  let success = false;
  let errorMessage: string | null = null;

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const resp = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": `sha256=${sig}`,
        "X-Webhook-Event": "ping",
        "User-Agent": "DoubtlessCRM-Webhooks/1.0",
      },
      body,
      signal: ctrl.signal,
    });
    responseCode = resp.status;
    success = resp.status >= 200 && resp.status < 300;
  } catch (err) {
    errorMessage = (err as Error).message;
    logger.warn({ webhookId: id, err: errorMessage }, "Webhook ping delivery failed");
  } finally {
    clearTimeout(timeoutId);
  }

  try {
    await db.insert(webhookDeliveryLogsTable).values({
      webhookId: hook.id,
      event: "ping",
      payload: { message: "Test delivery from CRM" },
      responseCode,
      attempts: 1,
      success,
      lastAttemptAt: new Date(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to log webhook ping");
  }

  logger.info({ webhookId: id, success, responseCode }, "Webhook test ping sent");
  res.json({ success, responseCode, error: errorMessage });
});

// ── POST /api/webhooks/:id/regenerate-secret ──────────────────────────────────
router.post("/:id/regenerate-secret", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ userId: webhooksTable.userId })
    .from(webhooksTable).where(eq(webhooksTable.id, id)).limit(1);
  if (!existing || existing.userId !== req.user!.userId) { res.status(404).json({ error: "Not found" }); return; }

  const secret = crypto.randomBytes(32).toString("hex");
  const [hook] = await db.update(webhooksTable)
    .set({ secret, updatedAt: new Date() })
    .where(eq(webhooksTable.id, id))
    .returning();

  res.json({ ...hook, secret });
});

export default router;
