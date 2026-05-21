// Outlook token health cron — runs every 6 hours.
// For each user with an Outlook connection it force-refreshes their stored
// token via direct HTTP (not MSAL — MSAL hides the refresh_token on return).
// If the refresh fails the token has expired or been revoked, and the user
// receives an in-app notification with a link to Settings → Integrations.
import cron from "node-cron";
import { db, userConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import { logger } from "./logger.js";
import { refreshMicrosoftToken, GRAPH_SCOPES } from "./microsoft-graph.js";

interface StoredOutlookCreds {
  access_token:  string;
  refresh_token?: string;
  expires_at?:   string;
  email?:        string;
}

/**
 * Attempt a forced token refresh for a single Outlook connection.
 * Uses the direct HTTP token endpoint so the rotated refresh_token is always
 * persisted — MSAL's acquireTokenByRefreshToken silently discards it.
 * Returns true  → token is still valid (refreshed credentials written back to DB).
 * Returns false → refresh failed; token is expired or revoked.
 */
async function checkOutlookHealth(userId: number, creds: StoredOutlookCreds): Promise<boolean> {
  if (!creds.refresh_token) {
    logger.debug({ userId }, "Outlook health: no refresh_token stored — user must reconnect");
    return false;
  }

  const newToken = await refreshMicrosoftToken(userId, "outlook", GRAPH_SCOPES, creds.refresh_token);
  // refreshMicrosoftToken returns null on failure and already calls
  // notifyOutlookExpiredIfNeeded internally, so no extra work needed here.
  return newToken !== null;
}

async function runOutlookHealthCheck(_io: Server | null) {
  const rows = await db
    .select()
    .from(userConnectionsTable)
    .where(eq(userConnectionsTable.provider, "outlook"));

  if (rows.length === 0) return;

  logger.info({ count: rows.length }, "Outlook health check: checking connections");

  for (const row of rows) {
    const creds = row.credentials as unknown as StoredOutlookCreds | null;
    if (!creds?.access_token) continue;

    const healthy = await checkOutlookHealth(row.userId, creds);
    if (!healthy) {
      // refreshMicrosoftToken already called notifyOutlookExpiredIfNeeded
      // (with deduplication) so no additional notify needed here.
      logger.warn({ userId: row.userId }, "Outlook health check: token expired");
    }
  }
}

export function startOutlookHealthCron(io: Server | null) {
  // Full health check every 6 hours.
  cron.schedule("0 */6 * * *", async () => {
    try {
      await runOutlookHealthCheck(io);
    } catch (err) {
      logger.error({ err }, "Outlook health cron error");
    }
  });

  logger.info("Outlook health cron started (every 6 hours)");
}
