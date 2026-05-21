import { Router } from "express";
import { db, dealsTable, dealNotesTable, dealTemplatesTable, dealDeliverablePlansTable, contactsTable, usersTable, dealStageEnum, userPermissionsTable } from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";

import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { notifyUsersWithPref } from "../lib/notify-email.js";
import { notifyAll } from "../lib/notify.js";
import { auditLog } from "../lib/audit.js";
import { fireAutomation } from "../lib/automations.js";
import { fireWebhook } from "../lib/webhooks.js";

const router = Router();

const VALID_STAGES = dealStageEnum.enumValues;

const DealBody = z.object({
  title: z.string().min(1),
  value: z.number().nullable().optional(),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional().nullable(),
  expectedCloseDate: z.string().nullable().optional(),
  contactId: z.number().nullable().optional(),
  assignedTo: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  templateId: z.number().int().positive().optional().nullable(),
});

router.get("/", requireReadAuth, async (req, res) => {
  const stageFilter = req.query["stage"] as string | undefined;

  const rows = await db
    .select({
      deal: dealsTable,
      contactName: contactsTable.name,
      assignedToName: usersTable.name,
    })
    .from(dealsTable)
    .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
    .leftJoin(usersTable, eq(dealsTable.assignedTo, usersTable.id))
    .where(
      stageFilter && VALID_STAGES.includes(stageFilter as typeof VALID_STAGES[number])
        ? eq(dealsTable.stage, stageFilter as typeof VALID_STAGES[number])
        : sql`1=1`,
    )
    .orderBy(dealsTable.createdAt);

  res.json(rows.map(({ deal, contactName, assignedToName }) => formatDeal(deal, contactName, assignedToName)));
});

router.post("/", requireAuth, async (req, res) => {
  const parse = DealBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  let { title, value, stage, priority, expectedCloseDate, contactId, assignedTo, notes, templateId } = parse.data;
  const stageExplicitlySet = typeof (req.body as Record<string, unknown>)?.stage === "string";

  let appliedTemplate: typeof dealTemplatesTable.$inferSelect | null = null;
  if (templateId) {
    const [tmpl] = await db.select().from(dealTemplatesTable).where(eq(dealTemplatesTable.id, templateId)).limit(1);
    if (tmpl) {
      appliedTemplate = tmpl;
      if (value == null && tmpl.defaultValue != null) value = Number(tmpl.defaultValue);
      if (!stageExplicitlySet && tmpl.defaultStage) stage = tmpl.defaultStage;
    } else {
      res.status(400).json({ error: "Template not found" });
      return;
    }
  }

  const [deal] = await db
    .insert(dealsTable)
    .values({
      title,
      value: value != null ? String(value) : null,
      stage: stage ?? "lead",
      priority: priority ?? "medium",
      expectedCloseDate: expectedCloseDate ?? null,
      contactId: contactId ?? null,
      assignedTo: assignedTo ?? null,
      notes: notes ?? null,
      createdBy: req.user!.userId,
    })
    .returning();

  if (appliedTemplate && appliedTemplate.deliverableTypes && (appliedTemplate.deliverableTypes as string[]).length > 0) {
    const types = appliedTemplate.deliverableTypes as string[];
    const checklist = types.map((t: string) => `- [ ] ${t}`).join("\n");
    const content = `📋 Template: ${appliedTemplate.name}\n\nExpected deliverables:\n${checklist}${appliedTemplate.estimatedHours ? `\n\nEstimated hours: ${appliedTemplate.estimatedHours}h` : ""}`;
    await db.insert(dealNotesTable).values({ dealId: deal!.id, authorId: req.user!.userId, content });
    await db.insert(dealDeliverablePlansTable).values(
      types.map((deliverableType: string) => ({
        dealId: deal!.id,
        deliverableType,
        templateId: appliedTemplate!.id,
      }))
    );
  }

  void notifyUsersWithPref(
    "dealCreated",
    `New deal: ${title}`,
    `A new deal <strong>${title}</strong> has been created${value != null ? ` worth $${Number(value).toLocaleString()}` : ""}.`,
    req.user!.userId,
  );
  void notifyAll(
    req.io ?? null,
    "deal_created",
    "New deal created",
    `"${title}" was added to the pipeline`,
    `/pipeline`,
    req.user!.userId,
  );
  void auditLog({ userId: req.user!.userId, action: "deal.created", entityType: "deal", entityId: deal!.id, entityLabel: title, metadata: { value, stage }, req });
  void fireAutomation({ trigger: "deal.created", entityType: "deal", entityId: deal!.id, data: { deal: { ...deal, title, value, stage } }, userId: req.user!.userId, io: req.io ?? null });
  res.status(201).json(formatDeal(deal!, null, null));
});

// ── Deliverable Plans ───────────────────────────────────────────────────────

