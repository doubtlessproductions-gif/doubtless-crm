import { Router } from "express";
import { db, artistSavedViewsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";

const router = Router();

const SavedViewBody = z.object({
  name:    z.string().min(1).max(100),
  filters: z.record(z.unknown()),
});

router.get("/", requireAuth, async (req, res) => {
  const views = await db.select().from(artistSavedViewsTable)
    .where(eq(artistSavedViewsTable.userId, req.user!.userId))
    .orderBy(artistSavedViewsTable.createdAt);
  res.json(views);
});

router.post("/", requireAuth, async (req, res) => {
  const parse = SavedViewBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const [view] = await db.insert(artistSavedViewsTable)
    .values({ userId: req.user!.userId, name: parse.data.name, filters: parse.data.filters })
    .returning();
  res.status(201).json(view);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const result = await db.delete(artistSavedViewsTable)
    .where(and(
      eq(artistSavedViewsTable.id, id),
      eq(artistSavedViewsTable.userId, req.user!.userId),
    ))
    .returning({ id: artistSavedViewsTable.id });
  if (!result.length) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

export default router;
