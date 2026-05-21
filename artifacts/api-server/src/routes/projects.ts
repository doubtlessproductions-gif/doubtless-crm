import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, desc } from "drizzle-orm";
import { db, projectsTable, projectTemplatesTable, mediaVersionsTable, portalUsersTable, portalNotificationsTable, contactsTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth.js";
import { notifyUsersWithPref } from "../lib/notify-email.js";
import { auditLog } from "../lib/audit.js";
import { fireAutomation } from "../lib/automations.js";

const router = Router();

const ProjectBody = z.object({
  title:       z.string().min(1),
  description: z.string().optional(),
  artistId:    z.coerce.number().int().positive().optional().nullable(),
  releaseId:   z.coerce.number().int().positive().optional().nullable(),
  contactId:   z.coerce.number().int().positive().optional().nullable(),
  status:      z.enum(["planning", "in_progress", "mixing", "mastering", "delivered", "archived"]).optional(),
  deadline:    z.string().optional(),
  budgetCents: z.coerce.number().int().nonnegative().optional(),
  templateId:  z.coerce.number().int().positive().optional().nullable(),
});

const VALID_MEDIA_CATEGORIES = ["mix", "master", "stems", "video", "artwork", "radio_edit", "clean_edit", "other"] as const;
type ValidMediaCategory = typeof VALID_MEDIA_CATEGORIES[number];

async function maybeNotify(contactId: number | null | undefined, projectId: number, projectTitle: string) {
  if (!contactId) return;
  const [portalUser] = await db
    .select()
    .from(portalUsersTable)
    .where(eq(portalUsersTable.contactId, contactId))
    .limit(1);
  if (!portalUser || !portalUser.isActive) return;
  const [contact] = await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, contactId)).limit(1);
  await db.insert(portalNotificationsTable).values({
    userId: portalUser.id,
    type: "project_assigned",
    title: "New project shared with you",
    body: `"${projectTitle}" has been added to your portal.`,
    entityType: "project",
    entityId: projectId,
  });
}

// GET /projects
router.get("/", requireAuth, async (req, res) => {
  try {
    const where = [];
    if (req.query.artistId)  where.push(eq(projectsTable.artistId, Number(req.query.artistId)));
    if (req.query.contactId) where.push(eq(projectsTable.contactId, Number(req.query.contactId)));
    if (req.query.status)    where.push(eq(projectsTable.status, req.query.status as "planning" | "in_progress" | "mixing" | "mastering" | "delivered" | "archived"));

    const rows = await db.select().from(projectsTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(projectsTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listProjects failed");
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// POST /projects
router.post("/", requireAuth, async (req, res) => {
  const parsed = ProjectBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  let d = { ...parsed.data };
  try {
    let appliedTemplate: typeof projectTemplatesTable.$inferSelect | null = null;
    if (d.templateId) {
      const [tmpl] = await db.select().from(projectTemplatesTable).where(eq(projectTemplatesTable.id, d.templateId)).limit(1);
      if (!tmpl) { res.status(400).json({ error: "Template not found" }); return; }
      appliedTemplate = tmpl;
      if (!d.status && tmpl.defaultStatus) d.status = tmpl.defaultStatus as "planning" | "in_progress" | "mixing" | "mastering" | "delivered" | "archived";
      if (!d.description && tmpl.description) d.description = tmpl.description;
      if (!d.budgetCents && tmpl.estimatedHours) d.budgetCents = Math.round(Number(tmpl.estimatedHours) * 100);
    }

    const [row] = await db.insert(projectsTable).values({
      title:       d.title,
      description: d.description,
      artistId:    d.artistId ?? null,
      releaseId:   d.releaseId ?? null,
      contactId:   d.contactId ?? null,
      status:      d.status ?? "planning",
      deadline:    d.deadline ?? null,
      budgetCents: d.budgetCents ?? null,
      createdBy:   req.user!.userId,
    }).returning();

    if (appliedTemplate && appliedTemplate.mediaVersionCategories) {
      const cats = (appliedTemplate.mediaVersionCategories as string[]).filter(
        (c): c is ValidMediaCategory => (VALID_MEDIA_CATEGORIES as readonly string[]).includes(c)
      );
      for (const category of cats) {
        await db.insert(mediaVersionsTable).values({
          entityType:    "studio_project",
          entityId:      row!.id,
          label:         `${category.replace(/_/g, " ")} v1`,
          category,
          versionNumber: 1,
          status:        "pending",
          uploadedBy:    req.user!.userId,
        });
      }
    }

    await maybeNotify(d.contactId, row!.id, d.title);
    void notifyUsersWithPref(
      "projectCreated",
      `New studio project: ${d.title}`,
      `A new studio project <strong>${d.title}</strong> has been created with status <strong>${d.status ?? "Planning"}</strong>.`,
      req.user!.userId,
    );
    void auditLog({ userId: req.user!.userId, action: "project.created", entityType: "project", entityId: row!.id, entityLabel: d.title, req });
    void fireAutomation({ trigger: "project.created", entityType: "project", entityId: row!.id, data: { project: { title: d.title, status: d.status ?? "planning" } }, userId: req.user!.userId });
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createProject failed");
    res.status(500).json({ error: "Failed to create project" });
  }
});

// GET /projects/:id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getProject failed");
    res.status(500).json({ error: "Failed to get project" });
  }
});

// PUT /projects/:id
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const parsed = ProjectBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  try {
    const [prev] = await db.select({ contactId: projectsTable.contactId, status: projectsTable.status }).from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
    const [row] = await db.update(projectsTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(projectsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const newContactId = parsed.data.contactId;
    if (newContactId && newContactId !== prev?.contactId) {
      await maybeNotify(newContactId, id, row.title);
    }
    if (parsed.data.status && parsed.data.status !== prev?.status) {
      void notifyUsersWithPref(
        "projectStatusChanged",
        `Project status update: ${row.title}`,
        `The studio project <strong>${row.title}</strong> has moved to <strong>${parsed.data.status.replace("_", " ")}</strong>.`,
        req.user!.userId,
      );
      void auditLog({ userId: req.user!.userId, action: "project.status_changed", entityType: "project", entityId: id, entityLabel: row.title, metadata: { status: parsed.data.status }, req });
      void fireAutomation({ trigger: "project.status_changed", entityType: "project", entityId: id, data: { project: { id, title: row.title, status: parsed.data.status } }, userId: req.user!.userId });
    }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "updateProject failed");
    res.status(500).json({ error: "Failed to update project" });
  }
});

// DELETE /projects/:id
router.delete("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteProject failed");
    res.status(500).json({ error: "Failed to delete project" });
  }
});

export default router;
