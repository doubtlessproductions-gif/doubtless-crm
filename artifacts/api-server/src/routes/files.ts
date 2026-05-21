import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { requireAuth } from "../middlewares/auth.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { auditLog } from "../lib/audit.js";

const router = Router();
const objectStorageService = new ObjectStorageService();

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",   // .mov
  "video/webm",
  "video/x-msvideo",  // .avi
  "video/mpeg",
  "video/x-matroska", // .mkv
]);

const ALLOWED_MIMES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain", "text/csv",
  "audio/mpeg", "audio/wav", "audio/aac", "audio/flac", "audio/x-m4a",
  ...VIDEO_MIMES,
]);

// Use disk storage for temp files so large videos (up to 500 MB) are never held in Node
// process memory. The temp file is deleted immediately after upload to object storage.
const tempDir = path.join(process.cwd(), "tmp-uploads");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, _file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed"));
    }
  },
});

// ── Backward-compat: serve legacy local-disk attachments ──────────────────────
// Files uploaded before the object-storage migration live at <cwd>/uploads/<filename>.
// This handler keeps those URLs (/api/files/:filename) working for historical attachments.
const legacyUploadDir = path.join(process.cwd(), "uploads");
router.get("/:filename", requireAuth, (req, res) => {
  const filename = req.params["filename"] as string;
  const filePath = path.join(legacyUploadDir, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  res.sendFile(filePath, { headers: { "Accept-Ranges": "bytes" } });
});

// ── POST /api/files/upload — stream temp file into object storage ─────────────
router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const tempPath = req.file.path;

  try {
    const ext      = path.extname(req.file.originalname) || "";
    const subPath  = `attachments/${randomUUID()}${ext}`;

    // Read temp file from disk — avoids holding 500 MB in memory during the HTTP transfer phase
    const buffer = await fs.promises.readFile(tempPath);

    const storageKey = await objectStorageService.uploadBuffer(
      subPath,
      buffer,
      req.file.mimetype,
    );

    // storageKey is "/objects/attachments/<uuid><ext>"
    // Served via the existing auth-protected GET /api/storage/objects/* route
    const url  = `/api/storage/objects/${storageKey.replace(/^\/objects\//, "")}`;
    const name = req.file.originalname;
    const size = req.file.size;

    res.json({ url, name, size });
    void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "file.uploaded", entityType: "file", entityLabel: name, metadata: { url, size, mimeType: req.file.mimetype }, req });
  } catch (err) {
    req.log.error({ err }, "file upload to object storage failed");
    res.status(500).json({ error: "Upload failed" });
  } finally {
    // Always clean up the temp file regardless of success or failure
    fs.promises.unlink(tempPath).catch(() => {});
  }
});

export default router;
