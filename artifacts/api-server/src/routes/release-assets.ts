import { Router } from "express";
import multer from "multer";
import { extname } from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { z } from "zod/v4";
import { eq, desc } from "drizzle-orm";
import { db, releaseAssetsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const storageService = new ObjectStorageService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

const VALID_TYPES = ["audio_master", "cover_art", "music_video", "social_clip", "press_photo", "lyrics_sheet", "other"] as const;

// GET /release-assets?releaseId=X
router.get("/", requireAuth, async (req, res) => {
  const releaseId = Number(req.query.releaseId);
  if (!releaseId) { res.status(400).json({ error: "releaseId is required" }); return; }
  try {
    const rows = await db.select().from(releaseAssetsTable)
      .where(eq(releaseAssetsTable.releaseId, releaseId))
      .orderBy(desc(releaseAssetsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listReleaseAssets failed");
    res.status(500).json({ error: "Failed to list release assets" });
  }
});

// POST /release-assets (multipart)
router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

  const releaseId = Number(req.body.releaseId);
  const type = req.body.type as string;
  if (!releaseId || !VALID_TYPES.includes(type as typeof VALID_TYPES[number])) {
    res.status(400).json({ error: "releaseId and valid type are required" });
    return;
  }

  try {
    const ext  = extname(req.file.originalname) || "";
    const uid  = randomUUID();
    const subPath = `release-assets/${releaseId}/${uid}${ext}`;
    const storageKey = await storageService.uploadBuffer(subPath, req.file.buffer, req.file.mimetype);

    const filename = `${uid}${ext}`;
    const [row] = await db.insert(releaseAssetsTable).values({
      releaseId,
      type:         type as typeof VALID_TYPES[number],
      filename,
      originalName: req.file.originalname,
      mimeType:     req.file.mimetype,
      sizeBytes:    req.file.size,
      storageKey,
      notes:        req.body.notes ?? null,
      uploadedBy:   req.user!.userId,
    }).returning();

    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "uploadReleaseAsset failed");
    res.status(500).json({ error: "Failed to upload asset" });
  }
});

// GET /release-assets/:id/download  — stream asset file
router.get("/:id/download", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [asset] = await db.select().from(releaseAssetsTable).where(eq(releaseAssetsTable.id, id));
    if (!asset) { res.status(404).json({ error: "Not found" }); return; }
    const file = await storageService.getObjectEntityFile(asset.storageKey);
    const response = await storageService.downloadObject(file);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(asset.originalName)}"`);
    const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    nodeStream.pipe(res);
  } catch (err) {
    req.log.error({ err }, "downloadReleaseAsset failed");
    res.status(500).json({ error: "Failed to download asset" });
  }
});

// DELETE /release-assets/:id
router.delete("/:id", requireAuth, requireRole("owner", "admin", "manager", "engineer"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(releaseAssetsTable).where(eq(releaseAssetsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteReleaseAsset failed");
    res.status(500).json({ error: "Failed to delete release asset" });
  }
});

export default router;
