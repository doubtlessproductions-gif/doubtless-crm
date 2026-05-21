// Outlook inbox routes — read, send, delete, reply, and entity linking via Microsoft Graph
import { Router } from "express";
import { GraphError } from "@microsoft/microsoft-graph-client";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { getGraphClientForUser } from "../lib/microsoft-graph.js";
import { db, emailLinksTable } from "@workspace/db";

const router = Router();

const NOT_CONNECTED = { error: "not_connected", connectUrl: "/settings?tab=integrations" } as const;

function isGraphAuthError(err: unknown): boolean {
  if (err instanceof GraphError) return err.statusCode === 401;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("401") || msg.includes("Unauthorized") || msg.includes("InvalidAuthenticationToken");
}

function isGraphPermissionError(err: unknown): boolean {
  if (err instanceof GraphError) return err.statusCode === 403;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("403") || msg.includes("Forbidden");
}

function graphErrResponse(err: unknown, res: import("express").Response) {
  if (isGraphAuthError(err)) {
    return res.status(401).json({ error: "Microsoft connection expired", needsReconnect: true });
  }
  if (isGraphPermissionError(err)) {
    return res.status(403).json({
      error: "insufficient_scope",
      message: "Your Outlook connection needs updated permissions. Please reconnect in Settings.",
      connectUrl: "/settings?tab=integrations",
    });
  }
  const msg = err instanceof Error ? err.message : "Unknown error";
  return res.status(502).json({ error: "Graph API error", message: msg });
}

interface GraphMessage {
  id: string;
  subject: string | null;
  from: { emailAddress: { name: string; address: string } } | null;
  toRecipients?: { emailAddress: { name: string; address: string } }[];
  ccRecipients?: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
  hasAttachments: boolean;
  body?: { contentType: string; content: string };
}

interface GraphMessagesResponse {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
}

interface MailFolder {
  unreadItemCount: number;
}

// ── GET /api/outlook/status ───────────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  res.json({ connected: !!ctx, email: ctx?.email ?? null });
});

// ── GET /api/outlook/inbox ────────────────────────────────────────────────────
router.get("/inbox", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  if (!ctx) { res.status(403).json(NOT_CONNECTED); return; }

  const skip   = Math.max(0, parseInt(String(req.query["skip"] ?? "0"), 10) || 0);
  const top    = Math.min(50, Math.max(1, parseInt(String(req.query["top"] ?? "25"), 10) || 25));
  const search = String(req.query["search"] ?? "").trim();

  try {
    const SELECT = "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments";

    if (search) {
      const result = await ctx.client
        .api("/me/messages")
        .header("ConsistencyLevel", "eventual")
        .select(SELECT)
        .search(`"${search.replace(/"/g, "")}"`)
        .top(top).skip(skip)
        .get() as GraphMessagesResponse;
      res.json({ messages: result.value ?? [], hasMore: !!result["@odata.nextLink"], skip, top });
    } else {
      const result = await ctx.client
        .api("/me/messages")
        .select(SELECT)
        .orderby("receivedDateTime desc")
        .top(top).skip(skip)
        .get() as GraphMessagesResponse;
      res.json({ messages: result.value ?? [], hasMore: !!result["@odata.nextLink"], skip, top });
    }
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch Outlook inbox");
    graphErrResponse(err, res);
  }
});

// ── GET /api/outlook/unread-count ─────────────────────────────────────────────
router.get("/unread-count", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  if (!ctx) { res.json({ count: 0, connected: false }); return; }
  try {
    const folder = await ctx.client
      .api("/me/mailFolders/inbox").select("unreadItemCount").get() as MailFolder;
    res.json({ count: folder.unreadItemCount ?? 0, connected: true });
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch Outlook unread count");
    if (isGraphAuthError(err)) res.json({ count: 0, connected: false, needsReconnect: true });
    else res.json({ count: 0, connected: true });
  }
});

// ── GET /api/outlook/messages/:id — full message with body ───────────────────
router.get("/messages/:id", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  if (!ctx) { res.status(403).json(NOT_CONNECTED); return; }
  try {
    const msg = await ctx.client
      .api(`/me/messages/${req.params["id"]}`)
      .select("id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,body")
      .get() as GraphMessage;
    res.json(msg);
  } catch (err) {
    req.log.warn({ err, msgId: req.params["id"] }, "Failed to fetch message body");
    graphErrResponse(err, res);
  }
});

// ── DELETE /api/outlook/messages/:id — move to Deleted Items ─────────────────
router.delete("/messages/:id", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  if (!ctx) { res.status(403).json(NOT_CONNECTED); return; }
  try {
    await ctx.client.api(`/me/messages/${req.params["id"]}`).delete();
    // Also clean up any links for this message
    await db.delete(emailLinksTable).where(
      and(
        eq(emailLinksTable.messageId, String(req.params["id"])),
        eq(emailLinksTable.userId, req.user!.userId),
      )
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err, msgId: req.params["id"] }, "Failed to delete message");
    graphErrResponse(err, res);
  }
});

