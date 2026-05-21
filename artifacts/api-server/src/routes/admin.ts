import { Router, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "crypto";
import { db, usersTable, userRoleEnum, userConnectionsTable, userEmailSettingsTable, rolePermissionsTable, roleQuotasTable, userQuotasTable, customQuotaCategoriesTable, portalUsersTable, contactsTable, dealsTable, messagesTable, messageThreadsTable, auditLogsTable, userPermissionsTable, staffInvitesTable } from "@workspace/db";
import { eq, inArray, and, ne, isNotNull, isNull, sql, desc, ilike, gte, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod/v4";

const router = Router();

// Safe user fields shared by multiple routes
const SAFE_USER = {
  id:               usersTable.id,
  name:             usersTable.name,
  email:            usersTable.email,
  role:             usersTable.role,
  userType:         usersTable.userType,
  allowedTabs:      usersTable.allowedTabs,
  createdAt:        usersTable.createdAt,
  targetHourlyRate: usersTable.targetHourlyRate,
  colorMode:        usersTable.colorMode,
} as const;

// ── Middleware ────────────────────────────────────────────────────────────────
// Admin OR Owner may access
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId))
      .limit(1);
    if (user?.role !== "admin" && user?.role !== "owner") {
      res.status(403).json({ error: "Admin access required" }); return;
    }
    next();
  });
}

// Owner only
function requireOwner(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, async () => {
    const [user] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, req.user!.userId))
      .limit(1);
    if (user?.role !== "owner") {
      res.status(403).json({ error: "Owner access required" }); return;
    }
    next();
  });
}

