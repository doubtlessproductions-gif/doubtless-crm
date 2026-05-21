// Per-user company email (SMTP) settings — link, verify, and send via own email
import { Router } from "express";
import { db, userEmailSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import nodemailer from "nodemailer";

const router = Router();

const SettingsBody = z.object({
  fromName: z.string().min(1),
  fromEmail: z.string().email(),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  smtpSecure: z.boolean().default(false),
});

// GET /api/email-settings — get current user's email settings
router.get("/", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.userId, req.user!.userId));
  if (!rows.length) {
    res.json(null);
    return;
  }
  // Never return the raw password to the client
  const { smtpPass: _, ...safe } = rows[0]!;
  res.json({ ...safe, hasPassword: rows[0]!.smtpPass.length > 0 });
});

// PUT /api/email-settings — create or update
router.put("/", requireAuth, async (req, res) => {
  const parse = SettingsBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure } = parse.data;

  const existing = await db
    .select({ id: userEmailSettingsTable.id })
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.userId, req.user!.userId));

  if (existing.length) {
    await db
      .update(userEmailSettingsTable)
      .set({ fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure, isVerified: false, updatedAt: new Date() })
      .where(eq(userEmailSettingsTable.userId, req.user!.userId));
  } else {
    await db.insert(userEmailSettingsTable).values({
      userId: req.user!.userId,
      fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure,
    });
  }

  res.json({ ok: true });
});

// POST /api/email-settings/verify — send a test email to confirm SMTP works
router.post("/verify", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.userId, req.user!.userId));

  if (!rows.length || !rows[0]!.smtpHost) {
    res.status(400).json({ error: "No email settings configured" });
    return;
  }

  const s = rows[0]!;
  try {
    const transport = nodemailer.createTransport({
      host: s.smtpHost,
      port: s.smtpPort,
      secure: s.smtpSecure,
      auth: { user: s.smtpUser, pass: s.smtpPass },
    });

    await transport.verify();

    // Send a real test message to themselves
    await transport.sendMail({
      from: `"${s.fromName}" <${s.fromEmail}>`,
      to: s.fromEmail,
      subject: "CRM — Email connection verified ✓",
      html: `<p>Your company email <strong>${s.fromEmail}</strong> is successfully linked to the CRM.</p>`,
    });

    await db
      .update(userEmailSettingsTable)
      .set({ isVerified: true, updatedAt: new Date() })
      .where(eq(userEmailSettingsTable.userId, req.user!.userId));

    res.json({ ok: true });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "SMTP connection failed";

    // Microsoft 365 tenant has SMTP AUTH (Basic Auth) disabled at the admin level
    if (raw.includes("5.7.139") || raw.toLowerCase().includes("smtpclientauthentication is disabled")) {
      res.status(422).json({
        error: "SMTP AUTH is disabled for your Microsoft 365 tenant.",
        hint: "An M365 admin must enable SMTP AUTH for this mailbox: Exchange Admin Center → Recipients → Mailboxes → select the user → Mail flow settings → toggle SMTP AUTH on.",
        docsUrl: "https://aka.ms/smtp_auth_disabled",
        code: "M365_SMTP_AUTH_DISABLED",
      });
      return;
    }

    // Generic credential failure
    if (raw.includes("535") || raw.toLowerCase().includes("authentication")) {
      res.status(422).json({ error: "Authentication failed — check your username and password and try again." });
      return;
    }

    res.status(422).json({ error: raw });
  }
});

// DELETE /api/email-settings — unlink email
router.delete("/", requireAuth, async (req, res) => {
  await db
    .delete(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.userId, req.user!.userId));
  res.json({ ok: true });
});

export default router;
