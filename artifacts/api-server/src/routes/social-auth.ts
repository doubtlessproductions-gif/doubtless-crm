import { Router, type Request, type Response } from "express";
import { OAuth2Client } from "google-auth-library";
import { db, usersTable, activityTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { signToken } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();

function socialPopupPage(success: boolean, providerKey: string, token?: string, errorKey?: string): string {
  const type = `social-login-${providerKey}`;
  const payload = JSON.stringify({ type, success, token: token ?? null, message: errorKey ?? null });
  const body = success
    ? "<p style='font-family:sans-serif'>Signed in! You can close this window.</p>"
    : `<p style='font-family:sans-serif;color:#b91c1c'>Sign-in failed. You can close this window.</p>`;
  return `<!DOCTYPE html><html><body>${body}<script>
    try { window.opener && window.opener.postMessage(${payload}, "*"); } catch(_) {}
    setTimeout(() => window.close(), 800);
  </script></body></html>`;
}

function getAppUrl(req: Request): string {
  const domains = process.env["REPLIT_DOMAINS"];
  if (domains) {
    const primary = domains.split(",")[0]!.trim();
    return `https://${primary}`;
  }
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

async function completeSocialLogin(
  email: string,
  provider: string,
  providerKey: string,
  req: Request,
  res: Response,
) {
  try {
    const [user] = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role })
      .from(usersTable)
      .where(sql`lower(${usersTable.email}) = lower(${email})`)
      .limit(1);

    if (!user) {
      req.log.warn({ email, provider }, "Social login — no matching staff account");
      res.send(socialPopupPage(false, providerKey, undefined, "no_account"));
      return;
    }

    await db.insert(activityTable).values({
      userId: user.id,
      type: "login",
      description: `Signed in via ${provider}`,
    });

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    req.log.info({ userId: user.id, email, provider }, "Social login success");
    res.send(socialPopupPage(true, providerKey, token));
  } catch (err) {
    req.log.error({ err, provider }, "Social login DB error");
    res.send(socialPopupPage(false, providerKey, undefined, "server_error"));
  }
}

// ── Configured providers list ─────────────────────────────────────────────────
router.get("/providers", (_req: Request, res: Response) => {
  const providers: string[] = [];
  if (process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]) providers.push("google");
  if (process.env["META_CLIENT_ID"] && process.env["META_CLIENT_SECRET"]) providers.push("meta");
  if (process.env["LINKEDIN_CLIENT_ID"] && process.env["LINKEDIN_CLIENT_SECRET"]) providers.push("linkedin");
  if (process.env["TIKTOK_CLIENT_ID"] && process.env["TIKTOK_CLIENT_SECRET"]) providers.push("tiktok");
  res.json({ providers });
});

// ── GOOGLE ────────────────────────────────────────────────────────────────────

router.get("/google", (req: Request, res: Response) => {
  if (!process.env["GOOGLE_CLIENT_ID"] || !process.env["GOOGLE_CLIENT_SECRET"]) {
    res.send(socialPopupPage(false, "google", undefined, "provider_not_configured"));
    return;
  }
  const redirectUri = `${getAppUrl(req)}/api/auth/social/google/callback`;
  const client = new OAuth2Client(
    process.env["GOOGLE_CLIENT_ID"],
    process.env["GOOGLE_CLIENT_SECRET"],
    redirectUri,
  );
  const url = client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    prompt: "select_account",
  });
  res.redirect(url);
});

router.get("/google/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.send(socialPopupPage(false, "google", undefined, "cancelled")); return; }

  try {
    const redirectUri = `${getAppUrl(req)}/api/auth/social/google/callback`;
    const client = new OAuth2Client(
      process.env["GOOGLE_CLIENT_ID"],
      process.env["GOOGLE_CLIENT_SECRET"],
      redirectUri,
    );
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token!,
      audience: process.env["GOOGLE_CLIENT_ID"],
    });
    const payload = ticket.getPayload();
    if (!payload?.email) { res.send(socialPopupPage(false, "google", undefined, "no_email")); return; }
    await completeSocialLogin(payload.email, "Google", "google", req, res);
  } catch (err) {
    req.log.error({ err }, "Google OAuth callback error");
    res.send(socialPopupPage(false, "google", undefined, "oauth_failed"));
  }
});

// ── META / FACEBOOK ───────────────────────────────────────────────────────────

