import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { db, contactsTable, dealsTable, messageThreadsTable, messagesTable, dealNotesTable, portalUsersTable, videoProjectsTable, projectPagesTable, portalNotificationsTable, projectsTable, usersTable, invoicesTable, themeSettingsTable } from "@workspace/db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { notifyUsersWithPref } from "../lib/notify-email.js";
import { notifyAll } from "../lib/notify.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { z } from "zod";
import { requireAuth, requirePortalAuth, signPortalToken } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import {
  checkAccountLockout,
  recordLoginFailure,
  clearLoginFailures,
  authLimiter,
} from "../middlewares/security.js";
import { buildInvoicePdf } from "../lib/invoice-pdf.js";
import { getUncachableStripeClient } from "../lib/stripe.js";

const router = Router();

function friendlyStage(stage: string): string {
  const map: Record<string, string> = {
    lead: "New Inquiry",
    qualified: "In Discussion",
    proposal: "Proposal Sent",
    negotiation: "In Negotiation",
    won: "Complete",
    lost: "Closed",
  };
  return map[stage] ?? stage;
}

// ── POST /api/portal/invite ──────────────────────────────────────────────────
// Staff invites a contact to the portal
router.post("/invite", requireAuth, async (req, res) => {
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
  const inviteUrl = `${baseUrl}/portal/accept/${inviteToken}`;

  logger.info({ contactId, email: contact.email }, "Portal invite generated");
  res.json({ inviteUrl, portalUser });
});

// ── GET /api/portal/status/:contactId ───────────────────────────────────────
// Staff checks portal status for a contact
router.get("/status/:contactId", requireAuth, async (req, res) => {
  const contactId = parseInt(req.params["contactId"] as string);
  const [portalUser] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.contactId, contactId)).limit(1);
  if (!portalUser) { res.json({ status: "none" }); return; }

  let status: string;
  if (!portalUser.isActive) {
    status = "deactivated";
  } else if (!portalUser.inviteAcceptedAt) {
    status = "pending";
  } else {
    status = "active";
  }

  const baseUrl = process.env["REPLIT_DEV_DOMAIN"]
    ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
    : "http://localhost:80";
  const inviteUrl = portalUser.inviteToken ? `${baseUrl}/portal/accept/${portalUser.inviteToken}` : null;

  res.json({ status, portalUser, inviteUrl });
});

// ── PATCH /api/portal/deactivate/:contactId ──────────────────────────────────
// Staff deactivates a portal account
router.patch("/deactivate/:contactId", requireAuth, async (req, res) => {
  const contactId = parseInt(req.params["contactId"] as string);
  const parse = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [updated] = await db
    .update(portalUsersTable)
    .set({ isActive: parse.data.isActive })
    .where(eq(portalUsersTable.contactId, contactId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Portal user not found" }); return; }
  res.json(updated);
});

// ── GET /api/portal/accept/:token ────────────────────────────────────────────
// Public: validate token and return contact name for the setup form
router.get("/accept/:token", async (req, res) => {
  const { token } = req.params as { token: string };
  const [portalUser] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.inviteToken, token)).limit(1);
  if (!portalUser || !portalUser.isActive) {
    res.status(404).json({ error: "Invalid or expired invite link" });
    return;
  }
  if (portalUser.inviteAcceptedAt) {
    res.status(409).json({ error: "Invite already accepted" });
    return;
  }
  const [contact] = await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, portalUser.contactId)).limit(1);
  res.json({ email: portalUser.email, contactName: contact?.name ?? "" });
});

