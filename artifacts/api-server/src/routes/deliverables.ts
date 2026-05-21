import { Router, type RequestHandler } from "express";
import { db, deliverablesTable, deliverableCommentsTable, dealsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { notifyAll } from "../lib/notify.js";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { Readable } from "stream";
import { z } from "zod";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ── Allowed MIME types ────────────────────────────────────────────────────────

const ALLOWED_MIME = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/aac",
  "audio/flac",
  "audio/x-flac",
  "audio/ogg",
  "audio/mp4",
]);

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

// ── Upload intents (in-memory, cleared on restart) ───────────────────────────
// When request-upload is called the server records a one-time intent keyed by
// the storageKey it generated. The confirm step verifies that the supplied
// storageKey was actually issued by this server for this dealId + uploader,
// preventing authenticated users from self-publishing arbitrary storage keys.

interface UploadIntent {
  storageKey: string;
  dealId: number;
  uploaderId: number;
  mimeType: string;
  sizeBytes: number;
  expiresAt: Date; // 15-min window to finish the GCS upload + confirm call
}
const pendingUploads = new Map<string, UploadIntent>();

function storeUploadIntent(intent: UploadIntent): void {
  pendingUploads.set(intent.storageKey, intent);
  // Lazy eviction of stale intents
  if (pendingUploads.size > 2000) {
    const now = new Date();
    for (const [k, v] of pendingUploads) {
      if (v.expiresAt < now) pendingUploads.delete(k);
    }
  }
}

function claimUploadIntent(storageKey: string, dealId: number, uploaderId: number): UploadIntent | null {
  const intent = pendingUploads.get(storageKey);
  if (!intent) return null;
  // Always delete — one-time use
  pendingUploads.delete(storageKey);
  if (intent.expiresAt < new Date()) return null;
  if (intent.dealId !== dealId || intent.uploaderId !== uploaderId) return null;
  return intent;
}

// ── Short-lived stream tokens (in-memory, cleared on restart) ─────────────────
interface StreamTokenEntry {
  deliverableId: number;
  expiresAt: Date;
}
const streamTokenCache = new Map<string, StreamTokenEntry>();

function issueStreamToken(deliverableId: number): string {
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min TTL
  streamTokenCache.set(token, { deliverableId, expiresAt });
  if (streamTokenCache.size > 5000) {
    const now = new Date();
    for (const [k, v] of streamTokenCache) {
      if (v.expiresAt < now) streamTokenCache.delete(k);
    }
  }
  return token;
}

function validateStreamToken(token: string, deliverableId: number): boolean {
  const entry = streamTokenCache.get(token);
  if (!entry) return false;
  if (entry.expiresAt < new Date()) { streamTokenCache.delete(token); return false; }
  return entry.deliverableId === deliverableId;
}

// ── Zod schemas ───────────────────────────────────────────────────────────────

const RequestUploadBody = z.object({
  name: z.string().min(1).max(500),
  size: z.number().int().positive().max(MAX_BYTES, "File exceeds 500 MB limit"),
  contentType: z.string().min(1).max(200),
});

const ConfirmUploadBody = z.object({
  originalName: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_BYTES),
  storageKey: z.string().min(1).max(1000),
});