// ── Helper: build a safe AdminUser response shape ─────────────────────────────
async function buildAdminUser(user: { id: number; name: string; email: string; role: string; userType: string | null; allowedTabs: string[] | null; createdAt: Date }) {
  const conns = await db
    .select({ provider: userConnectionsTable.provider })
    .from(userConnectionsTable)
    .where(eq(userConnectionsTable.userId, user.id));
  const smtpRows = await db
    .select({ userId: userEmailSettingsTable.userId })
    .from(userEmailSettingsTable)
    .where(and(eq(userEmailSettingsTable.userId, user.id), ne(userEmailSettingsTable.smtpHost, "")));
  const connectedProviders = conns.map((c) => c.provider);
  if (smtpRows.length) connectedProviders.push("smtp");
  return { ...user, connectedProviders };
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get("/users", requireAdmin, async (_req, res) => {
  const users = await db.select(SAFE_USER).from(usersTable).orderBy(usersTable.createdAt);
  const userIds = users.map((u) => u.id);

  const connections = userIds.length
    ? await db
        .select({ userId: userConnectionsTable.userId, provider: userConnectionsTable.provider })
        .from(userConnectionsTable)
        .where(inArray(userConnectionsTable.userId, userIds))
    : [];

  const smtpConfigured = userIds.length
    ? await db
        .select({ userId: userEmailSettingsTable.userId })
        .from(userEmailSettingsTable)
        .where(and(inArray(userEmailSettingsTable.userId, userIds), ne(userEmailSettingsTable.smtpHost, "")))
    : [];
  const smtpUserIds = new Set(smtpConfigured.map((r) => r.userId));

  const connMap = new Map<number, string[]>();
  for (const conn of connections) {
    const list = connMap.get(conn.userId) ?? [];
    list.push(conn.provider);
    connMap.set(conn.userId, list);
  }

  res.json(
    users.map((u) => {
      const providers = connMap.get(u.id) ?? [];
      if (smtpUserIds.has(u.id)) providers.push("smtp");
      return { ...u, connectedProviders: providers };
    }),
  );
});

// ── PATCH /api/admin/users/:id/role ──────────────────────────────────────────
router.patch("/users/:id/role", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const newRole = req.body.role as string;
  const VALID_ROLES = userRoleEnum.enumValues;
  if (!VALID_ROLES.includes(newRole as typeof VALID_ROLES[number])) {
    res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` }); return;
  }

  // Look up caller and target
  const [caller] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  const [target] = await db.select({ role: usersTable.role, id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).limit(1);

  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.id === req.user!.userId) { res.status(400).json({ error: "You cannot change your own role" }); return; }

  if (caller?.role === "admin") {
    // Admins cannot touch owners or other admins, and cannot promote to owner/admin
    if (target.role === "owner" || target.role === "admin") {
      res.status(403).json({ error: "Admins cannot change the role of other admins or owners" }); return;
    }
    if (newRole === "owner" || newRole === "admin") {
      res.status(403).json({ error: "Admins cannot promote users to admin or owner — only the owner can do this" }); return;
    }
  }

  // Prevent demoting the last owner
  if (target.role === "owner" && newRole !== "owner") {
    const ownerCount = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "owner"));
    if (ownerCount.length <= 1) {
      res.status(400).json({ error: "Cannot demote the last owner — assign another owner first" }); return;
    }
  }

  const [updated] = await db.update(usersTable).set({ role: newRole as typeof VALID_ROLES[number] }).where(eq(usersTable.id, id)).returning(SAFE_USER);
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(await buildAdminUser(updated));
});

// ── DELETE /api/admin/users/:id — owner only ──────────────────────────────────
router.delete("/users/:id", requireOwner, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (id === req.user!.userId) { res.status(400).json({ error: "You cannot delete your own account" }); return; }

  const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.role === "owner") { res.status(400).json({ error: "Cannot delete another owner account" }); return; }

  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).end();
});

// ── GET /api/admin/users/:id/tabs ─────────────────────────────────────────────
router.get("/users/:id/tabs", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db.select({ allowedTabs: usersTable.allowedTabs }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ allowedTabs: user.allowedTabs });
});

// ── PATCH /api/admin/users/:id/tabs ──────────────────────────────────────────
router.patch("/users/:id/tabs", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = z.object({
    allowedTabs: z.array(z.string()).nullable(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  // Only owner can set tabs on another owner/admin
  const [target] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  const [caller] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);
  if ((target?.role === "owner" || target?.role === "admin") && caller?.role !== "owner") {
    res.status(403).json({ error: "Only the owner can restrict admin tab access" }); return;
  }

  const [user] = await db.update(usersTable)
    .set({ allowedTabs: parse.data.allowedTabs })
    .where(eq(usersTable.id, id))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  if (req.io) {
    req.io.to(`user:${id}`).emit("tabs:updated", { allowedTabs: user.allowedTabs });
  }

  res.json({ id: user.id, allowedTabs: user.allowedTabs });
});

// All valid team roles. Keep in sync with userRoleEnum in lib/db/src/schema/crm.ts.
const ALL_ROLES = ["owner", "admin", "manager", "artist", "engineer", "ar", "intern"] as const;

// Pages whose factory default is "every role has access". The admin (owner) can override these
// via PUT /api/admin/role-permissions at any time; stored overrides always take precedence.
const ROLE_PERMISSION_DEFAULTS: Record<string, string[]> = {
  "video-engine": [...ALL_ROLES],
};

// ── GET /api/admin/role-permissions ──────────────────────────────────────────
router.get("/role-permissions", requireAuth, async (_req, res) => {
  try {
    const [row] = await db.select().from(rolePermissionsTable).where(eq(rolePermissionsTable.id, 1)).limit(1);
    const stored = (row?.permissions ?? {}) as Record<string, string[]>;

    // Merge defaults: if a page has a factory default but no stored entry, apply the default.
    // Stored admin overrides always win, so this doesn't break future per-role toggling.
    const permissions: Record<string, string[]> = { ...ROLE_PERMISSION_DEFAULTS, ...stored };

    res.json({ permissions });
  } catch {
    res.status(500).json({ error: "Failed to fetch role permissions" });
  }
});

// ── PUT /api/admin/role-permissions — owner only ──────────────────────────────
router.put("/role-permissions", requireOwner, async (req, res) => {
  const parse = z.object({
    permissions: z.record(z.string(), z.array(z.string())),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid body" }); return; }

  try {
    await db
      .insert(rolePermissionsTable)
      .values({ id: 1, permissions: parse.data.permissions, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: rolePermissionsTable.id,
        set: { permissions: parse.data.permissions, updatedAt: new Date() },
      });
    res.json({ permissions: parse.data.permissions });
  } catch {
    res.status(500).json({ error: "Failed to save role permissions" });
  }
});

// ── Shared helper: fetch portal clients list with deal counts ─────────────────
async function fetchPortalClientsList() {
  const portalUsers = await db
    .select({
      id:               portalUsersTable.id,
      email:            portalUsersTable.email,
      contactId:        portalUsersTable.contactId,
      isActive:         portalUsersTable.isActive,
      inviteAcceptedAt: portalUsersTable.inviteAcceptedAt,
      lastLoginAt:      portalUsersTable.lastLoginAt,
      createdAt:        portalUsersTable.createdAt,
      contactName:      contactsTable.name,
      contactCompany:   contactsTable.company,
    })
    .from(portalUsersTable)
    .leftJoin(contactsTable, eq(portalUsersTable.contactId, contactsTable.id))
    .orderBy(portalUsersTable.createdAt);

  const contactIds = portalUsers.map((u) => u.contactId).filter(Boolean) as number[];
  const dealCountRows = contactIds.length
    ? await db
        .select({ contactId: dealsTable.contactId, count: sql<number>`count(*)::int` })
        .from(dealsTable)
        .where(inArray(dealsTable.contactId, contactIds))
        .groupBy(dealsTable.contactId)
    : [];

  const dealCountMap = new Map<number, number>();
  for (const row of dealCountRows) {
    if (row.contactId != null) dealCountMap.set(row.contactId, row.count);
  }

  return portalUsers.map((u) => ({ ...u, dealCount: dealCountMap.get(u.contactId) ?? 0 }));
}

// ── GET /api/admin/portal-clients — admin + owner ─────────────────────────────
router.get("/portal-clients", requireAdmin, async (_req, res) => {
  res.json(await fetchPortalClientsList());
});

// ── GET /api/admin/portal-clients/:id — admin + owner (detail) ───────────────
router.get("/portal-clients/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      id:               portalUsersTable.id,
      email:            portalUsersTable.email,
      contactId:        portalUsersTable.contactId,
      isActive:         portalUsersTable.isActive,
      inviteAcceptedAt: portalUsersTable.inviteAcceptedAt,
      lastLoginAt:      portalUsersTable.lastLoginAt,
      createdAt:        portalUsersTable.createdAt,
      contactName:      contactsTable.name,
      contactCompany:   contactsTable.company,
      contactEmail:     contactsTable.email,
    })
    .from(portalUsersTable)
    .leftJoin(contactsTable, eq(portalUsersTable.contactId, contactsTable.id))
    .where(eq(portalUsersTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Portal client not found" }); return; }

  const deals = await db
    .select({
      id:        dealsTable.id,
      title:     dealsTable.title,
      stage:     dealsTable.stage,
      value:     dealsTable.value,
      createdAt: dealsTable.createdAt,
      closedAt:  dealsTable.closedAt,
    })
    .from(dealsTable)
    .where(eq(dealsTable.contactId, row.contactId))
    .orderBy(desc(dealsTable.createdAt));

  const recentActivity = await db
    .select({
      messageId:    messagesTable.id,
      content:      messagesTable.content,
      fileUrl:      messagesTable.fileUrl,
      fileName:     messagesTable.fileName,
      createdAt:    messagesTable.createdAt,
      threadTitle:  messageThreadsTable.title,
      threadId:     messageThreadsTable.id,
    })
    .from(messagesTable)
    .innerJoin(messageThreadsTable, eq(messagesTable.threadId, messageThreadsTable.id))
    .where(eq(messagesTable.portalAuthorId, id))
    .orderBy(desc(messagesTable.createdAt))
    .limit(5);

  res.json({ ...row, deals, recentActivity });
});

// ── POST /api/admin/portal-invite — admin + owner ─────────────────────────────
router.post("/portal-invite", requireAdmin, async (req, res) => {
  const parse = z.object({ contactId: z.number() }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { contactId } = parse.data;
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId)).limit(1);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
  if (!contact.email) { res.status(400).json({ error: "Contact has no email address" }); return; }

  const inviteToken = randomBytes(32).toString("hex");
  const existing = await db.select().from(portalUsersTable).where(eq(portalUsersTable.contactId, contactId)).limit(1);
  let portalUser;

  if (existing.length > 0) {
    [portalUser] = await db
      .update(portalUsersTable)
      .set({ inviteToken, isActive: true, inviteAcceptedAt: null, passwordHash: null })
      .where(eq(portalUsersTable.contactId, contactId))
      .returning();
  } else {
    [portalUser] = await db
      .insert(portalUsersTable)
      .values({ contactId, email: contact.email, inviteToken })
      .returning();
  }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : "http://localhost:80";
  res.json({ inviteUrl: `${baseUrl}/portal/accept/${inviteToken}`, portalUser });
});

// ── POST /api/admin/portal-reinvite/:id — admin + owner (non-destructive) ─────
// Generates a fresh invite token WITHOUT touching passwordHash/inviteAcceptedAt.
// Existing credentials remain valid; the link can be used to set a new password
// only if the user chooses to follow it.
router.post("/portal-reinvite/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const inviteToken = randomBytes(32).toString("hex");
  const [updated] = await db
    .update(portalUsersTable)
    .set({ inviteToken })
    .where(eq(portalUsersTable.id, id))
    .returning({ id: portalUsersTable.id, email: portalUsersTable.email, inviteToken: portalUsersTable.inviteToken });

  if (!updated) { res.status(404).json({ error: "Portal user not found" }); return; }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : "http://localhost:80";
  res.json({ inviteUrl: `${baseUrl}/portal/accept/${updated.inviteToken}` });
});

// ── POST /api/admin/portal-reset/:id — admin + owner (destructive reset) ──────
// Explicitly wipes passwordHash + inviteAcceptedAt, forcing the user to re-accept.
// Must be called only after explicit confirmation in the UI.
router.post("/portal-reset/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const inviteToken = randomBytes(32).toString("hex");
  const [updated] = await db
    .update(portalUsersTable)
    .set({ inviteToken, inviteAcceptedAt: null, passwordHash: null, isActive: true })
    .where(eq(portalUsersTable.id, id))
    .returning({ id: portalUsersTable.id, email: portalUsersTable.email, inviteToken: portalUsersTable.inviteToken });

  if (!updated) { res.status(404).json({ error: "Portal user not found" }); return; }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : "http://localhost:80";
  res.json({ inviteUrl: `${baseUrl}/portal/accept/${updated.inviteToken}` });
});

// ── GET /api/admin/portal-contacts — admin + owner ────────────────────────────
router.get("/portal-contacts", requireAdmin, async (_req, res) => {
  const allContacts = await db
    .select({ id: contactsTable.id, name: contactsTable.name, email: contactsTable.email, company: contactsTable.company })
    .from(contactsTable)
    .where(isNotNull(contactsTable.email))
    .orderBy(contactsTable.name);

  const portalContactIds = new Set(
    (await db.select({ contactId: portalUsersTable.contactId }).from(portalUsersTable)).map((p) => p.contactId)
  );

  res.json(allContacts.filter((c) => !portalContactIds.has(c.id)));
});

// ── PATCH /api/admin/portal-users/:id/status — admin + owner ──────────────────
router.patch("/portal-users/:id/status", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [updated] = await db
    .update(portalUsersTable)
    .set({ isActive: parse.data.isActive })
    .where(eq(portalUsersTable.id, id))
    .returning({
      id:       portalUsersTable.id,
      isActive: portalUsersTable.isActive,
    });
  if (!updated) { res.status(404).json({ error: "Portal user not found" }); return; }
  res.json(updated);
});

// ── DELETE /api/admin/portal-users/:id — admin + owner ────────────────────────
router.delete("/portal-users/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db
    .delete(portalUsersTable)
    .where(eq(portalUsersTable.id, id))
    .returning({ id: portalUsersTable.id });
  if (!deleted) { res.status(404).json({ error: "Portal user not found" }); return; }
  res.json({ ok: true });
});

// ── GET /api/admin/portal-users — admin + owner (backward-compat alias) ───────
router.get("/portal-users", requireAdmin, async (_req, res) => {
  res.json(await fetchPortalClientsList());
});

// ── PUT /api/admin/users/:id/rate — set per-user target hourly rate ────────────
router.put("/users/:id/rate", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parse = z.object({
    targetHourlyRate: z.number().positive().nullable(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [updated] = await db
    .update(usersTable)
    .set({ targetHourlyRate: parse.data.targetHourlyRate != null ? String(parse.data.targetHourlyRate) : null })
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id, name: usersTable.name, targetHourlyRate: usersTable.targetHourlyRate });
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(updated);
});

// ── GET /api/admin/quota-categories ──────────────────────────────────────────
router.get("/quota-categories", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(customQuotaCategoriesTable).orderBy(customQuotaCategoriesTable.createdAt);
  res.json(rows);
});

// ── POST /api/admin/quota-categories ─────────────────────────────────────────
router.post("/quota-categories", requireAdmin, async (req, res) => {
  const parse = z.object({
    label:       z.string().min(1),
    unit:        z.string().default("count"),
    description: z.string().optional(),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const [row] = await db
    .insert(customQuotaCategoriesTable)
    .values({ label: parse.data.label, unit: parse.data.unit, description: parse.data.description ?? null })
    .returning();
  res.json(row);
});

// ── DELETE /api/admin/quota-categories/:id ────────────────────────────────────
router.delete("/quota-categories/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(customQuotaCategoriesTable).where(eq(customQuotaCategoriesTable.id, id));
  res.json({ ok: true });
});

// ── GET /api/admin/user-quotas — per-user quota overrides ────────────────────
router.get("/user-quotas", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(userQuotasTable);
  res.json(rows);
});

// ── PUT /api/admin/user-quotas — upsert per-user quota overrides ──────────────
router.put("/user-quotas", requireAdmin, async (req, res) => {
  const QuotaItem = z.object({
    userId:      z.number().int().positive(),
    metricKey:   z.string(),
    targetValue: z.number().min(0),
  });
  const parse = z.object({ quotas: z.array(QuotaItem) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const now = new Date();
  for (const q of parse.data.quotas) {
    await db
      .insert(userQuotasTable)
      .values({ userId: q.userId, metricKey: q.metricKey, targetValue: String(q.targetValue), updatedAt: now })
      .onConflictDoUpdate({
        target: [userQuotasTable.userId, userQuotasTable.metricKey],
        set: { targetValue: String(q.targetValue), updatedAt: now },
      });
  }
  const rows = await db.select().from(userQuotasTable);
  res.json(rows);
});

// ── GET /api/admin/role-quotas — get all quotas (admin + owner) ───────────────
router.get("/role-quotas", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(roleQuotasTable);
  res.json(rows);
});

// ── PUT /api/admin/role-quotas — upsert quotas (admin + owner) ────────────────
router.put("/role-quotas", requireAdmin, async (req, res) => {
  const QuotaItem = z.object({
    role:        z.string(),
    metricKey:   z.string(),
    targetValue: z.number().min(0),
  });
  const parse = z.object({ quotas: z.array(QuotaItem) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const now = new Date();
  for (const q of parse.data.quotas) {
    await db
      .insert(roleQuotasTable)
      .values({ role: q.role, metricKey: q.metricKey, targetValue: String(q.targetValue), updatedAt: now })
      .onConflictDoUpdate({
        target: [roleQuotasTable.role, roleQuotasTable.metricKey],
        set: { targetValue: String(q.targetValue), updatedAt: now },
      });
  }

  const rows = await db.select().from(roleQuotasTable);
  res.json(rows);
});

// ── GET /api/admin/users/:id/notification-prefs ───────────────────────────────
router.get("/users/:id/notification-prefs", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db
    .select({ notificationPrefs: usersTable.notificationPrefs })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user.notificationPrefs ?? {});
});

// ── PUT /api/admin/users/:id/notification-prefs ───────────────────────────────
router.put("/users/:id/notification-prefs", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  await db.update(usersTable).set({ notificationPrefs: req.body }).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

// ── GET /api/admin/me/notification-prefs — self-service ───────────────────────
router.get("/me/notification-prefs", requireAuth, async (req, res) => {
  const [user] = await db
    .select({ notificationPrefs: usersTable.notificationPrefs })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);
  res.json(user?.notificationPrefs ?? {});
});

// ── PUT /api/admin/me/notification-prefs — self-service ───────────────────────
router.put("/me/notification-prefs", requireAuth, async (req, res) => {
  await db
    .update(usersTable)
    .set({ notificationPrefs: req.body })
    .where(eq(usersTable.id, req.user!.userId));
  res.json({ ok: true });
});

// ── AUDIT LOGS ────────────────────────────────────────────────────────────────

// GET /api/admin/audit-logs?action=&entityType=&userId=&from=&to=&limit=&offset=
router.get("/audit-logs", requireOwner, async (req, res) => {
  const { action, entityType, userId, from, to, limit = "100", offset = "0" } = req.query as Record<string, string>;
  const conditions = [];
  if (action)     conditions.push(ilike(auditLogsTable.action, `%${action}%`));
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (userId)     conditions.push(eq(auditLogsTable.userId, Number(userId)));
  if (from)       conditions.push(gte(auditLogsTable.createdAt, new Date(from)));
  if (to)         conditions.push(lte(auditLogsTable.createdAt, new Date(to)));

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(Math.min(Number(limit), 500))
    .offset(Number(offset));

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(conditions.length ? and(...conditions) : undefined);

  res.json({ rows, total: count });
});

// ── STAFF INVITE MANAGEMENT ────────────────────────────────────────────────────

// GET /api/admin/invites — list all staff invites (pending + used)
router.get("/invites", requireAdmin, async (_req, res) => {
  const invites = await db
    .select({
      id:          staffInvitesTable.id,
      email:       staffInvitesTable.email,
      role:        staffInvitesTable.role,
      invitedBy:   staffInvitesTable.invitedBy,
      expiresAt:   staffInvitesTable.expiresAt,
      usedAt:      staffInvitesTable.usedAt,
      createdAt:   staffInvitesTable.createdAt,
      inviterName: usersTable.name,
    })
    .from(staffInvitesTable)
    .leftJoin(usersTable, eq(staffInvitesTable.invitedBy, usersTable.id))
    .orderBy(desc(staffInvitesTable.createdAt));

  // For used invites, look up the user account that was created with that email
  const usedEmails = invites.filter((i) => i.usedAt).map((i) => i.email);
  const claimedRows = usedEmails.length
    ? await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(inArray(usersTable.email, usedEmails))
    : [];
  const claimedByMap = new Map(claimedRows.map((u) => [u.email, u.name]));

  res.json(
    invites.map((i) => ({
      ...i,
      claimedByName: i.usedAt ? (claimedByMap.get(i.email) ?? null) : null,
    })),
  );
});

// DELETE /api/admin/invites/:id — revoke a pending invite (atomic: only deletes if not yet accepted)
router.delete("/invites/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // First confirm the invite exists so we can give a meaningful 404 vs 400
  const [invite] = await db
    .select({ id: staffInvitesTable.id, usedAt: staffInvitesTable.usedAt })
    .from(staffInvitesTable)
    .where(eq(staffInvitesTable.id, id))
    .limit(1);

  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.usedAt) { res.status(400).json({ error: "Cannot revoke an invite that has already been accepted" }); return; }

  // Atomic delete: only succeeds if the invite is still pending (usedAt IS NULL).
  // Guards against a race where the invite is accepted between the check above and the delete.
  const deleted = await db
    .delete(staffInvitesTable)
    .where(and(eq(staffInvitesTable.id, id), isNull(staffInvitesTable.usedAt)))
    .returning({ id: staffInvitesTable.id });

  if (!deleted.length) {
    res.status(400).json({ error: "Cannot revoke an invite that has already been accepted" }); return;
  }

  res.json({ ok: true });
});

// ── ADVANCED ACL — USER PERMISSIONS ──────────────────────────────────────────

// GET /api/admin/users/:id/permissions
router.get("/users/:id/permissions", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(userPermissionsTable).where(eq(userPermissionsTable.userId, id)).limit(1);
  res.json(row?.permissions ?? {});
});

// PUT /api/admin/users/:id/permissions
router.put("/users/:id/permissions", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const permissions = req.body as Record<string, boolean>;
  const [existing] = await db.select({ id: userPermissionsTable.id }).from(userPermissionsTable).where(eq(userPermissionsTable.userId, id)).limit(1);
  if (existing) {
    await db.update(userPermissionsTable).set({ permissions, updatedAt: new Date() }).where(eq(userPermissionsTable.userId, id));
  } else {
    await db.insert(userPermissionsTable).values({ userId: id, permissions });
  }
  res.json({ ok: true });
});

export default router;
