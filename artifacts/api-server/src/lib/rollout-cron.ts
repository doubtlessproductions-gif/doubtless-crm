import cron from "node-cron";
import { randomUUID } from "crypto";
import { db, rolloutActionsTable, releasesTable, projectPagesTable, invoicesTable, contactsTable, themeSettingsTable } from "@workspace/db";
import type { Release, RolloutAction } from "@workspace/db";
import { and, eq, lte, lt, gte, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendNotificationEmail } from "./notify-email.js";

// ── Slug helper ────────────────────────────────────────────────────────────────
function toSlug(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Per-action handlers ───────────────────────────────────────────────────────

async function handleCreatePost(action: RolloutAction, release: Release) {
  const payload = action.payload as { text?: string };
  const content = `${payload.text ?? ""} — ${release.artistName ?? "Unknown"} "${release.title}"`;
  logger.info({ content, releaseId: release.id }, "Rollout: create_post queued");
  // In production: integrate with your social post scheduler
}

async function handleSendEmail(action: RolloutAction, release: Release) {
  const payload = action.payload as { subject?: string; body?: string };
  logger.info({ subject: payload.subject, releaseId: release.id }, "Rollout: send_email queued");
  // In production: integrate with your email provider
}

async function handleDropVideo(action: RolloutAction, release: Release) {
  logger.info(
    { audioUrl: release.audioUrl, coverArt: release.coverArtUrl, releaseId: release.id },
    "Rollout: drop_video render queued",
  );
  // In production: call your render worker / queueRender({ type: "waveform", ... })
}

async function handleUnlockContent(action: RolloutAction, release: Release) {
  const payload = action.payload as { price?: number };
  logger.info({ price: payload.price, releaseId: release.id }, "Rollout: unlock_content payment link queued");
  // In production: create Stripe payment link via /api/payments
}

async function handlePublishPage(_action: RolloutAction, release: Release) {
  const slug = `${toSlug(release.title)}-${release.id}`;

  // Idempotent: skip if page already exists
  const existing = await db.select({ id: projectPagesTable.id })
    .from(projectPagesTable)
    .where(eq(projectPagesTable.slug, slug))
    .limit(1);

  if (existing.length > 0) {
    logger.info({ slug }, "Rollout: publish_page already exists, skipping");
    return;
  }

  await db.insert(projectPagesTable).values({
    title:     release.title,
    slug,
    status:    "published",
    createdBy: release.createdBy ?? null,
    blocks: [
      ...(release.coverArtUrl
        ? [{ id: randomUUID(), type: "image" as const, url: release.coverArtUrl, alt: release.title }]
        : []),
      ...(release.audioUrl
        ? [{ id: randomUUID(), type: "audio" as const, url: release.audioUrl, title: release.title }]
        : []),
      { id: randomUUID(), type: "heading" as const, text: release.title, level: 1 as const },
      ...(release.artistName
        ? [{ id: randomUUID(), type: "text" as const, content: `By ${release.artistName}` }]
        : []),
      { id: randomUUID(), type: "text" as const, content: "Stream now" },
    ],
  });

  logger.info({ slug, releaseId: release.id }, "Rollout: publish_page created");
}

// ── Shared action runner (used by cron + manual trigger endpoint) ─────────────

export async function handleRolloutAction(action: RolloutAction, release: Release): Promise<void> {
  switch (action.type) {
    case "create_post":     return handleCreatePost(action, release);
    case "send_email":      return handleSendEmail(action, release);
    case "drop_video":      return handleDropVideo(action, release);
    case "unlock_content":  return handleUnlockContent(action, release);
    case "publish_page":    return handlePublishPage(action, release);
    default:
      logger.warn({ type: action.type }, "Rollout: unknown action type");
  }
}

// ── Invoice reminder cron ─────────────────────────────────────────────────────

async function runInvoiceReminders() {
  // Check if reminders are enabled globally
  const [theme] = await db
    .select({ invoiceRemindersEnabled: themeSettingsTable.invoiceRemindersEnabled, companyName: themeSettingsTable.companyName })
    .from(themeSettingsTable)
    .limit(1);

  // Default to enabled when no settings row exists yet; only skip when explicitly disabled.
  if (theme && !theme.invoiceRemindersEnabled) return;

  const companyName = theme.companyName ?? "Your CRM";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  // Step 1: Flag "sent" invoices with a past dueDate as "overdue".
  // This mirrors flagOverdue() in routes/invoices.ts and ensures the cron doesn't
  // miss invoices in case no user loaded the invoice list that day.
  await db
    .update(invoicesTable)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(
      and(
        eq(invoicesTable.status, "sent"),
        lt(invoicesTable.dueDate, todayStr),
      ),
    );

  // Step 2: "sent" invoices due within the next 3 days — upcoming reminder (once)
  const in3Days = new Date(today);
  in3Days.setDate(in3Days.getDate() + 3);
  const in3DaysStr = in3Days.toISOString().slice(0, 10);

  const upcomingDue = await db
    .select({
      inv:          invoicesTable,
      contactEmail: contactsTable.email,
      contactName:  contactsTable.name,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(
      and(
        eq(invoicesTable.status, "sent"),
        gte(invoicesTable.dueDate, todayStr),
        lte(invoicesTable.dueDate, in3DaysStr),
        eq(invoicesTable.remindersSent, 0),
      ),
    );

  // Step 3: Overdue alert — invoices that transitioned to "overdue" today (updatedAt >= today
  // midnight) and haven't yet received the overdue alert. Using updatedAt rather than the
  // returning() IDs means we also catch invoices flipped by the route-level flagOverdue()
  // before the cron ran (e.g. when a user opened the invoice list earlier in the day),
  // while still excluding historical pre-deployment backlog with old updatedAt values.
  const overdueAlerts = await db
    .select({
      inv:          invoicesTable,
      contactEmail: contactsTable.email,
      contactName:  contactsTable.name,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(
      and(
        eq(invoicesTable.status, "overdue"),
        eq(invoicesTable.overdueAlertSent, false),
        gte(invoicesTable.updatedAt, today),
      ),
    );

  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  const baseUrl = domain ? `https://${domain}` : "http://localhost";

  async function sendReminder(
    inv: typeof invoicesTable.$inferSelect,
    contactEmail: string | null,
    contactName: string | null,
    isOverdue: boolean,
  ) {
    if (!contactEmail) {
      logger.warn({ invoiceId: inv.id }, "Invoice reminder: contact has no email, skipping");
      return;
    }

    const viewUrl = inv.viewToken ? `${baseUrl}/api/invoices/view/${inv.viewToken}` : null;
    const dueLine = inv.dueDate
      ? `due on <strong>${new Date(inv.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</strong>`
      : "due soon";

    const subject = isOverdue
      ? `Overdue: Invoice ${inv.number} from ${companyName}`
      : `Reminder: Invoice ${inv.number} is ${dueLine.replace(/<[^>]*>/g, "")}`;

    const bodyLines = [
      `Hi ${contactName ?? "there"},`,
      isOverdue
        ? `Your invoice <strong>${inv.number}</strong> for <strong>$${Number(inv.total).toFixed(2)}</strong> is now <strong style="color:#ef4444">overdue</strong>.`
        : `This is a friendly reminder that invoice <strong>${inv.number}</strong> for <strong>$${Number(inv.total).toFixed(2)}</strong> is ${dueLine}.`,
      viewUrl ? `<a href="${viewUrl}" style="color:#3b82f6;font-weight:600">View &amp; pay your invoice online</a>` : null,
      `If you have already arranged payment, please disregard this notice.`,
      `Thank you,<br/>${companyName}`,
    ].filter(Boolean).map((l) => `<p>${l}</p>`).join("\n");

    try {
      const sent = await sendNotificationEmail(contactEmail, subject, bodyLines);
      if (sent) {
        // Mark the appropriate stage so it doesn't re-fire
        await db
          .update(invoicesTable)
          .set({
            remindersSent:    (inv.remindersSent ?? 0) + 1,
            overdueAlertSent: isOverdue ? true : inv.overdueAlertSent,
            updatedAt:        new Date(),
          })
          .where(eq(invoicesTable.id, inv.id));
        logger.info({ invoiceId: inv.id, to: contactEmail, isOverdue }, "Invoice reminder sent");
      } else {
        logger.warn({ invoiceId: inv.id }, "Invoice reminder: no transport configured, not incrementing");
      }
    } catch (err) {
      logger.error({ err, invoiceId: inv.id }, "Failed to send invoice reminder");
    }
  }

  const totalCount = upcomingDue.length + overdueAlerts.length;
  if (totalCount === 0) return;

  logger.info({ upcoming: upcomingDue.length, overdue: overdueAlerts.length }, "Invoice reminder cron: sending reminders");

  for (const { inv, contactEmail, contactName } of upcomingDue) {
    await sendReminder(inv, contactEmail, contactName, false);
  }
  for (const { inv, contactEmail, contactName } of overdueAlerts) {
    await sendReminder(inv, contactEmail, contactName, true);
  }
}

// ── Cron (runs every minute, picks up due pending actions) ────────────────────

export function startRolloutCron() {
  cron.schedule("* * * * *", async () => {
    const now = new Date();

    const due = await db
      .select({ action: rolloutActionsTable, release: releasesTable })
      .from(rolloutActionsTable)
      .innerJoin(releasesTable, eq(rolloutActionsTable.releaseId, releasesTable.id))
      .where(and(eq(rolloutActionsTable.status, "pending"), lte(rolloutActionsTable.scheduledFor, now)));

    if (due.length === 0) return;
    logger.info({ count: due.length }, "Rollout cron: processing due actions");

    for (const { action, release } of due) {
      // Mark running (prevents double-execution in concurrent instances)
      await db.update(rolloutActionsTable)
        .set({ status: "running" })
        .where(and(eq(rolloutActionsTable.id, action.id), eq(rolloutActionsTable.status, "pending")));

      try {
        await handleRolloutAction(action, release);
        await db.update(rolloutActionsTable)
          .set({ status: "done", completedAt: new Date() })
          .where(eq(rolloutActionsTable.id, action.id));
      } catch (err) {
        logger.error({ err, actionId: action.id, type: action.type }, "Rollout action failed");
        await db.update(rolloutActionsTable)
          .set({ status: "failed", error: String(err) })
          .where(eq(rolloutActionsTable.id, action.id));
      }
    }

    // Mark releases "live" when their release date has passed and they were scheduled
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await db
      .update(releasesTable)
      .set({ status: "live", updatedAt: new Date() })
      .where(
        and(
          eq(releasesTable.status, "scheduled"),
          lte(releasesTable.releaseDate, today.toISOString().split("T")[0]!),
        ),
      );
  });

  // Invoice reminders: run once per day at 9 AM
  cron.schedule("0 9 * * *", async () => {
    try {
      await runInvoiceReminders();
    } catch (err) {
      logger.error({ err }, "Invoice reminder cron error");
    }
  });

  logger.info("Rollout cron started (every minute); invoice reminder cron at 09:00 daily");
}
