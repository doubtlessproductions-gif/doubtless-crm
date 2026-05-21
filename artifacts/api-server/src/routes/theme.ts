import { Router } from "express";
import { db, themeSettingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

async function ensureTheme() {
  const [existing] = await db.select().from(themeSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(themeSettingsTable).values({}).returning();
  return created!;
}

router.get("/", async (_req, res) => {
  const theme = await ensureTheme();
  res.json(formatTheme(theme));
});

router.put("/", requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);

  if (user?.role !== "admin" && user?.role !== "manager" && user?.role !== "owner") {
    res.status(403).json({ error: "Admin, manager, or owner access required" });
    return;
  }

  const theme = await ensureTheme();
  const { primaryColor, accentColor, logoUrl, companyName, sidebarConfig, invoiceRemindersEnabled } = req.body;

  const [updated] = await db
    .update(themeSettingsTable)
    .set({
      primaryColor: primaryColor ?? theme.primaryColor,
      accentColor: accentColor ?? theme.accentColor,
      logoUrl: logoUrl !== undefined ? logoUrl : theme.logoUrl,
      companyName: companyName ?? theme.companyName,
      sidebarConfig: sidebarConfig !== undefined ? sidebarConfig : theme.sidebarConfig,
      invoiceRemindersEnabled: invoiceRemindersEnabled !== undefined ? Boolean(invoiceRemindersEnabled) : theme.invoiceRemindersEnabled,
      updatedAt: new Date(),
    })
    .where(eq(themeSettingsTable.id, theme.id))
    .returning();

  res.json(formatTheme(updated!));
});

function formatTheme(t: typeof themeSettingsTable.$inferSelect) {
  return {
    id: t.id,
    primaryColor: t.primaryColor,
    accentColor: t.accentColor,
    logoUrl: t.logoUrl,
    companyName: t.companyName,
    sidebarConfig: t.sidebarConfig,
    invoiceRemindersEnabled: t.invoiceRemindersEnabled,
    updatedAt: t.updatedAt,
  };
}

export default router;
