import { Router } from "express";
import {
  db, messageThreadsTable, messagesTable, usersTable, paymentLinksTable, threadParticipantsTable,
  userPermissionsTable,
} from "@workspace/db";
import { eq, desc, count, and, inArray, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { notifyUsersWithPref } from "../lib/notify-email.js";
import { notifyAll } from "../lib/notify.js";

const router = Router();

const CreateThreadBody = z.object({
  type: z.enum(["deal", "contact", "general", "review", "release", "dm", "group"]).default("general"),
  dealId: z.number().nullable().optional(),
  contactId: z.number().nullable().optional(),
  artistId: z.number().nullable().optional(),
  releaseId: z.number().nullable().optional(),
  title: z.string().min(1),
  reviewFileUrl: z.string().nullable().optional(),
  reviewFileName: z.string().nullable().optional(),
  isFinalLocked: z.boolean().optional().default(false),
  participantIds: z.array(z.number()).optional(),
});

const SendMessageBody = z.object({
  content: z.string().min(1),
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  fileSize: z.number().nullable().optional(),
  isFinalDelivery: z.boolean().optional().default(false),
});

// ── helpers ─────────────────────────────────────────────────────────────────

type Participant = { id: number; name: string; email: string };

async function getParticipants(threadId: number): Promise<Participant[]> {
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(threadParticipantsTable)
    .innerJoin(usersTable, eq(threadParticipantsTable.userId, usersTable.id))
    .where(eq(threadParticipantsTable.threadId, threadId));
  return rows;
}

async function addParticipants(threadId: number, userIds: number[]): Promise<void> {
  if (!userIds.length) return;
  const vals = userIds.map((userId) => ({ threadId, userId }));
  await db.insert(threadParticipantsTable).values(vals).onConflictDoNothing();
}

function serializeThread(
  thread: typeof messageThreadsTable.$inferSelect,
  messageCount: number,
  lastMessage: string | null,
  participants: Participant[] = [],
) {
  return {
    id: thread.id,
    type: thread.type,
    dealId: thread.dealId,
    contactId: thread.contactId,
    artistId: thread.artistId,
    releaseId: thread.releaseId,
    title: thread.title,
    createdBy: thread.createdBy,
    createdAt: thread.createdAt,
    lastMessage,
    messageCount,
    reviewFileUrl: thread.reviewFileUrl ?? null,
    reviewFileName: thread.reviewFileName ?? null,
    isFinalLocked: thread.isFinalLocked,
    manuallyPaid: thread.manuallyPaid,
    isCompleted: thread.isCompleted,
    completedAt: thread.completedAt ?? null,
    completedBy: thread.completedBy ?? null,
    participants,
  };
}

async function dealIsPaid(dealId: number | null, manuallyPaid: boolean): Promise<boolean> {
  if (manuallyPaid) return true;
  if (!dealId) return false;
  const rows = await db
    .select({ id: paymentLinksTable.id })
    .from(paymentLinksTable)
    .where(and(eq(paymentLinksTable.dealId, dealId), eq(paymentLinksTable.status, "completed")))
    .limit(1);
  return rows.length > 0;
}

// ── GET /api/messages/team ───────────────────────────────────────────────────
// Returns all team users for DM/participant selection
router.get("/team", requireAuth, async (_req, res) => {
  const users = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.userType, "team"))
    .orderBy(usersTable.name);
  res.json(users);
});

