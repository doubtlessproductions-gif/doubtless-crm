import { Router } from "express";
import {
  db, artistOutreachMessagesTable, artistsTable, usersTable,
  activityTable, artistNotesTable, parseLabelStatus,
} from "@workspace/db";
import { eq, and, inArray, desc, count, sql } from "drizzle-orm";
import { requireAuth, requireReadAuth, requireRole } from "../middlewares/auth.js";
import { generateOutreachMessage } from "../lib/outreach-ai.js";
import { sendGraphEmail } from "../lib/microsoft-graph.js";
import { z } from "zod";

const router = Router();

// Shorthand role guard for approve/send/queue operations
const requireOutreachManager = [requireAuth, requireRole("owner", "admin", "manager")];

// ── Validation ────────────────────────────────────────────────────────────────

const GenerateBody = z.object({
  type: z.enum(["dm", "email", "proposal", "recommendation"]),
  contextNotes: z.string().optional(),
  recipientEmail: z.string().email().optional(),
});

/**
 * Allowed status transitions via the generic PATCH endpoint:
 *   draft → approved   (requires manager role, checked separately)
 *
 * Disallowed via PATCH — must use dedicated endpoints:
 *   * → sent     (use /send)
 *   * → replied  (use /reply)
 */
const PatchAllowedStatuses = ["draft", "approved"] as const;

const UpdateBody = z.object({
  subject:        z.string().optional(),
  body:           z.string().min(1).optional(),
  status:         z.enum(PatchAllowedStatuses).optional(),
  recipientEmail: z.string().email().optional().nullable(),
  replyNotes:     z.string().optional().nullable(),
});

const QueueUpdateBody = z.object({
  subject:        z.string().optional(),
  body:           z.string().min(1).optional(),
  status:         z.enum(PatchAllowedStatuses).optional(),
  recipientEmail: z.string().email().optional().nullable(),
});

const MarkRepliedBody = z.object({
  replyNotes: z.string().optional(),
});

// ── Bulk send (admin/manager) ─────────────────────────────────────────────────

const BulkSendBody = z.object({
  msgIds: z.array(z.number().int().positive()).min(1).max(50),
});

/** POST /artists/outreach/bulk-send — send multiple approved messages in one request */
router.post("/outreach/bulk-send", ...requireOutreachManager, async (req, res) => {
  const parse = BulkSendBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { msgIds } = parse.data;

  const msgs = await db.select({
    msg: artistOutreachMessagesTable,
    artistName: artistsTable.name,
  })
    .from(artistOutreachMessagesTable)
    .innerJoin(artistsTable, eq(artistOutreachMessagesTable.artistId, artistsTable.id))
    .where(inArray(artistOutreachMessagesTable.id, msgIds));

  const sent: number[] = [];
  const failed: { id: number; reason: string }[] = [];

  for (const { msg, artistName } of msgs) {
    if (msg.status !== "approved") {
      failed.push({ id: msg.id, reason: `Status is "${msg.status}" — must be approved` });
      continue;
    }
    if (!msg.recipientEmail) {
      failed.push({ id: msg.id, reason: "No recipient email set" });
      continue;
    }

    const html = msg.body.replace(/\n/g, "<br>");
    const ok = await sendGraphEmail(req.user!.userId, {
      to:      msg.recipientEmail,
      subject: msg.subject ?? `Message from Doubtless Productions`,
      html,
    });

    if (!ok) {
      failed.push({ id: msg.id, reason: "Outlook send failed — check connection" });
      continue;
    }

    await db.update(artistOutreachMessagesTable)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(artistOutreachMessagesTable.id, msg.id));

    await db.insert(artistNotesTable).values({
      artistId:      msg.artistId,
      authorId:      req.user!.userId,
      type:          "outreach_sent",
      subject:       msg.subject ?? msg.type,
      body:          msg.body,
      sentTo:        msg.recipientEmail,
      outreachMsgId: msg.id,
    });

    await db.insert(activityTable).values({
      userId:      req.user!.userId,
      type:        "outreach_sent",
      description: `Bulk-sent ${msg.type} to ${artistName} (${msg.recipientEmail}) — "${msg.subject ?? msg.type}"`,
    });

    sent.push(msg.id);
  }

  res.json({ sent, failed });
});