// ── POST /api/portal/accept/:token ───────────────────────────────────────────
// Public: set password and activate account
router.post("/accept/:token", async (req, res) => {
  const { token } = req.params as { token: string };
  const parse = z.object({ password: z.string().min(8) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  const [portalUser] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.inviteToken, token)).limit(1);
  if (!portalUser || !portalUser.isActive) {
    res.status(404).json({ error: "Invalid or expired invite link" });
    return;
  }
  if (portalUser.inviteAcceptedAt) {
    res.status(409).json({ error: "Invite already accepted" });
    return;
  }

  const passwordHash = await bcrypt.hash(parse.data.password, 12);
  const [updated] = await db
    .update(portalUsersTable)
    .set({ passwordHash, inviteAcceptedAt: new Date(), inviteToken: null })
    .where(eq(portalUsersTable.id, portalUser.id))
    .returning();

  const jwtToken = signPortalToken({ portalUserId: updated!.id, contactId: updated!.contactId, email: updated!.email });
  logger.info({ portalUserId: updated!.id, contactId: updated!.contactId }, "Portal account activated");
  res.json({ token: jwtToken });
});

// ── POST /api/portal/login ───────────────────────────────────────────────────
// Public: portal login — rate-limited + account lockout protected
router.post("/login", authLimiter, async (req, res) => {
  const parse = z.object({ email: z.string().email(), password: z.string() }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { email, password } = parse.data;

  const lockout = checkAccountLockout(`portal:${email}`);
  if (lockout.locked) {
    const minutes = Math.ceil((lockout.waitSeconds ?? 900) / 60);
    res.status(429).json({ error: `Account temporarily locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` });
    return;
  }

  const [portalUser] = await db
    .select({
      id:                portalUsersTable.id,
      contactId:         portalUsersTable.contactId,
      email:             portalUsersTable.email,
      passwordHash:      portalUsersTable.passwordHash,
      isActive:          portalUsersTable.isActive,
      inviteAcceptedAt:  portalUsersTable.inviteAcceptedAt,
    })
    .from(portalUsersTable)
    .where(eq(portalUsersTable.email, email))
    .limit(1);

  if (!portalUser || !portalUser.isActive || !portalUser.passwordHash || !portalUser.inviteAcceptedAt) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await bcrypt.compare(password, portalUser.passwordHash);
  if (!valid) {
    recordLoginFailure(`portal:${email}`, (msg) => logger.warn(msg));
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  clearLoginFailures(`portal:${email}`);
  await db.update(portalUsersTable).set({ lastLoginAt: new Date() }).where(eq(portalUsersTable.id, portalUser.id));
  const jwtToken = signPortalToken({ portalUserId: portalUser.id, contactId: portalUser.contactId, email: portalUser.email });
  res.json({ token: jwtToken });
});

// ── GET /api/portal/me ───────────────────────────────────────────────────────
router.get("/me", requirePortalAuth, async (req, res) => {
  const { contactId, email } = req.portalUser!;
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId)).limit(1);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
  res.json({ email, contact: { id: contact.id, name: contact.name, company: contact.company } });
});

// ── GET /api/portal/projects ─────────────────────────────────────────────────
router.get("/projects", requirePortalAuth, async (req, res) => {
  const { contactId } = req.portalUser!;
  const deals = await db.select().from(dealsTable).where(eq(dealsTable.contactId, contactId));

  const projects = await Promise.all(
    deals.map(async (deal) => {
      const notes = await db
        .select()
        .from(dealNotesTable)
        .where(eq(dealNotesTable.dealId, deal.id))
        .orderBy(dealNotesTable.createdAt);

      const threads = await db
        .select()
        .from(messageThreadsTable)
        .where(eq(messageThreadsTable.dealId, deal.id));

      const fileMessages = await Promise.all(
        threads.map(async (thread) => {
          const msgs = await db
            .select()
            .from(messagesTable)
            .where(and(eq(messagesTable.threadId, thread.id), eq(messagesTable.isFinalDelivery, false)))
            .orderBy(messagesTable.createdAt);
          return msgs.filter((m) => m.fileUrl);
        })
      );
      const files = fileMessages.flat();

      const timeline: { date: Date; label: string }[] = [
        { date: deal.createdAt, label: "Project created" },
        ...notes.map((n) => ({ date: n.createdAt, label: "Note added" })),
        ...files.map((f) => ({ date: f.createdAt, label: `File shared: ${f.fileName ?? "file"}` })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        id: deal.id,
        title: deal.title,
        status: friendlyStage(deal.stage),
        createdAt: deal.createdAt,
        timeline,
        fileCount: files.length,
      };
    })
  );

  res.json(projects);
});

// ── GET /api/portal/projects/:dealId/messages ────────────────────────────────
router.get("/projects/:dealId/messages", requirePortalAuth, async (req, res) => {
  const dealId = parseInt(req.params["dealId"] as string);
  const { contactId } = req.portalUser!;

  const [deal] = await db.select().from(dealsTable).where(and(eq(dealsTable.id, dealId), eq(dealsTable.contactId, contactId))).limit(1);
  if (!deal) { res.status(404).json({ error: "Project not found" }); return; }

  const threads = await db.select().from(messageThreadsTable).where(eq(messageThreadsTable.dealId, dealId));
  const allMessages = await Promise.all(
    threads.map(async (thread) => {
      const msgs = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.threadId, thread.id))
        .orderBy(messagesTable.createdAt);
      return msgs.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        content: m.content,
        fileUrl: m.fileUrl,
        fileName: m.fileName,
        createdAt: m.createdAt,
        isFromPortal: !!m.portalAuthorId,
        authorName: m.portalAuthorId ? "You" : "Doubtless Productions",
      }));
    })
  );

  res.json({ dealId, messages: allMessages.flat().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) });
});

