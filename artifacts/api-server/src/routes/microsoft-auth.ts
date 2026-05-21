// Microsoft OAuth2 — login, Outlook connect, OneDrive connect, callback
import { Router } from "express";
import "isomorphic-fetch";
import { Client } from "@microsoft/microsoft-graph-client";
import {
  getMsalClient, getRedirectUri,
  GRAPH_SCOPES, ONEDRIVE_SCOPES, LOGIN_SCOPES,
  exchangeCodeForTokens,
} from "../lib/microsoft-graph.js";
import { db, userConnectionsTable, usersTable, activityTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { signToken } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

function popupPage(success: boolean, message?: string, provider = "microsoft-oauth", token?: string): string {
  const payload = JSON.stringify({ type: provider, success, message: message ?? null, token: token ?? null });
  const body = success
    ? "<p style='font-family:sans-serif'>Connected! You can close this window.</p>"
    : `<p style='font-family:sans-serif;color:#b91c1c'>Error: ${message ?? "Unknown error"}. You can close this window.</p>`;
  return `<!DOCTYPE html><html><body>${body}<script>
    try { window.opener && window.opener.postMessage(${payload}, "*"); } catch(_) {}
    setTimeout(() => window.close(), 800);
  </script></body></html>`;
}

// ── GET /api/auth/microsoft/configured ────────────────────────────────────────
// Returns whether Microsoft credentials are configured (no auth needed).
router.get("/configured", (_req, res) => {
  const configured = !!(process.env["MICROSOFT_CLIENT_ID"] && process.env["MICROSOFT_CLIENT_SECRET"]);
  res.json({ configured });
});

// ── GET /api/auth/microsoft/url ───────────────────────────────────────────────
// Returns the Microsoft OAuth URL for connecting Outlook email (requires CRM auth).
router.get("/url", requireAuth, async (req, res) => {
  const msal = getMsalClient();
  if (!msal) {
    res.status(503).json({
      error: "Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in environment settings.",
    });
    return;
  }
  try {
    const url = await msal.getAuthCodeUrl({
      scopes:      GRAPH_SCOPES,
      redirectUri: getRedirectUri(),
      prompt:      "select_account",
      state:       `outlook:${req.user!.userId}`,
    });
    res.json({ url, redirectUri: getRedirectUri() });
  } catch (err) {
    logger.warn({ err }, "Failed to generate Microsoft auth URL");
    res.status(500).json({ error: "Failed to generate sign-in URL" });
  }
});

// ── GET /api/auth/microsoft/onedrive-url ──────────────────────────────────────
// Returns the Microsoft OAuth URL for connecting OneDrive (requires CRM auth).
router.get("/onedrive-url", requireAuth, async (req, res) => {
  const msal = getMsalClient();
  if (!msal) {
    res.status(503).json({
      error: "Microsoft OAuth is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in environment settings.",
    });
    return;
  }
  try {
    const url = await msal.getAuthCodeUrl({
      scopes:      ONEDRIVE_SCOPES,
      redirectUri: getRedirectUri(),
      prompt:      "select_account",
      state:       `onedrive:${req.user!.userId}`,
    });
    res.json({ url });
  } catch (err) {
    logger.warn({ err }, "Failed to generate OneDrive auth URL");
    res.status(500).json({ error: "Failed to generate OneDrive sign-in URL" });
  }
});

// ── GET /api/auth/microsoft/login ─────────────────────────────────────────────
// Redirects the browser to Microsoft OAuth for CRM login (no auth required).
router.get("/login", (req, res) => {
  const msal = getMsalClient();
  if (!msal) {
    res.redirect("/login?error=provider_not_configured");
    return;
  }
  void msal.getAuthCodeUrl({
    scopes:      LOGIN_SCOPES,
    redirectUri: getRedirectUri(),
    prompt:      "select_account",
    state:       "login",
  }).then((url) => res.redirect(url))
    .catch((err) => {
      logger.warn({ err }, "Failed to build Microsoft login URL");
      res.redirect("/login?error=oauth_failed");
    });
});

// ── GET /api/auth/microsoft/callback ─────────────────────────────────────────
// Microsoft redirects here after approval. State encodes the mode:
//   "login"            → CRM login — find user by email, sign JWT
//   "outlook:{userId}" → connect Outlook email
//   "onedrive:{userId}"→ connect OneDrive files
//   "{number}"         → legacy Outlook connect (backward compat)
router.get("/callback", async (req, res) => {
  const { code, state, error: msError, error_description } = req.query as Record<string, string | undefined>;

  if (msError) {
    logger.warn({ msError, error_description }, "Microsoft OAuth returned an error");
    if (state === "login") {
      res.send(popupPage(false, "oauth_failed", "microsoft-login"));
    } else {
      res.send(popupPage(false, error_description ?? msError));
    }
    return;
  }

  if (!code || !state) {
    if (state === "login") {
      res.send(popupPage(false, "oauth_failed", "microsoft-login"));
    } else {
      res.send(popupPage(false, "Missing code or state parameter"));
    }
    return;
  }

  const msal = getMsalClient();
  if (!msal) {
    if (state === "login") res.send(popupPage(false, "provider_not_configured", "microsoft-login"));
    else res.send(popupPage(false, "Microsoft OAuth not configured on the server"));
    return;
  }

  // Parse mode from state
  const isLogin    = state === "login";
  const isOneDrive = state.startsWith("onedrive:");
  const isOutlook  = state.startsWith("outlook:") || /^\d+$/.test(state);

  const userId = isOneDrive
    ? parseInt(state.replace("onedrive:", ""), 10)
    : isOutlook
      ? parseInt(state.replace("outlook:", ""), 10)
      : NaN;

  if (!isLogin && isNaN(userId)) {
    res.send(popupPage(false, "Invalid state parameter"));
    return;
  }

  try {
    const scopes = isLogin ? LOGIN_SCOPES : isOneDrive ? ONEDRIVE_SCOPES : GRAPH_SCOPES;

    // Use direct HTTP token exchange so refresh_token is always captured.
    // MSAL's AuthenticationResult deliberately omits refresh_token, which
    // caused silent breakage — tokens expired after 1 hour with no renewal.
    const tokenData = await exchangeCodeForTokens(code, scopes);

    if (!tokenData?.access_token) {
      if (isLogin) res.redirect("/login?error=oauth_failed");
      else res.send(popupPage(false, "Token exchange returned no access token"));
      return;
    }

    // Fetch profile from Graph
    const graphClient = Client.init({ authProvider: (done) => done(null, tokenData.access_token) });
    const me = await graphClient.api("/me").select("mail,userPrincipalName,displayName").get() as {
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
    };
    const email       = me.mail ?? me.userPrincipalName ?? "";
    const displayName = me.displayName ?? email;

    // ── LOGIN mode ────────────────────────────────────────────────────────────
    if (isLogin) {
      const [user] = await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
        .from(usersTable)
        .where(sql`lower(${usersTable.email}) = lower(${email})`)
        .limit(1);

      if (!user) {
        logger.warn({ email }, "Microsoft login — no matching staff account");
        res.send(popupPage(false, "no_account", "microsoft-login"));
        return;
      }

      await db.insert(activityTable).values({
        userId: user.id,
        type: "login",
        description: "Signed in via Microsoft",
      });

      const token = signToken({ userId: user.id, email: user.email, role: user.role });
      logger.info({ userId: user.id, email }, "Microsoft login success");
      res.send(popupPage(true, undefined, "microsoft-login", token));
      return;
    }

    const creds = {
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at:    tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : null,
      email,
    };

    const provider = isOneDrive ? "onedrive" : "outlook";

    // ── OUTLOOK / ONEDRIVE connect modes ─────────────────────────────────────
    const [existing] = await db
      .select({ id: userConnectionsTable.id })
      .from(userConnectionsTable)
      .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));

    if (existing) {
      await db
        .update(userConnectionsTable)
        .set({ displayName, credentials: creds as Record<string, unknown>, connectedAt: new Date() })
        .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));
    } else {
      await db
        .insert(userConnectionsTable)
        .values({ userId, provider, displayName, credentials: creds as Record<string, unknown> });
    }

    logger.info({ userId, email, provider }, "Microsoft account connected via OAuth");
    const popupType = isOneDrive ? "microsoft-onedrive" : "microsoft-oauth";
    res.send(popupPage(true, undefined, popupType));
  } catch (err) {
    logger.warn({ err, state }, "Microsoft OAuth callback error");
    const msg = err instanceof Error ? err.message : "Authentication failed";
    if (isLogin) {
      res.send(popupPage(false, "oauth_failed", "microsoft-login"));
    } else {
      res.send(popupPage(false, msg));
    }
  }
});

// ── GET /api/auth/microsoft/status ────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  const [row] = await db
    .select({ displayName: userConnectionsTable.displayName, connectedAt: userConnectionsTable.connectedAt })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, req.user!.userId), eq(userConnectionsTable.provider, "outlook")));

  res.json({ connected: !!row, displayName: row?.displayName ?? null, connectedAt: row?.connectedAt ?? null });
});

export default router;