// ── GET /api/messages/threads ────────────────────────────────────────────────
router.get("/threads", requireAuth, async (req, res) => {
  const myId = req.user!.userId;

  const threads = await db
    .select({ thread: messageThreadsTable, messageCount: count(messagesTable.id) })
    .from(messageThreadsTable)
    .leftJoin(messagesTable, eq(messagesTable.threadId, messageThreadsTable.id))
    .groupBy(messageThreadsTable.id)
    .orderBy(desc(messageThreadsTable.createdAt));

  // Get last message per thread
  const lastMessages = await Promise.all(
    threads.map(async ({ thread }) => {
      const [last] = await db
        .select({ content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.threadId, thread.id))
        .orderBy(desc(messagesTable.createdAt))
        .limit(1);
      return { id: thread.id, lastMessage: last?.content ?? null };
    }),
  );

  // Get participants for all threads
  const allParticipantRows = await db
    .select({ threadId: threadParticipantsTable.threadId, id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(threadParticipantsTable)
    .innerJoin(usersTable, eq(threadParticipantsTable.userId, usersTable.id));

  const participantMap = new Map<number, Participant[]>();
  for (const row of allParticipantRows) {
    if (!participantMap.has(row.threadId)) participantMap.set(row.threadId, []);
    participantMap.get(row.threadId)!.push({ id: row.id, name: row.name, email: row.email });
  }

  const lastMap = new Map(lastMessages.map((m) => [m.id, m.lastMessage]));

  // For DM/group threads, only show threads where the user is a participant
  const result = threads
    .filter(({ thread }) => {
      if (thread.type === "dm" || thread.type === "group") {
        const parts = participantMap.get(thread.id) ?? [];
        return parts.some((p) => p.id === myId);
      }
      return true;
    })
    .map(({ thread, messageCount }) =>
      serializeThread(
        thread,
        Number(messageCount),
        lastMap.get(thread.id) ?? null,
        participantMap.get(thread.id) ?? [],
      ),
    );

  res.json(result);
});

// ── POST /api/messages/dm/:userId ────────────────────────────────────────────
// Find or create a 1-on-1 DM thread between current user and target user
router.post("/dm/:userId", requireAuth, async (req, res) => {
  const myId = req.user!.userId;
  const otherId = parseInt(req.params["userId"] as string);
  if (myId === otherId) { res.status(400).json({ error: "Cannot DM yourself" }); return; }

  const [other] = await db.select().from(usersTable).where(eq(usersTable.id, otherId)).limit(1);
  if (!other) { res.status(404).json({ error: "User not found" }); return; }

  // Find existing DM — a "dm" thread where BOTH users are participants and it has exactly these 2
  const myParticipations = await db
    .select({ threadId: threadParticipantsTable.threadId })
    .from(threadParticipantsTable)
    .innerJoin(messageThreadsTable, eq(threadParticipantsTable.threadId, messageThreadsTable.id))
    .where(and(
      eq(threadParticipantsTable.userId, myId),
      eq(messageThreadsTable.type, "dm"),
    ));

  const myThreadIds = myParticipations.map((r) => r.threadId);

  if (myThreadIds.length > 0) {
    const otherParticipations = await db
      .select({ threadId: threadParticipantsTable.threadId })
      .from(threadParticipantsTable)
      .where(and(
        eq(threadParticipantsTable.userId, otherId),
        inArray(threadParticipantsTable.threadId, myThreadIds),
      ));

    if (otherParticipations.length > 0) {
      const threadId = otherParticipations[0]!.threadId;
      const [thread] = await db.select().from(messageThreadsTable).where(eq(messageThreadsTable.id, threadId)).limit(1);
      if (thread) {
        const participants = await getParticipants(threadId);
        res.json(serializeThread(thread, 0, null, participants));
        return;
      }
    }
  }

  // Create new DM thread
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, myId)).limit(1);
  const [thread] = await db
    .insert(messageThreadsTable)
    .values({
      type: "dm",
      title: `${me?.name ?? "Me"} & ${other.name}`,
      createdBy: myId,
    })
    .returning();

  await addParticipants(thread!.id, [myId, otherId]);
  const participants = await getParticipants(thread!.id);
  res.status(201).json(serializeThread(thread!, 0, null, participants));
});

// ── POST /api/messages/threads ───────────────────────────────────────────────
router.post("/threads", requireAuth, async (req, res) => {
  const parse = CreateThreadBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { type, dealId, contactId, artistId, releaseId, title, reviewFileUrl, reviewFileName, isFinalLocked, participantIds } = parse.data;
  const [thread] = await db
    .insert(messageThreadsTable)
    .values({
      type,
      dealId: dealId ?? null,
      contactId: contactId ?? null,
      artistId: artistId ?? null,
      releaseId: releaseId ?? null,
      title,
      createdBy: req.user!.userId,
      reviewFileUrl: reviewFileUrl ?? null,
      reviewFileName: reviewFileName ?? null,
      isFinalLocked: isFinalLocked ?? false,
    })
    .returning();

  // Add creator + any specified participants
  const allParticipantIds = Array.from(new Set([req.user!.userId, ...(participantIds ?? [])]));
  await addParticipants(thread!.id, allParticipantIds);

  const participants = await getParticipants(thread!.id);
  res.status(201).json(serializeThread(thread!, 0, null, participants));
});