router.get("/:id/plans", requireAuth, async (req, res) => {
  const dealId = Number(req.params.id);
  if (!dealId) { res.status(400).json({ error: "Invalid id" }); return; }
  const plans = await db.select().from(dealDeliverablePlansTable).where(eq(dealDeliverablePlansTable.dealId, dealId));
  res.json(plans);
});

router.patch("/plans/:planId", requireAuth, async (req, res) => {
  const planId = Number(req.params.planId);
  if (!planId) { res.status(400).json({ error: "Invalid planId" }); return; }
  const bodyParse = z.object({ isCompleted: z.boolean() }).safeParse(req.body);
  if (!bodyParse.success) { res.status(400).json({ error: "isCompleted (boolean) is required" }); return; }
  const { isCompleted } = bodyParse.data;
  const [plan] = await db
    .update(dealDeliverablePlansTable)
    .set({ isCompleted, completedAt: isCompleted ? new Date() : null })
    .where(eq(dealDeliverablePlansTable.id, planId))
    .returning();
  if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
  res.json(plan);
});

// ── CSV export ──────────────────────────────────────────────────────────────
function csvRow(vals: (string | number | null | undefined)[]): string {
  return vals.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

router.get("/export.csv", requireAuth, async (req, res) => {
  const stageFilter = req.query["stage"] as string | undefined;
  const rows = await db
    .select({ deal: dealsTable, contactName: contactsTable.name, assignedToName: usersTable.name })
    .from(dealsTable)
    .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
    .leftJoin(usersTable, eq(dealsTable.assignedTo, usersTable.id))
    .where(
      stageFilter && VALID_STAGES.includes(stageFilter as typeof VALID_STAGES[number])
        ? eq(dealsTable.stage, stageFilter as typeof VALID_STAGES[number])
        : sql`1=1`,
    )
    .orderBy(dealsTable.createdAt);
  const lines = [
    csvRow(["ID", "Title", "Stage", "Value", "Contact", "Assigned To", "Closed At", "Created At"]),
    ...rows.map(({ deal, contactName, assignedToName }) => csvRow([
      deal.id, deal.title, deal.stage,
      deal.value ? Number(deal.value) : "",
      contactName ?? "", assignedToName ?? "",
      deal.closedAt?.toISOString() ?? "",
      deal.createdAt.toISOString(),
    ])),
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="deals.csv"`);
  res.send(lines.join("\n"));
});

// ── Bulk actions ────────────────────────────────────────────────────────────
const DealBulkBody = z.object({
  ids:    z.array(z.number().int().positive()).min(1).max(500),
  action: z.enum(["stage", "assign", "delete"]),
  stage:  z.enum(["lead", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  userId: z.number().int().positive().nullable().optional(),
});

router.patch("/bulk", requireAuth, async (req, res) => {
  const parse = DealBulkBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { ids, action, stage, userId } = parse.data;

  if (action === "delete") {
    await db.delete(dealsTable).where(inArray(dealsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }
  if (action === "stage") {
    if (!stage) { res.status(400).json({ error: "stage required" }); return; }
    const closedAt = stage === "won" || stage === "lost" ? new Date() : null;
    await db.update(dealsTable).set({ stage, closedAt, updatedAt: new Date() }).where(inArray(dealsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }
  if (action === "assign") {
    await db.update(dealsTable).set({ assignedTo: userId ?? null, updatedAt: new Date() }).where(inArray(dealsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }
  res.status(400).json({ error: "Unknown action" });
});

router.get("/:id", requireReadAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db
    .select({
      deal: dealsTable,
      contactName: contactsTable.name,
      assignedToName: usersTable.name,
    })
    .from(dealsTable)
    .leftJoin(contactsTable, eq(dealsTable.contactId, contactsTable.id))
    .leftJoin(usersTable, eq(dealsTable.assignedTo, usersTable.id))
    .where(eq(dealsTable.id, id))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  const notes = await db
    .select({
      note: dealNotesTable,
      authorName: usersTable.name,
    })
    .from(dealNotesTable)
    .leftJoin(usersTable, eq(dealNotesTable.authorId, usersTable.id))
    .where(eq(dealNotesTable.dealId, id))
    .orderBy(dealNotesTable.createdAt);

  res.json({
    ...formatDeal(row.deal, row.contactName, row.assignedToName),
    dealNotes: notes.map(({ note, authorName }) => ({
      id:         note.id,
      dealId:     note.dealId,
      authorId:   note.authorId,
      authorName: authorName ?? "Unknown",
      content:    note.content,
      fileUrl:    note.fileUrl,
      fileName:   note.fileName,
      createdAt:  note.createdAt,
    })),
  });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = DealBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { title, value, stage, priority, expectedCloseDate, contactId, assignedTo, notes } = parse.data;
  const [deal] = await db
    .update(dealsTable)
    .set({
      title,
      value: value != null ? String(value) : null,
      stage: stage ?? "lead",
      priority: priority ?? "medium",
      expectedCloseDate: expectedCloseDate ?? null,
      contactId: contactId ?? null,
      assignedTo: assignedTo ?? null,
      notes: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(dealsTable.id, id))
    .returning();
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  void notifyUsersWithPref(
    "dealUpdated",
    `Deal updated: ${title}`,
    `The deal <strong>${title}</strong> has been updated.`,
    req.user!.userId,
  );
  res.json(formatDeal(deal, null, null));
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const role = req.user!.role ?? "";
  const roleCanDelete = ["owner", "admin", "manager"].includes(role);
  if (!roleCanDelete) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    const allowed = (permsRow?.permissions as Record<string, boolean> | null)?.["deals:delete"] === true;
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const result = await db.delete(dealsTable).where(eq(dealsTable.id, id)).returning();
  if (!result.length) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/:id/stage", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const stage = req.body.stage;
  if (!VALID_STAGES.includes(stage)) {
    res.status(400).json({ error: `stage must be one of: ${VALID_STAGES.join(", ")}` });
    return;
  }
  const closedAt = stage === "won" || stage === "lost" ? new Date() : null;
  const [deal] = await db
    .update(dealsTable)
    .set({ stage, closedAt, updatedAt: new Date() })
    .where(eq(dealsTable.id, id))
    .returning();
  if (!deal) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  const stageLabel: Record<string, string> = {
    lead: "Lead", qualified: "Qualified", proposal: "Proposal Sent",
    negotiation: "Negotiation", won: "Won ✓", lost: "Lost",
  };
  void notifyUsersWithPref(
    "dealStageChanged",
    `Deal moved to ${stageLabel[stage] ?? stage}: ${deal.title}`,
    `The deal <strong>${deal.title}</strong> has moved to <strong>${stageLabel[stage] ?? stage}</strong>.`,
    req.user!.userId,
  );
  void notifyAll(
    req.io ?? null,
    "deal_stage",
    `Deal → ${stageLabel[stage] ?? stage}`,
    `"${deal.title}" moved to ${stageLabel[stage] ?? stage}`,
    `/pipeline`,
    req.user!.userId,
  );
  void auditLog({ userId: req.user!.userId, action: "deal.stage_changed", entityType: "deal", entityId: id, entityLabel: deal.title, metadata: { stage }, req });
  void fireAutomation({ trigger: "deal.stage_changed", entityType: "deal", entityId: id, data: { deal: { id, title: deal.title, stage } }, userId: req.user!.userId, io: req.io ?? null });
  void fireWebhook("deal.stage_changed", { dealId: id, title: deal.title, stage }, req.user!.userId);
  res.json(formatDeal(deal, null, null));
});

router.post("/:id/notes", requireAuth, async (req, res) => {
  const dealId = parseInt(req.params["id"] as string);
  const { content = "", fileUrl, fileName } = req.body as { content?: string; fileUrl?: string; fileName?: string };

  if (!content?.trim() && !fileUrl) {
    res.status(400).json({ error: "content or a file attachment is required" });
    return;
  }

  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId)).limit(1);
  if (!deal) { res.status(404).json({ error: "Deal not found" }); return; }

  const [note] = await db
    .insert(dealNotesTable)
    .values({
      dealId,
      authorId: req.user!.userId,
      content: content?.trim() ?? "",
      fileUrl:  fileUrl  ?? null,
      fileName: fileName ?? null,
    })
    .returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

  void notifyUsersWithPref(
    "dealNoteAdded",
    `New note on deal: ${deal.title}`,
    `${user?.name ?? "A team member"} added a note to <strong>${deal.title}</strong>${content?.trim() ? `:<br/><br/><em>${content.trim().slice(0, 300)}</em>` : " (file attached)"}.`,
    req.user!.userId,
  );

  res.status(201).json({
    id:         note!.id,
    dealId:     note!.dealId,
    authorId:   note!.authorId,
    authorName: user?.name ?? "Unknown",
    content:    note!.content,
    fileUrl:    note!.fileUrl,
    fileName:   note!.fileName,
    createdAt:  note!.createdAt,
  });
});

function formatDeal(
  d: typeof dealsTable.$inferSelect,
  contactName: string | null | undefined,
  assignedToName: string | null | undefined,
) {
  return {
    id: d.id,
    title: d.title,
    value: d.value ? Number(d.value) : null,
    stage: d.stage,
    priority: d.priority,
    expectedCloseDate: d.expectedCloseDate,
    contactId: d.contactId,
    contactName: contactName ?? null,
    assignedTo: d.assignedTo,
    assignedToName: assignedToName ?? null,
    notes: d.notes,
    closedAt: d.closedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export default router;
