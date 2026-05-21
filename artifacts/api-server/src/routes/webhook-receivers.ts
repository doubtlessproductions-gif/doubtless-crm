import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import { db, apiKeysTable, webhookInboundQueueTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = express.Router();

// ── API key resolver ──────────────────────────────────────────────────────────

async function resolveApiKey(authHeader: string | undefined): Promise<number | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7);
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const [key] = await db
    .select({ userId: apiKeysTable.userId, revokedAt: apiKeysTable.revokedAt })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, keyHash))
    .limit(1);
  if (!key || key.revokedAt) return null;
  return key.userId;
}

// ── Middleware: structured request logging ────────────────────────────────────

function inboundLogger(req: Request, _res: Response, next: NextFunction): void {
  logger.info(
    {
      method:     req.method,
      path:       req.path,
      deliveryId: req.headers["x-webhook-delivery-id"] ?? null,
      ip:         req.ip,
    },
    "Inbound webhook received",
  );
  next();
}

// ── Middleware: HMAC-SHA256 signature verification ────────────────────────────
// Caller must include: X-Webhook-Signature: sha256=<hmac-sha256-hex-of-raw-body>
// If WEBHOOK_SECRET is not configured the check is skipped (development mode).

function verifySignature(
  req: Request & { rawBody?: Buffer },
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env["WEBHOOK_SECRET"];
  if (!secret) { next(); return; }

  const header = req.headers["x-webhook-signature"];
  // Signature is optional — if omitted the Bearer token in enqueue() handles auth.
  // If provided it MUST be correct (prevents spoofed payloads on public endpoints).
  if (!header) { next(); return; }

  const raw = req.rawBody;
  if (!raw) {
    res.status(400).json({ error: "Cannot read raw body for signature verification" });
    return;
  }

  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const actual   = String(header);

  let valid = false;
  try {
    valid =
      actual.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  } catch {
    valid = false;
  }

  if (!valid) {
    logger.warn({ path: req.path }, "Inbound webhook: invalid signature — rejected");
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }
  next();
}

// ── Middleware: idempotency / retry deduplication ─────────────────────────────
// If X-Webhook-Delivery-Id was already seen (any status), respond 200 immediately.

async function checkIdempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const deliveryId = req.headers["x-webhook-delivery-id"];
  if (!deliveryId) { next(); return; }

  const [existing] = await db
    .select({ status: webhookInboundQueueTable.status })
    .from(webhookInboundQueueTable)
    .where(eq(webhookInboundQueueTable.deliveryId, String(deliveryId)))
    .limit(1);

  if (existing) {
    logger.info(
      { deliveryId, status: existing.status },
      "Inbound webhook: duplicate delivery — skipped",
    );
    res.json({ success: true, queued: false, reason: "duplicate" });
    return;
  }
  next();
}

// ── Shared enqueue handler (runs after per-route middleware stack) ────────────

async function enqueue(req: Request, res: Response, event: string): Promise<void> {
  const userId = await resolveApiKey(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  const deliveryId = req.headers["x-webhook-delivery-id"]
    ? String(req.headers["x-webhook-delivery-id"])
    : null;

  await db.insert(webhookInboundQueueTable).values({
    deliveryId,
    event,
    payload:  req.body as Record<string, unknown>,
    userId,
    status:   "pending",
  });

  logger.info({ event, deliveryId, userId }, "Inbound webhook: enqueued");
  res.status(202).json({ success: true, queued: true, event });
}

// ── Routes — middleware applied per-route so it only fires on exact paths ─────
// (router.use() would fire on ALL /api/webhooks/* including outbound CRUD routes)

const inboundStack = [
  inboundLogger,
  verifySignature as express.RequestHandler,
  checkIdempotency,
];

router.post("/new-lead",      ...inboundStack, (req, res) => enqueue(req, res, "new-lead"));
router.post("/pipeline",      ...inboundStack, (req, res) => enqueue(req, res, "pipeline"));
router.post("/subscriptions", ...inboundStack, (req, res) => enqueue(req, res, "subscriptions"));
router.post("/automation",    ...inboundStack, (req, res) => enqueue(req, res, "automation"));
router.post("/team-activity", ...inboundStack, (req, res) => enqueue(req, res, "team-activity"));

export default router;