// ── POST /api/portal/projects/:dealId/messages ───────────────────────────────
router.post("/projects/:dealId/messages", requirePortalAuth, async (req, res) => {
  const dealId = parseInt(req.params["dealId"] as string);
  const { contactId, portalUserId } = req.portalUser!;

  const [deal] = await db.select().from(dealsTable).where(and(eq(dealsTable.id, dealId), eq(dealsTable.contactId, contactId))).limit(1);
  if (!deal) { res.status(404).json({ error: "Project not found" }); return; }

  const parse = z.object({ content: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  let [thread] = await db.select().from(messageThreadsTable).where(and(eq(messageThreadsTable.dealId, dealId), eq(messageThreadsTable.type, "deal"))).limit(1);

  if (!thread) {
    [thread] = await db.insert(messageThreadsTable).values({
      type: "deal",
      dealId,
      contactId,
      title: deal.title,
      createdBy: deal.createdBy,
    }).returning();
  }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      threadId: thread!.id,
      portalAuthorId: portalUserId,
      content: parse.data.content,
    })
    .returning();

  const [contact] = await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, contactId)).limit(1);
  void notifyUsersWithPref(
    "portalMessage",
    `Client message on deal: ${deal.title}`,
    `<strong>${contact?.name ?? "A client"}</strong> sent a message on deal <strong>${deal.title}</strong>:<br/><br/><em>${parse.data.content.slice(0, 300)}${parse.data.content.length > 300 ? "…" : ""}</em>`,
  );
  void notifyAll(
    req.io ?? null,
    "portal_message",
    `Client message: ${deal.title}`,
    `${contact?.name ?? "A client"}: ${parse.data.content.slice(0, 120)}${parse.data.content.length > 120 ? "…" : ""}`,
    `/messages`,
  );

  res.status(201).json({
    id: msg!.id,
    threadId: msg!.threadId,
    content: msg!.content,
    createdAt: msg!.createdAt,
    isFromPortal: true,
    authorName: "You",
  });
});

// ── GET /api/portal/videos ──────────────────────────────────────────────────
// List video projects assigned to the logged-in client's contact
router.get("/videos", requirePortalAuth, async (req, res) => {
  const { contactId } = req.portalUser!;
  const videos = await db
    .select({
      id:                 videoProjectsTable.id,
      title:              videoProjectsTable.title,
      description:        videoProjectsTable.description,
      status:             videoProjectsTable.status,
      durationSeconds:    videoProjectsTable.durationSeconds,
      sizeBytes:          videoProjectsTable.sizeBytes,
      downloadEnabled:    videoProjectsTable.downloadEnabled,
      stripeInvoiceUrl:   videoProjectsTable.stripeInvoiceUrl,
      invoiceAmountCents: videoProjectsTable.invoiceAmountCents,
      hasThumbnail:       videoProjectsTable.thumbnailKey,
      hasPreview:         videoProjectsTable.previewKey,
      createdAt:          videoProjectsTable.createdAt,
    })
    .from(videoProjectsTable)
    .where(eq(videoProjectsTable.contactId, contactId))
    .orderBy(videoProjectsTable.createdAt);
  res.json(videos.map(v => ({ ...v, hasThumbnail: !!v.hasThumbnail, hasPreview: !!v.hasPreview })));
});

