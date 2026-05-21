import { Router } from "express";
import multer from "multer";
import { tmpdir } from "os";
import { extname } from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { Readable } from "stream";
import { z } from "zod/v4";
import { eq, and, desc } from "drizzle-orm";
import { db, videoProjectsTable, portalUsersTable, portalNotificationsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { processVideoForWatermark } from "../lib/ffmpeg.js";
import { getUncachableStripeClient } from "../lib/stripe.js";

const router = Router();
const storage = new ObjectStorageService();

// ── Multer (disk storage — needed for FFmpeg) ─────────────────────────────────

const videoUpload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname) || ".mp4";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const allowed = ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/mpeg", "video/x-matroska"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Validation ────────────────────────────────────────────────────────────────

const VideoProjectBody = z.object({
  title:              z.string().min(1),
  description:        z.string().optional(),
  releaseId:          z.coerce.number().int().positive().optional(),
  artistId:           z.coerce.number().int().positive().optional(),
  contactId:          z.coerce.number().int().positive().optional(),
  invoiceAmountCents: z.coerce.number().int().positive().optional(),
});

const VideoInvoiceBody = z.object({
  amountCents:   z.coerce.number().int().positive(),
  description:   z.string().optional(),
  customerEmail: z.string().email().optional(),
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function processAndStore(videoProjectId: number, inputPath: string, sizeBytes: number) {
  try {
    await db.update(videoProjectsTable)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(videoProjectsTable.id, videoProjectId));

    const result = await processVideoForWatermark(inputPath, videoProjectId);

    const uid = randomUUID();
    const [watermarkedKey, previewKey, thumbnailKey] = await Promise.all([
      storage.uploadBuffer(`video-projects/${videoProjectId}/${uid}_watermarked.mp4`, result.watermarkedBuffer, "video/mp4"),
      storage.uploadBuffer(`video-projects/${videoProjectId}/${uid}_preview.mp4`, result.previewBuffer, "video/mp4"),
      storage.uploadBuffer(`video-projects/${videoProjectId}/${uid}_thumb.jpg`, result.thumbnailBuffer, "image/jpeg"),
    ]);

    await db.update(videoProjectsTable)
      .set({
        status: "watermarked",
        watermarkedKey,
        previewKey,
        thumbnailKey,
        durationSeconds: result.durationSeconds,
        sizeBytes,
        lockedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoProjectsTable.id, videoProjectId));
  } catch (err) {
    await db.update(videoProjectsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(videoProjectsTable.id, videoProjectId));
    throw err;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /video-projects
router.get("/", requireAuth, async (req, res) => {
  try {
    const where = [];
    if (req.query.releaseId) where.push(eq(videoProjectsTable.releaseId, Number(req.query.releaseId)));
    if (req.query.artistId)  where.push(eq(videoProjectsTable.artistId, Number(req.query.artistId)));
    if (req.query.status)    where.push(eq(videoProjectsTable.status, req.query.status as "uploading" | "processing" | "watermarked" | "unlocked" | "failed"));

    const rows = await db.select().from(videoProjectsTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(videoProjectsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listVideoProjects failed");
    res.status(500).json({ error: "Failed to list video projects" });
  }
});

async function maybeNotifyVideo(contactId: number | null | undefined, videoId: number, title: string) {
  if (!contactId) return;
  const [portalUser] = await db.select().from(portalUsersTable)
    .where(eq(portalUsersTable.contactId, contactId)).limit(1);
  if (!portalUser || !portalUser.isActive) return;
  await db.insert(portalNotificationsTable).values({
    userId: portalUser.id,
    type: "video_assigned",
    title: "New video shared with you",
    body: `"${title}" has been added to your portal.`,
    entityType: "video",
    entityId: videoId,
  });
}

// POST /video-projects
router.post("/", requireAuth, async (req, res) => {
  const parsed = VideoProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.insert(videoProjectsTable).values({
      title:              d.title,
      description:        d.description,
      releaseId:          d.releaseId ?? null,
      artistId:           d.artistId ?? null,
      contactId:          d.contactId ?? null,
      invoiceAmountCents: d.invoiceAmountCents ?? null,
      status:             "uploading",
      downloadEnabled:    false,
      uploadedBy:         req.user!.userId,
    }).returning();
    await maybeNotifyVideo(d.contactId, row!.id, d.title);
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createVideoProject failed");
    res.status(500).json({ error: "Failed to create video project" });
  }
});

// GET /video-projects/:id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getVideoProject failed");
    res.status(500).json({ error: "Failed to get video project" });
  }
});

// PUT /video-projects/:id
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = VideoProjectBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  try {
    const [row] = await db.update(videoProjectsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(videoProjectsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "updateVideoProject failed");
    res.status(500).json({ error: "Failed to update video project" });
  }
});

// DELETE /video-projects/:id
router.delete("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteVideoProject failed");
    res.status(500).json({ error: "Failed to delete video project" });
  }
});

