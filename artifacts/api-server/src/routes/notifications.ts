import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

// GET /api/notifications — last 50 for the current user
router.get("/", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(rows);
});

// GET /api/notifications/unread-count
router.get("/unread-count", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const rows = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ count: rows.length });
});

// PUT /api/notifications/read — mark all read for current user
router.put("/read", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ ok: true });
});

// DELETE /api/notifications/:id — dismiss one
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const userId = req.user!.userId;
  await db
    .delete(notificationsTable)
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, userId)));
  res.status(204).send();
});

export default router;
