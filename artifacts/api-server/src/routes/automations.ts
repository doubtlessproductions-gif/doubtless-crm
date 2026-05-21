import { Router } from "express";
import { z } from "zod/v4";
import { eq, desc } from "drizzle-orm";
import { db, automationsTable, automationRunsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { auditLog } from "../lib/audit.js";

const router = Router();

const conditionSchema = z.object({
  field:    z.string(),
  operator: z.string(),
  value:    z.union([z.string(), z.number(), z.boolean()]),
});

const actionSchema = z.object({
  type:   z.string(),
  config: z.record(z.string(), z.unknown()),
});

const automationSchema = z.object({
  name:          z.string().min(1),
  description:   z.string().optional(),
  trigger:       z.string(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  conditions:    z.array(conditionSchema).optional(),
  actions:       z.array(actionSchema).min(1),
  enabled:       z.boolean().optional(),
});

// GET /api/automations
router.get("/", requireAuth, async (req, res) => {
  const rows = await db
    .select({
      id:          automationsTable.id,
      name:        automationsTable.name,
      description: automationsTable.description,
      trigger:     automationsTable.trigger,
      triggerConfig: automationsTable.triggerConfig,
      conditions:  automationsTable.conditions,
      actions:     automationsTable.actions,
      enabled:     automationsTable.enabled,
      runCount:    automationsTable.runCount,
      lastRunAt:   automationsTable.lastRunAt,
      createdAt:   automationsTable.createdAt,
      updatedAt:   automationsTable.updatedAt,
      createdBy:   automationsTable.createdBy,
      creatorName: usersTable.name,
    })
    .from(automationsTable)
    .leftJoin(usersTable, eq(automationsTable.createdBy, usersTable.id))
    .orderBy(desc(automationsTable.updatedAt));
  res.json(rows);
});

// GET /api/automations/:id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(automationsTable).where(eq(automationsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// GET /api/automations/:id/runs
router.get("/:id/runs", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const runs = await db
    .select()
    .from(automationRunsTable)
    .where(eq(automationRunsTable.automationId, id))
    .orderBy(desc(automationRunsTable.createdAt))
    .limit(50);
  res.json(runs);
});

// POST /api/automations
router.post("/", requireAuth, async (req, res) => {
  const parsed = automationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payload" }); return; }
  const d = parsed.data;
  const [row] = await db.insert(automationsTable).values({
    name:          d.name,
    description:   d.description ?? null,
    trigger:       d.trigger,
    triggerConfig: d.triggerConfig ?? {},
    conditions:    d.conditions ?? [],
    actions:       d.actions,
    enabled:       d.enabled ?? true,
    createdBy:     req.user!.userId,
  }).returning();
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "automation.created", entityType: "automation", entityId: row.id, entityLabel: row.name, req });
  res.status(201).json(row);
});

// PUT /api/automations/:id
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = automationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid payload" }); return; }
  const d = parsed.data;
  const [row] = await db.update(automationsTable).set({
    name:          d.name,
    description:   d.description ?? null,
    trigger:       d.trigger,
    triggerConfig: d.triggerConfig ?? {},
    conditions:    d.conditions ?? [],
    actions:       d.actions,
    enabled:       d.enabled ?? true,
    updatedAt:     new Date(),
  }).where(eq(automationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "automation.updated", entityType: "automation", entityId: id, entityLabel: row.name, req });
  res.json(row);
});

// PATCH /api/automations/:id/toggle
router.patch("/:id/toggle", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select({ enabled: automationsTable.enabled, name: automationsTable.name }).from(automationsTable).where(eq(automationsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await db.update(automationsTable).set({ enabled: !existing.enabled, updatedAt: new Date() }).where(eq(automationsTable.id, id)).returning();
  res.json(row);
});

// DELETE /api/automations/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select({ name: automationsTable.name }).from(automationsTable).where(eq(automationsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  await db.delete(automationsTable).where(eq(automationsTable.id, id));
  const [user] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  void auditLog({ userId: req.user!.userId, userName: user?.name, action: "automation.deleted", entityType: "automation", entityId: id, entityLabel: existing.name, req });
  res.json({ ok: true });
});

export default router;
