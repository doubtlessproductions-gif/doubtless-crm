import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, invoiceEmailTemplatesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

const PRIVILEGED_ROLES = ["owner", "admin", "manager"];

const TemplateBody = z.object({
  name:    z.string().min(1).max(100),
  subject: z.string().min(1).max(500),
  body:    z.string().min(1),
});

// GET /api/invoice-email-templates — all templates visible to authenticated workspace members
router.get("/", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(invoiceEmailTemplatesTable)
    .orderBy(desc(invoiceEmailTemplatesTable.createdAt));
  res.json(rows);
});

// POST /api/invoice-email-templates
router.post("/", requireAuth, async (req, res) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const [row] = await db
    .insert(invoiceEmailTemplatesTable)
    .values({ ...parsed.data, createdBy: req.user!.userId })
    .returning();
  res.status(201).json(row);
});

// PUT /api/invoice-email-templates/:id — creator or privileged role only
router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(invoiceEmailTemplatesTable).where(eq(invoiceEmailTemplatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user!.role as string);
  if (existing.createdBy !== req.user!.userId && !isPrivileged) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const [row] = await db
    .update(invoiceEmailTemplatesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(invoiceEmailTemplatesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /api/invoice-email-templates/:id — creator or privileged role only
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(invoiceEmailTemplatesTable).where(eq(invoiceEmailTemplatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const isPrivileged = PRIVILEGED_ROLES.includes(req.user!.role as string);
  if (existing.createdBy !== req.user!.userId && !isPrivileged) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  await db.delete(invoiceEmailTemplatesTable).where(eq(invoiceEmailTemplatesTable.id, id));
  res.status(204).end();
});

export default router;
