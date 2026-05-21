// Social media publishing engine — called by both the manual publish endpoint
// and the scheduled-post cron. Each platform gets its own handler.

type PublishResult = { ok: true } | { ok: false; error: string };

// ── Instagram ──────────────────────────────────────────────────────────────────
// Uses Instagram Graph API (long-lived user access token for Business accounts).
// Image posts require a publicly-accessible image URL in mediaUrls[0].
async function publishInstagram(token: string, copy: string, mediaUrls: string[]): Promise<PublishResult> {
  try {
    const meRes = await fetch(
      `https://graph.instagram.com/me?fields=id&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!meRes.ok) return { ok: false, error: "Could not fetch Instagram user ID — check your access token." };
    const me = (await meRes.json()) as { id?: string; error?: { message?: string } };
    if (!me.id) return { ok: false, error: me.error?.message ?? "No Instagram user ID in response." };

    const imageUrl = mediaUrls[0];
    const containerBody: Record<string, string> = {
      caption:    copy,
      access_token: token,
    };
    if (imageUrl) {
      containerBody.image_url = imageUrl;
      containerBody.media_type = "IMAGE";
    } else {
      // Text-only carousel not supported; Instagram requires media
      return { ok: false, error: "Instagram posts require at least one image URL in the Media URLs field." };
    }

    const containerRes = await fetch(`https://graph.instagram.com/v19.0/${me.id}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerBody),
      signal: AbortSignal.timeout(15000),
    });
    if (!containerRes.ok) {
      const err = (await containerRes.json()) as { error?: { message?: string } };
      return { ok: false, error: `Instagram container error: ${err.error?.message ?? containerRes.statusText}` };
    }
    const container = (await containerRes.json()) as { id?: string };
    if (!container.id) return { ok: false, error: "No container ID returned from Instagram." };

    const pubRes = await fetch(`https://graph.instagram.com/v19.0/${me.id}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: token }),
      signal: AbortSignal.timeout(15000),
    });
    if (!pubRes.ok) {
      const err = (await pubRes.json()) as { error?: { message?: string } };
      return { ok: false, error: `Instagram publish error: ${err.error?.message ?? pubRes.statusText}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Instagram request failed: ${String(e)}` };
  }
}

// ── Facebook Pages ─────────────────────────────────────────────────────────────
async function publishFacebook(
  token: string, pageId: string, copy: string, mediaUrls: string[],
): Promise<PublishResult> {
  if (!pageId) return { ok: false, error: "Facebook Page ID is missing. Re-connect Facebook in Settings → Integrations." };
  try {
    const body: Record<string, string> = { message: copy, access_token: token };
    if (mediaUrls[0]) body.link = mediaUrls[0];

    const res = await fetch(`https://graph.facebook.com/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = (await res.json()) as { error?: { message?: string } };
      return { ok: false, error: `Facebook error: ${err.error?.message ?? res.statusText}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Facebook request failed: ${String(e)}` };
  }
}

// ── Slack ──────────────────────────────────────────────────────────────────────
async function publishSlack(token: string, copy: string): Promise<PublishResult> {
  try {
    if (token.startsWith("https://hooks.slack.com/")) {
      const res = await fetch(token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: copy }),
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      return text === "ok" || res.ok ? { ok: true } : { ok: false, error: `Slack webhook error: ${text}` };
    }

    // Bot token
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "#general", text: copy }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) return { ok: false, error: `Slack bot error: ${data.error ?? "unknown"}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Slack request failed: ${String(e)}` };
  }
}

// ── Platform dispatch ──────────────────────────────────────────────────────────
const UNSUPPORTED: Record<string, string> = {
  twitter:  "X/Twitter posting requires OAuth 1.0a user auth, which isn't supported with a Bearer token. Schedule via Buffer or Hootsuite.",
  linkedin: "LinkedIn posting requires OAuth 2.0 user auth. Schedule via a LinkedIn scheduling tool.",
  tiktok:   "TikTok posting requires special API approval and cannot be automated with an access token.",
  youtube:  "YouTube posting requires OAuth 2.0 user auth. Upload via YouTube Studio.",
  email:    "Email posts are handled through the Email/SMTP integration — use the Templates page to send.",
  sms:      "SMS posts require a Twilio or SMS provider connection.",
};

export async function publishPost(
  platform: string,
  credentials: Record<string, string>,
  copy: string,
  mediaUrls: string[],
): Promise<PublishResult> {
  if (UNSUPPORTED[platform]) return { ok: false, error: UNSUPPORTED[platform] };

  const token = credentials["accessToken"] ?? credentials["access_token"] ?? "";

  switch (platform) {
    case "instagram":
      return publishInstagram(token, copy, mediaUrls);
    case "facebook":
      return publishFacebook(token, credentials["pageId"] ?? credentials["page_id"] ?? "", copy, mediaUrls);
    case "slack":
      return publishSlack(token, copy);
    default:
      return { ok: false, error: `Publishing to "${platform}" is not yet supported.` };
  }
}
