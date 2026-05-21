import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, desc } from "drizzle-orm";
import { db, contentPostsTable, userConnectionsTable, workspaceConnectionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { publishPost } from "../lib/social-publisher.js";

const router = Router();

const ContentPostBody = z.object({
  releaseId:   z.coerce.number().int().positive().optional(),
  platform:    z.enum(["instagram", "tiktok", "twitter", "youtube", "facebook", "email", "sms", "slack", "linkedin"]),
  scheduledAt: z.string().min(1),
  copy:        z.string().default(""),
  mediaUrls:   z.array(z.string()).default([]),
  status:      z.enum(["draft", "scheduled", "posted", "cancelled"]).default("draft"),
});

// Helper: resolve credentials for a platform — personal first, then workspace fallback
async function resolveCredentials(
  userId: number,
  platform: string,
): Promise<{ credentials: Record<string, string>; isWorkspace: boolean } | null> {
  const [personal] = await db
    .select({ credentials: userConnectionsTable.credentials })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, platform)));

  if (personal?.credentials) {
    return { credentials: personal.credentials as Record<string, string>, isWorkspace: false };
  }

  const [workspace] = await db
    .select({ credentials: workspaceConnectionsTable.credentials })
    .from(workspaceConnectionsTable)
    .where(eq(workspaceConnectionsTable.provider, platform));

  if (workspace?.credentials) {
    return { credentials: workspace.credentials as Record<string, string>, isWorkspace: true };
  }

  return null;
}

// GET /content-posts
router.get("/", requireAuth, async (req, res) => {
  try {
    const where = [];
    if (req.query.releaseId) where.push(eq(contentPostsTable.releaseId, Number(req.query.releaseId)));
    if (req.query.platform)  where.push(eq(contentPostsTable.platform, req.query.platform as "instagram"));
    if (req.query.status)    where.push(eq(contentPostsTable.status, req.query.status as "draft"));

    const rows = await db.select().from(contentPostsTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(contentPostsTable.scheduledAt);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listContentPosts failed");
    res.status(500).json({ error: "Failed to list content posts" });
  }
});

// POST /content-posts
router.post("/", requireAuth, async (req, res) => {
  const parsed = ContentPostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.insert(contentPostsTable).values({
      releaseId:   d.releaseId ?? null,
      platform:    d.platform as "instagram",
      scheduledAt: new Date(d.scheduledAt),
      copy:        d.copy,
      mediaUrls:   d.mediaUrls,
      status:      d.status,
      createdBy:   req.user!.userId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createContentPost failed");
    res.status(500).json({ error: "Failed to create content post" });
  }
});

// GET /content-posts/:id
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  try {
    const [row] = await db.select().from(contentPostsTable).where(eq(contentPostsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getContentPost failed");
    res.status(500).json({ error: "Failed to get content post" });
  }
});

// PUT /content-posts/:id
router.put("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  const parsed = ContentPostBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  const updates: Record<string, unknown> = { ...d, updatedAt: new Date() };
  if (d.scheduledAt) updates.scheduledAt = new Date(d.scheduledAt);
  if (d.status === "posted") updates.postedAt = new Date();

  try {
    const [row] = await db.update(contentPostsTable)
      .set(updates)
      .where(eq(contentPostsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "updateContentPost failed");
    res.status(500).json({ error: "Failed to update content post" });
  }
});

// DELETE /content-posts/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  try {
    await db.delete(contentPostsTable).where(eq(contentPostsTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteContentPost failed");
    res.status(500).json({ error: "Failed to delete content post" });
  }
});

// POST /content-posts/:id/publish — manual publish NOW via connected account
router.post("/:id/publish", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  const userId = req.user!.userId;

  const [post] = await db.select().from(contentPostsTable).where(eq(contentPostsTable.id, id));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }
  if (post.status === "posted") { res.status(400).json({ error: "Post already published" }); return; }

  // Resolve credentials: personal first, workspace fallback
  const resolved = await resolveCredentials(userId, post.platform);

  if (!resolved) {
    res.status(400).json({
      error: `No ${post.platform} account connected. Go to Settings → Integrations to connect it first, or ask an admin to set up a company account.`,
    });
    return;
  }

  const result = await publishPost(
    post.platform,
    resolved.credentials,
    post.copy,
    (post.mediaUrls as string[]) ?? [],
  );

  if (result.ok) {
    const [updated] = await db.update(contentPostsTable)
      .set({ status: "posted", postedAt: new Date(), publishError: null, updatedAt: new Date() })
      .where(eq(contentPostsTable.id, id))
      .returning();
    req.log.info({ postId: id, platform: post.platform, isWorkspace: resolved.isWorkspace }, "Content post published manually");
    res.json(updated);
  } else {
    await db.update(contentPostsTable)
      .set({ publishError: result.error, updatedAt: new Date() })
      .where(eq(contentPostsTable.id, id));
    req.log.warn({ postId: id, platform: post.platform, error: result.error }, "Content post publish failed");
    res.status(422).json({ error: result.error });
  }
});

export default router;