// ── GET /api/messages/threads/:id ───────────────────────────────────────────
router.get("/threads/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [thread] = await db
    .select().from(messageThreadsTable).where(eq(messageThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

  const paid = await dealIsPaid(thread.dealId, thread.manuallyPaid);
  const participants = await getParticipants(id);

  const msgs = await db
    .select({ msg: messagesTable, authorName: usersTable.name })
    .from(messagesTable)
    .leftJoin(usersTable, eq(messagesTable.authorId, usersTable.id))
    .where(eq(messagesTable.threadId, id))
    .orderBy(messagesTable.createdAt);

  res.json({
    ...serializeThread(thread, msgs.length, msgs.at(-1)?.msg.content ?? null, participants),
    dealIsPaid: paid,
    messages: msgs.map(({ msg, authorName }) => ({
      id: msg.id,
      threadId: msg.threadId,
      authorId: msg.authorId,
      authorName: authorName ?? "Unknown",
      content: msg.content,
      fileUrl: msg.fileUrl,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      createdAt: msg.createdAt,
      isFinalDelivery: msg.isFinalDelivery,
    })),
  });
});

// ── PATCH /api/messages/threads/:id ─────────────────────────────────────────
router.patch("/threads/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const PatchBody = z.object({
    isFinalLocked: z.boolean().optional(),
    manuallyPaid: z.boolean().optional(),
    isCompleted: z.boolean().optional(),
    reviewFileUrl: z.string().nullable().optional(),
    reviewFileName: z.string().nullable().optional(),
    dealId: z.number().nullable().optional(),
    title: z.string().optional(),
  });
  const parse = PatchBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const updates: Record<string, unknown> = { ...parse.data };
  if (typeof parse.data.isCompleted === "boolean") {
    updates.completedAt = parse.data.isCompleted ? new Date() : null;
    updates.completedBy = parse.data.isCompleted ? req.user!.userId : null;
  }

  const [updated] = await db
    .update(messageThreadsTable)
    .set(updates)
    .where(eq(messageThreadsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Thread not found" }); return; }
  const participants = await getParticipants(id);
  res.json(serializeThread(updated, 0, null, participants));
});

// ── DELETE /api/messages/threads/:id ────────────────────────────────────────
router.delete("/threads/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [thread] = await db.select().from(messageThreadsTable).where(eq(messageThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  const roleCanDelete = ["owner", "admin", "manager", "engineer"].includes(req.user!.role ?? "");
  let canDelete = roleCanDelete || thread.createdBy === req.user!.userId;
  if (!canDelete) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    canDelete = (permsRow?.permissions as Record<string, boolean> | null)?.["messages:delete"] === true;
  }
  if (!canDelete) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(messagesTable).where(eq(messagesTable.threadId, id));
  await db.delete(messageThreadsTable).where(eq(messageThreadsTable.id, id));
  res.status(204).end();
});

// ── GET /api/messages/threads/:id/participants ────────────────────────────────
router.get("/threads/:id/participants", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const participants = await getParticipants(id);
  res.json(participants);
});

// ── POST /api/messages/threads/:id/participants ───────────────────────────────
router.post("/threads/:id/participants", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = z.object({ userId: z.number() }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  await addParticipants(id, [parse.data.userId]);
  const participants = await getParticipants(id);
  res.json(participants);
});

// ── DELETE /api/messages/threads/:id/participants/:userId ─────────────────────
router.delete("/threads/:id/participants/:userId", requireAuth, async (req, res) => {
  const threadId = parseInt(req.params["id"] as string);
  const userId = parseInt(req.params["userId"] as string);
  await db.delete(threadParticipantsTable).where(
    and(eq(threadParticipantsTable.threadId, threadId), eq(threadParticipantsTable.userId, userId)),
  );
  const participants = await getParticipants(threadId);
  res.json(participants);
});