// ── Global outreach queue (admin/manager view) ────────────────────────────────
// NOTE: These routes MUST come before /:id/outreach to avoid route conflicts

/** GET /artists/outreach/queue — all draft+approved messages across artists */
router.get("/outreach/queue", ...requireOutreachManager, async (req, res) => {
  const rows = await db
    .select({
      msg: artistOutreachMessagesTable,
      artistName: artistsTable.name,
      artistGenre: artistsTable.genre,
      creatorName: usersTable.name,
    })
    .from(artistOutreachMessagesTable)
    .innerJoin(artistsTable, eq(artistOutreachMessagesTable.artistId, artistsTable.id))
    .innerJoin(usersTable, eq(artistOutreachMessagesTable.createdBy, usersTable.id))
    .where(inArray(artistOutreachMessagesTable.status, ["draft", "approved"]))
    .orderBy(desc(artistOutreachMessagesTable.createdAt));

  res.json(rows.map(r => ({
    ...fmtMessage(r.msg),
    artistName: r.artistName,
    artistGenre: r.artistGenre,
    creatorName: r.creatorName,
  })));
});

/** DELETE /artists/outreach/queue/:msgId — discard from queue (admin/manager) */
router.delete("/outreach/queue/:msgId", ...requireOutreachManager, async (req, res) => {
  const msgId = parseInt(req.params["msgId"] as string);
  await db.delete(artistOutreachMessagesTable)
    .where(and(
      eq(artistOutreachMessagesTable.id, msgId),
      inArray(artistOutreachMessagesTable.status, ["draft", "approved"]),
    ));
  res.status(204).end();
});

/** PATCH /artists/outreach/queue/:msgId — queue-level edit (subject/body/email/status)
 *  Only `draft` and `approved` statuses are accepted; `sent`/`replied` are rejected.
 */
router.patch("/outreach/queue/:msgId", ...requireOutreachManager, async (req, res) => {
  const msgId = parseInt(req.params["msgId"] as string);
  const parse = QueueUpdateBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { status, ...rest } = parse.data;
  const setData: Record<string, unknown> = { ...rest, updatedAt: new Date() };

  if (status) {
    setData["status"] = status;
    if (status === "approved") setData["approvedBy"] = req.user!.userId;
  }

  const [row] = await db.update(artistOutreachMessagesTable)
    .set(setData)
    .where(eq(artistOutreachMessagesTable.id, msgId))
    .returning();

  if (!row) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(fmtMessage(row));
});

// ── Outreach analytics ────────────────────────────────────────────────────────

