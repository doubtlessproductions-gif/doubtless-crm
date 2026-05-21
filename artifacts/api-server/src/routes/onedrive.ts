// Microsoft OneDrive routes — full file management + CRM file linking
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/auth.js";
import { db } from "@workspace/db";
import { fileLinksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  isOneDriveConnected,
  listRootFiles,
  listFolderFiles,
  listRemoteFolderFiles,
  searchFiles,
  listSharedWithMe,
  listRecentFiles,
  listFollowedSites,
  listSiteRootFiles,
  getSiteDriveId,
  uploadFile,
  createFolder,
  deleteItem,
  renameItem,
  getDownloadUrl,
} from "../lib/onedrive.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const NOT_CONNECTED = { error: "not_connected", connectUrl: "/settings?tab=integrations" } as const;

async function requireOneDriveConnection(req: Request, res: Response): Promise<boolean> {
  const connected = await isOneDriveConnected(req.user!.userId);
  if (!connected) { res.status(403).json(NOT_CONNECTED); return false; }
  return true;
}

// ── Status ────────────────────────────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  const connected = await isOneDriveConnected(req.user!.userId);
  res.json({ connected });
});

// ── My Drive — root & folder browsing ────────────────────────────────────────
router.get("/files", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json(await listRootFiles(req.user!.userId)); }
  catch { res.status(502).json({ error: "Failed to list OneDrive files" }); }
});

router.get("/files/:id", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json(await listFolderFiles(req.user!.userId, String(req.params["id"]))); }
  catch { res.status(502).json({ error: "Failed to list folder" }); }
});

// ── Recent files ──────────────────────────────────────────────────────────────
router.get("/recent", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json(await listRecentFiles(req.user!.userId)); }
  catch { res.status(502).json({ error: "Failed to list recent files" }); }
});

// ── Remote folder (shared / SharePoint) ──────────────────────────────────────
router.get("/remote-folder", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  const driveId = (req.query["driveId"] as string | undefined)?.trim();
  const itemId  = (req.query["itemId"]  as string | undefined)?.trim();
  if (!driveId || !itemId) { res.status(400).json({ error: "driveId and itemId are required" }); return; }
  try { res.json(await listRemoteFolderFiles(req.user!.userId, driveId, itemId)); }
  catch { res.status(502).json({ error: "Failed to list remote folder" }); }
});

// ── Search ────────────────────────────────────────────────────────────────────
router.get("/search", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  const q = (req.query["q"] as string | undefined)?.trim();
  if (!q || q.length < 2) { res.json([]); return; }
  try { res.json(await searchFiles(req.user!.userId, q)); }
  catch { res.status(502).json({ error: "Failed to search OneDrive" }); }
});

// ── Shared with me ────────────────────────────────────────────────────────────
router.get("/shared", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json(await listSharedWithMe(req.user!.userId)); }
  catch { res.status(502).json({ error: "Failed to list shared files" }); }
});

// ── SharePoint sites ──────────────────────────────────────────────────────────
router.get("/sites", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json(await listFollowedSites(req.user!.userId)); }
  catch { res.status(502).json({ error: "Failed to list sites" }); }
});

router.get("/sites/:siteId/files", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json(await listSiteRootFiles(req.user!.userId, String(req.params["siteId"]))); }
  catch { res.status(502).json({ error: "Failed to list site files" }); }
});

router.get("/sites/:siteId/drive-id", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try { res.json({ driveId: await getSiteDriveId(req.user!.userId, String(req.params["siteId"])) }); }
  catch { res.status(502).json({ error: "Failed to get site drive ID" }); }
});

// ── Upload file (≤4 MB) ───────────────────────────────────────────────────────
router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
  const parentFolderId = (req.body as { folderId?: string }).folderId ?? null;
  try {
    const item = await uploadFile(
      req.user!.userId,
      parentFolderId,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype,
    );
    if (!item) { res.status(502).json({ error: "Upload failed" }); return; }
    res.json(item);
  } catch (err) {
    req.log.warn({ err }, "OneDrive upload failed");
    res.status(502).json({ error: "Upload failed" });
  }
});

// ── Create folder ──────────────────────────────────────────────────────────────
router.post("/folders", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  const { name, parentFolderId } = req.body as { name: string; parentFolderId?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const folder = await createFolder(req.user!.userId, parentFolderId ?? null, name.trim());
    if (!folder) { res.status(502).json({ error: "Failed to create folder" }); return; }
    res.json(folder);
  } catch (err) {
    req.log.warn({ err }, "OneDrive create folder failed");
    res.status(502).json({ error: "Failed to create folder" });
  }
});

// ── Delete item ────────────────────────────────────────────────────────────────
router.delete("/items/:id", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try {
    const ok = await deleteItem(req.user!.userId, String(req.params["id"]));
    if (!ok) { res.status(502).json({ error: "Delete failed" }); return; }
    // Clean up any file links
    await db.delete(fileLinksTable).where(
      and(
        eq(fileLinksTable.fileId, String(req.params["id"])),
        eq(fileLinksTable.userId, req.user!.userId),
      )
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "OneDrive delete failed");
    res.status(502).json({ error: "Delete failed" });
  }
});