router.get("/meta", (req: Request, res: Response) => {
  if (!process.env["META_CLIENT_ID"] || !process.env["META_CLIENT_SECRET"]) {
    res.send(socialPopupPage(false, "meta", undefined, "provider_not_configured"));
    return;
  }
  const redirectUri = `${getAppUrl(req)}/api/auth/social/meta/callback`;
  const url =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${process.env["META_CLIENT_ID"]}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=email,public_profile` +
    `&response_type=code`;
  res.redirect(url);
});

router.get("/meta/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.send(socialPopupPage(false, "meta", undefined, "cancelled")); return; }

  try {
    const redirectUri = `${getAppUrl(req)}/api/auth/social/meta/callback`;
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token` +
      `?client_id=${process.env["META_CLIENT_ID"]}` +
      `&client_secret=${process.env["META_CLIENT_SECRET"]}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code=${code}`,
    );
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) { res.send(socialPopupPage(false, "meta", undefined, "oauth_failed")); return; }

    const meRes = await fetch(
      `https://graph.facebook.com/me?fields=email&access_token=${tokenData.access_token}`,
    );
    const me = (await meRes.json()) as { email?: string };
    if (!me.email) { res.send(socialPopupPage(false, "meta", undefined, "no_email")); return; }
    await completeSocialLogin(me.email, "Meta", "meta", req, res);
  } catch (err) {
    req.log.error({ err }, "Meta OAuth callback error");
    res.send(socialPopupPage(false, "meta", undefined, "oauth_failed"));
  }
});

// ── LINKEDIN ──────────────────────────────────────────────────────────────────

router.get("/linkedin", (req: Request, res: Response) => {
  if (!process.env["LINKEDIN_CLIENT_ID"] || !process.env["LINKEDIN_CLIENT_SECRET"]) {
    res.send(socialPopupPage(false, "linkedin", undefined, "provider_not_configured"));
    return;
  }
  const redirectUri = `${getAppUrl(req)}/api/auth/social/linkedin/callback`;
  const url =
    `https://www.linkedin.com/oauth/v2/authorization` +
    `?response_type=code` +
    `&client_id=${process.env["LINKEDIN_CLIENT_ID"]}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=openid%20profile%20email`;
  res.redirect(url);
});

router.get("/linkedin/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.send(socialPopupPage(false, "linkedin", undefined, "cancelled")); return; }

  try {
    const redirectUri = `${getAppUrl(req)}/api/auth/social/linkedin/callback`;
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env["LINKEDIN_CLIENT_ID"] ?? "",
        client_secret: process.env["LINKEDIN_CLIENT_SECRET"] ?? "",
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) { res.send(socialPopupPage(false, "linkedin", undefined, "oauth_failed")); return; }

    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = (await meRes.json()) as { email?: string };
    if (!me.email) { res.send(socialPopupPage(false, "linkedin", undefined, "no_email")); return; }
    await completeSocialLogin(me.email, "LinkedIn", "linkedin", req, res);
  } catch (err) {
    req.log.error({ err }, "LinkedIn OAuth callback error");
    res.send(socialPopupPage(false, "linkedin", undefined, "oauth_failed"));
  }
});

// ── TIKTOK ────────────────────────────────────────────────────────────────────

router.get("/tiktok", (req: Request, res: Response) => {
  if (!process.env["TIKTOK_CLIENT_ID"] || !process.env["TIKTOK_CLIENT_SECRET"]) {
    res.send(socialPopupPage(false, "tiktok", undefined, "provider_not_configured"));
    return;
  }
  const redirectUri = `${getAppUrl(req)}/api/auth/social/tiktok/callback`;
  const url =
    `https://www.tiktok.com/v2/auth/authorize/` +
    `?client_key=${process.env["TIKTOK_CLIENT_ID"]}` +
    `&scope=user.info.basic,user.info.profile,user.info.stats` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(url);
});

router.get("/tiktok/callback", async (req: Request, res: Response) => {
  const code = req.query["code"] as string | undefined;
  if (!code) { res.send(socialPopupPage(false, "tiktok", undefined, "cancelled")); return; }

  try {
    const redirectUri = `${getAppUrl(req)}/api/auth/social/tiktok/callback`;
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: process.env["TIKTOK_CLIENT_ID"] ?? "",
        client_secret: process.env["TIKTOK_CLIENT_SECRET"] ?? "",
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as { data?: { access_token?: string; open_id?: string } };
    if (!tokenData.data?.access_token) { res.send(socialPopupPage(false, "tiktok", undefined, "oauth_failed")); return; }

    req.log.warn({ openId: tokenData.data.open_id }, "TikTok login — TikTok does not expose email by default");
    res.send(socialPopupPage(false, "tiktok", undefined, "tiktok_no_email"));
  } catch (err) {
    req.log.error({ err }, "TikTok OAuth callback error");
    res.send(socialPopupPage(false, "tiktok", undefined, "oauth_failed"));
  }
});

export default router;