const ShareActionBody = z.object({
  sharePassword: z.string().max(100).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const ShareConfigBody = z.object({
  sharePassword: z.string().max(100).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const CommentBody = z.object({
  authorName: z.string().min(1).max(200),
  authorEmail: z.string().email().max(300).optional().or(z.literal("")),
  timestampSeconds: z.number().int().min(0).optional(),
  body: z.string().min(1).max(5000),
  sharePassword: z.string().max(100).optional(),
});

const UpdateStatusBody = z.object({
  status: z.enum(["uploaded", "shared", "approved"]),
});

const ApproveBody = z.object({
  approverName: z.string().min(1).max(200),
  sharePassword: z.string().max(100).optional(),
});

function generateToken(): string {
  return randomBytes(20).toString("hex");
}

function shareUrl(token: string): string {
  const domain = process.env["REPLIT_DEV_DOMAIN"];
  const base = domain ? `https://${domain}` : "http://localhost";
  return `${base}/deliver/${token}`;
}

function isExpired(row: typeof deliverablesTable.$inferSelect): boolean {
  return !!(row.expiresAt && row.expiresAt < new Date());
}

function sanitize(row: typeof deliverablesTable.$inferSelect) {
  return {
    ...row,
    expired: isExpired(row),
    shareUrl: row.shareToken ? shareUrl(row.shareToken) : null,
    sharePassword: row.sharePassword ? "••••••••" : null,
  };
}

// ── Deal-scoped authenticated routes ─────────────────────────────────────────

/**
 * POST /api/deals/:dealId/deliverables/request-upload
 * Server-enforced MIME type and 500 MB size validation.
 * Returns a presigned PUT URL and the normalized storage key.
 */
router.post("/deals/:dealId/deliverables/request-upload", requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (isNaN(dealId)) { res.status(400).json({ error: "Invalid dealId" }); return; }

  const parsed = RequestUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { name, size, contentType } = parsed.data;

  if (!ALLOWED_MIME.has(contentType)) {
    res.status(415).json({ error: "Unsupported file type. Only video and audio files are accepted." });
    return;
  }
  if (size > MAX_BYTES) {
    res.status(413).json({ error: "File exceeds the 500 MB limit." });
    return;
  }

  try {
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    const { uploadURL, storageKey } = await objectStorageService.getDeliverableUploadURL(dealId, ext);

    // Record a signed intent so the confirm step can verify the storageKey
    // was genuinely issued by this server for this dealId + uploader.
    storeUploadIntent({
      storageKey,
      dealId,
      uploaderId: req.user!.userId,
      mimeType: contentType,
      sizeBytes: size,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min window
    });

    res.json({ uploadURL, storageKey });
  } catch (err) {
    req.log.error({ err }, "Failed to generate deliverable upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * POST /api/deals/:dealId/deliverables
 * Confirms an upload by saving the deliverable record.
 * Server re-validates MIME type and size for defence-in-depth.
 */
router.post("/deals/:dealId/deliverables", requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (isNaN(dealId)) { res.status(400).json({ error: "Invalid dealId" }); return; }

  const parsed = ConfirmUploadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const { originalName, mimeType, sizeBytes, storageKey } = parsed.data;

  // Verify the storageKey was issued by this server for this deal + uploader
  const intent = claimUploadIntent(storageKey, dealId, req.user!.userId);
  if (!intent) {
    res.status(403).json({ error: "Invalid or expired upload intent. Please start a new upload." });
    return;
  }

  // Cross-check claimed metadata against what the server approved
  if (!ALLOWED_MIME.has(mimeType) || !ALLOWED_MIME.has(intent.mimeType)) {
    res.status(415).json({ error: "Unsupported file type." }); return;
  }
  if (sizeBytes > MAX_BYTES || intent.sizeBytes > MAX_BYTES) {
    res.status(413).json({ error: "File exceeds the 500 MB limit." }); return;
  }

  // No shareToken yet — sharing is an explicit CRM action (POST .../share)
  const [row] = await db.insert(deliverablesTable).values({
    dealId,
    filename: originalName,
    originalName,
    mimeType,
    sizeBytes,
    storageKey,
    status: "uploaded",
    uploadedBy: req.user!.userId,
  }).returning();

  void notifyAll(
    req.io ?? null,
    "deliverable",
    "New deliverable uploaded",
    `${originalName} uploaded for deal #${dealId}`,
    `/pipeline`,
    req.user!.userId,
  );

  res.status(201).json(sanitize(row));
});

/**
 * GET /api/deals/:dealId/deliverables
 * List all deliverables for a deal.
 */
router.get("/deals/:dealId/deliverables", requireAuth, async (req, res) => {
  const dealId = Number(req.params.dealId);
  if (isNaN(dealId)) { res.status(400).json({ error: "Invalid dealId" }); return; }

  const rows = await db
    .select()
    .from(deliverablesTable)
    .where(eq(deliverablesTable.dealId, dealId))
    .orderBy(desc(deliverablesTable.createdAt));

  res.json(rows.map(sanitize));
});

// ── Single-resource authenticated routes ─────────────────────────────────────

/**
 * POST /api/deals/:dealId/deliverables/:id/share
 * Explicit CRM share action: generates/rotates shareToken, hashes password,
 * sets status → "shared". Owner or admin only.
 */
router.post("/deals/:dealId/deliverables/:id/share", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const dealId = Number(req.params.dealId);
  if (isNaN(id) || isNaN(dealId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = ShareActionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data" }); return; }

  const [existing] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.dealId !== dealId) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.uploadedBy !== req.user!.userId && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const hashedPassword = parsed.data.sharePassword
    ? await bcrypt.hash(parsed.data.sharePassword, 10)
    : null;

  const updates: Partial<typeof deliverablesTable.$inferInsert> = {
    shareToken: generateToken(),
    status: "shared",
    sharePassword: hashedPassword,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : existing.expiresAt,
    updatedAt: new Date(),
  };

  const [row] = await db.update(deliverablesTable).set(updates).where(eq(deliverablesTable.id, id)).returning();
  res.json(sanitize(row));
});

/** PATCH /api/deliverables/:id/share — update password and/or expiry after sharing (owner or admin) */
router.patch("/deliverables/:id/share", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = ShareConfigBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data" }); return; }

  const [existing] = await db.select().from(deliverablesTable).where(eq(deliverablesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.uploadedBy !== req.user!.userId && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const updates: Partial<typeof deliverablesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.sharePassword !== undefined) {
    updates.sharePassword = parsed.data.sharePassword
      ? await bcrypt.hash(parsed.data.sharePassword, 10)
      : null;
  }
  if (parsed.data.expiresAt !== undefined) {
    updates.expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  }

  const [row] = await db.update(deliverablesTable).set(updates).where(eq(deliverablesTable.id, id)).returning();
  res.json(sanitize(row));
});

/** PATCH /api/deliverables/:id/status — update status (owner or admin) */
router.patch("/deliverables/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid status" }); return; }

  const [existing] = await db.select().from(deliverablesTable).where(eq(deliverablesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.uploadedBy !== req.user!.userId && req.user!.role !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [row] = await db.update(deliverablesTable)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(deliverablesTable.id, id))
    .returning();
  res.json(sanitize(row));
});

/** DELETE /api/deliverables/:id — owner or admin only */
router.delete("/deliverables/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(deliverablesTable).where(eq(deliverablesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.uploadedBy !== req.user!.userId && !["owner", "admin", "manager"].includes(req.user!.role ?? "")) {
    res.status(403).json({ error: "Forbidden: only the uploader or an admin may delete" }); return;
  }

  await db.delete(deliverablesTable).where(eq(deliverablesTable.id, id));
  res.json({ ok: true });
});

/**
 * GET /api/deliverables/:id/comments — admin/manager only view of client comments
 */
router.get("/deliverables/:id/comments", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const comments = await db.select().from(deliverableCommentsTable)
    .where(eq(deliverableCommentsTable.deliverableId, id))
    .orderBy(deliverableCommentsTable.createdAt);
  res.json(comments);
});

