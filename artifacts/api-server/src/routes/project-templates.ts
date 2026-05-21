import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, projectTemplatesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

const TemplateBody = z.object({
  name:                   z.string().min(1).max(200),
  description:            z.string().max(1000).optional().nullable(),
  defaultStatus:          z.enum(["planning", "in_progress", "mixing", "mastering", "delivered", "archived"]).default("planning"),
  mediaVersionCategories: z.array(z.string().min(1).max(100)).default([]),
  estimatedHours:         z.number().int().min(0).optional().nullable(),
});

// GET /api/project-templates
router.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(projectTemplatesTable).orderBy(desc(projectTemplatesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listProjectTemplates failed");
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// POST /api/project-templates
router.post("/", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.insert(projectTemplatesTable).values({
      name:                   d.name,
      description:            d.description ?? null,
      defaultStatus:          d.defaultStatus,
      mediaVersionCategories: d.mediaVersionCategories,
      estimatedHours:         d.estimatedHours ?? null,
      createdBy:              req.user!.userId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createProjectTemplate failed");
    res.status(500).json({ error: "Failed to create template" });
  }
});

// GET /api/project-templates/:id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(projectTemplatesTable).where(eq(projectTemplatesTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getProjectTemplate failed");
    res.status(500).json({ error: "Failed to get template" });
  }
});

// PUT /api/project-templates/:id
router.put("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.update(projectTemplatesTable).set({
      name:                   d.name,
      description:            d.description ?? null,
      defaultStatus:          d.defaultStatus,
      mediaVersionCategories: d.mediaVersionCategories,
      estimatedHours:         d.estimatedHours ?? null,
      updatedAt:              new Date(),
    }).where(eq(projectTemplatesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "updateProjectTemplate failed");
    res.status(500).json({ error: "Failed to update template" });
  }
});

// DELETE /api/project-templates/:id
router.delete("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.delete(projectTemplatesTable).where(eq(projectTemplatesTable.id, id)).returning({ id: projectTemplatesTable.id });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteProjectTemplate failed");
    res.status(500).json({ error: "Failed to delete template" });
  }
});

export default router;
