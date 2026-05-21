// Per-user integration connections — Outlook, OneDrive, Dropbox, and third-party apps
import { Router } from "express";
import { db, userConnectionsTable, workspaceConnectionsTable, customPlatformsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import type { Request, Response } from "express";

const router = Router();

const VALID_PROVIDERS = [
  "outlook", "onedrive", "dropbox",
  "quickbooks", "xero",
  "instagram", "facebook", "linkedin", "twitter", "tiktok", "youtube",
  "slack", "mailchimp",
  "shopify",
  "google-drive", "notion", "airtable",
  "hubspot",
] as const;

type Provider = (typeof VALID_PROVIDERS)[number];

// ── Provider verification — attempts an API call to confirm the credential ───
async function verifyCredential(
  provider: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; displayName: string }> {
  const token = (body.accessToken ?? body.token) as string | undefined;

  switch (provider as Provider) {
    case "instagram": {
      if (!token) return { ok: false, displayName: "" };
      try {
        const r = await fetch(`https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const d = (await r.json()) as { username?: string };
          return { ok: true, displayName: d.username ? `@${d.username}` : "Instagram Account" };
        }
        const err = (await r.json()) as { error?: { message?: string } };
        return { ok: false, displayName: err.error?.message ?? "Invalid token" };
      } catch { return { ok: false, displayName: "Could not reach Instagram" }; }
    }

    case "facebook": {
      if (!token) return { ok: false, displayName: "" };
      try {
        const r = await fetch(`https://graph.facebook.com/me?fields=name,email&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const d = (await r.json()) as { name?: string; email?: string };
          return { ok: true, displayName: d.name ?? d.email ?? "Facebook Account" };
        }
        return { ok: false, displayName: "Invalid token" };
      } catch { return { ok: false, displayName: "Could not reach Facebook" }; }
    }

    case "slack": {
      if (!token) return { ok: false, displayName: "" };
      if (token.startsWith("https://hooks.slack.com/")) {
        try {
          const r = await fetch(token, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: "" }),
            signal: AbortSignal.timeout(8000),
          });
          const text = await r.text();
          if (r.ok || text === "ok") return { ok: true, displayName: "Slack Incoming Webhook" };
          return { ok: false, displayName: text };
        } catch { return { ok: false, displayName: "Could not reach Slack" }; }
      }
      if (token.startsWith("xoxb-") || token.startsWith("xoxa-")) {
        try {
          const r = await fetch("https://slack.com/api/auth.test", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const d = (await r.json()) as { ok?: boolean; team?: string; user?: string };
            if (d.ok) return { ok: true, displayName: `${d.user ?? "Bot"} @ ${d.team ?? "Workspace"}` };
          }
          return { ok: false, displayName: "Invalid Slack token" };
        } catch { return { ok: false, displayName: "Could not reach Slack" }; }
      }
      return { ok: false, displayName: "Must be a Slack webhook URL (https://hooks.slack.com/…) or bot token (xoxb-…)" };
    }

    case "mailchimp": {
      if (!token) return { ok: false, displayName: "" };
      const match = token.match(/-([a-z0-9]+)$/);
      if (!match) return { ok: false, displayName: "Invalid API key format — expected key-usXX" };
      const dc = match[1];
      try {
        const r = await fetch(`https://${dc}.api.mailchimp.com/3.0/`, {
          headers: { Authorization: `Basic ${Buffer.from(`anystring:${token}`).toString("base64")}` },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const d = (await r.json()) as { account_name?: string; email?: string };
          return { ok: true, displayName: d.account_name ?? d.email ?? "Mailchimp Account" };
        }
        return { ok: false, displayName: "Invalid Mailchimp API key" };
      } catch { return { ok: false, displayName: "Could not reach Mailchimp" }; }
    }

    case "notion": {
      if (!token) return { ok: false, displayName: "" };
      try {
        const r = await fetch("https://api.notion.com/v1/users/me", {
          headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const d = (await r.json()) as { name?: string; person?: { email?: string } };
          return { ok: true, displayName: d.name ?? d.person?.email ?? "Notion Account" };
        }
        return { ok: false, displayName: "Invalid Notion integration secret" };
      } catch { return { ok: false, displayName: "Could not reach Notion" }; }
    }

    case "shopify": {
      const shopDomain = body.shopDomain as string | undefined;
      const accessToken = body.accessToken as string | undefined;
      if (!shopDomain || !accessToken) return { ok: false, displayName: "Shop domain and access token are both required" };
      try {
        const domain = shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
        const r = await fetch(`https://${domain}/admin/api/2024-01/shop.json`, {
          headers: { "X-Shopify-Access-Token": accessToken },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const d = (await r.json()) as { shop?: { name?: string; email?: string } };
          return { ok: true, displayName: d.shop?.name ?? d.shop?.email ?? domain };
        }
        return { ok: false, displayName: "Invalid Shopify credentials — check the shop domain and token" };
      } catch { return { ok: false, displayName: "Could not reach your Shopify store" }; }
    }

    case "youtube": {
      if (!token) return { ok: false, displayName: "" };
      try {
        const r = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) },
        );
        if (r.ok) {
          const d = (await r.json()) as { items?: { snippet?: { title?: string } }[] };
          const title = d.items?.[0]?.snippet?.title;
          return { ok: true, displayName: title ?? "YouTube Channel" };
        }
        const err = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, displayName: err.error?.message ?? "Invalid access token" };
      } catch { return { ok: false, displayName: "Could not reach YouTube" }; }
    }

    case "quickbooks":
    case "xero":
    case "linkedin":
    case "twitter":
    case "tiktok":
    case "google-drive":
    case "airtable":
    case "hubspot":
      return { ok: true, displayName: token ? `${provider.charAt(0).toUpperCase() + provider.slice(1)} Account` : "Connected" };

    default:
      return { ok: false, displayName: "Unknown provider" };
  }
}