// ── POST /api/messages/threads/:id/messages ──────────────────────────────────
router.post("/threads/:id/messages", requireAuth, async (req, res) => {
  const threadId = parseInt(req.params["id"] as string);
  const parse = SendMessageBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { content, fileUrl, fileName, fileSize, isFinalDelivery } = parse.data;

  const [thread] = await db.select().from(messageThreadsTable).where(eq(messageThreadsTable.id, threadId)).limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      threadId,
      authorId: req.user!.userId,
      content,
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      fileSize: fileSize ?? null,
      isFinalDelivery: isFinalDelivery ?? false,
    })
    .returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId)).limit(1);

  const payload = {
    id: msg!.id,
    threadId: msg!.threadId,
    authorId: msg!.authorId,
    authorName: user?.name ?? "Unknown",
    content: msg!.content,
    fileUrl: msg!.fileUrl,
    fileName: msg!.fileName,
    fileSize: msg!.fileSize,
    createdAt: msg!.createdAt,
    isFinalDelivery: msg!.isFinalDelivery,
  };

  const io = (req as any).io;
  if (io) io.to(`thread:${threadId}`).emit("message", payload);

  void notifyUsersWithPref(
    "newMessage",
    `New message in "${thread.title}"`,
    `${user?.name ?? "A team member"} sent a message in <strong>${thread.title}</strong>:<br/><br/><em>${content.slice(0, 300)}${content.length > 300 ? "…" : ""}</em>`,
    req.user!.userId,
  );
  void notifyAll(
    req.io ?? null,
    "message",
    `New message in "${thread.title}"`,
    `${user?.name ?? "A team member"}: ${content.slice(0, 120)}${content.length > 120 ? "…" : ""}`,
    `/messages`,
    req.user!.userId,
  );

  res.status(201).json(payload);
});

// ── PATCH /api/messages/threads/:id/messages/:msgId ──────────────────────────
router.patch("/threads/:id/messages/:msgId", requireAuth, async (req, res) => {
  const msgId = parseInt(req.params["msgId"] as string);
  const threadId = parseInt(req.params["id"] as string);
  const parse = z.object({ isFinalDelivery: z.boolean() }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const [updated] = await db
    .update(messagesTable)
    .set({ isFinalDelivery: parse.data.isFinalDelivery })
    .where(and(eq(messagesTable.id, msgId), eq(messagesTable.threadId, threadId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Message not found" }); return; }
  res.json(updated);
});

// ── DELETE /api/messages/threads/:id/messages/:msgId ─────────────────────────
router.delete("/threads/:id/messages/:msgId", requireAuth, async (req, res) => {
  const msgId = parseInt(req.params["msgId"] as string);
  const threadId = parseInt(req.params["id"] as string);
  const [msg] = await db
    .select().from(messagesTable)
    .where(and(eq(messagesTable.id, msgId), eq(messagesTable.threadId, threadId)))
    .limit(1);
  if (!msg) { res.status(404).json({ error: "Message not found" }); return; }
  const roleMsgCanDelete = ["owner", "admin", "manager", "engineer"].includes(req.user!.role ?? "");
  let canDeleteMsg = roleMsgCanDelete || msg.authorId === req.user!.userId;
  if (!canDeleteMsg) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    canDeleteMsg = (permsRow?.permissions as Record<string, boolean> | null)?.["messages:delete"] === true;
  }
  if (!canDeleteMsg) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(messagesTable).where(eq(messagesTable.id, msgId));
  const io = (req as any).io;
  if (io) io.to(`thread:${threadId}`).emit("message_deleted", { msgId, threadId });
  res.status(204).end();
});

// ── GET /api/messages/threads/:id/payment-status ────────────────────────────
router.get("/threads/:id/payment-status", requireAuth, async (req, res) => {
  const threadId = parseInt(req.params["id"] as string);
  const [thread] = await db.select().from(messageThreadsTable).where(eq(messageThreadsTable.id, threadId)).limit(1);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  const paid = await dealIsPaid(thread.dealId, thread.manuallyPaid);
  res.json({ paid, dealId: thread.dealId, isFinalLocked: thread.isFinalLocked, manuallyPaid: thread.manuallyPaid });
});

export default router;
