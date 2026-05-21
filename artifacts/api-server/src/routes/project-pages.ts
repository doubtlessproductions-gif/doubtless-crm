import { Router } from "express";
import { db, projectPagesTable, dealsTable, contactsTable, artistsTable, userPermissionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import type { ContentBlock } from "@workspace/db";

const router = Router();

// ── Zod: loose block schema (JSONB — trust our own frontend) ──────────────────
const BlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({ id: z.string(), type: z.string() }).passthrough(),
);

const PageBody = z.object({
  title:       z.string().min(1).max(200),
  slug:        z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens only"),
  description: z.string().max(500).optional().nullable(),
  blocks:      z.array(BlockSchema).max(200).default([]),
  dealId:      z.number().int().positive().optional().nullable(),
  contactId:   z.number().int().positive().optional().nullable(),
  artistId:    z.number().int().positive().optional().nullable(),
});

// ── GET /api/pages — list all (auth) ─────────────────────────────────────────
router.get("/", requireAuth, async (_req, res) => {
  const pages = await db
    .select()
    .from(projectPagesTable)
    .orderBy(desc(projectPagesTable.updatedAt));
  res.json(pages);
});

// ── POST /api/pages — create (auth) ──────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const parse = PageBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const existing = await db.select({ id: projectPagesTable.id })
    .from(projectPagesTable).where(eq(projectPagesTable.slug, parse.data.slug)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "A page with this slug already exists" }); return; }

  const [page] = await db.insert(projectPagesTable).values({
    title:       parse.data.title,
    slug:        parse.data.slug,
    description: parse.data.description ?? null,
    blocks:      parse.data.blocks as ContentBlock[],
    dealId:      parse.data.dealId ?? null,
    contactId:   parse.data.contactId ?? null,
    artistId:    parse.data.artistId ?? null,
    createdBy:   req.user!.userId,
  }).returning();

  res.status(201).json(page);
});

// ── GET /api/pages/public/:slug — public read (no auth) ──────────────────────
// Must be before /:id to avoid ambiguity
router.get("/public/:slug", async (req, res) => {
  const [page] = await db.select()
    .from(projectPagesTable)
    .where(eq(projectPagesTable.slug, req.params["slug"] as string))
    .limit(1);
  if (!page) { res.status(404).json({ error: "Page not found" }); return; }
  if (page.status !== "published") { res.status(404).json({ error: "Page not found" }); return; }
  res.json(page);
});

// ── GET /api/pages/:id — get by id (auth) ────────────────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [page] = await db.select().from(projectPagesTable).where(eq(projectPagesTable.id, id)).limit(1);
  if (!page) { res.status(404).json({ error: "Page not found" }); return; }
  res.json(page);
});

// ── PUT /api/pages/:id — update (auth) ───────────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = PageBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const conflict = await db.select({ id: projectPagesTable.id })
    .from(projectPagesTable)
    .where(eq(projectPagesTable.slug, parse.data.slug))
    .limit(1);
  if (conflict.length > 0 && conflict[0]!.id !== id) {
    res.status(409).json({ error: "A page with this slug already exists" }); return;
  }

  const [updated] = await db.update(projectPagesTable)
    .set({
      title:       parse.data.title,
      slug:        parse.data.slug,
      description: parse.data.description ?? null,
      blocks:      parse.data.blocks as ContentBlock[],
      dealId:      parse.data.dealId ?? null,
      contactId:   parse.data.contactId ?? null,
      artistId:    parse.data.artistId ?? null,
      updatedAt:   new Date(),
    })
    .where(eq(projectPagesTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Page not found" }); return; }
  res.json(updated);
});

// ── POST /api/pages/:id/publish — toggle draft ↔ published (auth) ────────────
router.post("/:id/publish", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [page] = await db.select({ status: projectPagesTable.status })
    .from(projectPagesTable).where(eq(projectPagesTable.id, id)).limit(1);
  if (!page) { res.status(404).json({ error: "Page not found" }); return; }

  const next = page.status === "published" ? "draft" : "published";
  const [updated] = await db.update(projectPagesTable)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(projectPagesTable.id, id))
    .returning();

  res.json(updated);
});

// ── DELETE /api/pages/:id (auth) ─────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const role = req.user!.role ?? "";
  const roleCanDelete = ["owner", "admin"].includes(role);
  if (!roleCanDelete) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    const allowed = (permsRow?.permissions as Record<string, boolean> | null)?.["projects:delete"] === true;
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  await db.delete(projectPagesTable).where(eq(projectPagesTable.id, id));
  res.status(204).end();
});

export default router;