// ── Shared connect logic ────────────────────────────────────────────────────────
async function connectProvider(
  userId: number,
  provider: string,
  body: Record<string, unknown>,
  res: Response,
): Promise<void> {
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    res.status(400).json({ error: `Unknown provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` });
    return;
  }

  let displayName = "";
  let credentials: Record<string, string> | undefined;

  if (provider === "outlook") {
    res.status(400).json({ error: "Outlook is connected via Microsoft sign-in. Use Settings → Integrations → Microsoft Outlook → Connect." });
    return;
  }

  if (provider === "onedrive") {
    res.status(400).json({ error: "OneDrive is connected via Microsoft sign-in. Use Settings → Integrations → Microsoft OneDrive → Connect." });
    return;

  } else if (provider === "dropbox") {
    const parse = z.object({ accessToken: z.string().min(10) }).safeParse(body);
    if (!parse.success) { res.status(400).json({ error: "accessToken is required for Dropbox" }); return; }
    try {
      const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${parse.data.accessToken}`, "Content-Type": "application/json" },
        body: "null",
      });
      if (!r.ok) { res.status(400).json({ error: "Invalid Dropbox access token — please check and try again" }); return; }
      const acct = (await r.json()) as { name?: { display_name?: string }; email?: string };
      displayName = acct.name?.display_name ?? acct.email ?? "Dropbox Account";
    } catch { res.status(502).json({ error: "Could not reach Dropbox to verify token" }); return; }
    credentials = { access_token: parse.data.accessToken };

  } else {
    const result = await verifyCredential(provider, body);
    if (!result.ok) {
      res.status(400).json({ error: result.displayName || "Could not verify credentials — please check and try again" });
      return;
    }
    displayName = result.displayName;

    const creds: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === "string" && v.trim()) creds[k] = v.trim();
    }
    if (Object.keys(creds).length > 0) credentials = creds;
  }

  const [existing] = await db
    .select({ id: userConnectionsTable.id })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));

  const returning = {
    id: userConnectionsTable.id,
    userId: userConnectionsTable.userId,
    provider: userConnectionsTable.provider,
    displayName: userConnectionsTable.displayName,
    connectedAt: userConnectionsTable.connectedAt,
  } as const;

  let row;
  if (existing) {
    const [updated] = await db
      .update(userConnectionsTable)
      .set({ displayName, credentials: credentials ?? null, connectedAt: new Date() })
      .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)))
      .returning(returning);
    row = updated!;
  } else {
    const [inserted] = await db
      .insert(userConnectionsTable)
      .values({ userId, provider, displayName, credentials: credentials ?? null })
      .returning(returning);
    row = inserted!;
  }

  logger.info({ userId, provider, displayName }, "Integration connected");
  res.json(row);
}

// ── GET /api/integrations/connections ─────────────────────────────────────────
// Returns the user's personal connections PLUS any workspace connections for
// providers the user hasn't connected personally (marked isWorkspace: true).
router.get("/connections", requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  const [personalConns, workspaceConns] = await Promise.all([
    db.select({
      id:          userConnectionsTable.id,
      userId:      userConnectionsTable.userId,
      provider:    userConnectionsTable.provider,
      displayName: userConnectionsTable.displayName,
      connectedAt: userConnectionsTable.connectedAt,
    }).from(userConnectionsTable).where(eq(userConnectionsTable.userId, userId)),
    db.select({
      id:          workspaceConnectionsTable.id,
      provider:    workspaceConnectionsTable.provider,
      displayName: workspaceConnectionsTable.displayName,
      connectedAt: workspaceConnectionsTable.connectedAt,
    }).from(workspaceConnectionsTable),
  ]);

  const personalProviders = new Set(personalConns.map((c) => c.provider));

  const result = [
    ...personalConns.map((c) => ({ ...c, isWorkspace: false })),
    ...workspaceConns
      .filter((wc) => !personalProviders.has(wc.provider))
      .map((wc) => ({
        id:          wc.id,
        userId:      null as number | null,
        provider:    wc.provider,
        displayName: `${wc.displayName} (Shared)`,
        connectedAt: wc.connectedAt,
        isWorkspace: true,
      })),
  ];

  res.json(result);
});

// ── POST /api/integrations/connect/:provider (path-param style) ───────────────
router.post("/connect/:provider", requireAuth, async (req, res) => {
  await connectProvider(req.user!.userId, req.params["provider"] as string, req.body as Record<string, unknown>, res);
});

// ── POST /api/integrations/connections (canonical body-param upsert) ──────────
router.post("/connections", requireAuth, async (req, res) => {
  const parse = z.object({
    provider: z.string(),
    data: z.record(z.string(), z.unknown()).optional().default({}),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "provider is required" }); return; }
  await connectProvider(req.user!.userId, parse.data.provider, parse.data.data, res);
});

// ── DELETE /api/integrations/connections/:provider ────────────────────────────
router.delete("/connections/:provider", requireAuth, async (req, res) => {
  const { provider } = req.params as { provider: string };
  const userId = req.user!.userId;
  await db
    .delete(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, userId), eq(userConnectionsTable.provider, provider)));
  logger.info({ userId, provider }, "Integration disconnected");
  res.json({ ok: true });
});

// ── WORKSPACE CONNECTION MANAGEMENT (admin only) ──────────────────────────────

function requireAdmin(req: Request, res: Response): boolean {
  const role = req.user?.role;
  if (role !== "admin" && role !== "owner") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// Providers that may be set as company-wide workspace connections
const WORKSPACE_SOCIAL_PROVIDERS = ["instagram", "facebook", "slack"] as const;

// GET /api/integrations/workspace-connections
// Returns connection metadata to all authenticated users (credentials never included).
// connectedBy is admin-only metadata — stripped before sending to non-admins.
router.get("/workspace-connections", requireAuth, async (req, res) => {
  const rows = await db.select({
    id:          workspaceConnectionsTable.id,
    provider:    workspaceConnectionsTable.provider,
    displayName: workspaceConnectionsTable.displayName,
    connectedAt: workspaceConnectionsTable.connectedAt,
    connectedBy: workspaceConnectionsTable.connectedBy,
  }).from(workspaceConnectionsTable);

  const isAdmin = req.user?.role === "admin" || req.user?.role === "owner";
  const sanitised = rows.map(({ connectedBy, ...rest }) =>
    isAdmin ? { ...rest, connectedBy } : rest
  );
  res.json(sanitised);
});

// POST /api/integrations/workspace-connections — upsert a company account (admin only)
router.post("/workspace-connections", requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parse = z.object({
    provider: z.enum(WORKSPACE_SOCIAL_PROVIDERS),
    data:     z.record(z.string(), z.unknown()).optional().default({}),
  }).safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: `provider must be one of: ${WORKSPACE_SOCIAL_PROVIDERS.join(", ")}` });
    return;
  }

  const { provider, data } = parse.data;
  if (!VALID_PROVIDERS.includes(provider as Provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }

  const result = await verifyCredential(provider, data);
  if (!result.ok) {
    res.status(400).json({ error: result.displayName || "Could not verify credentials" });
    return;
  }

  const creds: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.trim()) creds[k] = v.trim();
  }

  const [existing] = await db
    .select({ id: workspaceConnectionsTable.id })
    .from(workspaceConnectionsTable)
    .where(eq(workspaceConnectionsTable.provider, provider));

  let row;
  if (existing) {
    const [updated] = await db
      .update(workspaceConnectionsTable)
      .set({ displayName: result.displayName, credentials: creds, connectedBy: req.user!.userId, connectedAt: new Date() })
      .where(eq(workspaceConnectionsTable.provider, provider))
      .returning({ id: workspaceConnectionsTable.id, provider: workspaceConnectionsTable.provider, displayName: workspaceConnectionsTable.displayName, connectedAt: workspaceConnectionsTable.connectedAt });
    row = updated!;
  } else {
    const [inserted] = await db
      .insert(workspaceConnectionsTable)
      .values({ provider, displayName: result.displayName, credentials: creds, connectedBy: req.user!.userId })
      .returning({ id: workspaceConnectionsTable.id, provider: workspaceConnectionsTable.provider, displayName: workspaceConnectionsTable.displayName, connectedAt: workspaceConnectionsTable.connectedAt });
    row = inserted!;
  }

  logger.info({ userId: req.user!.userId, provider }, "Workspace connection upserted");
  res.json(row);
});

// DELETE /api/integrations/workspace-connections/:provider
router.delete("/workspace-connections/:provider", requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { provider } = req.params as { provider: string };
  await db.delete(workspaceConnectionsTable).where(eq(workspaceConnectionsTable.provider, provider));
  logger.info({ userId: req.user!.userId, provider }, "Workspace connection removed");
  res.json({ ok: true });
});

// ── CUSTOM PLATFORMS ────────────────────────────────────────────────────────
// Workspace-level registry of custom streaming / social platform templates.

// GET /api/integrations/custom-platforms
router.get("/custom-platforms", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(customPlatformsTable)
    .orderBy(customPlatformsTable.createdAt);
  res.json(rows);
});

const customPlatformBody = z.object({
  name:     z.string().min(1).max(80),
  linkType: z.enum(["streaming", "social"]),
});

// POST /api/integrations/custom-platforms
router.post("/custom-platforms", requireAuth, async (req, res) => {
  const parsed = customPlatformBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const { name, linkType } = parsed.data;
  const [row] = await db
    .insert(customPlatformsTable)
    .values({ name, linkType, createdBy: req.user!.userId })
    .returning();
  logger.info({ userId: req.user!.userId, name, linkType }, "Custom platform created");
  res.status(201).json(row);
});

// DELETE /api/integrations/custom-platforms/:id
router.delete("/custom-platforms/:id", requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(customPlatformsTable).where(eq(customPlatformsTable.id, id));
  logger.info({ userId: req.user!.userId, id }, "Custom platform deleted");
  res.json({ ok: true });
});

export default router;
