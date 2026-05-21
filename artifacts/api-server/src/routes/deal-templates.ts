import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, dealTemplatesTable, dealNotesTable, dealsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

const TemplateBody = z.object({
  name:             z.string().min(1).max(200),
  description:      z.string().max(1000).optional().nullable(),
  defaultValue:     z.number().min(0).optional().nullable(),
  defaultStage:     z.enum(["lead", "qualified", "proposal", "negotiation", "won", "lost"]).default("lead"),
  deliverableTypes: z.array(z.string().min(1).max(100)).default([]),
  estimatedHours:   z.number().int().min(0).optional().nullable(),
});

// GET /api/deal-templates
router.get("/", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealTemplatesTable).orderBy(desc(dealTemplatesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listDealTemplates failed");
    res.status(500).json({ error: "Failed to list templates" });
  }
});

// POST /api/deal-templates
router.post("/", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.insert(dealTemplatesTable).values({
      name:             d.name,
      description:      d.description ?? null,
      defaultValue:     d.defaultValue != null ? String(d.defaultValue) : null,
      defaultStage:     d.defaultStage,
      deliverableTypes: d.deliverableTypes,
      estimatedHours:   d.estimatedHours ?? null,
      createdBy:        req.user!.userId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createDealTemplate failed");
    res.status(500).json({ error: "Failed to create template" });
  }
});

// GET /api/deal-templates/:id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(dealTemplatesTable).where(eq(dealTemplatesTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getDealTemplate failed");
    res.status(500).json({ error: "Failed to get template" });
  }
});

// PUT /api/deal-templates/:id
router.put("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = TemplateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.update(dealTemplatesTable).set({
      name:             d.name,
      description:      d.description ?? null,
      defaultValue:     d.defaultValue != null ? String(d.defaultValue) : null,
      defaultStage:     d.defaultStage,
      deliverableTypes: d.deliverableTypes,
      estimatedHours:   d.estimatedHours ?? null,
      updatedAt:        new Date(),
    }).where(eq(dealTemplatesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "updateDealTemplate failed");
    res.status(500).json({ error: "Failed to update template" });
  }
});

// DELETE /api/deal-templates/:id
router.delete("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.delete(dealTemplatesTable).where(eq(dealTemplatesTable.id, id)).returning({ id: dealTemplatesTable.id });
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "deleteDealTemplate failed");
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// POST /api/deal-templates/:id/apply/:dealId — apply template post-hoc (creates a note with deliverable checklist)
router.post("/:id/apply/:dealId", requireAuth, async (req, res) => {
  const templateId = Number(req.params.id);
  const dealId     = Number(req.params.dealId);
  try {
    const [tmpl] = await db.select().from(dealTemplatesTable).where(eq(dealTemplatesTable.id, templateId));
    if (!tmpl) { res.status(404).json({ error: "Template not found" }); return; }
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
    if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

    if (tmpl.deliverableTypes.length > 0) {
      const checklist = tmpl.deliverableTypes.map(t => `- [ ] ${t}`).join("\n");
      const content = `📋 Template: ${tmpl.name}\n\nExpected deliverables:\n${checklist}${tmpl.estimatedHours ? `\n\nEstimated hours: ${tmpl.estimatedHours}h` : ""}`;
      await db.insert(dealNotesTable).values({
        dealId,
        authorId: req.user!.userId,
        content,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "applyDealTemplate failed");
    res.status(500).json({ error: "Failed to apply template" });
  }
});

export default router;