// ── Public share-token handlers (named so they can be dual-registered) ────────

/**
 * GET /api/deliverables/share/:token  (also aliased to GET /api/deliver/:token)
 * Returns metadata including deal title and expired flag.
 */
const handleShareMeta: RequestHandler = async (req, res) => {
  const [row] = await db
    .select({
      id: deliverablesTable.id,
      originalName: deliverablesTable.originalName,
      mimeType: deliverablesTable.mimeType,
      sizeBytes: deliverablesTable.sizeBytes,
      status: deliverablesTable.status,
      createdAt: deliverablesTable.createdAt,
      sharePassword: deliverablesTable.sharePassword,
      expiresAt: deliverablesTable.expiresAt,
      shareToken: deliverablesTable.shareToken,
      dealTitle: dealsTable.title,
    })
    .from(deliverablesTable)
    .leftJoin(dealsTable, eq(deliverablesTable.dealId, dealsTable.id))
    .where(eq(deliverablesTable.shareToken, req.params["token"] as string))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const expired = !!(row.expiresAt && row.expiresAt < new Date());

  res.json({
    id: row.id,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt,
    dealTitle: row.dealTitle ?? null,
    hasPassword: !!row.sharePassword,
    expired,
  });
};

/**
 * POST /api/deliverables/share/:token/stream-token
 * Validates password (if any) and issues a short-lived stream token.
 */
const handleStreamToken: RequestHandler = async (req, res) => {
  const [row] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.shareToken, req.params["token"] as string))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.expiresAt && row.expiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired" }); return;
  }

  if (row.sharePassword) {
    const { password } = req.body ?? {};
    const ok = password && await bcrypt.compare(String(password), row.sharePassword);
    if (!ok) { res.status(403).json({ error: "Wrong password" }); return; }
  }

  res.json({ streamToken: issueStreamToken(row.id) });
};

/**
 * GET /api/deliverables/share/:token/stream?t=<streamToken>
 * Streams the file; requires a valid short-lived stream token.
 */