// ── GET /api/portal/videos/:id/preview ──────────────────────────────────────
// Stream 30-second watermarked preview to portal client
router.get("/videos/:id/preview", requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { contactId } = req.portalUser!;
  const [vp] = await db.select().from(videoProjectsTable)
    .where(and(eq(videoProjectsTable.id, id), eq(videoProjectsTable.contactId, contactId)))
    .limit(1);
  if (!vp?.previewKey) { res.status(404).json({ error: "Preview not available" }); return; }
  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(vp.previewKey);
    const response = await storage.downloadObject(file, 3600);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=3600");
    (response as unknown as NodeJS.ReadableStream).pipe(res);
  } catch (err) {
    logger.error({ err }, "portal video preview failed");
    res.status(500).json({ error: "Failed to stream preview" });
  }
});

// ── GET /api/portal/videos/:id/download ─────────────────────────────────────
// Download original video (only if unlocked)
router.get("/videos/:id/download", requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { contactId } = req.portalUser!;
  const [vp] = await db.select().from(videoProjectsTable)
    .where(and(eq(videoProjectsTable.id, id), eq(videoProjectsTable.contactId, contactId)))
    .limit(1);
  if (!vp) { res.status(404).json({ error: "Not found" }); return; }
  if (!vp.downloadEnabled || !vp.originalKey) { res.status(403).json({ error: "Video is locked — payment required" }); return; }
  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(vp.originalKey);
    const response = await storage.downloadObject(file);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${vp.title}.mp4"`);
    (response as unknown as NodeJS.ReadableStream).pipe(res);
  } catch (err) {
    logger.error({ err }, "portal video download failed");
    res.status(500).json({ error: "Failed to download video" });
  }
});

// ── GET /api/portal/threads ──────────────────────────────────────────────────
// List message threads directly assigned to the logged-in client's contact
// (not deal-based threads — those are handled via /projects/:dealId/messages)
router.get("/threads", requirePortalAuth, async (req, res) => {
  const { contactId } = req.portalUser!;
  const threads = await db
    .select({
      id:             messageThreadsTable.id,
      title:          messageThreadsTable.title,
      type:           messageThreadsTable.type,
      reviewFileUrl:  messageThreadsTable.reviewFileUrl,
      reviewFileName: messageThreadsTable.reviewFileName,
      createdAt:      messageThreadsTable.createdAt,
    })
    .from(messageThreadsTable)
    .where(and(eq(messageThreadsTable.contactId, contactId), isNull(messageThreadsTable.dealId)))
    .orderBy(messageThreadsTable.createdAt);
  res.json(threads);
});

// ── GET /api/portal/threads/:id/messages ─────────────────────────────────────
router.get("/threads/:id/messages", requirePortalAuth, async (req, res) => {
  const threadId = parseInt(req.params["id"] as string);
  const { contactId } = req.portalUser!;

  const [thread] = await db.select().from(messageThreadsTable)
    .where(and(eq(messageThreadsTable.id, threadId), eq(messageThreadsTable.contactId, contactId)))
    .limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

  const msgs = await db.select().from(messagesTable)
    .where(eq(messagesTable.threadId, threadId))
    .orderBy(messagesTable.createdAt);

  res.json(msgs.map((m) => ({
    id: m.id,
    content: m.content,
    fileUrl: m.fileUrl,
    fileName: m.fileName,
    createdAt: m.createdAt,
    isFromPortal: !!m.portalAuthorId,
    authorName: m.portalAuthorId ? "You" : "Doubtless Productions",
  })));
});

