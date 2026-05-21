import { Router } from "express";
import { db, usersTable, userPermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const [permsRow] = await db
    .select({ permissions: userPermissionsTable.permissions })
    .from(userPermissionsTable)
    .where(eq(userPermissionsTable.userId, user.id))
    .limit(1);

  res.json({
    id:          user.id,
    name:        user.name,
    email:       user.email,
    role:        user.role,
    userType:    user.userType,
    allowedTabs: user.allowedTabs,
    colorMode:   user.colorMode,
    createdAt:   user.createdAt,
    permissions: permsRow?.permissions ?? {},
  });
});

// ── PUT /api/users/me/color-mode — save light/dark preference ─────────────────
router.put("/me/color-mode", requireAuth, async (req, res) => {
  const parse = z.object({ colorMode: z.enum(["light", "dark"]) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid colorMode" }); return; }
  await db
    .update(usersTable)
    .set({ colorMode: parse.data.colorMode })
    .where(eq(usersTable.id, req.user!.userId));
  res.json({ colorMode: parse.data.colorMode });
});

export default router;
