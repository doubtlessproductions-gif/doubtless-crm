// GET /api/security/status — admin-only security dashboard info
import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { SECURITY_STATUS } from "../middlewares/security.js";
import { db, activityTable } from "@workspace/db";
import { eq, desc, like } from "drizzle-orm";

const router = Router();

router.get("/status", requireAuth, async (_req, res) => {
  // Count recent failed login activity entries
  const recentFailedLogins = await db
    .select()
    .from(activityTable)
    .where(like(activityTable.description, "Signed in from%"))
    .orderBy(desc(activityTable.createdAt))
    .limit(5);

  res.json({
    ...SECURITY_STATUS,
    jwtSecretConfigured: !!process.env["SESSION_SECRET"],
    recentLogins: recentFailedLogins.map((a) => ({
      userId: a.userId,
      description: a.description,
      at: a.createdAt,
    })),
    nodeEnv: process.env["NODE_ENV"] ?? "unknown",
    uptime: Math.floor(process.uptime()),
  });
});

export default router;