/** GET /artists/outreach/analytics — aggregate stats */
router.get("/outreach/analytics", ...requireOutreachManager, async (req, res) => {
  const byStatus = await db
    .select({ status: artistOutreachMessagesTable.status, n: count() })
    .from(artistOutreachMessagesTable)
    .groupBy(artistOutreachMessagesTable.status);

  const statusMap = Object.fromEntries(byStatus.map(r => [r.status, Number(r.n)]));
  const totalGenerated = Object.values(statusMap).reduce((a, b) => a + b, 0);
  const totalSent      = (statusMap["sent"] ?? 0) + (statusMap["replied"] ?? 0);
  const totalReplied   = statusMap["replied"] ?? 0;
  const responseRate   = totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  const byMember = await db
    .select({
      userId:    usersTable.id,
      name:      usersTable.name,
      generated: count(),
      sent:      sql<number>`SUM(CASE WHEN ${artistOutreachMessagesTable.status} IN ('sent','replied') THEN 1 ELSE 0 END)::int`,
      replied:   sql<number>`SUM(CASE WHEN ${artistOutreachMessagesTable.status} = 'replied' THEN 1 ELSE 0 END)::int`,
    })
    .from(artistOutreachMessagesTable)
    .innerJoin(usersTable, eq(artistOutreachMessagesTable.createdBy, usersTable.id))
    .groupBy(usersTable.id, usersTable.name)
    .orderBy(desc(count()));

  const byGenre = await db
    .select({ genre: artistsTable.genre, n: count() })
    .from(artistOutreachMessagesTable)
    .innerJoin(artistsTable, eq(artistOutreachMessagesTable.artistId, artistsTable.id))
    .groupBy(artistsTable.genre)
    .orderBy(desc(count()))
    .limit(10);

  const byType = await db
    .select({ type: artistOutreachMessagesTable.type, n: count() })
    .from(artistOutreachMessagesTable)
    .groupBy(artistOutreachMessagesTable.type);

  const byRegion = await db
    .select({
      region: sql<string>`COALESCE(NULLIF(TRIM(${artistsTable.state}), ''), 'Unknown')`,
      n:      count(),
    })
    .from(artistOutreachMessagesTable)
    .innerJoin(artistsTable, eq(artistOutreachMessagesTable.artistId, artistsTable.id))
    .groupBy(sql`COALESCE(NULLIF(TRIM(${artistsTable.state}), ''), 'Unknown')`)
    .orderBy(desc(count()))
    .limit(10);

  res.json({
    totalGenerated,
    totalSent,
    totalReplied,
    responseRate,
    byStatus: statusMap,
    byMember: byMember.map(r => ({
      userId:       r.userId,
      name:         r.name,
      generated:    Number(r.generated),
      sent:         Number(r.sent),
      replied:      Number(r.replied),
      responseRate: Number(r.sent) > 0
        ? Math.round((Number(r.replied) / Number(r.sent)) * 100)
        : 0,
    })),
    byGenre:  byGenre.map(r => ({ genre: r.genre ?? "Unknown", count: Number(r.n) })),
    byType:   byType.map(r => ({ type: r.type, count: Number(r.n) })),
    byRegion: byRegion.map(r => ({ region: r.region, count: Number(r.n) })),
  });
});

// ── Per-artist outreach routes ────────────────────────────────────────────────

/** POST /artists/:id/outreach/generate — AI-generate and save as draft */
router.post("/:id/outreach/generate", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const parse = GenerateBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const [artist] = await db.select().from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);
  if (!artist) { res.status(404).json({ error: "Artist not found" }); return; }

  const { type, contextNotes, recipientEmail } = parse.data;

  const draft = await generateOutreachMessage(
    {
      name:              artist.name,
      genre:             artist.genre,
      bio:               artist.bio,
      tags:              artist.tags as string[],
      city:              artist.city,
      state:             artist.state,
      outreachStatus:    artist.outreachStatus,
      followersEstimate: artist.followersEstimate,
      engagementLevel:   artist.engagementLevel,
      revenuePotential:  artist.revenuePotential,
      labelStatus:       parseLabelStatus(artist.labelStatus).join(", ") || undefined,
      streamingLinks:    (artist.streamingLinks ?? {}) as Record<string, string>,
      socialLinks:       (artist.socialLinks ?? {}) as Record<string, string>,
    },
    type,
    contextNotes,
  );

  const [row] = await db.insert(artistOutreachMessagesTable).values({
    artistId,
    type,
    subject:        draft.subject,
    body:           draft.body,
    contextNotes:   contextNotes ?? null,
    recipientEmail: recipientEmail ?? null,
    status:         "draft",
    createdBy:      req.user!.userId,
  }).returning();

  res.status(201).json(fmtMessage(row!));
});

/** GET /artists/:id/outreach — list messages for one artist */
router.get("/:id/outreach", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const rows = await db.select().from(artistOutreachMessagesTable)
    .where(eq(artistOutreachMessagesTable.artistId, artistId))
    .orderBy(desc(artistOutreachMessagesTable.createdAt));
  res.json(rows.map(fmtMessage));
});

