import { Router } from "express";
import crypto from "crypto";
import { db, apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { logger } from "../lib/logger.js";

const router = Router();

function hashKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

const VALID_SCOPES = ["contacts", "deals", "artists", "royalties", "forms"] as const;
type ApiKeyScope = typeof VALID_SCOPES[number];

// ── GET /api/api-keys ─────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const keys = await db
    .select({
      id:         apiKeysTable.id,
      name:       apiKeysTable.name,
      prefix:     apiKeysTable.prefix,
      scopes:     apiKeysTable.scopes,
      lastUsedAt: apiKeysTable.lastUsedAt,
      createdAt:  apiKeysTable.createdAt,
      revokedAt:  apiKeysTable.revokedAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, req.user!.userId));
  res.json(keys);
});

// ── POST /api/api-keys ────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const parse = z.object({
    name:   z.string().min(1).max(100),
    scopes: z.array(z.enum(VALID_SCOPES)).optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const rawKey = `apk_${crypto.randomBytes(32).toString("hex")}`;
  const prefix = rawKey.slice(4, 12); // first 8 chars after "apk_"
  const keyHash = hashKey(rawKey);
  const scopes: ApiKeyScope[] | null =
    parse.data.scopes && parse.data.scopes.length > 0 ? parse.data.scopes : null;

  const [key] = await db.insert(apiKeysTable).values({
    userId:  req.user!.userId,
    name:    parse.data.name,
    keyHash,
    prefix,
    scopes,
  }).returning();

  logger.info({ keyId: key!.id, userId: req.user!.userId, scopes }, "API key created");
  res.status(201).json({
    id: key!.id,
    userId: key!.userId,
    name: key!.name,
    prefix: key!.prefix,
    scopes: key!.scopes,
    createdAt: key!.createdAt,
    lastUsedAt: key!.lastUsedAt,
    revokedAt: key!.revokedAt,
    key: rawKey,
  });
});

// ── DELETE /api/api-keys/:id ──────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ userId: apiKeysTable.userId })
    .from(apiKeysTable).where(eq(apiKeysTable.id, id)).limit(1);
  if (!existing || existing.userId !== req.user!.userId) {
    res.status(404).json({ error: "Not found" }); return;
  }

  await db.update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeysTable.id, id));

  res.status(204).send();
});

export { requireReadAuth };

export default router;