// ── POST /api/portal/threads/:id/messages ────────────────────────────────────
router.post("/threads/:id/messages", requirePortalAuth, async (req, res) => {
  const threadId = parseInt(req.params["id"] as string);
  const { contactId, portalUserId } = req.portalUser!;

  const [thread] = await db.select().from(messageThreadsTable)
    .where(and(eq(messageThreadsTable.id, threadId), eq(messageThreadsTable.contactId, contactId)))
    .limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

  const parse = z.object({ content: z.string().min(1) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [msg] = await db.insert(messagesTable).values({
    threadId,
    portalAuthorId: portalUserId,
    content: parse.data.content,
  }).returning();

  const [contact] = await db.select({ name: contactsTable.name }).from(contactsTable).where(eq(contactsTable.id, contactId)).limit(1);
  void notifyUsersWithPref(
    "portalMessage",
    `Client message in thread: ${thread.title}`,
    `<strong>${contact?.name ?? "A client"}</strong> sent a message in <strong>${thread.title}</strong>:<br/><br/><em>${parse.data.content.slice(0, 300)}${parse.data.content.length > 300 ? "…" : ""}</em>`,
  );

  res.status(201).json({
    id: msg!.id,
    content: msg!.content,
    fileUrl: null,
    fileName: null,
    createdAt: msg!.createdAt,
    isFromPortal: true,
    authorName: "You",
  });
});

// ── GET /api/portal/notifications ────────────────────────────────────────────
router.get("/notifications", requirePortalAuth, async (req, res) => {
  const { portalUserId } = req.portalUser!;
  const notes = await db
    .select()
    .from(portalNotificationsTable)
    .where(eq(portalNotificationsTable.userId, portalUserId))
    .orderBy(portalNotificationsTable.createdAt);
  res.json(notes.reverse());
});

// ── PUT /api/portal/notifications/read ───────────────────────────────────────
router.put("/notifications/read", requirePortalAuth, async (req, res) => {
  const { portalUserId } = req.portalUser!;
  await db
    .update(portalNotificationsTable)
    .set({ read: true })
    .where(eq(portalNotificationsTable.userId, portalUserId));
  res.status(204).end();
});

// ── GET /api/portal/pages ─────────────────────────────────────────────────────
// List project pages assigned to the logged-in client's contact
router.get("/pages", requirePortalAuth, async (req, res) => {
  const { contactId } = req.portalUser!;
  const pages = await db
    .select({
      id:          projectPagesTable.id,
      title:       projectPagesTable.title,
      slug:        projectPagesTable.slug,
      description: projectPagesTable.description,
      status:      projectPagesTable.status,
      updatedAt:   projectPagesTable.updatedAt,
    })
    .from(projectPagesTable)
    .where(and(eq(projectPagesTable.contactId, contactId), eq(projectPagesTable.status, "published")))
    .orderBy(projectPagesTable.updatedAt);
  res.json(pages);
});

// ── GET /api/portal/invoices ──────────────────────────────────────────────────
// List invoices for the logged-in client's contact
router.get("/invoices", requirePortalAuth, async (req, res) => {
  const { contactId } = req.portalUser!;
  const invoices = await db
    .select({
      id:          invoicesTable.id,
      number:      invoicesTable.number,
      total:       invoicesTable.total,
      status:      invoicesTable.status,
      dueDate:     invoicesTable.dueDate,
      sentAt:      invoicesTable.sentAt,
      paidAt:      invoicesTable.paidAt,
      viewToken:   invoicesTable.viewToken,
      createdAt:   invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.contactId, contactId))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(invoices);
});

// ── GET /api/portal/invoices/:id/pdf ─────────────────────────────────────────
// Download PDF for an invoice belonging to this client
router.get("/invoices/:id/pdf", requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { contactId } = req.portalUser!;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      inv:          invoicesTable,
      contactName:  contactsTable.name,
      contactEmail: contactsTable.email,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.contactId, contactId)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

  const [theme] = await db.select({ companyName: themeSettingsTable.companyName, logoUrl: themeSettingsTable.logoUrl }).from(themeSettingsTable).limit(1);
  const companyName = theme?.companyName ?? "My Company";
  const logoUrl = theme?.logoUrl ?? null;

  try {
    const pdf = await buildInvoicePdf(row.inv, row.contactName ?? "Client", row.contactEmail ?? null, companyName, logoUrl);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.inv.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    logger.error({ err }, "portal invoice pdf failed");
    res.status(500).json({ error: "PDF generation failed" });
  }
});

