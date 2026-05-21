import nodemailer from "nodemailer";
import { db, usersTable, userEmailSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendGraphEmailViaAnySender } from "./microsoft-graph.js";

export interface NotificationPrefs {
  newMessage: boolean;
  portalMessage: boolean;
  dealCreated: boolean;
  dealStageChanged: boolean;
  dealUpdated: boolean;
  newContact: boolean;
  projectCreated: boolean;
  projectStatusChanged: boolean;
  dealNoteAdded: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  newMessage: false,
  portalMessage: false,
  dealCreated: false,
  dealStageChanged: false,
  dealUpdated: false,
  newContact: false,
  projectCreated: false,
  projectStatusChanged: false,
  dealNoteAdded: false,
};

export const NOTIF_LABELS: Record<keyof NotificationPrefs, string> = {
  newMessage:            "New message in a thread",
  portalMessage:         "Client sends a portal message",
  dealCreated:           "New deal created",
  dealStageChanged:      "Deal stage changes",
  dealUpdated:           "Deal info updated",
  newContact:            "New contact added",
  projectCreated:        "New studio project created",
  projectStatusChanged:  "Studio project status changes",
  dealNoteAdded:         "Note added to a deal",
};

function emailHtml(title: string, body: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:520px;margin:40px auto;padding:0 20px">
<div style="border-radius:8px;border:1px solid #e4e4e7;padding:28px 32px">
  <h2 style="margin:0 0 12px;font-size:17px;font-weight:600;color:#18181b">${title}</h2>
  <div style="margin:0;font-size:14px;line-height:1.6;color:#52525b">${body}</div>
  <hr style="margin:24px 0;border:none;border-top:1px solid #e4e4e7"/>
  <p style="margin:0;font-size:12px;color:#a1a1aa">You're receiving this because you have email notifications enabled in the CRM.</p>
</div></body></html>`;
}

async function getSenderSmtp(): Promise<typeof userEmailSettingsTable.$inferSelect | null> {
  const rows = await db
    .select()
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.isVerified, true))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Send a notification email to a specific recipient.
 * Priority: Microsoft Graph (any connected Outlook user) → verified SMTP → silent skip.
 * Returns true if the email was successfully dispatched, false otherwise.
 */
export async function sendNotificationEmail(toEmail: string, subject: string, body: string, _toUserId?: number): Promise<boolean> {
  try {
    const html = emailHtml(subject, body);

    // 1️⃣ Try Graph API via any team member's connected Outlook account
    const sentViaGraph = await sendGraphEmailViaAnySender({ to: toEmail, subject, html });
    if (sentViaGraph) {
      logger.info({ to: toEmail, subject, via: "graph" }, "Notification email sent via Microsoft Graph");
      return true;
    }

    // 2️⃣ Fall back to verified SMTP
    const smtp = await getSenderSmtp();
    if (!smtp) return false;
    const transport = nodemailer.createTransport({
      host:   smtp.smtpHost,
      port:   smtp.smtpPort,
      secure: smtp.smtpSecure,
      auth:   { user: smtp.smtpUser, pass: smtp.smtpPass },
    });
    await transport.sendMail({
      from:    `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to:      toEmail,
      subject,
      html,
    });
    logger.info({ to: toEmail, subject, via: "smtp" }, "Notification email sent via SMTP");
    return true;
  } catch (err) {
    logger.warn({ err, to: toEmail, subject }, "Failed to send notification email");
    return false;
  }
}

export async function notifyUsersWithPref(
  pref: keyof NotificationPrefs,
  subject: string,
  body: string,
  excludeUserId?: number,
): Promise<void> {
  try {
    const users = await db
      .select({ id: usersTable.id, email: usersTable.email, notificationPrefs: usersTable.notificationPrefs })
      .from(usersTable);

    const targets = users.filter((u) => {
      if (excludeUserId !== undefined && u.id === excludeUserId) return false;
      const prefs = (u.notificationPrefs as NotificationPrefs | null) ?? DEFAULT_PREFS;
      return prefs[pref] === true;
    });

    await Promise.allSettled(targets.map((u) => sendNotificationEmail(u.email, subject, body, u.id)));
  } catch (err) {
    logger.warn({ err, pref }, "notifyUsersWithPref error");
  }
}