/** GET /artists/:id/notes — structured conversation history */
router.get("/:id/notes", requireReadAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const rows = await db
    .select({
      note: artistNotesTable,
      authorName: usersTable.name,
    })
    .from(artistNotesTable)
    .innerJoin(usersTable, eq(artistNotesTable.authorId, usersTable.id))
    .where(eq(artistNotesTable.artistId, artistId))
    .orderBy(desc(artistNotesTable.createdAt));

  res.json(rows.map(r => ({
    id:            r.note.id,
    artistId:      r.note.artistId,
    authorId:      r.note.authorId,
    authorName:    r.authorName,
    type:          r.note.type,
    subject:       r.note.subject,
    body:          r.note.body,
    sentTo:        r.note.sentTo,
    outreachMsgId: r.note.outreachMsgId,
    createdAt:     r.note.createdAt,
  })));
});

/** PATCH /artists/:id/outreach/:msgId — update/approve/edit a message.
 *  Status may only be set to `draft` or `approved` here.
 *  `sent` must come via /send; `replied` must come via /reply.
 */
router.patch("/:id/outreach/:msgId", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const msgId    = parseInt(req.params["msgId"] as string);
  const parse = UpdateBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { status, ...rest } = parse.data;

  // Approving requires elevated role
  if (status === "approved") {
    const role = req.user?.role ?? "";
    if (!["owner", "admin", "manager"].includes(role)) {
      res.status(403).json({ error: "Only admins/managers can approve outreach" });
      return;
    }
  }

  const setData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  if (status) {
    setData["status"] = status;
    if (status === "approved") setData["approvedBy"] = req.user!.userId;
  }

  const [row] = await db.update(artistOutreachMessagesTable)
    .set(setData)
    .where(and(
      eq(artistOutreachMessagesTable.id, msgId),
      eq(artistOutreachMessagesTable.artistId, artistId),
    ))
    .returning();

  if (!row) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(fmtMessage(row));
});

/** POST /artists/:id/outreach/:msgId/send — send via Outlook.
 *  Requires admin/manager AND the message must be in 'approved' status.
 *  On success: marks sent, logs to activityTable (summary) and artistNotesTable (full record).
 */
router.post("/:id/outreach/:msgId/send", ...requireOutreachManager, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const msgId    = parseInt(req.params["msgId"] as string);

  const [msg] = await db.select().from(artistOutreachMessagesTable)
    .where(and(
      eq(artistOutreachMessagesTable.id, msgId),
      eq(artistOutreachMessagesTable.artistId, artistId),
    ))
    .limit(1);

  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }

  // Enforce approval-before-send state machine
  if (msg.status !== "approved") {
    res.status(422).json({
      error: `Message must be approved before sending (current status: ${msg.status}). Have a manager approve it first.`,
    });
    return;
  }

  if (!msg.recipientEmail) {
    res.status(400).json({ error: "recipientEmail is required to send via Outlook" });
    return;
  }

  const [artist] = await db.select({ name: artistsTable.name })
    .from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);

  const html = msg.body.replace(/\n/g, "<br>");
  const ok = await sendGraphEmail(req.user!.userId, {
    to:      msg.recipientEmail,
    subject: msg.subject ?? `Message from Doubtless Productions`,
    html,
  });

  if (!ok) {
    res.status(503).json({ error: "Outlook not connected or send failed. Connect Outlook in Integrations." });
    return;
  }

  const [updated] = await db.update(artistOutreachMessagesTable)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(artistOutreachMessagesTable.id, msgId))
    .returning();

  // Log structured conversation record (full body preserved for history)
  await db.insert(artistNotesTable).values({
    artistId,
    authorId:      req.user!.userId,
    type:          "outreach_sent",
    subject:       msg.subject ?? msg.type,
    body:          msg.body,
    sentTo:        msg.recipientEmail,
    outreachMsgId: msgId,
  });

  // Log compact activity entry for global activity feed
  await db.insert(activityTable).values({
    userId:      req.user!.userId,
    type:        "outreach_sent",
    description: `Sent ${msg.type} outreach to ${artist?.name ?? "artist"} (${msg.recipientEmail}) — "${msg.subject ?? msg.type}"`,
  });

  res.json(fmtMessage(updated!));
});

