import nodemailer from "nodemailer";
import { db, userEmailSettingsTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendGraphEmail, getAnyGraphSender } from "./microsoft-graph.js";

function buildInviteEmailHtml(opts: {
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}): string {
  const expiry = opts.expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:520px;margin:40px auto;padding:0 20px">
<div style="border-radius:8px;border:1px solid #e4e4e7;padding:28px 32px">
  <h2 style="margin:0 0 12px;font-size:17px;font-weight:600;color:#18181b">You've been invited to join the team</h2>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b">
    <strong>${opts.inviterName}</strong> has invited you to create an account. Click the link below to set up your profile and get started.
  </p>
  <a href="${opts.inviteUrl}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500;margin-bottom:16px">
    Accept Invitation
  </a>
  <p style="margin:0;font-size:12px;color:#a1a1aa">
    Or copy this link: <span style="word-break:break-all">${opts.inviteUrl}</span>
  </p>
  <hr style="margin:24px 0;border:none;border-top:1px solid #e4e4e7"/>
  <p style="margin:0;font-size:12px;color:#a1a1aa">This invite expires on ${expiry}. If you weren't expecting this email, you can safely ignore it.</p>
</div></body></html>`;
}

/**
 * Resolve an absolute public URL for the app.
 * Priority: APP_URL env var → first REPLIT_DOMAINS entry → http://localhost:80
 */
function buildInviteUrl(token: string): string {
  const appUrl = process.env["APP_URL"];
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/invite/${token}`;

  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const primary = domains.split(",")[0]!.trim();
    return `https://${primary}/invite/${token}`;
  }

  return `http://localhost:80/invite/${token}`;
}

/** Inviter's own verified SMTP settings, or null if not configured / unverified. */
async function getSmtpForUser(userId: number): Promise<typeof userEmailSettingsTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.userId, userId))
    .limit(1);
  if (row && row.smtpHost && row.smtpUser && row.isVerified) return row;
  return null;
}

/**
 * System-level fallback: the lowest-id verified SMTP row (deterministic ordering).
 * Excludes the inviter's own row since that was already checked above.
 */
async function getFallbackSmtp(excludeUserId: number): Promise<typeof userEmailSettingsTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.isVerified, true))
    .orderBy(asc(userEmailSettingsTable.id))
    .limit(10);
  return rows.find((r) => r.userId !== excludeUserId) ?? null;
}

async function sendViaSMTP(
  smtp: typeof userEmailSettingsTable.$inferSelect,
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  const transport = nodemailer.createTransport({
    host:   smtp.smtpHost,
    port:   smtp.smtpPort,
    secure: smtp.smtpSecure,
    auth:   { user: smtp.smtpUser, pass: smtp.smtpPass },
  });
  await transport.sendMail({
    from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
    to,
    subject,
    html,
  });
}

export async function sendInviteEmail(opts: {
  toEmail: string;
  inviteToken: string;
  expiresAt: Date;
  invitedByUserId: number;
}): Promise<boolean> {
  try {
    const [inviter] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, opts.invitedByUserId))
      .limit(1);

    const inviterName = inviter?.name ?? "Your team admin";
    const inviteUrl   = buildInviteUrl(opts.inviteToken);
    const html        = buildInviteEmailHtml({ inviterName, inviteUrl, expiresAt: opts.expiresAt });
    const subject     = `${inviterName} invited you to join the team`;

    // 1️⃣ Prefer the inviter's own Outlook (Graph API — bypasses SMTP AUTH restriction)
    const sent = await sendGraphEmail(opts.invitedByUserId, { to: opts.toEmail, subject, html });
    if (sent) {
      logger.info({ to: opts.toEmail, via: "graph", sender: "user" }, "Invite email sent via Microsoft Graph");
      return true;
    }

    // 2️⃣ Try any other team member's Outlook connection
    const anySender = await getAnyGraphSender();
    if (anySender && anySender.userId !== opts.invitedByUserId) {
      try {
        await anySender.client.api("/me/sendMail").post({
          message: {
            subject,
            body: { contentType: "HTML", content: html },
            toRecipients: [{ emailAddress: { address: opts.toEmail } }],
          },
        });
        logger.info({ to: opts.toEmail, via: "graph", sender: "system" }, "Invite email sent via system Graph sender");
        return true;
      } catch { /* fall through */ }
    }

    // 3️⃣ Inviter's own verified SMTP
    const userSmtp = await getSmtpForUser(opts.invitedByUserId);
    if (userSmtp) {
      await sendViaSMTP(userSmtp, opts.toEmail, subject, html);
      logger.info({ to: opts.toEmail, via: "smtp", sender: "user" }, "Invite email sent via user SMTP");
      return true;
    }

    // 4️⃣ System-level fallback SMTP
    const fallbackSmtp = await getFallbackSmtp(opts.invitedByUserId);
    if (fallbackSmtp) {
      await sendViaSMTP(fallbackSmtp, opts.toEmail, subject, html);
      logger.info({ to: opts.toEmail, via: "smtp", sender: "system" }, "Invite email sent via system fallback SMTP");
      return true;
    }

    logger.info({ to: opts.toEmail }, "Invite email skipped — no email sender configured");
    return false;
  } catch (err) {
    logger.warn({ err, to: opts.toEmail }, "Failed to send invite email");
    return false;
  }
}
