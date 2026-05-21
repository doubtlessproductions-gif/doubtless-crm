// Microsoft Graph API — OAuth2 token management + email/Graph client helpers
// Uses direct HTTP token exchange so refresh_token is reliably stored & rotated.
import "isomorphic-fetch";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import { db, userConnectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger.js";
import { notifyOutlookExpiredIfNeeded } from "./notify.js";

export const GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.Send",
  "Mail.ReadWrite",
];

export const ONEDRIVE_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Files.ReadWrite",
];

export const LOGIN_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
];

// ── MSAL client (used only for generating auth-code URLs) ─────────────────────

export function getMsalClient(): ConfidentialClientApplication | null {
  const clientId     = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  const tenantId     = process.env["MICROSOFT_TENANT_ID"] ?? "common";
  if (!clientId || !clientSecret) return null;
  return new ConfidentialClientApplication({
    auth: {
      clientId,
      authority:    `https://login.microsoftonline.com/${tenantId}`,
      clientSecret,
    },
  });
}

/** Build the OAuth redirect URI from env or Replit domain. */
export function getRedirectUri(): string {
  if (process.env["MICROSOFT_REDIRECT_URI"]) return process.env["MICROSOFT_REDIRECT_URI"];
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const primary = domains.split(",")[0]!.trim();
    return `https://${primary}/api/auth/microsoft/callback`;
  }
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}/api/auth/microsoft/callback`;
  return "http://localhost:80/api/auth/microsoft/callback";
}

// ── Direct HTTP token helpers ─────────────────────────────────────────────────
// MSAL's AuthenticationResult intentionally hides refresh_token, so we talk
// directly to the token endpoint.  The response always includes refresh_token
// when offline_access is in the scope list.

interface TokenEndpointResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in?:   number;   // seconds
  token_type?:   string;
  id_token?:     string;
  error?:        string;
  error_description?: string;
}

function tokenEndpointUrl(): string {
  const tenantId = process.env["MICROSOFT_TENANT_ID"] ?? "common";
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

/**
 * Exchange an OAuth2 authorization code for tokens.
 * Returns the full token response including refresh_token.
 */
export async function exchangeCodeForTokens(
  code:     string,
  scopes:   string[],
): Promise<TokenEndpointResponse | null> {
  const clientId     = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;

  try {
    const params = new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      redirect_uri:  getRedirectUri(),
      grant_type:    "authorization_code",
      scope:         scopes.join(" "),
    });

    const r = await fetch(tokenEndpointUrl(), {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });

    const data = await r.json() as TokenEndpointResponse;
    if (data.error) {
      logger.warn({ error: data.error, description: data.error_description }, "Token code exchange failed");
      return null;
    }
    return data;
  } catch (err) {
    logger.warn({ err }, "Token code exchange request failed");
    return null;
  }
}

// ── Stored credentials shape ──────────────────────────────────────────────────

interface StoredMicrosoftCreds {
  access_token:   string;
  refresh_token?: string;
  expires_at?:    string; // ISO string
  email?:         string;
}

// ── Internal token refresh via direct HTTP ────────────────────────────────────

export async function refreshMicrosoftToken(
  userId:     number,
  provider:   string,
  scopes:     string[],
  refreshTok: string,
): Promise<string | null> {
  const clientId     = process.env["MICROSOFT_CLIENT_ID"];
  const clientSecret = process.env["MICROSOFT_CLIENT_SECRET"];
  if (!clientId || !clientSecret) return null;

  try {
    const params = new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    "refresh_token",
      refresh_token: refreshTok,
      scope:         scopes.join(" "),
    });

    const r = await fetch(tokenEndpointUrl(), {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });

    const data = await r.json() as TokenEndpointResponse;

    if (data.error || !data.access_token) {
      logger.warn({ error: data.error, description: data.error_description, userId, provider },
        "Microsoft token refresh returned an error");
      if (provider === "outlook") void notifyOutlookExpiredIfNeeded(null, userId);
      return null;
    }

    // Fetch existing creds so we can preserve the email field
    const [existing] = await db
      .select({ creds: userConnectionsTable.credentials })
      .from(userConnectionsTable)
      .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));

    const merged: StoredMicrosoftCreds = {
      ...((existing?.creds as unknown as StoredMicrosoftCreds) ?? {}),
      access_token:  data.access_token,
      // Microsoft may or may not rotate the refresh token — use the new one if provided
      refresh_token: data.refresh_token ?? refreshTok,
      expires_at:    data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : undefined,
    };

    await db
      .update(userConnectionsTable)
      .set({ credentials: merged as unknown as Record<string, unknown> })
      .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));

    logger.info({ userId, provider }, "Microsoft token refreshed successfully");
    return data.access_token;
  } catch (err) {
    logger.warn({ err, userId, provider }, "Microsoft token refresh request failed");
    if (provider === "outlook") void notifyOutlookExpiredIfNeeded(null, userId);
    return null;
  }
}

async function refreshOutlookToken(userId: number, refreshTok: string): Promise<string | null> {
  return refreshMicrosoftToken(userId, "outlook", GRAPH_SCOPES, refreshTok);
}

/**
 * Determine whether stored credentials need a proactive token refresh.
 * Returns true when:
 *   - The token is within 5 minutes of its known expiry, OR
 *   - expires_at is absent (unknown expiry → treat as expired to be safe).
 * Always returns false when there is no refresh_token to use.
 */
function needsRefresh(creds: StoredMicrosoftCreds): boolean {
  if (!creds.refresh_token) return false;
  if (!creds.expires_at) return true; // unknown expiry — assume stale
  const remaining = new Date(creds.expires_at).getTime() - Date.now();
  return remaining < 5 * 60 * 1000;
}

/**
 * Get a live access token for any Microsoft-connected provider (outlook, onedrive).
 * Refreshes automatically if within 5 min of expiry, or if expiry is unknown.
 */
export async function getStoredMicrosoftToken(
  userId:   number,
  provider: string,
  scopes:   string[],
): Promise<string | null> {
  const [row] = await db
    .select({ creds: userConnectionsTable.credentials })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));

  if (!row?.creds) return null;
  const creds = row.creds as unknown as StoredMicrosoftCreds;
  if (!creds.access_token) return null;

  if (needsRefresh(creds)) {
    return (await refreshMicrosoftToken(userId, provider, scopes, creds.refresh_token!)) ?? creds.access_token;
  }
  return creds.access_token;
}

/**
 * Build a Graph client for a specific CRM user.
 * Handles token refresh automatically.
 */
export async function getGraphClientForUser(userId: number): Promise<{ client: Client; email: string } | null> {
  const [row] = await db
    .select()
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, "outlook")));

  if (!row?.credentials) return null;
  const creds = row.credentials as unknown as StoredMicrosoftCreds;
  if (!creds.access_token) return null;

  let accessToken = creds.access_token;

  if (needsRefresh(creds)) {
    accessToken = (await refreshOutlookToken(userId, creds.refresh_token!)) ?? accessToken;
  }

  const client = Client.init({ authProvider: (done) => done(null, accessToken) });
  return { client, email: creds.email ?? "" };
}

/**
 * Find the first CRM user with a live Outlook connection and return their Graph client.
 * Used as a sender for system-level emails (notifications, invites) when SMTP is unavailable.
 */
export async function getAnyGraphSender(): Promise<{ client: Client; email: string; userId: number } | null> {
  const rows = await db
    .select()
    .from(userConnectionsTable)
    .where(eq(userConnectionsTable.provider, "outlook"));

  for (const row of rows) {
    const ctx = await getGraphClientForUser(row.userId);
    if (ctx) return { ...ctx, userId: row.userId };
  }
  return null;
}

export interface GraphAttachment {
  filename:    string;
  content:     Buffer;
  contentType: string;
}

/**
 * Send an email via Graph API on behalf of userId.
 * Returns true on success, false if the user has no Outlook connection or send fails.
 * Optionally attaches files (e.g. invoice PDFs).
 */
export async function sendGraphEmail(
  userId: number,
  opts:   { to: string; subject: string; html: string; attachments?: GraphAttachment[] },
): Promise<boolean> {
  const ctx = await getGraphClientForUser(userId);
  if (!ctx) return false;
  try {
    const message: Record<string, unknown> = {
      subject:      opts.subject,
      body:         { contentType: "HTML", content: opts.html },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    };
    if (opts.attachments?.length) {
      message["attachments"] = opts.attachments.map((a) => ({
        "@odata.type":  "#microsoft.graph.fileAttachment",
        name:           a.filename,
        contentType:    a.contentType,
        contentBytes:   a.content.toString("base64"),
      }));
    }
    await ctx.client.api("/me/sendMail").post({ message });
    return true;
  } catch (err) {
    logger.warn({ err, to: opts.to }, "Graph email send failed");
    return false;
  }
}

/**
 * Send an email using the first available Graph sender (any connected Outlook user).
 * Falls back gracefully — caller should try SMTP if this returns false.
 */
export async function sendGraphEmailViaAnySender(
  opts: { to: string; subject: string; html: string },
): Promise<boolean> {
  const sender = await getAnyGraphSender();
  if (!sender) return false;
  try {
    await sender.client.api("/me/sendMail").post({
      message: {
        subject:      opts.subject,
        body:         { contentType: "HTML", content: opts.html },
        toRecipients: [{ emailAddress: { address: opts.to } }],
      },
    });
    return true;
  } catch (err) {
    logger.warn({ err, to: opts.to }, "Graph (any-sender) email send failed");
    return false;
  }
}
