import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, desc } from "drizzle-orm";
import { db, mediaVersionsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { auditLog } from "../lib/audit.js";

const router = Router();

const versionSchema = z.object({
  entityType:    z.string(),
  entityId:      z.number().int(),
  label:         z.string().min(1),
  category:      z.enum(["mix", "master", "stems", "video", "artwork", "radio_edit", "clean_edit", "other"]),
  storageKey:    z.string().optional(),
  fileName:      z.string().optional(),
  fileSizeBytes: z.number().int().optional(),
  mimeType:      z.string().optional(),
  notes:         z.string().optional(),
});

// GET /api/media-versions?entityType=studio_project&entityId=5
router.get("/", requireAuth, async (req, res) => {
  const { entityType, entityId } = req.query;
  if (!entityType || !entityId) { res.status(400).json({ error: "entityType and entityId required" }); return; }
  const rows = await db
    .select({
      id:            mediaVersionsTable.id,
      entityType:    mediaVersionsTable.entityType,
      entityId:      mediaVersionsTable.entityId,
      versionNumber: mediaVersionsTable.versionNumber,
      label:         mediaVersionsTable.label,
      category:      mediaVersionsTable.category,
      storageKey:    mediaVersionsTable.storageKey,
      fileName:      mediaVersionsTable.fileName,
      fileSizeBytes: mediaVersionsTable.fileSizeBytes,
      mimeType:      mediaVersionsTable.mimeType,
      notes:         mediaVersionsTable.notes,
      status:        mediaVersionsTable.status,
      createdAt:     mediaVersionsTable.createdAt,
      approvedAt:    mediaVersionsTable.approvedAt,
      uploadedBy:    mediaVersionsTable.uploadedBy,
      uploaderName:  usersTable.name,
      approvedBy:    mediaVersionsTable.approvedBy,
    })
    .from(mediaVersionsTable)
    .leftJoin(usersTable, eq(mediaVersionsTable.uploadedBy, usersTable.id))
    .where(and(
      eq(mediaVersionsTable.entityType, String(entityType)),
      eq(mediaVersionsTable.entityId, Number(entityId)),
    ))
    .orderBy(desc(mediaVersionsTable.createdAt));
  res.json(rows);
});

// POST /api/media-versions
router.post("/", requireAuth, async (req, res) => {
  const parsed = versionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payload" }); return; }
  const d = parsed.data;

  // Get next version number for this entity+category
  const existing = await db
    .select({ versionNumber: mediaVersionsTable.versionNumber })
    .from(mediaVersionsTable)
    .where(and(
      eq(mediaVersionsTable.entityType, d.entityType),
      eq(mediaVersionsTable.entityId, d.entityId),
      eq(mediaVersionsTable.category, d.category),
    ));
  const nextVersion = existing.length > 0 ? Math.max(...existing.map((r) => r.versionNumber)) + 1 : 1;

  const [row] = await db.insert(mediaVersionsTable).values({
    entityType:    d.entityType,
    entityId:      d.entityId,
    versionNumber: nextVersion,
    label:         d.label || `${d.category.replace("_", " ")} v${nextVersion}`,
    category:      d.category,
    storageKey:    d.storageKey ?? null,
    fileName:      d.fileName ?? null,
    fileSizeBytes: d.fileSizeBytes ?? null,
    mimeType:      d.mimeType ?? null,
    notes:         d.notes ?? null,
    uploadedBy:    req.user!.userId,
  }).returning();

  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "media_version.uploaded", entityType: d.entityType, entityId: d.entityId, entityLabel: row.label, req });
  res.status(201).json(row);
});

// PATCH /api/media-versions/:id/status
router.patch("/:id/status", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status as "pending" | "approved" | "rejected" | "superseded";
  if (!["pending", "approved", "rejected", "superseded"].includes(status)) {
    res.status(400).json({ error: "Invalid status" }); return;
  }
  let row;
  if (status === "approved") {
    [row] = await db.update(mediaVersionsTable).set({ status, approvedBy: req.user!.userId, approvedAt: new Date() }).where(eq(mediaVersionsTable.id, id)).returning();
  } else {
    [row] = await db.update(mediaVersionsTable).set({ status }).where(eq(mediaVersionsTable.id, id)).returning();
  }
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: `media_version.${status}`, entityType: "media_version", entityId: id, entityLabel: row.label, req });
  res.json(row);
});

// PUT /api/media-versions/:id/notes
router.put("/:id/notes", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const notes = String(req.body.notes ?? "");
  const [row] = await db.update(mediaVersionsTable).set({ notes }).where(eq(mediaVersionsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /api/media-versions/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select({ label: mediaVersionsTable.label }).from(mediaVersionsTable).where(eq(mediaVersionsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(mediaVersionsTable).where(eq(mediaVersionsTable.id, id));
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "media_version.deleted", entityType: "media_version", entityId: id, entityLabel: existing.label, req });
  res.json({ ok: true });
});

export default router;