// ── Rename item ────────────────────────────────────────────────────────────────
router.patch("/items/:id", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  const { name } = req.body as { name: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const item = await renameItem(req.user!.userId, String(req.params["id"]), name.trim());
    if (!item) { res.status(502).json({ error: "Rename failed" }); return; }
    res.json(item);
  } catch (err) {
    req.log.warn({ err }, "OneDrive rename failed");
    res.status(502).json({ error: "Rename failed" });
  }
});

// ── Get download URL ───────────────────────────────────────────────────────────
router.get("/items/:id/download-url", requireAuth, async (req, res) => {
  if (!(await requireOneDriveConnection(req, res))) return;
  try {
    const url = await getDownloadUrl(req.user!.userId, String(req.params["id"]));
    if (!url) { res.status(404).json({ error: "No download URL available" }); return; }
    res.json({ url });
  } catch (err) {
    req.log.warn({ err }, "OneDrive download URL failed");
    res.status(502).json({ error: "Failed to get download URL" });
  }
});

// ── Link a file to a CRM entity ───────────────────────────────────────────────
const VALID_ENTITY_TYPES = ["contact", "artist", "release", "deal", "invoice", "thread"] as const;

router.post("/files/:fileId/link", requireAuth, async (req, res) => {
  const { entityType, entityId, fileName, fileWebUrl, fileMimeType } = req.body as {
    entityType: string; entityId: number;
    fileName?: string; fileWebUrl?: string; fileMimeType?: string;
  };
  if (!entityType || entityId === undefined) {
    res.status(400).json({ error: "entityType and entityId are required" }); return;
  }
  if (!VALID_ENTITY_TYPES.includes(entityType as typeof VALID_ENTITY_TYPES[number])) {
    res.status(400).json({ error: "invalid entityType" }); return;
  }
  try {
    const existing = await db.select({ id: fileLinksTable.id })
      .from(fileLinksTable)
      .where(and(
        eq(fileLinksTable.userId,     req.user!.userId),
        eq(fileLinksTable.fileId,     String(req.params["fileId"])),
        eq(fileLinksTable.entityType, entityType),
        eq(fileLinksTable.entityId,   Number(entityId)),
      ))
      .limit(1);
    if (existing.length) { res.json(existing[0]); return; }

    const [link] = await db.insert(fileLinksTable).values({
      userId:       req.user!.userId,
      fileId:       String(req.params["fileId"]),
      fileName:     fileName ?? null,
      fileWebUrl:   fileWebUrl ?? null,
      fileMimeType: fileMimeType ?? null,
      entityType,
      entityId:     Number(entityId),
    }).returning();
    res.json(link);
  } catch (err) {
    req.log.warn({ err }, "Failed to link file");
    res.status(500).json({ error: "Failed to link file" });
  }
});

// ── Remove a file link ─────────────────────────────────────────────────────────
router.delete("/file-links/:linkId", requireAuth, async (req, res) => {
  const linkId = parseInt(String(req.params["linkId"]), 10);
  if (isNaN(linkId)) { res.status(400).json({ error: "invalid linkId" }); return; }
  try {
    await db.delete(fileLinksTable).where(
      and(eq(fileLinksTable.id, linkId), eq(fileLinksTable.userId, req.user!.userId))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err, linkId }, "Failed to delete file link");
    res.status(500).json({ error: "Failed to delete file link" });
  }
});

// ── All entity links for a given file ─────────────────────────────────────────
router.get("/files/:fileId/links", requireAuth, async (req, res) => {
  try {
    const links = await db.select()
      .from(fileLinksTable)
      .where(and(
        eq(fileLinksTable.fileId,  String(req.params["fileId"])),
        eq(fileLinksTable.userId,  req.user!.userId),
      ))
      .orderBy(fileLinksTable.linkedAt);
    res.json(links);
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch file links");
    res.status(500).json({ error: "Failed to fetch file links" });
  }
});

// ── All linked files for a CRM entity ─────────────────────────────────────────
router.get("/linked/:entityType/:entityId", requireAuth, async (req, res) => {
  const entityId = parseInt(String(req.params["entityId"]), 10);
  if (isNaN(entityId)) { res.status(400).json({ error: "invalid entityId" }); return; }
  try {
    const links = await db.select()
      .from(fileLinksTable)
      .where(and(
        eq(fileLinksTable.entityType, String(req.params["entityType"])),
        eq(fileLinksTable.entityId,   entityId),
      ))
      .orderBy(fileLinksTable.linkedAt);
    res.json(links);
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch linked files");
    res.status(500).json({ error: "Failed to fetch linked files" });
  }
});

export default router;