const handleStream: RequestHandler = async (req, res) => {
  const [row] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.shareToken, req.params["token"] as string))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.expiresAt && row.expiresAt < new Date()) { res.status(410).json({ error: "Expired" }); return; }

  const streamToken = req.query["t"] as string | undefined;
  if (!streamToken || !validateStreamToken(streamToken, row.id)) {
    res.status(403).json({ error: "Invalid or expired stream token" }); return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(row.storageKey);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "File not found in storage" }); return;
    }
    req.log.error({ err }, "Stream error");
    res.status(500).json({ error: "Stream failed" });
  }
};

/**
 * POST /api/deliverables/share/:token/approve
 * Client approval — sets status to "approved" and records an approval comment.
 */
const handleApprove: RequestHandler = async (req, res) => {
  const [row] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.shareToken, req.params["token"] as string))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.expiresAt && row.expiresAt < new Date()) { res.status(410).json({ error: "Expired" }); return; }

  const parsed = ApproveBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "approverName is required" }); return; }
  const { approverName, sharePassword } = parsed.data;

  if (row.sharePassword) {
    const ok = sharePassword && await bcrypt.compare(sharePassword, row.sharePassword);
    if (!ok) { res.status(403).json({ error: "Wrong password" }); return; }
  }

  const [updated] = await db.update(deliverablesTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(deliverablesTable.id, row.id))
    .returning();

  await db.insert(deliverableCommentsTable).values({
    deliverableId: row.id,
    authorName: approverName,
    body: "✓ Approved this deliverable.",
    timestampSeconds: null,
  });

  res.json({ status: updated.status });
};

/** POST /api/deliverables/share/:token/comments — public comment submission */
const handlePostComment: RequestHandler = async (req, res) => {
  const [row] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.shareToken, req.params["token"] as string))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.expiresAt && row.expiresAt < new Date()) { res.status(410).json({ error: "Expired" }); return; }

  const parsed = CommentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid data" }); return; }
  const { authorName, authorEmail, timestampSeconds, body, sharePassword } = parsed.data;

  if (row.sharePassword) {
    const ok = sharePassword && await bcrypt.compare(sharePassword, row.sharePassword);
    if (!ok) { res.status(403).json({ error: "Wrong password" }); return; }
  }

  const [comment] = await db.insert(deliverableCommentsTable).values({
    deliverableId: row.id,
    authorName,
    authorEmail: authorEmail || null,
    timestampSeconds: timestampSeconds ?? null,
    body,
  }).returning();

  res.status(201).json(comment);
};

/**
 * GET /api/deliverables/share/:token/comments — public comment listing.
 * Password-protected links require a valid stream token as ?t=<token>.
 */
const handleGetComments: RequestHandler = async (req, res) => {
  const [row] = await db.select().from(deliverablesTable)
    .where(eq(deliverablesTable.shareToken, req.params["token"] as string))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  if (row.expiresAt && row.expiresAt < new Date()) {
    res.status(410).json({ error: "This share link has expired" }); return;
  }

  if (row.sharePassword) {
    const streamToken = req.query["t"] as string | undefined;
    if (!streamToken || !validateStreamToken(streamToken, row.id)) {
      res.status(403).json({ error: "A valid stream token is required to view comments on a protected link" });
      return;
    }
  }

  const comments = await db.select().from(deliverableCommentsTable)
    .where(eq(deliverableCommentsTable.deliverableId, row.id))
    .orderBy(deliverableCommentsTable.createdAt);
  res.json(comments);
};

// ── Register public share routes on both canonical and /deliver/ alias paths ──

router.get("/deliverables/share/:token",                handleShareMeta);
router.get("/deliver/:token",                           handleShareMeta);

router.post("/deliverables/share/:token/stream-token",  handleStreamToken);
router.post("/deliver/:token/stream-token",             handleStreamToken);

router.get("/deliverables/share/:token/stream",         handleStream);
router.get("/deliver/:token/stream",                    handleStream);

router.post("/deliverables/share/:token/approve",       handleApprove);
router.post("/deliver/:token/approve",                  handleApprove);

router.post("/deliverables/share/:token/comments",      handlePostComment);
router.post("/deliver/:token/comments",                 handlePostComment);

router.get("/deliverables/share/:token/comments",       handleGetComments);
router.get("/deliver/:token/comments",                  handleGetComments);

export default router;
