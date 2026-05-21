import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import type { Server } from "socket.io";
import { logger } from "./logger.js";

/**
 * Insert a notification for a specific user and push it live via Socket.io.
 */
export async function notify(
  io: Server | null,
  userId: number,
  type: string,
  title: string,
  body: string,
  linkHref: string,
): Promise<void> {
  try {
    const [row] = await db
      .insert(notificationsTable)
      .values({ userId, type, title, body, linkHref })
      .returning();
    if (io && row) {
      io.to(`user:${userId}`).emit("notification:new", {
        id:        row.id,
        type:      row.type,
        title:     row.title,
        body:      row.body,
        linkHref:  row.linkHref,
        isRead:    row.isRead,
        createdAt: row.createdAt,
      });
    }
  } catch (err) {
    logger.warn({ err, userId, type }, "notify: failed to insert notification");
  }
}

/**
 * Create an `outlook_expired` in-app notification for a user, deduplicated so
 * it fires at most once every 7 days regardless of whether the user has read
 * the previous one. Calling with io=null still persists the notification to
 * the DB; the real-time push is simply skipped.
 */
export async function notifyOutlookExpiredIfNeeded(
  io: Server | null,
  userId: number,
): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userId, userId),
          eq(notificationsTable.type, "outlook_expired"),
          gte(notificationsTable.createdAt, sevenDaysAgo),
        ),
      )
      .limit(1);
    if (rows.length > 0) return;

    await notify(
      io,
      userId,
      "outlook_expired",
      "Outlook connection expired",
      "Your Microsoft Outlook connection is no longer valid. Click here to reconnect.",
      "/settings",
    );
  } catch (err) {
    logger.warn({ err, userId }, "notifyOutlookExpiredIfNeeded: failed");
  }
}

/**
 * Notify all team-type users except the actor.
 */
export async function notifyAll(
  io: Server | null,
  type: string,
  title: string,
  body: string,
  linkHref: string,
  excludeUserId?: number,
): Promise<void> {
  try {
    const users = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.userType, "team"));
    const targets = users.filter((u) => u.id !== excludeUserId);
    await Promise.allSettled(
      targets.map((u) => notify(io, u.id, type, title, body, linkHref)),
    );
  } catch (err) {
    logger.warn({ err, type }, "notifyAll: failed");
  }
}