// ── POST /api/portal/invoices/:id/checkout-session ───────────────────────────
// Creates a Stripe Checkout session for an unpaid invoice and returns the URL
router.post("/invoices/:id/checkout-session", requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { contactId } = req.portalUser!;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({ inv: invoicesTable, contactName: contactsTable.name, contactEmail: contactsTable.email })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.contactId, contactId)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (row.inv.status === "paid") { res.status(409).json({ error: "Invoice is already paid" }); return; }

  const stripe = await getUncachableStripeClient();
  if (!stripe) { res.status(503).json({ error: "Payment processing is not configured" }); return; }

  const totalCents = Math.round(Number(row.inv.total) * 100);
  if (totalCents <= 0) { res.status(400).json({ error: "Invoice total must be greater than zero" }); return; }

  const appUrl = process.env["APP_URL"];
  const replitDomain = process.env["REPLIT_DOMAINS"]?.split(",")[0]?.trim();
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  const baseUrl = appUrl
    ? appUrl.replace(/\/$/, "")
    : replitDomain
      ? `https://${replitDomain}`
      : devDomain
        ? `https://${devDomain}`
        : "http://localhost:80";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `Invoice ${row.inv.number}`,
            ...(row.contactName ? { description: `Client: ${row.contactName}` } : {}),
          },
          unit_amount: totalCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      invoiceId: String(id),
      invoiceNumber: row.inv.number,
    },
    customer_email: row.contactEmail ?? undefined,
    success_url: `${baseUrl}/portal?payment=success&invoice=${id}`,
    cancel_url: `${baseUrl}/portal?payment=cancelled&invoice=${id}`,
  });

  await db.update(invoicesTable)
    .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
    .where(eq(invoicesTable.id, id));

  logger.info({ invoiceId: id, sessionId: session.id }, "Stripe checkout session created");
  res.json({ checkoutUrl: session.url });
});

// In-memory cooldown map: key = `${portalUserId}:${invoiceId}`, value = last request timestamp
const paymentRequestCooldown = new Map<string, number>();
const PAYMENT_REQUEST_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per invoice per portal user

// ── POST /api/portal/invoices/:id/payment-request ────────────────────────────
// Client requests payment confirmation — notifies staff
router.post("/invoices/:id/payment-request", requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const { contactId, portalUserId } = req.portalUser!;
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Cooldown guard: prevent notification spam (once per invoice per hour per portal user)
  const cooldownKey = `${portalUserId}:${id}`;
  const lastSent = paymentRequestCooldown.get(cooldownKey);
  if (lastSent && Date.now() - lastSent < PAYMENT_REQUEST_COOLDOWN_MS) {
    const waitMinutes = Math.ceil((PAYMENT_REQUEST_COOLDOWN_MS - (Date.now() - lastSent)) / 60000);
    res.status(429).json({ error: `Please wait ${waitMinutes} minute${waitMinutes === 1 ? "" : "s"} before sending another request for this invoice.` });
    return;
  }

  const [row] = await db
    .select({ inv: invoicesTable, contactName: contactsTable.name })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(and(eq(invoicesTable.id, id), eq(invoicesTable.contactId, contactId)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (row.inv.status === "paid") { res.status(409).json({ error: "Invoice is already paid" }); return; }

  paymentRequestCooldown.set(cooldownKey, Date.now());

  void notifyUsersWithPref(
    "portalMessage",
    `Payment confirmation: ${row.inv.number}`,
    `<strong>${row.contactName ?? "A client"}</strong> has confirmed payment for invoice <strong>${row.inv.number}</strong> (${row.inv.total ? `$${Number(row.inv.total).toFixed(2)}` : ""}). Please verify and mark it as paid.`,
  );

  logger.info({ invoiceId: id, contactId }, "Portal payment request submitted");
  res.json({ ok: true });
});

export default router;
