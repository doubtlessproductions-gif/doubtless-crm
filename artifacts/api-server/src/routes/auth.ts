import { Router } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod/v4";
import { db, usersTable, activityTable, staffInvitesTable } from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { signToken, requireAuth } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import {
  checkAccountLockout,
  recordLoginFailure,
  clearLoginFailures,
} from "../middlewares/security.js";
import { sendInviteEmail } from "../lib/invite-email.js";

const router = Router();

// Safe user fields — never includes passwordHash
const SAFE_USER_FIELDS = {
  id:        usersTable.id,
  name:      usersTable.name,
  email:     usersTable.email,
  role:      usersTable.role,
  createdAt: usersTable.createdAt,
} as const;

// ── Password strength validator ───────────────────────────────────────────────
function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(password) && !/[0-9]/.test(password) && !/[^A-Za-z0-9]/.test(password)) {
    return "Password must contain at least one uppercase letter, number, or special character";
  }
  return null;
}

// ── POST /api/auth/register — bootstrap only (first user becomes admin) ───────
router.post("/register", async (req, res) => {
  const existingUsers = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existingUsers.length > 0) {
    res.status(403).json({ error: "Registration is invite-only. Ask your team admin for an invite link." });
    return;
  }

  const parse = RegisterBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { name, password } = parse.data;
  const email = parse.data.email.toLowerCase();
  const strengthError = validatePasswordStrength(password);
  if (strengthError) { res.status(400).json({ error: strengthError }); return; }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, passwordHash, role: "owner" })
    .returning(SAFE_USER_FIELDS);

  await db.insert(activityTable).values({ userId: user!.id, type: "account", description: "Account created (bootstrap admin)" });
  logger.info({ userId: user!.id, email, ip: req.ip }, "Bootstrap admin account registered");

  const token = signToken({ userId: user!.id, email: user!.email, role: user!.role });
  res.status(201).json({ token, user });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const parse = LoginBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { email, password } = parse.data;

  // Account lockout check — must run before bcrypt to prevent timing oracle
  const lockout = checkAccountLockout(email);
  if (lockout.locked) {
    logger.warn({ email, ip: req.ip }, "Login blocked — account locked");
    const minutes = Math.ceil((lockout.waitSeconds ?? 900) / 60);
    res.status(429).json({ error: `Account temporarily locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
    return;
  }

  // Fetch only the fields we need (passwordHash required for bcrypt comparison)
  // Case-insensitive email match — "Collin@..." and "collin@..." are the same account
  const [user] = await db
    .select({
      id:           usersTable.id,
      name:         usersTable.name,
      email:        usersTable.email,
      role:         usersTable.role,
      passwordHash: usersTable.passwordHash,
      createdAt:    usersTable.createdAt,
    })
    .from(usersTable)
    .where(sql`lower(${usersTable.email}) = lower(${email})`)
    .limit(1);

  if (!user) {
    // Don't reveal whether email exists
    logger.warn({ email, ip: req.ip }, "Failed login — unknown email");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    recordLoginFailure(email, (msg) => logger.warn(msg));
    logger.warn({ userId: user.id, email, ip: req.ip }, "Failed login — wrong password");
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Success — clear any failure record
  clearLoginFailures(email);
  await db.insert(activityTable).values({ userId: user.id, type: "login", description: `Signed in from ${req.ip ?? "unknown IP"}` });
  logger.info({ userId: user.id, email, ip: req.ip }, "Successful login");

  const token = signToken({ userId: user.id, email: user.email, role: user.role });
  // Never include passwordHash in response
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt } });
});

// ── POST /api/auth/invite — admin creates a staff invite ──────────────────────
router.post("/invite", requireAuth, async (req, res) => {
  // Parse body first so we can check role before the DB call
  const parse = z.object({
    email: z.string().email(),
    role: z.enum(["owner", "admin", "manager", "artist", "engineer", "ar", "intern"]).default("intern"),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  // Verify caller role via DB (not just JWT claim)
  const [caller] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.userId))
    .limit(1);
  if (caller?.role !== "admin" && caller?.role !== "owner") {
    res.status(403).json({ error: "Admin access required" }); return;
  }
  // Only owners can invite other owners
  if (parse.data.role === "owner" && caller.role !== "owner") {
    res.status(403).json({ error: "Only the owner can invite other owners" }); return;
  }

  const { email, role } = parse.data;

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "A user with this email already exists" }); return; }

  // Remove any existing unused invite for this email
  await db.delete(staffInvitesTable).where(and(eq(staffInvitesTable.email, email), isNull(staffInvitesTable.usedAt)));

  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const [invite] = await db.insert(staffInvitesTable).values({
    email, role, invitedBy: req.user!.userId, token, expiresAt,
  }).returning();

  logger.info({ email, role, invitedBy: req.user!.userId }, "Staff invite created");

  const emailSent = await sendInviteEmail({
    toEmail: email,
    inviteToken: token,
    expiresAt: invite!.expiresAt,
    invitedByUserId: req.user!.userId,
  });

  res.status(201).json({
    inviteToken: invite!.token,
    email: invite!.email,
    role: invite!.role,
    expiresAt: invite!.expiresAt,
    emailSent,
  });
});

// ── GET /api/auth/invite/:token — validate an invite ─────────────────────────
router.get("/invite/:token", async (req, res) => {
  const token = req.params["token"] as string;
  const [invite] = await db.select().from(staffInvitesTable).where(eq(staffInvitesTable.token, token)).limit(1);

  if (!invite) { res.status(404).json({ error: "Invite not found or invalid" }); return; }
  if (invite.usedAt) { res.status(410).json({ error: "This invite has already been used" }); return; }
  if (new Date() > invite.expiresAt) { res.status(410).json({ error: "This invite has expired. Ask your admin for a new one." }); return; }

  res.json({ email: invite.email, role: invite.role, expiresAt: invite.expiresAt });
});

// ── POST /api/auth/invite/:token/accept — accept invite + create account ──────
router.post("/invite/:token/accept", async (req, res) => {
  const token = req.params["token"] as string;
  const [invite] = await db.select().from(staffInvitesTable).where(eq(staffInvitesTable.token, token)).limit(1);

  if (!invite) { res.status(404).json({ error: "Invite not found or invalid" }); return; }
  if (invite.usedAt) { res.status(410).json({ error: "This invite has already been used" }); return; }
  if (new Date() > invite.expiresAt) { res.status(410).json({ error: "This invite has expired." }); return; }

  const parse = z.object({ name: z.string().min(1).max(100), password: z.string().min(8) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { name, password } = parse.data;
  const strengthError = validatePasswordStrength(password);
  if (strengthError) { res.status(400).json({ error: strengthError }); return; }

  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, invite.email)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "An account with this email already exists" }); return; }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({ name, email: invite.email.toLowerCase(), passwordHash, role: invite.role })
    .returning(SAFE_USER_FIELDS);

  await db.update(staffInvitesTable).set({ usedAt: new Date() }).where(eq(staffInvitesTable.id, invite.id));
  await db.insert(activityTable).values({ userId: user!.id, type: "account", description: "Account created via team invite" });

  logger.info({ userId: user!.id, email: user!.email, ip: req.ip }, "Account created via invite");

  const authToken = signToken({ userId: user!.id, email: user!.email, role: user!.role });
  res.status(201).json({ token: authToken, user });
});

export default router;