// POST /video-projects/:id/upload  — multipart video file upload → FFmpeg
router.post("/:id/upload", requireAuth, videoUpload.single("video"), async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

  try {
    const [project] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Video project not found" }); return; }

    // Store original
    const originalBuf = await fs.readFile(req.file.path);
    const uid = randomUUID();
    const ext = extname(req.file.originalname) || ".mp4";
    const originalKey = await storage.uploadBuffer(
      `video-projects/${id}/${uid}_original${ext}`,
      originalBuf,
      req.file.mimetype,
    );

    await db.update(videoProjectsTable)
      .set({ originalKey, status: "processing", updatedAt: new Date() })
      .where(eq(videoProjectsTable.id, id));

    const [updated] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    res.status(202).json(updated);

    // Fire-and-forget FFmpeg processing
    processAndStore(id, req.file.path, req.file.size).catch((err) => {
      req.log.error({ err, videoProjectId: id }, "FFmpeg processing failed");
    });
  } catch (err) {
    await fs.unlink(req.file.path).catch(() => {});
    req.log.error({ err }, "uploadVideoFile failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// POST /video-projects/:id/invoice  — create Stripe invoice, lock download
router.post("/:id/invoice", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = VideoInvoiceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  try {
    const [project] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    if (!project) { res.status(404).json({ error: "Not found" }); return; }

    const stripe = await getUncachableStripeClient();
    if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

    // Create one-off invoice
    let customerId: string | undefined;
    if (d.customerEmail) {
      const customers = await stripe.customers.list({ email: d.customerEmail, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({ email: d.customerEmail });
        customerId = customer.id;
      }
    }

    const invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: true,
      collection_method: "send_invoice",
      days_until_due: 7,
      metadata: { videoProjectId: String(id) },
      description: d.description ?? `Video delivery: ${project.title}`,
    });

    await stripe.invoiceItems.create({
      customer: customerId ?? (invoice.customer as string),
      invoice: invoice.id,
      amount: d.amountCents,
      currency: "usd",
      description: d.description ?? `Video: ${project.title}`,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    const [updated] = await db.update(videoProjectsTable)
      .set({
        stripeInvoiceId:    finalized.id,
        stripeInvoiceUrl:   finalized.hosted_invoice_url ?? null,
        invoiceAmountCents: d.amountCents,
        downloadEnabled:    false,
        updatedAt:          new Date(),
      })
      .where(eq(videoProjectsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "createVideoInvoice failed");
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

// POST /video-projects/:id/unlock  — manual admin unlock
router.post("/:id/unlock", requireAuth, requireRole("owner", "admin"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [updated] = await db.update(videoProjectsTable)
      .set({ status: "unlocked", downloadEnabled: true, unlockedAt: new Date(), updatedAt: new Date() })
      .where(eq(videoProjectsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "unlockVideoProject failed");
    res.status(500).json({ error: "Failed to unlock video project" });
  }
});

// GET /video-projects/:id/thumbnail  — stream thumbnail JPEG
router.get("/:id/thumbnail", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [vp] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    if (!vp?.thumbnailKey) { res.status(404).json({ error: "No thumbnail yet" }); return; }
    const file = await storage.getObjectEntityFile(vp.thumbnailKey);
    const response = await storage.downloadObject(file, 3600);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    nodeStream.pipe(res);
  } catch (err) {
    req.log.error({ err }, "getVideoThumbnail failed");
    res.status(500).json({ error: "Failed to stream thumbnail" });
  }
});

// GET /video-projects/:id/preview  — stream 30 s watermarked preview
router.get("/:id/preview", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [vp] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    if (!vp?.previewKey) { res.status(404).json({ error: "No preview yet" }); return; }
    const file = await storage.getObjectEntityFile(vp.previewKey);
    const response = await storage.downloadObject(file, 3600);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    nodeStream.pipe(res);
  } catch (err) {
    req.log.error({ err }, "getVideoPreview failed");
    res.status(500).json({ error: "Failed to stream preview" });
  }
});

// GET /video-projects/:id/download  — stream original (must be unlocked)
router.get("/:id/download", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [vp] = await db.select().from(videoProjectsTable).where(eq(videoProjectsTable.id, id));
    if (!vp) { res.status(404).json({ error: "Not found" }); return; }
    if (!vp.downloadEnabled) { res.status(403).json({ error: "Video is locked — payment required" }); return; }
    const key = vp.originalKey ?? vp.watermarkedKey;
    if (!key) { res.status(404).json({ error: "No video file stored yet" }); return; }
    const file = await storage.getObjectEntityFile(key);
    const response = await storage.downloadObject(file);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(vp.title)}.mp4"`);
    const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    nodeStream.pipe(res);
  } catch (err) {
    req.log.error({ err }, "downloadVideoProject failed");
    res.status(500).json({ error: "Failed to download video" });
  }
});

// POST /video-projects/webhook/stripe  — Stripe payment webhook
router.post("/webhook/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env["STRIPE_VIDEO_WEBHOOK_SECRET"];

  try {
    const stripe = await getUncachableStripeClient();
    if (!stripe) { res.status(503).end(); return; }

    let event;
    if (webhookSecret && sig) {
      try {
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
      } catch {
        res.status(400).json({ error: "Invalid webhook signature" });
        return;
      }
    } else {
      event = req.body as { type: string; data: { object: Record<string, unknown> } };
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as { id: string; metadata?: { videoProjectId?: string } };
      const videoProjectId = invoice.metadata?.videoProjectId;
      if (videoProjectId) {
        await db.update(videoProjectsTable)
          .set({ status: "unlocked", downloadEnabled: true, unlockedAt: new Date(), updatedAt: new Date() })
          .where(eq(videoProjectsTable.id, Number(videoProjectId)));
      }
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