// ── POST /api/outlook/send — compose and send a new email ────────────────────
router.post("/send", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  if (!ctx) { res.status(403).json(NOT_CONNECTED); return; }

  const { to, subject, body, cc } = req.body as {
    to: string; subject: string; body: string; cc?: string;
  };
  if (!to || !subject) { res.status(400).json({ error: "to and subject are required" }); return; }

  try {
    const toAddresses = to.split(/[,;]+/).map((a: string) => a.trim()).filter(Boolean);
    const message: Record<string, unknown> = {
      subject,
      body: { contentType: "HTML", content: body || "" },
      toRecipients: toAddresses.map((address: string) => ({ emailAddress: { address } })),
    };
    if (cc) {
      const ccAddresses = cc.split(/[,;]+/).map((a: string) => a.trim()).filter(Boolean);
      if (ccAddresses.length) {
        message["ccRecipients"] = ccAddresses.map((address: string) => ({ emailAddress: { address } }));
      }
    }
    await ctx.client.api("/me/sendMail").post({ message });
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err }, "Failed to send email");
    graphErrResponse(err, res);
  }
});

// ── POST /api/outlook/messages/:id/reply ─────────────────────────────────────
router.post("/messages/:id/reply", requireAuth, async (req, res) => {
  const ctx = await getGraphClientForUser(req.user!.userId);
  if (!ctx) { res.status(403).json(NOT_CONNECTED); return; }

  const { comment, replyAll } = req.body as { comment: string; replyAll?: boolean };
  const endpoint = replyAll
    ? `/me/messages/${req.params["id"]}/replyAll`
    : `/me/messages/${req.params["id"]}/reply`;

  try {
    await ctx.client.api(endpoint).post({ comment: comment ?? "" });
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err, msgId: req.params["id"] }, "Failed to reply to message");
    graphErrResponse(err, res);
  }
});

// ── POST /api/outlook/messages/:messageId/link — link email to CRM entity ────
router.post("/messages/:messageId/link", requireAuth, async (req, res) => {
  const {
    entityType, entityId,
    messageSubject, messageSenderName, messageSenderEmail, messageDate,
  } = req.body as {
    entityType: string; entityId: number;
    messageSubject?: string; messageSenderName?: string;
    messageSenderEmail?: string; messageDate?: string;
  };

  if (!entityType || entityId === undefined) {
    res.status(400).json({ error: "entityType and entityId are required" }); return;
  }

  const VALID_TYPES = ["contact", "artist", "release", "deal", "invoice", "thread"];
  if (!VALID_TYPES.includes(entityType)) {
    res.status(400).json({ error: "invalid entityType" }); return;
  }

  try {
    // Upsert — prevent duplicates
    const existing = await db.select({ id: emailLinksTable.id })
      .from(emailLinksTable)
      .where(and(
        eq(emailLinksTable.userId,     req.user!.userId),
        eq(emailLinksTable.messageId,  String(req.params["messageId"])),
        eq(emailLinksTable.entityType, entityType),
        eq(emailLinksTable.entityId,   Number(entityId)),
      ))
      .limit(1);

    if (existing.length) {
      res.json(existing[0]);
      return;
    }

    const [link] = await db.insert(emailLinksTable).values({
      userId:             req.user!.userId,
      messageId:          String(req.params["messageId"]),
      messageSubject:     messageSubject ?? null,
      messageSenderName:  messageSenderName ?? null,
      messageSenderEmail: messageSenderEmail ?? null,
      messageDate:        messageDate ?? null,
      entityType,
      entityId:           Number(entityId),
    }).returning();

    res.json(link);
  } catch (err) {
    req.log.warn({ err }, "Failed to link email");
    res.status(500).json({ error: "Failed to link email" });
  }
});

// ── DELETE /api/outlook/links/:linkId — remove a link ────────────────────────
router.delete("/links/:linkId", requireAuth, async (req, res) => {
  const linkId = parseInt(String(req.params["linkId"]), 10);
  if (isNaN(linkId)) { res.status(400).json({ error: "invalid linkId" }); return; }
  try {
    await db.delete(emailLinksTable).where(
      and(eq(emailLinksTable.id, linkId), eq(emailLinksTable.userId, req.user!.userId))
    );
    res.json({ ok: true });
  } catch (err) {
    req.log.warn({ err, linkId }, "Failed to delete link");
    res.status(500).json({ error: "Failed to delete link" });
  }
});

// ── GET /api/outlook/linked/:entityType/:entityId — links for a CRM entity ───
router.get("/linked/:entityType/:entityId", requireAuth, async (req, res) => {
  const entityId = parseInt(String(req.params["entityId"]), 10);
  if (isNaN(entityId)) { res.status(400).json({ error: "invalid entityId" }); return; }
  try {
    const links = await db.select()
      .from(emailLinksTable)
      .where(and(
        eq(emailLinksTable.entityType, String(req.params["entityType"])),
        eq(emailLinksTable.entityId,   entityId),
      ))
      .orderBy(emailLinksTable.linkedAt);
    res.json(links);
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch linked emails");
    res.status(500).json({ error: "Failed to fetch linked emails" });
  }
});

// ── GET /api/outlook/messages/:messageId/links — all entity links for a msg ──
router.get("/messages/:messageId/links", requireAuth, async (req, res) => {
  try {
    const links = await db.select()
      .from(emailLinksTable)
      .where(and(
        eq(emailLinksTable.messageId, String(req.params["messageId"])),
        eq(emailLinksTable.userId,    req.user!.userId),
      ))
      .orderBy(emailLinksTable.linkedAt);
    res.json(links);
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch message links");
    res.status(500).json({ error: "Failed to fetch message links" });
  }
});

export default router;