/** POST /artists/:id/outreach/:msgId/reply — log a reply.
 *  Marks message as replied and writes a structured history record.
 */
router.post("/:id/outreach/:msgId/reply", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const msgId    = parseInt(req.params["msgId"] as string);
  const parse = MarkRepliedBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  // Fetch current state before updating — reply only valid from sent/replied
  const [current] = await db.select({ status: artistOutreachMessagesTable.status })
    .from(artistOutreachMessagesTable)
    .where(and(
      eq(artistOutreachMessagesTable.id, msgId),
      eq(artistOutreachMessagesTable.artistId, artistId),
    ))
    .limit(1);

  if (!current) { res.status(404).json({ error: "Message not found" }); return; }

  if (!["sent", "replied"].includes(current.status)) {
    res.status(422).json({
      error: `Cannot log a reply for a message with status "${current.status}". Message must be sent first.`,
    });
    return;
  }

  const [row] = await db.update(artistOutreachMessagesTable)
    .set({
      status:     "replied",
      repliedAt:  new Date(),
      replyNotes: parse.data.replyNotes ?? null,
      updatedAt:  new Date(),
    })
    .where(and(
      eq(artistOutreachMessagesTable.id, msgId),
      eq(artistOutreachMessagesTable.artistId, artistId),
    ))
    .returning();

  if (!row) { res.status(404).json({ error: "Message not found" }); return; }

  const [artist] = await db.select({ name: artistsTable.name })
    .from(artistsTable).where(eq(artistsTable.id, artistId)).limit(1);

  const replyBody = parse.data.replyNotes
    ? `Reply received.\n\nNotes: ${parse.data.replyNotes}`
    : "Reply received (no notes recorded).";

  // Log structured conversation record for history
  await db.insert(artistNotesTable).values({
    artistId,
    authorId:      req.user!.userId,
    type:          "outreach_reply",
    subject:       row.subject ? `RE: ${row.subject}` : `Reply — ${row.type}`,
    body:          replyBody,
    sentTo:        row.recipientEmail,
    outreachMsgId: msgId,
  });

  await db.insert(activityTable).values({
    userId:      req.user!.userId,
    type:        "outreach_replied",
    description: `Reply logged for outreach to ${artist?.name ?? "artist"} — "${row.subject ?? row.type}"`,
  });

  res.json(fmtMessage(row));
});

/** DELETE /artists/:id/outreach/:msgId */
router.delete("/:id/outreach/:msgId", requireAuth, async (req, res) => {
  const artistId = parseInt(req.params["id"] as string);
  const msgId    = parseInt(req.params["msgId"] as string);
  await db.delete(artistOutreachMessagesTable)
    .where(and(
      eq(artistOutreachMessagesTable.id, msgId),
      eq(artistOutreachMessagesTable.artistId, artistId),
    ));
  res.status(204).end();
});

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmtMessage(r: typeof artistOutreachMessagesTable.$inferSelect) {
  return {
    id:             r.id,
    artistId:       r.artistId,
    type:           r.type,
    subject:        r.subject,
    body:           r.body,
    status:         r.status,
    contextNotes:   r.contextNotes,
    recipientEmail: r.recipientEmail,
    createdBy:      r.createdBy,
    approvedBy:     r.approvedBy,
    sentAt:         r.sentAt,
    repliedAt:      r.repliedAt,
    replyNotes:     r.replyNotes,
    createdAt:      r.createdAt,
    updatedAt:      r.updatedAt,
  };
}

export default router;
