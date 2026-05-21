import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  useGetTheme, useUpdateTheme, useGetMe, getGetThemeQueryKey, getGetMeQueryKey,
  useGetMyConnections, useConnectProvider, useDisconnectProvider, getGetMyConnectionsQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import {
  Paintbrush, Mail, CheckCircle2, AlertCircle, Trash2, Send, Eye, EyeOff, Info,
  ShieldCheck, ShieldAlert, ShieldOff, Lock, Zap, Globe, FileText, Bug, Clock,
  Plug2, HardDrive, Cloud, Loader2, ExternalLink, Check, Plus, X, Target, Users2, Bell,
  Webhook, Key, Copy, RefreshCw, ChevronDown, ChevronUp, Search,
  Sun, SlidersHorizontal,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

// ── Schemas ────────────────────────────────────────────────────────────────
const themeSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a valid hex color"),
  logoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  font: z.string().default("Inter"),
  borderRadius: z.string().default("0.5rem"),
  navStyle: z.enum(["filled", "outlined", "minimal"]).default("filled"),
});

const emailSchema = z.object({
  fromName: z.string().min(1, "Display name is required"),
  fromEmail: z.string().email("Must be a valid email"),
  smtpHost: z.string().min(1, "SMTP host is required"),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUser: z.string().min(1, "Username is required"),
  smtpPass: z.string().min(1, "Password is required"),
  smtpSecure: z.boolean(),
});

type ThemeFormValues = z.infer<typeof themeSchema>;
type NavStyle = "filled" | "outlined" | "minimal";
type EmailFormValues = z.infer<typeof emailSchema>;

interface EmailSettings {
  id: number;
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpSecure: boolean;
  isVerified: boolean;
  hasPassword: boolean;
}

interface SecurityStatus {
  helmet: boolean;
  csp: boolean;
  hsts: boolean;
  rateLimiting: { api: string; auth: string; forms: string };
  cors: string;
  bodySizeLimit: string;
  xssSanitization: boolean;
  honeypot: boolean;
  jwtSecretConfigured: boolean;
  bcryptRounds: number;
  socketCors: string;
  nodeEnv: string;
  uptime: number;
  recentLogins: { userId: number; description: string; at: string }[];
}

const PRESETS: { label: string; host: string; port: number; secure: boolean }[] = [
  { label: "Gmail",        host: "smtp.gmail.com",     port: 587, secure: false },
  { label: "Outlook/365",  host: "smtp.office365.com", port: 587, secure: false },
  { label: "Yahoo",        host: "smtp.mail.yahoo.com",port: 465, secure: true  },
  { label: "Custom",       host: "",                   port: 587, secure: false },
];

function authH(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

// ── SMTP Disconnect Button ──────────────────────────────────────────────────
// ── Notification Preferences Tab ────────────────────────────────────────────
const NOTIF_EVENTS_SETTINGS = [
  { key: "newMessage",           label: "New message in thread",       desc: "Get an email when any team member sends a message" },
  { key: "portalMessage",        label: "Client portal message",        desc: "Get an email when a client messages via the portal" },
  { key: "dealCreated",          label: "New deal created",             desc: "Get an email when a new deal is added" },
  { key: "dealStageChanged",     label: "Deal stage change",            desc: "Get an email when a deal moves to a new stage" },
  { key: "dealUpdated",          label: "Deal info updated",            desc: "Get an email when deal details are edited" },
  { key: "newContact",           label: "New contact added",            desc: "Get an email when a new contact is created" },
  { key: "projectCreated",       label: "New studio project",           desc: "Get an email when a studio project is created" },
  { key: "projectStatusChanged", label: "Studio project status change", desc: "Get an email when a project status changes" },
  { key: "dealNoteAdded",        label: "Note added to deal",           desc: "Get an email when a note is added to a deal" },
];

function NotificationsTab({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch("/api/admin/me/notification-prefs", { headers: authH(token) })
      .then((r) => r.json())
      .then((data) => { setPrefs(data ?? {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/me/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Notification preferences saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  const activeCount = Object.values(prefs).filter(Boolean).length;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Bell className="h-4 w-4 text-blue-500" /> Email Notifications
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Choose which CRM events send you an email. {activeCount > 0 && <span className="text-blue-600 font-medium">{activeCount} active</span>}
          </p>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
        </Button>
      </div>
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 mb-4">
        Emails are delivered via your verified SMTP account. Make sure your company email is set up in the Email Account tab.
      </div>
      <div className="space-y-2">
        {NOTIF_EVENTS_SETTINGS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-start justify-between gap-4 p-3 rounded-lg border border-zinc-100 hover:bg-zinc-50 transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-800">{label}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
            </div>
            <Switch
              checked={!!prefs[key]}
              onCheckedChange={(v) => setPrefs((prev) => ({ ...prev, [key]: v }))}
              className="shrink-0 mt-0.5"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function SmtpDisconnectButton({ token, onSuccess }: { token: string | null; onSuccess: () => void }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function handleDisconnect() {
    setPending(true);
    try {
      const r = await fetch("/api/email-settings", {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (r.ok) {
        toast({ title: "SMTP email disconnected" });
        onSuccess();
      } else {
        toast({ title: "Failed to disconnect", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="sm" variant="outline"
      className="text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
      onClick={handleDisconnect}
      disabled={pending}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
    </Button>
  );
}

// ── App Directory definition ───────────────────────────────────────────────────
type AppField = { key: string; label: string; placeholder: string; type?: "text" | "password" | "url" };
type AppDef = {
  id: string; name: string; description: string; category: string;
  bgColor: string; textColor: string; initials: string;
  connectType: "replit-connector" | "token" | "oauth" | "oauth-onedrive" | "smtp-redirect";
  instructions?: string; docsUrl?: string; fields?: AppField[];
};

const APP_DIRECTORY: AppDef[] = [
  {
    id: "outlook", name: "Microsoft Outlook",
    description: "Send CRM emails from your @doubtlessproductions.com address via Microsoft Graph — works even when SMTP AUTH is disabled.",
    category: "Microsoft", bgColor: "bg-blue-50", textColor: "text-[#0078d4]", initials: "OL",
    connectType: "oauth" as const,
  },
  { id: "onedrive", name: "Microsoft OneDrive", description: "Browse and attach cloud files to deals and contacts.", category: "Microsoft", bgColor: "bg-blue-50", textColor: "text-[#0078d4]", initials: "OD", connectType: "oauth-onedrive" as const },
  { id: "dropbox", name: "Dropbox", description: "Attach Dropbox files to deals and projects.", category: "Cloud Storage", bgColor: "bg-blue-50", textColor: "text-[#0061ff]", initials: "DB", connectType: "token", instructions: "Generate an access token at dropbox.com/developers/apps and paste it below.", docsUrl: "https://www.dropbox.com/developers/apps", fields: [{ key: "accessToken", label: "Access Token", placeholder: "sl.xxxxxxxxxxxxxxxx…", type: "password" }] },
  { id: "google-drive", name: "Google Drive", description: "Browse and attach Google Drive files to deals.", category: "Cloud Storage", bgColor: "bg-red-50", textColor: "text-[#4285f4]", initials: "GD", connectType: "token", instructions: "Go to console.cloud.google.com → APIs → Credentials, create an API Key, and paste it below.", docsUrl: "https://console.cloud.google.com/", fields: [{ key: "accessToken", label: "API Key", placeholder: "AIzaSy…", type: "password" }] },
  { id: "quickbooks", name: "QuickBooks", description: "Sync invoices, payments, and customer records with your accounting.", category: "Accounting", bgColor: "bg-green-50", textColor: "text-[#2ca01c]", initials: "QB", connectType: "token", instructions: "Create an app at developer.intuit.com, generate a Bearer Token, and also copy your Company (Realm) ID from the QuickBooks URL.", docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/get-started", fields: [{ key: "accessToken", label: "Bearer Token", placeholder: "eyJhbGciOiJSUzI1NiJ9…", type: "password" }, { key: "realmId", label: "Company (Realm) ID", placeholder: "4620816365025971230", type: "text" }] },
  { id: "xero", name: "Xero", description: "Sync contacts and invoices with Xero accounting.", category: "Accounting", bgColor: "bg-blue-50", textColor: "text-[#13b5ea]", initials: "XE", connectType: "token", instructions: "Create an app at developer.xero.com, connect it to your organisation, and paste your access token below.", docsUrl: "https://developer.xero.com/documentation/getting-started-guide/", fields: [{ key: "accessToken", label: "Access Token", placeholder: "eyJhbGciOi…", type: "password" }] },
  { id: "instagram", name: "Instagram", description: "Post content, view analytics, and track engagement.", category: "Social Media", bgColor: "bg-pink-50", textColor: "text-[#e1306c]", initials: "IG", connectType: "token", instructions: "Get a long-lived User Access Token from the Meta for Developers dashboard. Your app needs the instagram_basic permission.", docsUrl: "https://developers.facebook.com/docs/instagram-basic-display-api/getting-started", fields: [{ key: "accessToken", label: "Long-lived Access Token", placeholder: "IGQVJVWXpj…", type: "password" }] },
  { id: "facebook", name: "Facebook Pages", description: "Post to your Facebook Page and track audience engagement.", category: "Social Media", bgColor: "bg-blue-50", textColor: "text-[#1877f2]", initials: "FB", connectType: "token", instructions: "Get a Page Access Token from the Meta for Developers dashboard (facebook.com/developers) for the Page you want to manage.", docsUrl: "https://developers.facebook.com/docs/pages/access-tokens", fields: [{ key: "accessToken", label: "Page Access Token", placeholder: "EAABsbCS4…", type: "password" }, { key: "pageId", label: "Page ID", placeholder: "123456789012345", type: "text" }] },
  { id: "linkedin", name: "LinkedIn", description: "Post company updates and track page analytics.", category: "Social Media", bgColor: "bg-blue-50", textColor: "text-[#0a66c2]", initials: "LI", connectType: "token", instructions: "Create an app at linkedin.com/developers and generate an OAuth 2.0 access token with the w_member_social and r_basicprofile permissions.", docsUrl: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow", fields: [{ key: "accessToken", label: "Access Token", placeholder: "AQV8X…", type: "password" }] },
  { id: "twitter", name: "X (Twitter)", description: "Post updates and monitor brand mentions.", category: "Social Media", bgColor: "bg-zinc-50", textColor: "text-zinc-900", initials: "X", connectType: "token", instructions: "Create a project at developer.twitter.com, create an app, and generate a Bearer Token.", docsUrl: "https://developer.twitter.com/en/portal/dashboard", fields: [{ key: "accessToken", label: "Bearer Token", placeholder: "AAAAAAAAAAAAAAAA…", type: "password" }] },
  { id: "tiktok", name: "TikTok", description: "Manage TikTok content and track video performance.", category: "Social Media", bgColor: "bg-zinc-50", textColor: "text-zinc-800", initials: "TK", connectType: "token", instructions: "Create a developer app at developers.tiktok.com and generate an access token with the required scopes.", docsUrl: "https://developers.tiktok.com/", fields: [{ key: "accessToken", label: "Access Token", placeholder: "act.xxxxxxxx…", type: "password" }] },
  { id: "youtube", name: "YouTube", description: "Post videos, manage your channel, and track watch analytics.", category: "Social Media", bgColor: "bg-red-50", textColor: "text-[#ff0000]", initials: "YT", connectType: "token", instructions: "Go to console.cloud.google.com → APIs & Services → Credentials, create an OAuth 2.0 client ID, enable the YouTube Data API v3, and generate an access token with the youtube.force-ssl and youtube.readonly scopes. You can use the OAuth 2.0 Playground (developers.google.com/oauthplayground) to get a token quickly.", docsUrl: "https://developers.google.com/youtube/v3/getting-started", fields: [{ key: "accessToken", label: "OAuth Access Token", placeholder: "ya29.xxxxxxxx…", type: "password" }, { key: "channelId", label: "Channel ID (optional)", placeholder: "UCxxxxxxxxxxxxxxxxxxxxxxxx", type: "text" }] },
  { id: "slack", name: "Slack", description: "Send CRM notifications and deal updates to your Slack workspace.", category: "Communication", bgColor: "bg-purple-50", textColor: "text-[#4a154b]", initials: "SL", connectType: "token", instructions: "Create an Incoming Webhook at api.slack.com/apps (for simple notifications), or use a Bot Token (xoxb-…) for full functionality.", docsUrl: "https://api.slack.com/messaging/webhooks", fields: [{ key: "accessToken", label: "Webhook URL or Bot Token", placeholder: "https://hooks.slack.com/services/…", type: "text" }] },
  { id: "mailchimp", name: "Mailchimp", description: "Sync contacts and launch email campaigns from within the CRM.", category: "Marketing", bgColor: "bg-yellow-50", textColor: "text-[#c09a00]", initials: "MC", connectType: "token", instructions: "Go to Mailchimp → Account → Extras → API keys and generate a key. Format: xxxxxxxx-usXX.", docsUrl: "https://mailchimp.com/developer/marketing/guides/quick-start/", fields: [{ key: "accessToken", label: "API Key", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-us21", type: "password" }] },
  { id: "shopify", name: "Shopify", description: "Sync orders, customers, and products from your Shopify store.", category: "E-commerce", bgColor: "bg-green-50", textColor: "text-[#5c8e1a]", initials: "SH", connectType: "token", instructions: "In Shopify Admin go to Settings → Apps → Develop apps, create a custom app, configure Admin API scopes, and install it to get your access token.", docsUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps", fields: [{ key: "shopDomain", label: "Shop Domain", placeholder: "your-store.myshopify.com", type: "text" }, { key: "accessToken", label: "Admin API Access Token", placeholder: "shpat_xxxxxxxxxx…", type: "password" }] },
  { id: "notion", name: "Notion", description: "Link your Notion workspace to sync notes and documents with deals.", category: "Productivity", bgColor: "bg-zinc-50", textColor: "text-zinc-900", initials: "NO", connectType: "token", instructions: "Go to notion.so/my-integrations, create an internal integration, and copy the Integration Secret.", docsUrl: "https://www.notion.so/my-integrations", fields: [{ key: "accessToken", label: "Integration Secret", placeholder: "secret_xxxxxxxxxxxxxxxxxxxxxxxxxx…", type: "password" }] },
  { id: "airtable", name: "Airtable", description: "Sync Airtable bases with CRM contacts and deals.", category: "Productivity", bgColor: "bg-yellow-50", textColor: "text-[#f82b60]", initials: "AT", connectType: "token", instructions: "Go to airtable.com/account → Personal access tokens and create a token with the scopes you need.", docsUrl: "https://airtable.com/account", fields: [{ key: "accessToken", label: "Personal Access Token", placeholder: "patXXXXXXXXXXXXXX.…", type: "password" }] },
  { id: "hubspot", name: "HubSpot", description: "Import HubSpot contacts, deals, and activities into the CRM.", category: "CRM", bgColor: "bg-orange-50", textColor: "text-[#ff7a59]", initials: "HS", connectType: "token", instructions: "In HubSpot go to Settings → Integrations → Private Apps, create an app with the scopes you need, and copy the access token.", docsUrl: "https://developers.hubspot.com/docs/api/private-apps", fields: [{ key: "accessToken", label: "Private App Token", placeholder: "pat-na1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", type: "password" }] },
  { id: "bandcamp", name: "Bandcamp", description: "Research independent artists, discover emerging talent, and explore releases directly from Bandcamp for A&R prospecting.", category: "Music Research", bgColor: "bg-cyan-50", textColor: "text-[#1DA0C3]", initials: "BC", connectType: "token", instructions: "Enter your Bandcamp label page URL or fan account username. This links your Bandcamp presence to the CRM for easy A&R reference and artist lookups.", docsUrl: "https://bandcamp.com/developer", fields: [{ key: "accessToken", label: "Label / Fan Page URL or Username", placeholder: "your-label.bandcamp.com", type: "text" }] },
  { id: "groover", name: "Groover", description: "Track playlisting campaigns and monitor curator feedback in real time. Discover new playlist placement opportunities for your entire roster.", category: "Music Research", bgColor: "bg-violet-50", textColor: "text-[#6741D9]", initials: "GV", connectType: "token", instructions: "Get your API key from your Groover Pro or Label account under Account → API Access. Required for real-time campaign tracking and curator feedback.", docsUrl: "https://groover.co/en/blog/groover-for-labels/", fields: [{ key: "accessToken", label: "Groover API Key", placeholder: "grv_xxxxxxxxxxxxxxxx", type: "password" }] },
];

const CATEGORIES = ["All", "Microsoft", "Cloud Storage", "Social Media", "Accounting", "Marketing", "Communication", "E-commerce", "Productivity", "CRM", "Music Research"];

// ── Custom Platforms Section ──────────────────────────────────────────────────
interface CustomPlatformRow { id: number; name: string; linkType: string; createdAt: string }

const BUILT_IN_PLATFORMS = [
  { name: "Spotify",   linkType: "streaming", color: "bg-green-50 text-green-700" },
  { name: "YouTube",   linkType: "streaming", color: "bg-red-50 text-red-600" },
  { name: "Bandcamp",  linkType: "streaming", color: "bg-cyan-50 text-cyan-700" },
  { name: "Apple Music", linkType: "streaming", color: "bg-pink-50 text-pink-600" },
  { name: "Groover",   linkType: "social",    color: "bg-violet-50 text-violet-700" },
  { name: "SoundCloud",linkType: "streaming", color: "bg-orange-50 text-orange-600" },
];

function CustomPlatformsCard({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [platforms, setPlatforms] = useState<CustomPlatformRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"streaming" | "social">("streaming");
  const [adding, setAdding] = useState(false);
  const { data: meData } = useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });
  const isAdmin = meData?.role === "admin" || meData?.role === "owner";

  const load = () => {
    if (!token) return;
    setLoading(true);
    fetch("/api/integrations/custom-platforms", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { setPlatforms(d as CustomPlatformRow[]); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const r = await fetch("/api/integrations/custom-platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newName.trim(), linkType: newType }),
      });
      if (!r.ok) throw new Error();
      toast({ title: `"${newName.trim()}" added to custom platforms` });
      setNewName("");
      load();
    } catch {
      toast({ title: "Failed to add platform", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: number, name: string) {
    const r = await fetch(`/api/integrations/custom-platforms/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) { toast({ title: `"${name}" removed` }); load(); }
    else toast({ title: "Failed to remove", variant: "destructive" });
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-violet-500" /> Music & Streaming Platforms
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Define custom platforms for your roster. These appear as preset options when adding links to artists.
        </p>
      </div>

      {/* Built-in platforms */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Built-in</p>
        <div className="flex flex-wrap gap-2">
          {BUILT_IN_PLATFORMS.map((p) => (
            <div key={p.name} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${p.color} border-current/20`}>
              <span>{p.name}</span>
              <span className="text-[10px] opacity-60 capitalize">{p.linkType}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Custom platforms */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Custom</p>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : platforms.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No custom platforms yet. Add one below — e.g. Deezer, SoundXchange, Beatport.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {platforms.map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-zinc-200 bg-zinc-50">
                <span>{p.name}</span>
                <span className="text-[10px] text-zinc-400 capitalize">{p.linkType}</span>
                {isAdmin && (
                  <button onClick={() => void handleDelete(p.id, p.name)} className="ml-0.5 text-zinc-300 hover:text-red-500 transition-colors">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new platform */}
      <div className="flex gap-2 items-end pt-1 border-t border-zinc-100">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Platform name</Label>
          <Input
            className="h-8 text-sm"
            placeholder="e.g. Deezer, Beatport, SoundXchange…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
          />
        </div>
        <div className="space-y-1 shrink-0">
          <Label className="text-xs">Type</Label>
          <Select value={newType} onValueChange={(v) => setNewType(v as "streaming" | "social")}>
            <SelectTrigger className="h-8 text-xs w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="streaming">Streaming</SelectItem>
              <SelectItem value="social">Social</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-8 gap-1.5 shrink-0" onClick={() => void handleAdd()} disabled={adding || !newName.trim()}>
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </Button>
      </div>
    </div>
  );
}

// ── Integrations Tab ───────────────────────────────────────────────────────
function IntegrationsTab({ token, setActiveTab }: { token: string | null; setActiveTab: (tab: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [connectingApp, setConnectingApp] = useState<AppDef | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [modalConnecting, setModalConnecting] = useState(false);

  const { data: connections = [], isLoading } = useGetMyConnections({
    query: { enabled: !!token, queryKey: getGetMyConnectionsQueryKey() },
  });

  const connMap = Object.fromEntries(
    connections.filter((c) => !(c as { isWorkspace?: boolean }).isWorkspace).map((c) => [c.provider, c])
  );

  // Workspace (company-level) connections
  const { data: meData } = useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });
  const isAdmin = meData?.role === "admin" || meData?.role === "owner";

  const [connectingWS, setConnectingWS] = useState<AppDef | null>(null);
  const [wsFields, setWsFields] = useState<Record<string, string>>({});
  const [wsConnecting, setWsConnecting] = useState(false);

  const { data: workspaceConns = [], refetch: refetchWS } = useQuery<
    { id: number; provider: string; displayName: string; connectedAt: string }[]
  >({
    queryKey: ["workspace-connections"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/workspace-connections", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return [];
      return r.json() as Promise<{ id: number; provider: string; displayName: string; connectedAt: string }[]>;
    },
    enabled: !!token,
  });
  const wsConnMap = Object.fromEntries(workspaceConns.map((c) => [c.provider, c]));

  async function handleWSConnect() {
    if (!connectingWS) return;
    setWsConnecting(true);
    try {
      const r = await fetch("/api/integrations/workspace-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ provider: connectingWS.id, data: wsFields }),
      });
      if (!r.ok) {
        const err = (await r.json()) as { error?: string };
        toast({ title: "Failed to connect", description: err.error, variant: "destructive" });
      } else {
        toast({ title: `${connectingWS.name} connected as company account` });
        void refetchWS();
        void qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
        setConnectingWS(null);
        setWsFields({});
      }
    } catch {
      toast({ title: "Connection failed", variant: "destructive" });
    } finally {
      setWsConnecting(false);
    }
  }

  async function handleWSDisconnect(provider: string, name: string) {
    const r = await fetch(`/api/integrations/workspace-connections/${provider}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      toast({ title: `${name} company account disconnected` });
      void refetchWS();
      void qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
    } else {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    }
  }

  const connectMutation = useConnectProvider({
    mutation: {
      onSuccess: (_, vars) => {
        qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
        qc.invalidateQueries({ queryKey: ["onedrive-status"] });
        const appName = APP_DIRECTORY.find((a) => a.id === vars.provider)?.name ?? vars.provider;
        toast({ title: `${appName} connected successfully` });
        setConnectingApp(null);
        setFields({});
        setModalConnecting(false);
      },
      onError: (err: Error) => {
        toast({ title: "Connection failed", description: err.message, variant: "destructive" });
        setModalConnecting(false);
      },
    },
  });

  const disconnectMutation = useDisconnectProvider({
    mutation: {
      onSuccess: (_, vars) => {
        qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
        qc.invalidateQueries({ queryKey: ["onedrive-status"] });
        const appName = APP_DIRECTORY.find((a) => a.id === vars.provider)?.name ?? vars.provider;
        toast({ title: `${appName} disconnected` });
      },
      onError: () => toast({ title: "Failed to disconnect", variant: "destructive" }),
    },
  });

  const { data: emailSettings } = useQuery<EmailSettings | null>({
    queryKey: ["email-settings"],
    queryFn: async () => {
      const r = await fetch("/api/email-settings", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) return null;
      return r.json() as Promise<EmailSettings | null>;
    },
    enabled: !!token,
  });

  function openConnect(app: AppDef) {
    if (app.connectType === "smtp-redirect") {
      window.location.href = "?tab=email";
      return;
    }
    if (app.connectType === "oauth") {
      void (async () => {
        try {
          const r = await fetch(`/api/auth/microsoft/url`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!r.ok) {
            const err = (await r.json().catch(() => ({}))) as { error?: string };
            toast({ title: "Cannot connect Microsoft Outlook", description: err.error ?? "OAuth not configured — check server environment variables", variant: "destructive" });
            return;
          }
          const { url } = (await r.json()) as { url: string };
          const popup = window.open(url, "microsoft-oauth", "width=520,height=640,scrollbars=yes,noreferrer");

          // Listen for postMessage from the popup's callback page
          function onMessage(evt: MessageEvent) {
            const d = evt.data as { type?: string; success?: boolean; message?: string };
            if (d?.type !== "microsoft-oauth") return;
            window.removeEventListener("message", onMessage);
            if (d.success) {
              toast({ title: "Microsoft Outlook connected!" });
              void qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
            } else {
              toast({ title: "Microsoft sign-in failed", description: d.message ?? "Unknown error", variant: "destructive" });
            }
          }
          window.addEventListener("message", onMessage);

          // Safety fallback: if popup closes without postMessage, still refresh
          const poll = setInterval(() => {
            if (!popup || popup.closed) {
              clearInterval(poll);
              window.removeEventListener("message", onMessage);
              void qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
            }
          }, 1000);
        } catch {
          toast({ title: "Failed to start Microsoft sign-in", variant: "destructive" });
        }
      })();
      return;
    }
    if (app.connectType === "oauth-onedrive") {
      void (async () => {
        try {
          const r = await fetch("/api/auth/microsoft/onedrive-url", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!r.ok) {
            const err = (await r.json().catch(() => ({}))) as { error?: string };
            toast({ title: "Cannot connect OneDrive", description: err.error ?? "Microsoft OAuth not configured — check environment settings", variant: "destructive" });
            return;
          }
          const { url } = (await r.json()) as { url: string };
          const popup = window.open(url, "microsoft-onedrive", "width=520,height=640,scrollbars=yes,noreferrer");

          function onMessage(evt: MessageEvent) {
            const d = evt.data as { type?: string; success?: boolean; message?: string };
            if (d?.type !== "microsoft-onedrive") return;
            window.removeEventListener("message", onMessage);
            if (d.success) {
              toast({ title: "OneDrive connected!" });
              void qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
            } else {
              toast({ title: "OneDrive connection failed", description: d.message ?? "Unknown error", variant: "destructive" });
            }
          }
          window.addEventListener("message", onMessage);

          const poll = setInterval(() => {
            if (!popup || popup.closed) {
              clearInterval(poll);
              window.removeEventListener("message", onMessage);
              void qc.invalidateQueries({ queryKey: getGetMyConnectionsQueryKey() });
            }
          }, 1000);
        } catch {
          toast({ title: "Failed to start OneDrive sign-in", variant: "destructive" });
        }
      })();
      return;
    }
    if (app.connectType === "replit-connector") {
      connectMutation.mutate({ provider: app.id, data: {} });
      return;
    }
    setConnectingApp(app);
    setFields({});
  }

  function handleModalConnect() {
    if (!connectingApp) return;
    setModalConnecting(true);
    const data = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()]));
    connectMutation.mutate({ provider: connectingApp.id, data });
  }

  const filtered = APP_DIRECTORY.filter((app) => {
    const q = search.toLowerCase();
    const matchSearch = !q || app.name.toLowerCase().includes(q) || app.description.toLowerCase().includes(q) || app.category.toLowerCase().includes(q);
    const matchCat = category === "All" || app.category === category;
    return matchSearch && matchCat;
  });

  const connectedCount = connections.length;

  return (
    <div className="space-y-5">
      {/* Header stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Plug2 className="h-4 w-4 text-violet-500" /> App Marketplace</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Connect third-party apps to supercharge your CRM workflow.</p>
        </div>
        {connectedCount > 0 && (
          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">{connectedCount} connected</Badge>
        )}
      </div>

      {/* Company Social Accounts — admin-managed shared credentials */}
      {(() => {
        const COMPANY_SOCIAL_IDS = ["instagram", "facebook", "slack"];
        const companySocialApps = APP_DIRECTORY.filter((a) => COMPANY_SOCIAL_IDS.includes(a.id));
        return (
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-pink-500" /> Company Social Accounts
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isAdmin
                    ? "Connect company-wide accounts once — every team member can publish through them."
                    : "Shared accounts connected by your admin for the whole team."}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {companySocialApps.map((app) => {
                const wc = wsConnMap[app.id];
                return (
                  <div
                    key={app.id}
                    className={cn(
                      "rounded-lg border p-3.5 flex flex-col gap-2.5 transition-shadow",
                      wc ? "border-green-200 bg-green-50/30" : "border-zinc-200 bg-zinc-50/40"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className={cn("w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold shrink-0", app.bgColor, app.textColor)}>
                        {app.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold leading-tight">{app.name}</p>
                        {wc ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] mt-0.5 hover:bg-green-100">
                            Connected
                          </Badge>
                        ) : (
                          <Badge className="bg-zinc-100 text-zinc-400 border-zinc-200 text-[10px] mt-0.5 hover:bg-zinc-100">
                            Not connected
                          </Badge>
                        )}
                      </div>
                    </div>
                    {wc && (
                      <p className="text-[10px] text-zinc-500">As: <span className="font-medium text-zinc-700">{wc.displayName}</span></p>
                    )}
                    {isAdmin ? (
                      <div className="flex gap-1.5 mt-auto">
                        {wc ? (
                          <Button
                            size="sm" variant="outline"
                            className="flex-1 text-[11px] h-7 text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                            onClick={() => void handleWSDisconnect(app.id, app.name)}
                          >
                            Disconnect
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="flex-1 text-[11px] h-7 gap-1"
                            onClick={() => { setConnectingWS(app); setWsFields({}); }}
                          >
                            <Plus className="h-3 w-3" />Connect
                          </Button>
                        )}
                      </div>
                    ) : (
                      !wc && (
                        <p className="text-[10px] text-zinc-400 italic mt-auto">Ask an admin to connect this account.</p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input className="pl-9 text-sm" placeholder="Search apps…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Category filter */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "text-xs px-3 py-1 rounded-full border transition-colors",
              category === cat
                ? "bg-violet-600 text-white border-violet-600"
                : "bg-white text-zinc-600 border-zinc-200 hover:border-violet-300 hover:text-violet-700"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No apps match your search.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((app) => {
            const conn = connMap[app.id];
            const smtpConnected = app.connectType === "smtp-redirect" && emailSettings?.isVerified === true;
            const isConnected = !!conn || smtpConnected;
            const isPendingConnect = connectMutation.isPending && (connectMutation.variables as { provider?: string })?.provider === app.id;
            const isPendingDisconnect = disconnectMutation.isPending && (disconnectMutation.variables as { provider?: string })?.provider === app.id;

            return (
              <div
                key={app.id}
                className={cn(
                  "bg-white rounded-xl border p-4 flex flex-col gap-3 shadow-sm transition-shadow hover:shadow-md",
                  isConnected ? "border-green-200" : "border-zinc-200"
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold shrink-0", app.bgColor, app.textColor)}>
                    {app.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-semibold leading-tight">{app.name}</span>
                      {isConnected ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 text-[10px]">Connected</Badge>
                      ) : (
                        <Badge className="bg-zinc-100 text-zinc-400 hover:bg-zinc-100 border-zinc-200 text-[10px]">Not connected</Badge>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{app.category}</span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed flex-1">{app.description}</p>

                {conn && (
                  <p className="text-xs text-zinc-400">As: <span className="font-medium text-zinc-600">{conn.displayName}</span></p>
                )}
                {smtpConnected && emailSettings?.fromEmail && (
                  <p className="text-xs text-zinc-400">As: <span className="font-medium text-zinc-600">{emailSettings.fromEmail}</span></p>
                )}

                {/* SMTP info note for Outlook — replaces the old Azure OAuth flow */}
                {app.connectType === "smtp-redirect" && !smtpConnected && (
                  <div className="rounded-md bg-blue-50 border border-blue-100 p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">SMTP Setup</p>
                    <p className="text-[10px] text-blue-600 leading-relaxed">
                      Use <strong>smtp.office365.com</strong> with your <strong>@doubtlessproductions.com</strong> email and password. Click "Set up" below — the Outlook/365 preset is pre-filled.
                    </p>
                  </div>
                )}

                <div className="flex gap-2 mt-auto">
                  {conn ? (
                    <Button
                      size="sm" variant="outline"
                      className="flex-1 text-xs text-red-600 hover:text-red-700 border-red-200 hover:bg-red-50"
                      onClick={() => disconnectMutation.mutate({ provider: app.id })}
                      disabled={isPendingDisconnect}
                    >
                      {isPendingDisconnect ? <Loader2 className="h-3 w-3 animate-spin" /> : "Disconnect"}
                    </Button>
                  ) : smtpConnected ? (
                    <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setActiveTab("email")}>Edit SMTP</Button>
                  ) : (
                    <Button
                      size="sm"
                      className="flex-1 text-xs gap-1.5"
                      onClick={() => openConnect(app)}
                      disabled={isPendingConnect}
                    >
                      {isPendingConnect
                        ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Connecting…</>
                        : app.connectType === "smtp-redirect"
                          ? <><Plus className="h-3 w-3" />Set up</>
                          : <><Plus className="h-3 w-3" />Connect</>}
                    </Button>
                  )}
                  {app.docsUrl && (
                    <a href={app.docsUrl} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Music & Streaming Platforms (custom platform registry) */}
      <CustomPlatformsCard token={token} />

      {/* SMTP Email — always visible at bottom */}
      {(() => {
        const smtpConfigured = !!emailSettings;
        const smtpVerified = emailSettings?.isVerified ?? false;
        return (
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                  <Mail className="h-5 w-5 text-zinc-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm">Company Email (SMTP)</h3>
                    {smtpVerified ? (
                      <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200 text-xs">Connected</Badge>
                    ) : smtpConfigured ? (
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 text-xs">Configured — unverified</Badge>
                    ) : (
                      <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100 border-zinc-200 text-xs">Not configured</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Send CRM emails from your own company address via SMTP.</p>
                  {emailSettings?.fromEmail && (
                    <p className="text-xs text-zinc-400 mt-1">As: <span className="font-medium text-zinc-600">{emailSettings.fromEmail}</span></p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {smtpConfigured && (
                  <SmtpDisconnectButton token={token} onSuccess={() => qc.invalidateQueries({ queryKey: ["email-settings"] })} />
                )}
                <Button size="sm" variant={smtpConfigured ? "outline" : "default"} onClick={() => setActiveTab("email")}>
                  {smtpConfigured ? "Edit" : "Configure"}
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Connect credential modal */}
      <Dialog open={!!connectingApp} onOpenChange={(o) => { if (!o) { setConnectingApp(null); setFields({}); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              {connectingApp && (
                <div className={cn("w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0", connectingApp.bgColor, connectingApp.textColor)}>
                  {connectingApp.initials}
                </div>
              )}
              Connect {connectingApp?.name}
            </DialogTitle>
          </DialogHeader>
          {connectingApp && (
            <div className="space-y-4">
              {connectingApp.instructions && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-800 leading-relaxed flex gap-2">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-500" />
                  <span>
                    {connectingApp.instructions}{" "}
                    {connectingApp.docsUrl && (
                      <a href={connectingApp.docsUrl} target="_blank" rel="noopener noreferrer"
                        className="underline inline-flex items-center gap-0.5">
                        View docs <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </span>
                </div>
              )}
              {connectingApp.fields?.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-sm font-medium">{f.label}</Label>
                  <Input
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    className="text-sm font-mono"
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => { setConnectingApp(null); setFields({}); }}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={handleModalConnect}
                  disabled={modalConnecting || connectMutation.isPending || !(connectingApp.fields?.every((f) => fields[f.key]?.trim()))}
                >
                  {(modalConnecting || connectMutation.isPending)
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  Connect
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Workspace (company) connect dialog */}
      <Dialog open={!!connectingWS} onOpenChange={(o) => { if (!o) { setConnectingWS(null); setWsFields({}); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect company {connectingWS?.name} account</DialogTitle>
          </DialogHeader>
          {connectingWS && (
            <div className="space-y-4 pt-1">
              <div className={cn("flex items-center gap-3 p-3 rounded-lg border", connectingWS.bgColor, "bg-opacity-20")}>
                <div className={cn("w-9 h-9 rounded-md flex items-center justify-center text-sm font-bold shrink-0", connectingWS.bgColor, connectingWS.textColor)}>
                  {connectingWS.initials}
                </div>
                <div>
                  <p className="text-sm font-semibold">{connectingWS.name}</p>
                  <p className="text-xs text-muted-foreground">Company-wide · all team members can publish through this account</p>
                </div>
              </div>
              {connectingWS.fields?.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label className="text-sm font-medium">{f.label}</Label>
                  <Input
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    className="text-sm font-mono"
                    value={wsFields[f.key] ?? ""}
                    onChange={(e) => setWsFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => { setConnectingWS(null); setWsFields({}); }}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={() => void handleWSConnect()}
                  disabled={wsConnecting || !(connectingWS.fields?.every((f) => wsFields[f.key]?.trim()))}
                >
                  {wsConnecting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  Connect
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────────────────
function SecurityTab({ token }: { token: string | null }) {
  const { data, isLoading, error } = useQuery<SecurityStatus>({
    queryKey: ["security-status"],
    queryFn: async () => {
      const r = await fetch("/api/security/status", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed to load security status");
      return r.json();
    },
    enabled: !!token,
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading security status…</div>;
  if (error || !data) return (
    <div className="flex items-center gap-3 p-4 rounded-lg border border-red-200 bg-red-50 text-red-800 text-sm">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      Failed to load security status. You may not have admin access.
    </div>
  );

  type StatusItem = { label: string; value: string | boolean; detail?: string; icon: React.ReactNode; ok: boolean };

  const items: StatusItem[] = [
    {
      label: "Security headers (Helmet)",
      value: data.helmet ? "Enabled" : "Disabled",
      detail: "X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS",
      icon: <ShieldCheck className="h-4 w-4" />,
      ok: data.helmet,
    },
    {
      label: "Content Security Policy",
      value: data.csp ? "Strict (API-only)" : "Disabled",
      detail: "Blocks scripts, frames, and mixed content",
      icon: <FileText className="h-4 w-4" />,
      ok: data.csp,
    },
    {
      label: "HSTS (HTTPS enforcement)",
      value: data.hsts ? "63,072,000s (2 years)" : "Off",
      detail: "Forces all connections over HTTPS",
      icon: <Lock className="h-4 w-4" />,
      ok: data.hsts,
    },
    {
      label: "API rate limiting",
      value: data.rateLimiting.api,
      detail: "Per-IP sliding window",
      icon: <Zap className="h-4 w-4" />,
      ok: true,
    },
    {
      label: "Auth rate limiting",
      value: data.rateLimiting.auth,
      detail: "Counts failures only — protects against brute-force",
      icon: <Lock className="h-4 w-4" />,
      ok: true,
    },
    {
      label: "Form spam protection",
      value: data.rateLimiting.forms,
      detail: "Per-IP, on all public form endpoints",
      icon: <ShieldCheck className="h-4 w-4" />,
      ok: true,
    },
    {
      label: "CORS policy",
      value: data.cors === "allowlist" ? "Allowlist (Replit domains only)" : data.cors,
      detail: "Rejects requests from unknown origins",
      icon: <Globe className="h-4 w-4" />,
      ok: data.cors === "allowlist",
    },
    {
      label: "Socket.IO CORS",
      value: data.socketCors === "allowlist" ? "Allowlist" : data.socketCors,
      detail: "Real-time connections locked to known origins",
      icon: <Globe className="h-4 w-4" />,
      ok: data.socketCors === "allowlist",
    },
    {
      label: "Request body limit",
      value: data.bodySizeLimit,
      detail: "Prevents oversized payload attacks",
      icon: <ShieldCheck className="h-4 w-4" />,
      ok: true,
    },
    {
      label: "XSS input sanitization",
      value: data.xssSanitization ? "Active on all routes" : "Off",
      detail: "Strips <script>, <iframe>, inline event handlers from all inputs",
      icon: <Bug className="h-4 w-4" />,
      ok: data.xssSanitization,
    },
    {
      label: "Honeypot (bot detection)",
      value: data.honeypot ? "Active on public forms" : "Off",
      detail: "Hidden field catches automated submissions",
      icon: <Bug className="h-4 w-4" />,
      ok: data.honeypot,
    },
    {
      label: "JWT signing secret",
      value: data.jwtSecretConfigured ? "SESSION_SECRET (Replit Secrets)" : "⚠ Fallback key in use",
      detail: data.jwtSecretConfigured
        ? "Production-grade secret from Replit Secrets"
        : "Set SESSION_SECRET in Replit Secrets for production",
      icon: <Lock className="h-4 w-4" />,
      ok: data.jwtSecretConfigured,
    },
    {
      label: "Password hashing",
      value: `bcrypt (${data.bcryptRounds} rounds)`,
      detail: "Industry-standard adaptive hashing — resistant to brute force",
      icon: <Lock className="h-4 w-4" />,
      ok: true,
    },
  ];

  const passing = items.filter((i) => i.ok).length;
  const total = items.length;
  const allGood = passing === total;

  return (
    <div className="space-y-6">
      {/* Summary banner */}
      <div className={`flex items-start gap-4 p-5 rounded-xl border ${allGood ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
        <div className={`p-2 rounded-lg ${allGood ? "bg-green-100" : "bg-amber-100"}`}>
          {allGood
            ? <ShieldCheck className="h-6 w-6 text-green-700" />
            : <ShieldAlert className="h-6 w-6 text-amber-700" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h3 className={`font-semibold ${allGood ? "text-green-900" : "text-amber-900"}`}>
              {allGood ? "All security checks passing" : `${passing} / ${total} checks passing`}
            </h3>
            <Badge className={allGood ? "bg-green-600 hover:bg-green-600" : "bg-amber-500 hover:bg-amber-500"}>
              {allGood ? "Secure" : "Needs attention"}
            </Badge>
          </div>
          <p className={`text-sm mt-1 ${allGood ? "text-green-700" : "text-amber-700"}`}>
            Environment: <strong>{data.nodeEnv}</strong> · Server uptime: <strong>{formatUptime(data.uptime)}</strong>
          </p>
        </div>
      </div>

      {/* Check list */}
      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 divide-y divide-zinc-100">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-4 px-5 py-4">
            <div className={`mt-0.5 p-1.5 rounded-md shrink-0 ${item.ok ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
              {item.ok
                ? <CheckCircle2 className="h-4 w-4" />
                : <ShieldOff className="h-4 w-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-zinc-900">{item.label}</span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${item.ok ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>
                  {String(item.value)}
                </span>
              </div>
              {item.detail && (
                <p className="text-xs text-zinc-500 mt-0.5">{item.detail}</p>
              )}
            </div>
            <div className={`shrink-0 mt-0.5 ${item.ok ? "text-green-400" : "text-red-400"}`}>
              {item.icon}
            </div>
          </div>
        ))}
      </div>

      {/* Recent login activity */}
      {data.recentLogins.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5">
          <h3 className="text-sm font-semibold text-zinc-900 mb-3">Recent Login Activity</h3>
          <div className="space-y-2">
            {data.recentLogins.map((login, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-zinc-600">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span className="flex-1">{login.description}</span>
                <span className="text-xs text-zinc-400 shrink-0">
                  {new Date(login.at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* JWT secret warning */}
      {!data.jwtSecretConfigured && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">ACTION REQUIRED: Set SESSION_SECRET</p>
            <p className="mt-1 text-amber-700">
              Go to <strong>Replit Secrets</strong> and add a <code className="bg-amber-100 px-1 rounded">SESSION_SECRET</code> with a long random string. Without it, auth tokens use an insecure fallback key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Email Settings Tab ─────────────────────────────────────────────────────
function EmailSettingsTab({ token }: { token: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showPass, setShowPass] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const { data: settings, isLoading } = useQuery<EmailSettings | null>({
    queryKey: ["email-settings"],
    queryFn: async () => {
      const r = await fetch("/api/email-settings", { headers: authH(token) });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!token,
  });

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      fromName: "", fromEmail: "",
      smtpHost: "smtp.office365.com", smtpPort: 587,
      smtpUser: "", smtpPass: "", smtpSecure: false,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        fromName: settings.fromName, fromEmail: settings.fromEmail,
        smtpHost: settings.smtpHost, smtpPort: settings.smtpPort,
        smtpUser: settings.smtpUser, smtpPass: "", smtpSecure: settings.smtpSecure,
      });
    }
  }, [settings, form]);

  const save = useMutation({
    mutationFn: async (data: EmailFormValues) => {
      const r = await fetch("/api/email-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Save failed");
    },
    onSuccess: () => { toast({ title: "Email settings saved" }); qc.invalidateQueries({ queryKey: ["email-settings"] }); },
    onError: () => toast({ title: "Failed to save settings", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/email-settings", { method: "DELETE", headers: authH(token) });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Email account unlinked" });
      qc.invalidateQueries({ queryKey: ["email-settings"] });
      form.reset({ fromName: "", fromEmail: "", smtpHost: "smtp.office365.com", smtpPort: 587, smtpUser: "", smtpPass: "", smtpSecure: false });
    },
    onError: () => toast({ title: "Failed to unlink", variant: "destructive" }),
  });

  async function handleVerify() {
    setVerifying(true);
    try {
      const r = await fetch("/api/email-settings/verify", { method: "POST", headers: authH(token) });
      const body = await r.json() as { ok?: boolean; error?: string; hint?: string; docsUrl?: string; code?: string };
      if (r.ok) {
        toast({ title: "Email verified!", description: "A test message was sent to your inbox." });
        qc.invalidateQueries({ queryKey: ["email-settings"] });
      } else if (body.code === "M365_SMTP_AUTH_DISABLED") {
        toast({
          title: "Microsoft 365 — SMTP AUTH is disabled",
          description: (
            <span>
              {body.hint}{" "}
              <a href={body.docsUrl} target="_blank" rel="noreferrer" className="underline font-medium">
                Microsoft docs ↗
              </a>
            </span>
          ),
          variant: "destructive",
          duration: 15000,
        });
      } else {
        toast({ title: "Verification failed", description: body.error, variant: "destructive" });
      }
    } finally {
      setVerifying(false);
    }
  }

  function applyPreset(preset: typeof PRESETS[number]) {
    if (!preset.host) return;
    form.setValue("smtpHost", preset.host);
    form.setValue("smtpPort", preset.port);
    form.setValue("smtpSecure", preset.secure);
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-xl">
      {settings ? (
        <div className={`flex items-center gap-3 p-4 rounded-lg border text-sm ${settings.isVerified ? "bg-green-50 border-green-200 text-green-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {settings.isVerified ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <div className="flex-1">
            <span className="font-medium">{settings.fromEmail}</span>
            {settings.isVerified
              ? <span className="ml-2 text-green-700">Linked & verified</span>
              : <span className="ml-2">Saved but not yet verified — click Verify below</span>}
          </div>
          <Badge variant={settings.isVerified ? "default" : "secondary"} className={settings.isVerified ? "bg-green-600" : ""}>
            {settings.isVerified ? "Active" : "Pending"}
          </Badge>
        </div>
      ) : (
        <div className="flex items-start gap-3 p-4 rounded-lg border bg-blue-50 border-blue-200 text-sm text-blue-800">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Link your company email so emails sent from this CRM come from <strong>your</strong> address instead of a shared account.</p>
        </div>
      )}

      <div>
        <Label className="mb-2 block text-xs text-muted-foreground uppercase tracking-wide">Quick setup</Label>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => applyPreset(p)} className="h-7 text-xs">
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Display name</Label>
            <Input placeholder="Jane Smith" {...form.register("fromName")} />
            {form.formState.errors.fromName && <p className="text-xs text-red-500">{form.formState.errors.fromName.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>From email</Label>
            <Input placeholder="jane@company.com" type="email" {...form.register("fromEmail")} />
            {form.formState.errors.fromEmail && <p className="text-xs text-red-500">{form.formState.errors.fromEmail.message}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>SMTP host</Label>
          <Input placeholder="smtp.office365.com" {...form.register("smtpHost")} />
          {form.formState.errors.smtpHost && <p className="text-xs text-red-500">{form.formState.errors.smtpHost.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>SMTP port</Label>
            <Input type="number" placeholder="587" {...form.register("smtpPort")} />
          </div>
          <div className="space-y-1.5">
            <Label>Security</Label>
            <div className="flex items-center gap-3 h-10">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" className="rounded" {...form.register("smtpSecure")} />
                Use SSL/TLS (port 465)
              </label>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Username / Email</Label>
            <Input placeholder="jane@company.com" {...form.register("smtpUser")} />
            {form.formState.errors.smtpUser && <p className="text-xs text-red-500">{form.formState.errors.smtpUser.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{settings?.hasPassword ? "New password (leave blank to keep)" : "Password / App password"}</Label>
            <div className="relative">
              <Input
                type={showPass ? "text" : "password"}
                placeholder={settings?.hasPassword ? "••••••••" : "Enter password"}
                {...form.register("smtpPass")}
                className="pr-9"
              />
              <button type="button" onClick={() => setShowPass((s) => !s)} className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground">
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.smtpPass && <p className="text-xs text-red-500">{form.formState.errors.smtpPass.message}</p>}
          </div>
        </div>

        {form.watch("smtpHost") === "smtp.gmail.com" && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-100 text-xs text-blue-800">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Gmail requires an <strong>App Password</strong> — not your account password. Enable 2FA, then generate one at <em>myaccount.google.com → Security → App passwords</em>.</span>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2 border-t border-zinc-100">
          <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : settings ? "Update settings" : "Link email"}</Button>
          {settings && (
            <>
              <Button type="button" variant="outline" onClick={handleVerify} disabled={verifying} className="gap-1.5">
                <Send className="h-3.5 w-3.5" />
                {verifying ? "Sending test…" : "Verify connection"}
              </Button>
              <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto gap-1.5" onClick={() => remove.mutate()} disabled={remove.isPending}>
                <Trash2 className="h-3.5 w-3.5" />
                Unlink
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

// ── Preferences Tab ─────────────────────────────────────────────────────────
function PreferencesTab({ token }: { token: string | null }) {
  const { data: user } = useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });

  const [colorMode, setColorMode] = useState<"light" | "dark">(() =>
    (localStorage.getItem("colorMode") as "light" | "dark") ?? "light"
  );

  const [density, setDensity] = useState<"comfortable" | "compact">(() =>
    (localStorage.getItem("density") as "comfortable" | "compact") ?? "comfortable"
  );

  useEffect(() => {
    if (user?.colorMode) setColorMode(user.colorMode as "light" | "dark");
  }, [user?.colorMode]);

  async function applyColorMode(mode: "light" | "dark") {
    setColorMode(mode);
    localStorage.setItem("colorMode", mode);
    document.documentElement.classList.toggle("dark", mode === "dark");
    if (token) {
      await fetch("/api/users/me/color-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ colorMode: mode }),
      }).catch(() => {});
    }
  }

  function applyDensity(d: "comfortable" | "compact") {
    setDensity(d);
    localStorage.setItem("density", d);
    if (d === "compact") {
      document.documentElement.setAttribute("data-density", "compact");
    } else {
      document.documentElement.removeAttribute("data-density");
    }
  }

  return (
    <div className="space-y-5">
      {/* Color Mode */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <Sun className="h-4 w-4 text-amber-500" /> Color Mode
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">Choose how the interface looks for you personally</p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {(["light", "dark"] as const).map((mode) => {
            const isActive = colorMode === mode;
            return (
              <button
                key={mode}
                onClick={() => applyColorMode(mode)}
                className={cn(
                  "flex flex-col gap-2.5 p-3 rounded-xl border-2 transition-all text-left",
                  isActive
                    ? "border-zinc-800 bg-zinc-50 ring-1 ring-zinc-800"
                    : "border-zinc-200 hover:border-zinc-300",
                )}
              >
                <div className={cn(
                  "w-full h-16 rounded-lg overflow-hidden flex border",
                  mode === "dark" ? "bg-zinc-900 border-zinc-700" : "bg-zinc-50 border-zinc-200",
                )}>
                  <div className={cn(
                    "w-7 h-full flex flex-col p-1 gap-0.5 shrink-0",
                    mode === "dark" ? "bg-zinc-800" : "bg-zinc-200",
                  )}>
                    {[0, 1, 2, 3].map(i => (
                      <div
                        key={i}
                        className={cn("rounded-full h-1", mode === "dark"
                          ? (i === 0 ? "bg-zinc-400" : "bg-zinc-700")
                          : (i === 0 ? "bg-zinc-500" : "bg-zinc-300")
                        )}
                      />
                    ))}
                  </div>
                  <div className="flex-1 p-2 space-y-1.5">
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className={cn("rounded-full h-1.5", mode === "dark" ? "bg-zinc-700" : "bg-zinc-200")}
                        style={{ width: ["65%", "45%", "55%"][i] }}
                      />
                    ))}
                    <div
                      className={cn("rounded h-4 mt-0.5", mode === "dark" ? "bg-zinc-700" : "bg-zinc-200")}
                      style={{ width: "80%" }}
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-xs font-medium text-zinc-700 capitalize">{mode}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-zinc-800" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Display Density */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-blue-500" /> Display Density
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">Adjust how much content fits on screen</p>
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-xs">
          {([
            { value: "comfortable", label: "Comfortable", rows: 3 },
            { value: "compact",     label: "Compact",     rows: 5 },
          ] as const).map((opt) => {
            const isActive = density === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => applyDensity(opt.value)}
                className={cn(
                  "flex flex-col gap-2.5 p-3 rounded-xl border-2 transition-all text-left",
                  isActive
                    ? "border-zinc-800 bg-zinc-50 ring-1 ring-zinc-800"
                    : "border-zinc-200 hover:border-zinc-300",
                )}
              >
                <div className="w-full h-16 rounded-lg bg-zinc-50 border border-zinc-200 flex flex-col justify-center p-2.5">
                  {Array.from({ length: opt.rows }).map((_, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 border-b border-zinc-100 last:border-0"
                      style={{
                        paddingTop:    opt.value === "compact" ? "2px" : "4px",
                        paddingBottom: opt.value === "compact" ? "2px" : "4px",
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 shrink-0" />
                      <div
                        className="h-1 rounded-full bg-zinc-200 flex-1"
                        style={{ width: ["70%", "55%", "80%", "60%", "75%"][i] }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-xs font-medium text-zinc-700">{opt.label}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-zinc-800" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Theme Tab ──────────────────────────────────────────────────────────────
const THEME_PRESETS = [
  { name: "Doubtless", color: "#09090b", primary: "#09090b", accent: "#00e5b0", font: "Inter",             borderRadius: "0.5rem",  navStyle: "filled"   as NavStyle },
  { name: "Ocean",     color: "#0c1a2e", primary: "#0c1a2e", accent: "#38bdf8", font: "Inter",             borderRadius: "0.5rem",  navStyle: "filled"   as NavStyle },
  { name: "Forest",   color: "#0d1f17", primary: "#0d1f17", accent: "#34d399", font: "Plus Jakarta Sans", borderRadius: "0.75rem", navStyle: "filled"   as NavStyle },
  { name: "Midnight", color: "#1e1b4b", primary: "#1e1b4b", accent: "#818cf8", font: "Inter",             borderRadius: "0.75rem", navStyle: "outlined" as NavStyle },
  { name: "Crimson",  color: "#1a0a0a", primary: "#1a0a0a", accent: "#f43f5e", font: "Poppins",           borderRadius: "0.25rem", navStyle: "filled"   as NavStyle },
  { name: "Storm",    color: "#0f172a", primary: "#0f172a", accent: "#fb923c", font: "Space Grotesk",     borderRadius: "0.5rem",  navStyle: "minimal"  as NavStyle },
];

const SIDEBAR_SWATCHES = ["#09090b","#1e1b4b","#0c1a2e","#0d1f17","#1a0a0a","#1a1a2e","#0f172a","#1c1917","#374151","#020617"];
const ACCENT_SWATCHES  = ["#00e5b0","#38bdf8","#34d399","#818cf8","#f43f5e","#fb923c","#facc15","#a78bfa","#22d3ee","#4ade80"];

const FONT_OPTIONS = [
  { value: "system-ui",        label: "System"   },
  { value: "Inter",            label: "Inter"    },
  { value: "Poppins",          label: "Poppins"  },
  { value: "Plus Jakarta Sans",label: "Jakarta"  },
  { value: "Space Grotesk",    label: "Space"    },
];

const RADIUS_OPTIONS = [
  { value: "0px",     label: "Sharp",   px: 0  },
  { value: "0.25rem", label: "Soft",    px: 4  },
  { value: "0.5rem",  label: "Default", px: 8  },
  { value: "0.75rem", label: "Rounded", px: 12 },
];

const NAV_STYLE_OPTIONS: { value: NavStyle; label: string; desc: string }[] = [
  { value: "filled",   label: "Filled",   desc: "Solid highlight" },
  { value: "outlined", label: "Outlined", desc: "Border ring"     },
  { value: "minimal",  label: "Minimal",  desc: "Text & bar"      },
];

function ColorSwatch({ color, active, onClick, disabled }: { color: string; active: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 relative shrink-0"
      style={{ backgroundColor: color, borderColor: active ? "white" : "transparent", boxShadow: active ? `0 0 0 2px ${color}` : "none" }}
    >
      {active && <Check className="absolute inset-0 m-auto h-3 w-3 text-white drop-shadow" />}
    </button>
  );
}

function NavPreviewItem({ label, active, navStyle, accent }: { label: string; active: boolean; navStyle: NavStyle; accent: string }) {
  const base = "flex items-center gap-2 px-3 py-1.5 text-xs rounded transition-all";
  const activeClasses: Record<NavStyle, string> = {
    filled:   "bg-white/15 text-white",
    outlined: "border border-white/40 text-white",
    minimal:  "text-white",
  };
  return (
    <div className={`${base} ${active ? activeClasses[navStyle] : "text-white/50"}`} style={active && navStyle === "minimal" ? { borderLeft: `2px solid ${accent}` } : {}}>
      <div className="w-2 h-2 rounded-full bg-current opacity-70 shrink-0" />
      {label}
    </div>
  );
}

function ThemeTab({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: user } = useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });
  const isEditable = user?.role === "admin" || user?.role === "manager" || user?.role === "owner";
  const { data: theme, isLoading } = useGetTheme({ query: { queryKey: getGetThemeQueryKey() } });

  const extras = (theme?.sidebarConfig ?? {}) as { font?: string; borderRadius?: string; navStyle?: string };

  const form = useForm<ThemeFormValues>({
    resolver: zodResolver(themeSchema),
    defaultValues: {
      companyName: "", primaryColor: "#09090b", accentColor: "#00e5b0", logoUrl: "",
      font: "Inter", borderRadius: "0.5rem", navStyle: "filled",
    },
  });

  useEffect(() => {
    if (theme) {
      form.reset({
        companyName: theme.companyName,
        primaryColor: theme.primaryColor,
        accentColor: theme.accentColor,
        logoUrl: theme.logoUrl || "",
        font: extras.font || "Inter",
        borderRadius: extras.borderRadius || "0.5rem",
        navStyle: (extras.navStyle as NavStyle) || "filled",
      });
    }
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateTheme = useUpdateTheme({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetThemeQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["theme"] });
        toast({ title: "Theme saved" });
      },
      onError: (error: unknown) => {
        const e = error as { message?: string };
        toast({ title: "Failed to save theme", description: e.message, variant: "destructive" });
      },
    },
  });

  function handleSubmit(v: ThemeFormValues) {
    const { font, borderRadius, navStyle, ...rest } = v;
    updateTheme.mutate({ data: { ...rest, sidebarConfig: { font, borderRadius, navStyle } } });
  }

  function applyPreset(p: typeof THEME_PRESETS[number]) {
    form.setValue("primaryColor", p.primary);
    form.setValue("accentColor", p.accent);
    form.setValue("font", p.font);
    form.setValue("borderRadius", p.borderRadius);
    form.setValue("navStyle", p.navStyle);
  }

  const previewPrimary  = form.watch("primaryColor");
  const previewAccent   = form.watch("accentColor");
  const previewName     = form.watch("companyName");
  const previewLogo     = form.watch("logoUrl");
  const previewFont     = form.watch("font");
  const previewRadius   = form.watch("borderRadius");
  const previewNavStyle = form.watch("navStyle");

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      {!isEditable && (
        <div className="p-3 bg-blue-50 text-blue-800 rounded-lg text-sm border border-blue-100 flex items-start gap-2">
          <Paintbrush className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Only Administrators or Managers can edit theme settings.</p>
        </div>
      )}

      {/* ── Presets ── */}
      <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-zinc-900 mb-3">Quick Presets</h3>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => isEditable && applyPreset(p)}
              disabled={!isEditable}
              className="group flex flex-col items-center gap-2 p-2 rounded-lg border border-zinc-200 hover:border-zinc-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="w-full h-10 rounded-md flex items-end justify-end p-1.5" style={{ backgroundColor: p.primary }}>
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: p.accent }} />
              </div>
              <span className="text-xs text-zinc-600 font-medium">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">

          {/* Branding */}
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">Branding</h3>
            <div className="space-y-1.5">
              <Label htmlFor="companyName">Company Name</Label>
              <Input id="companyName" {...form.register("companyName")} disabled={!isEditable || updateTheme.isPending} />
              {form.formState.errors.companyName && <p className="text-xs text-red-500">{form.formState.errors.companyName.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logoUrl">Logo URL <span className="text-zinc-400 font-normal">(optional)</span></Label>
              <Input id="logoUrl" placeholder="https://example.com/logo.png" {...form.register("logoUrl")} disabled={!isEditable || updateTheme.isPending} />
              {form.formState.errors.logoUrl && <p className="text-xs text-red-500">{form.formState.errors.logoUrl.message}</p>}
            </div>
          </div>

          {/* Colors */}
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-5">
            <h3 className="text-sm font-semibold text-zinc-900">Colors</h3>

            {/* Sidebar color */}
            <div className="space-y-2">
              <Label>Sidebar Background</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  className="w-10 h-10 rounded-lg cursor-pointer border border-zinc-200 p-0.5 shrink-0"
                  value={previewPrimary}
                  onChange={(e) => form.setValue("primaryColor", e.target.value)}
                  disabled={!isEditable}
                />
                <Input
                  value={previewPrimary}
                  onChange={(e) => /^#[0-9A-Fa-f]{0,6}$/.test(e.target.value) && form.setValue("primaryColor", e.target.value)}
                  disabled={!isEditable}
                  className="font-mono text-sm w-32"
                  maxLength={7}
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {SIDEBAR_SWATCHES.map((c) => (
                  <ColorSwatch key={c} color={c} active={previewPrimary === c} onClick={() => form.setValue("primaryColor", c)} disabled={!isEditable} />
                ))}
              </div>
            </div>

            {/* Accent color */}
            <div className="space-y-2">
              <Label>Accent / Buttons</Label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  className="w-10 h-10 rounded-lg cursor-pointer border border-zinc-200 p-0.5 shrink-0"
                  value={previewAccent}
                  onChange={(e) => form.setValue("accentColor", e.target.value)}
                  disabled={!isEditable}
                />
                <Input
                  value={previewAccent}
                  onChange={(e) => /^#[0-9A-Fa-f]{0,6}$/.test(e.target.value) && form.setValue("accentColor", e.target.value)}
                  disabled={!isEditable}
                  className="font-mono text-sm w-32"
                  maxLength={7}
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {ACCENT_SWATCHES.map((c) => (
                  <ColorSwatch key={c} color={c} active={previewAccent === c} onClick={() => form.setValue("accentColor", c)} disabled={!isEditable} />
                ))}
              </div>
            </div>
          </div>

          {/* Typography */}
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">Typography</h3>
            <div className="grid grid-cols-5 gap-2">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => isEditable && form.setValue("font", f.value)}
                  disabled={!isEditable}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${previewFont === f.value ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-300"}`}
                >
                  <span className="text-xl font-bold text-zinc-800" style={{ fontFamily: f.value !== "system-ui" ? `"${f.value}", sans-serif` : "system-ui, sans-serif" }}>
                    Ag
                  </span>
                  <span className="text-[10px] text-zinc-500 font-medium">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Border Radius */}
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">Shape</h3>
            <div className="grid grid-cols-4 gap-2">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => isEditable && form.setValue("borderRadius", r.value)}
                  disabled={!isEditable}
                  className={`flex flex-col items-center gap-2 p-3 border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${previewRadius === r.value ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-300"}`}
                  style={{ borderRadius: r.px + 4 + "px" }}
                >
                  <div className="w-8 h-8 bg-zinc-200" style={{ borderRadius: r.px + "px" }} />
                  <span className="text-[10px] text-zinc-500 font-medium">{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Navigation Style */}
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900">Navigation Style</h3>
            <div className="grid grid-cols-3 gap-2">
              {NAV_STYLE_OPTIONS.map((n) => (
                <button
                  key={n.value}
                  type="button"
                  onClick={() => isEditable && form.setValue("navStyle", n.value)}
                  disabled={!isEditable}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${previewNavStyle === n.value ? "border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-300"}`}
                >
                  {/* Mini nav preview */}
                  <div className="w-full space-y-0.5 rounded p-1.5" style={{ backgroundColor: previewPrimary }}>
                    {[true, false, false].map((active, i) => (
                      <div
                        key={i}
                        className={`h-3 w-full rounded-sm transition-all ${
                          active
                            ? n.value === "filled"   ? "bg-white/20"
                            : n.value === "outlined" ? "border border-white/40"
                            : ""
                            : "bg-transparent"
                        }`}
                        style={active && n.value === "minimal" ? { borderLeft: `2px solid ${previewAccent}` } : {}}
                      />
                    ))}
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-medium text-zinc-700">{n.label}</p>
                    <p className="text-[10px] text-zinc-400">{n.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* ── Automation ── */}
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">Automation</h3>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-800">Invoice Reminders</p>
                <p className="text-xs text-zinc-500 mt-0.5">Automatically email contacts when an invoice is due within 3 days, and again when it goes overdue. Each stage fires once per invoice.</p>
              </div>
              <Switch
                checked={!!(theme as (typeof theme & { invoiceRemindersEnabled?: boolean }))?.invoiceRemindersEnabled}
                disabled={!isEditable || updateTheme.isPending}
                onCheckedChange={(checked) => {
                  updateTheme.mutate({ data: { invoiceRemindersEnabled: checked } as Parameters<typeof updateTheme.mutate>[0]["data"] });
                }}
              />
            </div>
          </div>

          {isEditable && (
            <Button type="submit" disabled={updateTheme.isPending} className="w-full sm:w-auto">
              {updateTheme.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Theme"}
            </Button>
          )}
        </form>

        {/* ── Live Preview ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Live Preview</Label>
            <span className="text-xs text-zinc-400">Updates as you change settings</span>
          </div>
          <div
            className="border border-zinc-200 rounded-xl overflow-hidden shadow-sm h-[520px] flex"
            style={{ fontFamily: previewFont !== "system-ui" ? `"${previewFont}", sans-serif` : "system-ui, sans-serif" }}
          >
            {/* Sidebar */}
            <div className="w-44 shrink-0 flex flex-col" style={{ backgroundColor: previewPrimary }}>
              <div className="h-12 flex items-center px-3 border-b border-white/10 gap-2 shrink-0">
                {previewLogo
                  ? <img src={previewLogo} alt="" className="h-6 w-6 shrink-0" style={{ borderRadius: previewRadius }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  : <div className="h-6 w-6 rounded-full bg-white/20 shrink-0 flex items-center justify-center text-white/80 text-[10px] font-bold">{(previewName || "A").charAt(0).toUpperCase()}</div>
                }
                <span className="font-semibold text-xs text-white truncate">{previewName || "Your Company"}</span>
              </div>
              <nav className="flex-1 p-2 space-y-0.5">
                {["Dashboard", "Pipeline", "Contacts", "Analytics", "Settings"].map((item, i) => (
                  <NavPreviewItem key={item} label={item} active={i === 0} navStyle={previewNavStyle} accent={previewAccent} />
                ))}
              </nav>
              <div className="p-3 border-t border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-white/20" />
                  <div>
                    <div className="h-2 w-16 bg-white/40 rounded-full mb-1" />
                    <div className="h-1.5 w-10 bg-white/20 rounded-full" />
                  </div>
                </div>
              </div>
            </div>

            {/* Main content */}
            <div className="flex-1 bg-zinc-50 flex flex-col overflow-hidden">
              {/* Top bar */}
              <div className="h-12 bg-white border-b border-zinc-200 flex items-center px-4 gap-3 shrink-0">
                <div className="h-2 w-20 bg-zinc-200 rounded-full" />
                <div className="flex-1" />
                <div className="h-6 w-6 rounded-full bg-zinc-200" />
              </div>

              {/* Content area */}
              <div className="flex-1 p-4 space-y-3 overflow-hidden">
                {/* KPI cards row */}
                <div className="grid grid-cols-3 gap-2">
                  {[["Revenue","$48k"],["Deals","24"],["Pipeline","$120k"]].map(([k,v]) => (
                    <div key={k} className="bg-white p-3 border border-zinc-200" style={{ borderRadius: previewRadius }}>
                      <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{k}</p>
                      <p className="text-sm font-bold text-zinc-800 mt-0.5">{v}</p>
                    </div>
                  ))}
                </div>

                {/* Main card */}
                <div className="bg-white border border-zinc-200 p-4 flex flex-col gap-3" style={{ borderRadius: previewRadius }}>
                  <div className="flex items-center justify-between">
                    <div className="h-2 w-24 bg-zinc-200 rounded-full" />
                    <button
                      className="px-3 py-1.5 text-[10px] font-semibold text-white shadow-sm"
                      style={{ backgroundColor: previewAccent, borderRadius: previewRadius, color: isLightColor(previewAccent) ? "#111" : "#fff" }}
                    >
                      + New Deal
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {["Doubtless Records","Sun Life Media","Epic Sync"].map((n) => (
                      <div key={n} className="flex items-center gap-2 py-1.5 border-b border-zinc-100">
                        <div className="w-5 h-5 rounded-full bg-zinc-100 shrink-0" />
                        <div className="flex-1">
                          <div className="h-2 w-24 bg-zinc-200 rounded-full" />
                        </div>
                        <div className="h-4 px-2 rounded-full text-[9px] font-medium flex items-center" style={{ backgroundColor: previewAccent + "22", color: previewAccent }}>
                          Active
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Badge row */}
                <div className="flex gap-2">
                  <div className="px-3 py-1 text-[10px] font-medium rounded-full text-white" style={{ backgroundColor: previewAccent }}>
                    Primary
                  </div>
                  <div className="px-3 py-1 text-[10px] font-medium rounded-full border" style={{ borderColor: previewAccent, color: previewAccent }}>
                    Outline
                  </div>
                  <div className="px-3 py-1 text-[10px] font-medium rounded-full bg-zinc-100 text-zinc-600">
                    Neutral
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

// ── Per-Member Rates Table (admin only) ───────────────────────────────────
interface MemberRateRow { userId: number; name: string; role: string; targetHourlyRate: string | null; }

function MemberRatesTable({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [rates, setRates] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);

  const authH = (t: string | null): Record<string, string> => (t ? { Authorization: `Bearer ${t}` } : {});

  const { data: users, isLoading, refetch } = useQuery<MemberRateRow[]>({
    queryKey: ["time-settings-members"],
    queryFn: async () => {
      const r = await fetch("/api/time/settings", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      const data = (await r.json()) as { memberRates: MemberRateRow[] };
      return data.memberRates ?? [];
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (!users) return;
    const init: Record<number, string> = {};
    for (const u of users) init[u.userId] = u.targetHourlyRate ?? "";
    setRates(init);
  }, [users]);

  async function saveRate(userId: number) {
    setSaving(userId);
    try {
      const val = rates[userId];
      const body = { targetHourlyRate: val === "" ? null : Number(val) };
      const r = await fetch(`/api/admin/users/${userId}/rate`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Rate saved" });
      refetch();
    } catch {
      toast({ title: "Failed to save rate", variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  const ROLE_META: Record<string, string> = {
    owner: "bg-amber-100 text-amber-700 border-amber-200",
    admin: "bg-purple-100 text-purple-700 border-purple-200",
    manager: "bg-blue-100 text-blue-700 border-blue-200",
    artist: "bg-rose-100 text-rose-700 border-rose-200",
    engineer: "bg-amber-100 text-amber-700 border-amber-200",
    ar: "bg-emerald-100 text-emerald-700 border-emerald-200",
    intern: "bg-zinc-100 text-zinc-600 border-zinc-200",
  };

  if (isLoading) return <div className="py-6 text-center text-sm text-muted-foreground">Loading team…</div>;

  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 border-b border-zinc-200">
            <th className="text-left px-4 py-2.5 font-semibold text-zinc-700">Member</th>
            <th className="text-left px-4 py-2.5 font-semibold text-zinc-700">Role</th>
            <th className="text-center px-4 py-2.5 font-semibold text-zinc-700">Rate ($/hr)</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {(users ?? []).map((u) => (
            <tr key={u.userId} className="hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-800">{u.name}</td>
              <td className="px-4 py-3">
                <Badge className={`text-xs border ${ROLE_META[u.role] ?? "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
                  {u.role === "ar" ? "A&R" : u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-center">
                <div className="flex items-center justify-center gap-1">
                  <span className="text-zinc-400 text-sm">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Workspace default"
                    value={rates[u.userId] ?? ""}
                    onChange={(e) => setRates((prev) => ({ ...prev, [u.userId]: e.target.value }))}
                    className="w-36 h-8 text-sm text-center font-mono"
                  />
                </div>
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs px-3"
                  onClick={() => saveRate(u.userId)}
                  disabled={saving === u.userId}
                >
                  {saving === u.userId ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Time Tracking Tab ──────────────────────────────────────────────────────
function TimeTrackingTab({ token }: { token: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: user } = useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  interface TimeSettings { id: number; targetHourlyRate: string; currency: string; }
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const { data: settings, isLoading } = useQuery<TimeSettings>({
    queryKey: ["time-settings"],
    queryFn: async () => {
      const r = await fetch("/api/time/settings", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    if (settings) {
      setRate(settings.targetHourlyRate);
      setCurrency(settings.currency);
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/time/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ targetHourlyRate: Number(rate), currency }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { toast({ title: "Time settings saved" }); qc.invalidateQueries({ queryKey: ["time-settings"] }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6 max-w-md">
      <div className="flex items-start gap-3 p-4 rounded-lg border bg-blue-50 border-blue-200 text-sm text-blue-800">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Configure the target hourly rate used to calculate profitability in deal time logs and analytics.</p>
      </div>

      {!isAdmin && (
        <div className="flex items-start gap-3 p-4 rounded-lg border bg-amber-50 border-amber-200 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>Only admins can change time tracking settings.</p>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Target hourly rate</Label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              min="1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="pl-7 w-40"
              disabled={!isAdmin}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Effective rate = deal value ÷ total hours. Green if above target, amber if ≤20% under, red if ≤50% under.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>Currency</Label>
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-24"
            maxLength={10}
            disabled={!isAdmin}
          />
        </div>

        {isAdmin && (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Changes"}
          </Button>
        )}
      </div>

      <div className="border-t border-zinc-100 pt-4">
        <p className="text-xs text-zinc-500">
          Current target: <strong>${settings?.targetHourlyRate ?? "100"}/{settings?.currency ?? "USD"} per hour</strong>
        </p>
      </div>

      {isAdmin && (
        <div className="space-y-3 pt-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Per-Member Rates</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Override the workspace rate for individual team members. Leave blank to use the workspace default.
            </p>
          </div>
          <MemberRatesTable token={token} />
        </div>
      )}
    </div>
  );
}

// ── Built-in metric keys with display labels ────────────────────────────────
const BUILTIN_METRICS = [
  { key: "deals_closed",     label: "Deals Closed",     unit: "count" },
  { key: "revenue_closed",   label: "Revenue ($)",      unit: "currency" },
  { key: "hours_logged",     label: "Hours Logged",     unit: "hours" },
  { key: "artists_signed",   label: "Artists Signed",   unit: "count" },
  { key: "projects_booked",  label: "Projects Booked",  unit: "count" },
  { key: "templates_sent",   label: "Templates Sent",   unit: "count" },
  { key: "form_submissions", label: "Form Submissions", unit: "count" },
];

// ── Custom Quota Categories Manager ─────────────────────────────────────────
interface QuotaCategory { id: number; label: string; unit: string; description: string | null; }

function QuotaCategoriesManager({ token }: { token: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const [newLabel, setNewLabel]     = useState("");
  const [newUnit, setNewUnit]       = useState("count");
  const [newDesc, setNewDesc]       = useState("");
  const [adding, setAdding]         = useState(false);
  const [deleting, setDeleting]     = useState<number | null>(null);

  const { data: cats = [], isLoading } = useQuery<QuotaCategory[]>({
    queryKey: ["quota-categories"],
    queryFn: async () => {
      const r = await fetch("/api/admin/quota-categories", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  async function addCategory() {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      const r = await fetch("/api/admin/quota-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ label: newLabel.trim(), unit: newUnit, description: newDesc.trim() || undefined }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Category created" });
      setNewLabel(""); setNewUnit("count"); setNewDesc("");
      qc.invalidateQueries({ queryKey: ["quota-categories"] });
    } catch {
      toast({ title: "Failed to create category", variant: "destructive" });
    } finally { setAdding(false); }
  }

  async function deleteCategory(id: number) {
    setDeleting(id);
    try {
      const r = await fetch(`/api/admin/quota-categories/${id}`, { method: "DELETE", headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Category deleted" });
      qc.invalidateQueries({ queryKey: ["quota-categories"] });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally { setDeleting(null); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-800">Custom Quota Categories</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define extra quota types beyond the built-ins (deals, revenue, hours, etc.).
        </p>
      </div>

      {/* Built-in list */}
      <div className="rounded-xl border border-zinc-200 overflow-hidden">
        <div className="bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 border-b border-zinc-200">Built-in</div>
        <div className="divide-y divide-zinc-100">
          {BUILTIN_METRICS.map((m) => (
            <div key={m.key} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-sm font-medium text-zinc-700">{m.label}</span>
              <Badge variant="outline" className="text-xs">{m.unit}</Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Custom categories */}
      {isLoading ? (
        <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
      ) : cats.length > 0 && (
        <div className="rounded-xl border border-zinc-200 overflow-hidden">
          <div className="bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500 border-b border-zinc-200">Custom</div>
          <div className="divide-y divide-zinc-100">
            {cats.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-2.5 group">
                <div>
                  <span className="text-sm font-medium text-zinc-700">{c.label}</span>
                  {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{c.unit}</Badge>
                  <button
                    onClick={() => deleteCategory(c.id)}
                    disabled={deleting === c.id}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-600 transition-opacity"
                  >
                    {deleting === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add new */}
      <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-zinc-600">Add Custom Category</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Label</Label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Studio Sessions" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Unit</Label>
            <Select value={newUnit} onValueChange={setNewUnit}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">Count</SelectItem>
                <SelectItem value="currency">Currency ($)</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
                <SelectItem value="percent">Percent (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Description (optional)</Label>
          <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Brief description" className="h-8 text-sm" />
        </div>
        <Button size="sm" onClick={addCategory} disabled={adding || !newLabel.trim()} className="gap-1.5">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add Category
        </Button>
      </div>
    </div>
  );
}

// ── Per-User / Group Quota Assigner ──────────────────────────────────────────
interface AdminUserRow { id: number; name: string; role: string; }
interface UserQuotaRow { id: number; userId: number; metricKey: string; targetValue: string; }

function UserQuotaAssigner({ token }: { token: string | null }) {
  const { toast } = useToast();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [overrides, setOverrides]            = useState<Record<string, string>>({});
  const [saving, setSaving]                  = useState(false);

  const { data: users = [] } = useQuery<AdminUserRow[]>({
    queryKey: ["admin-users-q"],
    queryFn: async () => {
      const r = await fetch("/api/admin/users", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      const data = (await r.json()) as AdminUserRow[];
      return data.filter((u) => u.role !== "portal");
    },
    enabled: !!token,
  });

  const { data: allUserQuotas = [] } = useQuery<UserQuotaRow[]>({
    queryKey: ["admin-user-quotas"],
    queryFn: async () => {
      const r = await fetch("/api/admin/user-quotas", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const { data: customCats = [] } = useQuery<QuotaCategory[]>({
    queryKey: ["quota-categories"],
    queryFn: async () => {
      const r = await fetch("/api/admin/quota-categories", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const allMetrics = [
    ...BUILTIN_METRICS,
    ...customCats.map((c) => ({ key: `custom:${c.id}`, label: c.label, unit: c.unit })),
  ];

  const { data: roleQuotas = [] } = useQuery<{ role: string; metricKey: string; targetValue: string }[]>({
    queryKey: ["role-quotas-q"],
    queryFn: async () => {
      const r = await fetch("/api/admin/role-quotas", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const selectedUser = users.find((u) => String(u.id) === selectedUserId);

  useEffect(() => {
    if (!selectedUserId) return;
    const uid = Number(selectedUserId);
    const userRows = allUserQuotas.filter((q) => q.userId === uid);
    const init: Record<string, string> = {};
    for (const q of userRows) init[q.metricKey] = q.targetValue;
    setOverrides(init);
  }, [selectedUserId, allUserQuotas]);

  const getRoleDefault = (metricKey: string): string | null => {
    if (!selectedUser) return null;
    const q = roleQuotas.find((r) => r.role === selectedUser.role && r.metricKey === metricKey);
    return q ? q.targetValue : null;
  };

  async function saveOverrides() {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const quotas = allMetrics
        .map((m) => ({ userId: Number(selectedUserId), metricKey: m.key, targetValue: Number(overrides[m.key] ?? 0) }))
        .filter((q) => overrides[q.metricKey] !== undefined && overrides[q.metricKey] !== "");
      const r = await fetch("/api/admin/user-quotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ quotas }),
      });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Quotas saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-800">Assign Quotas to Member</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Set individual targets for a team member. Overrides their role default. Leave blank to use the role default.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Select Member</Label>
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger className="w-64 h-9">
            <SelectValue placeholder="Choose a team member…" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name} <span className="text-muted-foreground capitalize ml-1">({u.role})</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedUser && (
        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200">
                  <th className="text-left px-4 py-2.5 font-semibold text-zinc-700">Metric</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-zinc-700">Role Default</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-zinc-700">Personal Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {allMetrics.map((m) => {
                  const roleDefault = getRoleDefault(m.key);
                  return (
                    <tr key={m.key} className="hover:bg-zinc-50/50">
                      <td className="px-4 py-3 font-medium text-zinc-800">
                        {m.label}
                        <span className="ml-1.5 text-xs text-muted-foreground">({m.unit})</span>
                      </td>
                      <td className="px-4 py-3 text-center text-muted-foreground text-sm">
                        {roleDefault ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          placeholder={roleDefault ?? "No default"}
                          value={overrides[m.key] ?? ""}
                          onChange={(e) => setOverrides((prev) => ({ ...prev, [m.key]: e.target.value }))}
                          className="w-28 h-8 text-sm text-center font-mono mx-auto"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button size="sm" onClick={saveOverrides} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save Targets for {selectedUser.name}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Webhooks Tab ───────────────────────────────────────────────────────────

const ALL_WEBHOOK_EVENTS = [
  { value: "form.submitted",       label: "Form submitted",         desc: "A public form receives a new submission" },
  { value: "deal.stage_changed",   label: "Deal stage changed",     desc: "A deal is moved to a different pipeline stage" },
  { value: "contact.created",      label: "Contact created",        desc: "A new contact is added to the CRM" },
  { value: "subscription.created", label: "Subscription created",   desc: "A client is enrolled in a subscription plan" },
  { value: "subscription.updated", label: "Subscription updated",   desc: "A subscription status changes (cancelled, renewed, etc.)" },
  { value: "automation.triggered", label: "Automation triggered",   desc: "An automation rule fires and completes an action" },
] as const;

interface WebhookRow {
  id: number; url: string; events: string[]; isActive: boolean;
  createdAt: string; updatedAt: string;
}
interface DeliveryLog {
  id: number; event: string; responseCode: number | null;
  attempts: number; success: boolean; lastAttemptAt: string;
}

interface PingResult { loading: boolean; success?: boolean; responseCode?: number | null; error?: string | null; }

function WebhooksTab({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editHook, setEditHook] = useState<WebhookRow | null>(null);
  const [logsHookId, setLogsHookId] = useState<number | null>(null);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [pingResults, setPingResults] = useState<Record<number, PingResult>>({});

  // ── Make integration panel state ──
  const [makeOpen, setMakeOpen] = useState(false);

  // ── Signature generator state ──
  const [sigOpen, setSigOpen] = useState(false);
  const [sigBody, setSigBody] = useState('{\n  "name": "Test User",\n  "email": "test@example.com"\n}');
  const [sigDeliveryId] = useState(() => crypto.randomUUID());
  const [sigResult, setSigResult] = useState<string | null>(null);
  const [sigLoading, setSigLoading] = useState(false);

  const [formUrl, setFormUrl] = useState("");
  const [formSecret, setFormSecret] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const H = { Authorization: `Bearer ${token}` } as Record<string, string>;

  async function loadWebhooks() {
    setLoading(true);
    try {
      const r = await fetch("/api/webhooks", { headers: H });
      if (r.ok) setWebhooks(await r.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { if (token) void loadWebhooks(); }, [token]);

  function openCreate() {
    setEditHook(null);
    setFormUrl(""); setFormSecret(crypto.randomUUID().replace(/-/g, ""));
    setFormEvents([]); setFormActive(true);
    setCreateOpen(true);
  }

  function openEdit(hook: WebhookRow) {
    setEditHook(hook);
    setFormUrl(hook.url);
    setFormEvents(hook.events);
    setFormActive(hook.isActive);
    setCreateOpen(true);
  }

  async function handleSave() {
    if (!formUrl || formEvents.length === 0) {
      toast({ title: "URL and at least one event are required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const method = editHook ? "PUT" : "POST";
      const url = editHook ? `/api/webhooks/${editHook.id}` : "/api/webhooks";
      const r = await fetch(url, {
        method, headers: { "Content-Type": "application/json", ...H },
        body: JSON.stringify(editHook
          ? { url: formUrl, events: formEvents, isActive: formActive }
          : { url: formUrl, secret: formSecret, events: formEvents, isActive: formActive }),
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Save failed", variant: "destructive" }); return; }
      toast({ title: editHook ? "Webhook updated" : "Webhook created" });
      setCreateOpen(false);
      void loadWebhooks();
    } finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    await fetch(`/api/webhooks/${id}`, { method: "DELETE", headers: H });
    toast({ title: "Webhook deleted" });
    setWebhooks((w) => w.filter((x) => x.id !== id));
  }

  async function openLogs(hookId: number) {
    if (logsHookId === hookId) { setLogsHookId(null); return; }
    setLogsHookId(hookId);
    setLogsLoading(true);
    try {
      const r = await fetch(`/api/webhooks/${hookId}/logs`, { headers: H });
      if (r.ok) setLogs(await r.json());
    } finally { setLogsLoading(false); }
  }

  async function handlePing(hookId: number) {
    setPingResults((prev) => ({ ...prev, [hookId]: { loading: true } }));
    try {
      const r = await fetch(`/api/webhooks/${hookId}/ping`, { method: "POST", headers: H });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        setPingResults((prev) => ({ ...prev, [hookId]: { loading: false, success: false, error: err.error ?? `Server error (${r.status})` } }));
        return;
      }
      const data = await r.json() as { success: boolean; responseCode: number | null; error: string | null };
      setPingResults((prev) => ({ ...prev, [hookId]: { loading: false, success: data.success, responseCode: data.responseCode, error: data.error } }));
      if (logsHookId === hookId) void openLogs(hookId);
    } catch {
      setPingResults((prev) => ({ ...prev, [hookId]: { loading: false, success: false, error: "Network error" } }));
    }
  }

  function toggleEvent(v: string) {
    setFormEvents((prev) => prev.includes(v) ? prev.filter((e) => e !== v) : [...prev, v]);
  }

  async function generateSignature() {
    setSigLoading(true);
    setSigResult(null);
    try {
      const r = await fetch("/api/webhooks/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...H },
        body: JSON.stringify({ body: sigBody }),
      });
      const data = await r.json() as { signature?: string; error?: string };
      if (!r.ok) { toast({ title: data.error ?? "Failed to generate signature", variant: "destructive" }); return; }
      setSigResult(data.signature ?? null);
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSigLoading(false);
    }
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Webhook className="h-4 w-4 text-violet-500" /> Outbound Webhooks</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Send real-time event notifications to external URLs (Zapier, Make, custom scripts).</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> Add Webhook</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : webhooks.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center">
          <Webhook className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-600">No webhooks yet</p>
          <p className="text-xs text-zinc-400 mt-1">Add a webhook to stream CRM events to Zapier, Make, or your own server.</p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" /> Add Webhook</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((hook) => (
            <div key={hook.id} className="bg-white rounded-xl border border-zinc-200 shadow-sm">
              <div className="flex items-center justify-between p-4 gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-medium truncate max-w-xs">{hook.url}</span>
                    <Badge className={hook.isActive ? "bg-green-100 text-green-700 border-green-200" : "bg-zinc-100 text-zinc-500 border-zinc-200"}>
                      {hook.isActive ? "Active" : "Paused"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(hook.events as string[]).map((e) => (
                      <span key={e} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 rounded px-1.5 py-0.5">{e}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(() => {
                    const pr = pingResults[hook.id];
                    if (!pr) return null;
                    if (pr.loading) return <span className="flex items-center gap-1 text-xs text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Pinging…</span>;
                    if (pr.success) return (
                      <span className="flex items-center gap-1 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded px-2 py-0.5">
                        <CheckCircle2 className="h-3 w-3" /> {pr.responseCode != null ? `HTTP ${pr.responseCode}` : "OK"}
                      </span>
                    );
                    return (
                      <span className="flex items-center gap-1 text-xs font-medium bg-red-50 text-red-600 border border-red-200 rounded px-2 py-0.5" title={pr.error ?? undefined}>
                        <AlertCircle className="h-3 w-3" /> {pr.responseCode != null ? `HTTP ${pr.responseCode}` : (pr.error ? "Error" : "Failed")}
                      </span>
                    );
                  })()}
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1 text-violet-600 hover:text-violet-800 hover:bg-violet-50"
                    disabled={pingResults[hook.id]?.loading}
                    onClick={() => handlePing(hook.id)}
                    title="Send a test ping to verify this endpoint">
                    <Send className="h-3 w-3" /> Send test ping
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-xs gap-1" onClick={() => openLogs(hook.id)}>
                    {logsHookId === hook.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} Logs
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(hook)}>
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                    onClick={() => handleDelete(hook.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              {logsHookId === hook.id && (
                <div className="border-t border-zinc-100 px-4 pb-4 pt-3">
                  <p className="text-xs font-medium text-zinc-500 mb-2">Last 50 deliveries</p>
                  {logsLoading ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>
                  ) : logs.length === 0 ? (
                    <p className="text-xs text-zinc-400 italic">No deliveries yet</p>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                      {logs.map((log) => (
                        <div key={log.id} className="flex items-center justify-between text-xs border border-zinc-100 rounded-lg px-3 py-2 bg-zinc-50">
                          <div className="flex items-center gap-2">
                            {log.success
                              ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                              : <AlertCircle className="h-3.5 w-3.5 text-red-400" />}
                            <span className="font-mono text-zinc-600">{log.event}</span>
                            {log.responseCode && <span className="text-zinc-400">HTTP {log.responseCode}</span>}
                            {log.attempts > 1 && <span className="text-amber-600">{log.attempts} attempts</span>}
                          </div>
                          <span className="text-zinc-400">{new Date(log.lastAttemptAt).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Make.com Integration Guide ──────────────────────────────────────── */}
      {(() => {
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const inboundEndpoints = [
          { slug: "new-lead",      label: "New Lead",        desc: "Fires when a form is submitted or a contact is created" },
          { slug: "pipeline",      label: "Pipeline",        desc: "Fires when a deal changes stage" },
          { slug: "subscriptions", label: "Subscriptions",   desc: "Fires when a subscription is created or updated" },
          { slug: "automation",    label: "Automation",      desc: "Fires when an automation is triggered" },
          { slug: "team-activity", label: "Team Activity",   desc: "Fires on deals, contacts, and automation events" },
        ];
        return (
          <div className="border border-zinc-200 rounded-xl bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors text-left"
              onClick={() => setMakeOpen((v) => !v)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className="flex items-center justify-center w-5 h-5 rounded bg-[#6d0eb1] text-white text-[10px] font-bold leading-none shrink-0">M</span>
                Make.com Integration Guide
                <span className="text-xs font-normal text-zinc-400">— step-by-step setup for both directions</span>
              </span>
              {makeOpen ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
            </button>

            {makeOpen && (
              <div className="border-t border-zinc-100 px-4 py-5 space-y-6">

                {/* Direction 1: CRM → Make */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-100 rounded px-2 py-0.5">CRM → Make</span>
                    <span className="text-xs text-zinc-500">CRM fires an event → Make scenario runs</span>
                  </div>
                  <ol className="space-y-2 text-xs text-zinc-600">
                    <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center text-[10px]">1</span>
                      Open Make, create a new scenario, and add a <strong>Webhooks → Custom webhook</strong> trigger module.
                    </li>
                    <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center text-[10px]">2</span>
                      Click <strong>Add</strong>, give it a name (e.g. "CRM Events"), and copy the webhook URL Make generates.
                    </li>
                    <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center text-[10px]">3</span>
                      Come back here, click <strong>+ Add Webhook</strong> above, paste that URL, choose your events, and save.
                    </li>
                    <li className="flex gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-700 font-bold flex items-center justify-center text-[10px]">4</span>
                      Hit <strong>Send test ping</strong> on your new webhook — Make will receive the payload and let you map the fields.
                    </li>
                  </ol>
                  <a
                    href="https://us2.make.com/2317795/scenarios/add"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 text-xs font-medium text-violet-600 hover:text-violet-800 underline underline-offset-2"
                  >
                    <ExternalLink className="h-3 w-3" /> Open Make to create a scenario
                  </a>
                </div>

                <div className="border-t border-zinc-100" />

                {/* Direction 2: Make → CRM */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold uppercase tracking-wide text-teal-700 bg-teal-50 border border-teal-100 rounded px-2 py-0.5">Make → CRM</span>
                    <span className="text-xs text-zinc-500">Make scenario runs → data lands in CRM</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-3">
                    In your Make scenario, add an <strong>HTTP → Make a request</strong> module. Paste one of these CRM receiver URLs as the target, set method to <code className="bg-zinc-100 px-1 rounded">POST</code>, and body type to <code className="bg-zinc-100 px-1 rounded">JSON</code>.
                    Add header <code className="bg-zinc-100 px-1 rounded">Content-Type: application/json</code>.
                  </p>
                  <div className="space-y-2">
                    {inboundEndpoints.map(({ slug, label, desc }) => {
                      const url = `${origin}/api/webhooks/${slug}`;
                      return (
                        <div key={slug} className="flex items-center gap-2 border border-zinc-100 rounded-lg px-3 py-2.5 bg-zinc-50">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-zinc-700">{label}</p>
                            <p className="text-[11px] text-zinc-400 mt-0.5">{desc}</p>
                            <code className="text-[11px] font-mono text-teal-700 mt-1 block truncate">{url}</code>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 gap-1 shrink-0 text-xs"
                            onClick={() => copyText(url, `${label} URL`)}
                          >
                            <Copy className="h-3 w-3" /> Copy
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 p-3 bg-zinc-50 border border-zinc-200 rounded-lg space-y-1.5">
                    <p className="text-xs text-zinc-700 font-semibold">Required header in Make's HTTP module:</p>
                    <code className="block text-xs font-mono text-teal-700 bg-white border border-zinc-200 rounded px-2 py-1.5">
                      Authorization: Bearer &lt;your-api-key&gt;
                    </code>
                    <p className="text-xs text-zinc-500">
                      That's all Make needs. The signature header is optional — only add it if you want extra payload verification.
                    </p>
                  </div>
                </div>

              </div>
            )}
          </div>
        );
      })()}

      {/* ── Inbound Signature Generator ─────────────────────────────────────── */}
      <div className="border border-zinc-200 rounded-xl bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 transition-colors text-left"
          onClick={() => setSigOpen((v) => !v)}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Key className="h-4 w-4 text-teal-500" />
            Inbound Signature Generator
            <span className="text-xs font-normal text-zinc-400">— compute X-Webhook-Signature for test calls</span>
          </span>
          {sigOpen ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
        </button>

        {sigOpen && (
          <div className="border-t border-zinc-100 px-4 py-4 space-y-4">
            <p className="text-xs text-zinc-500">
              Paste the exact JSON body you'll send, then click <strong>Generate</strong> to get the{" "}
              <code className="bg-zinc-100 px-1 rounded text-zinc-700">X-Webhook-Signature</code> header value.
              Include this header alongside your <code className="bg-zinc-100 px-1 rounded text-zinc-700">Authorization: Bearer &lt;api-key&gt;</code>.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600">Request Body (raw JSON)</label>
              <Textarea
                value={sigBody}
                onChange={(e) => { setSigBody(e.target.value); setSigResult(null); }}
                rows={6}
                className="font-mono text-xs resize-y"
                placeholder='{"name": "..."}'
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-zinc-600">X-Webhook-Delivery-Id (idempotency key)</label>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded px-2 py-1.5 text-zinc-700 truncate">{sigDeliveryId}</code>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copyText(sigDeliveryId, "Delivery ID")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <Button size="sm" className="h-8 gap-1.5 mt-5 bg-teal-600 hover:bg-teal-700 text-white"
                onClick={() => void generateSignature()}
                disabled={sigLoading || !sigBody.trim()}
              >
                {sigLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
                Generate
              </Button>
            </div>

            {sigResult && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-600">Generated Header</label>
                <div className="flex items-start gap-1.5">
                  <div className="flex-1 font-mono text-xs bg-zinc-950 text-teal-400 rounded-lg px-3 py-3 space-y-1 overflow-x-auto">
                    <div><span className="text-zinc-500">Authorization:</span> Bearer &lt;your-api-key&gt;</div>
                    <div><span className="text-zinc-500">X-Webhook-Delivery-Id:</span> {sigDeliveryId}</div>
                    <div><span className="text-zinc-500">X-Webhook-Signature:</span> {sigResult}</div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 px-2 shrink-0"
                    onClick={() => copyText(sigResult, "Signature")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-zinc-400">
                  Valid only for the body above — any change to the JSON (including whitespace) will produce a different signature.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Webhook className="h-4 w-4 text-violet-500" />
              {editHook ? "Edit Webhook" : "New Webhook"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Target URL</label>
              <Input value={formUrl} onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://hooks.zapier.com/…" className="font-mono text-sm" />
            </div>

            {!editHook ? (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Signing Secret</label>
                <div className="flex gap-2">
                  <Input value={formSecret} onChange={(e) => setFormSecret(e.target.value)}
                    className="font-mono text-xs flex-1" readOnly />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(formSecret); toast({ title: "Secret copied" }); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setFormSecret(crypto.randomUUID().replace(/-/g, ""))}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Copy this now — it won't be shown again. We'll include an <code className="bg-zinc-100 px-1 rounded">X-Signature: sha256=…</code> header with each delivery so you can verify the source.</p>
              </div>
            ) : (
              <div className="p-3 bg-zinc-50 border border-zinc-100 rounded-lg">
                <p className="text-xs text-muted-foreground">The signing secret was set when this webhook was created and cannot be changed. Delete and recreate the webhook to rotate the secret.</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">Events to subscribe</label>
              <div className="space-y-2">
                {ALL_WEBHOOK_EVENTS.map(({ value, label, desc }) => (
                  <label key={value} className="flex items-start gap-3 p-3 border border-zinc-100 rounded-lg hover:bg-zinc-50 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={formEvents.includes(value)} onChange={() => toggleEvent(value)} />
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-zinc-400">{desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 border border-zinc-100 rounded-lg">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-zinc-400">Pause delivery without deleting this webhook</p>
              </div>
              <Switch checked={formActive} onCheckedChange={setFormActive} />
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {editHook ? "Save Changes" : "Create Webhook"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── API Keys Tab ────────────────────────────────────────────────────────────

const API_KEY_SCOPES = [
  { value: "contacts",  label: "Contacts" },
  { value: "deals",     label: "Deals" },
  { value: "artists",   label: "Artists" },
  { value: "royalties", label: "Royalties" },
  { value: "forms",     label: "Forms & Submissions" },
] as const;

const SCOPE_COLORS: Record<string, string> = {
  contacts:  "bg-blue-100 text-blue-700 border-blue-200",
  deals:     "bg-purple-100 text-purple-700 border-purple-200",
  artists:   "bg-pink-100 text-pink-700 border-pink-200",
  royalties: "bg-emerald-100 text-emerald-700 border-emerald-200",
  forms:     "bg-orange-100 text-orange-700 border-orange-200",
};

interface ApiKeyRow {
  id: number; name: string; prefix: string;
  scopes: string[] | null;
  lastUsedAt: string | null; createdAt: string; revokedAt: string | null;
}

function ApiKeysTab({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleScope(value: string) {
    setNewKeyScopes((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  }

  const H = { Authorization: `Bearer ${token}` } as Record<string, string>;

  async function loadKeys() {
    setLoading(true);
    try {
      const r = await fetch("/api/api-keys", { headers: H });
      if (r.ok) setKeys(await r.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { if (token) void loadKeys(); }, [token]);

  async function handleCreate() {
    if (!newKeyName.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...H },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes.length > 0 ? newKeyScopes : undefined }),
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error ?? "Failed to create key", variant: "destructive" }); return; }
      setCreatedKey(data.key);
      void loadKeys();
    } finally { setSaving(false); }
  }

  async function handleRevoke(id: number) {
    await fetch(`/api/api-keys/${id}`, { method: "DELETE", headers: H });
    toast({ title: "API key revoked" });
    void loadKeys();
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Key className="h-4 w-4 text-amber-500" /> API Keys</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Generate read-only keys to access contacts, deals, artists, and more from scripts or external tools.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => { setNewKeyName(""); setNewKeyScopes([]); setCreatedKey(null); setCreateOpen(true); }}>
          <Plus className="h-3.5 w-3.5" /> New Key
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        API keys are <strong>read-only</strong> — they can only call GET endpoints. Use your JWT for write access.
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : activeKeys.length === 0 && revokedKeys.length === 0 ? (
        <div className="border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center">
          <Key className="h-8 w-8 text-zinc-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-zinc-600">No API keys yet</p>
          <p className="text-xs text-zinc-400 mt-1">Generate a key to connect external tools and scripts to this CRM.</p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => { setNewKeyName(""); setNewKeyScopes([]); setCreatedKey(null); setCreateOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Create API Key
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {activeKeys.map((k) => (
            <div key={k.id} className="bg-white rounded-xl border border-zinc-200 shadow-sm p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{k.name}</span>
                  <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Active</Badge>
                  {k.scopes && k.scopes.length > 0 ? (
                    k.scopes.map((s) => (
                      <Badge key={s} variant="outline" className={`text-xs border ${SCOPE_COLORS[s] ?? "bg-zinc-100 text-zinc-600 border-zinc-200"}`}>
                        {API_KEY_SCOPES.find((sc) => sc.value === s)?.label ?? s}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="outline" className="text-xs border bg-zinc-100 text-zinc-500 border-zinc-200">All resources</Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-400">
                  <span className="font-mono">apk_{k.prefix}••••••••</span>
                  <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                  {k.lastUsedAt && <span>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                  {!k.lastUsedAt && <span>Never used</span>}
                </div>
              </div>
              <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 shrink-0"
                onClick={() => handleRevoke(k.id)}>
                Revoke
              </Button>
            </div>
          ))}
          {revokedKeys.length > 0 && (
            <details className="text-xs text-zinc-400">
              <summary className="cursor-pointer hover:text-zinc-600 select-none">{revokedKeys.length} revoked key{revokedKeys.length !== 1 ? "s" : ""}</summary>
              <div className="space-y-1.5 mt-2">
                {revokedKeys.map((k) => (
                  <div key={k.id} className="flex items-center gap-2 text-xs text-zinc-400 line-through">
                    <span>{k.name}</span>
                    <span className="font-mono">apk_{k.prefix}••••••••</span>
                    <span>Revoked {new Date(k.revokedAt!).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreatedKey(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-500" /> Create API Key
            </DialogTitle>
          </DialogHeader>
          {createdKey ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Key created! Copy it now — it won't be shown again.
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Your API Key</label>
                <div className="flex gap-2">
                  <Input value={createdKey} readOnly className="font-mono text-xs flex-1" />
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(createdKey); toast({ title: "Key copied" }); }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-xs text-zinc-600 space-y-1">
                <p className="font-medium">Using your key:</p>
                <code className="block bg-zinc-100 rounded p-2 text-xs">Authorization: Bearer {createdKey.slice(0, 16)}…</code>
                <p>Use it as a Bearer token on any GET endpoint (contacts, deals, artists, royalties, submissions).</p>
              </div>
              <Button className="w-full" onClick={() => { setCreateOpen(false); setCreatedKey(null); }}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Key Name</label>
                <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. Zapier Integration, Internal Script…" autoFocus />
                <p className="text-xs text-muted-foreground">A descriptive name so you know what's using this key.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Resource Access</label>
                <p className="text-xs text-muted-foreground">Select which resources this key can access. Leave all unchecked to allow access to all resources.</p>
                <div className="grid grid-cols-2 gap-2">
                  {API_KEY_SCOPES.map((scope) => {
                    const checked = newKeyScopes.includes(scope.value);
                    return (
                      <button
                        key={scope.value}
                        type="button"
                        onClick={() => toggleScope(scope.value)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-left transition-colors ${
                          checked
                            ? `${SCOPE_COLORS[scope.value]} border font-medium`
                            : "border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                      >
                        <div className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                          checked ? "bg-current border-current" : "border-zinc-300"
                        }`}>
                          {checked && <svg viewBox="0 0 10 10" className="h-2 w-2 text-white fill-white"><path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </div>
                        {scope.label}
                      </button>
                    );
                  })}
                </div>
                {newKeyScopes.length === 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    No restrictions — this key will have access to all resources.
                  </p>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
                  Generate Key
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function Settings() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("tab") ?? "integrations";
  });

  return (
    <div className="flex-1 p-4 sm:p-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Manage your workspace and personal preferences.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
          <TabsList className="w-max min-w-full">
            <TabsTrigger value="preferences" className="gap-1.5 shrink-0">
              <Sun className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Preferences</span><span className="sm:hidden">Prefs</span>
            </TabsTrigger>
            <TabsTrigger value="integrations" className="gap-1.5 shrink-0">
              <Plug2 className="h-3.5 w-3.5" /> <span className="hidden xs:inline">Integrations</span><span className="xs:hidden">Apps</span>
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5 shrink-0">
              <Mail className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Email Account</span><span className="sm:hidden">Email</span>
            </TabsTrigger>
            <TabsTrigger value="theme" className="gap-1.5 shrink-0">
              <Paintbrush className="h-3.5 w-3.5" /> Theme
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5 shrink-0">
              <ShieldCheck className="h-3.5 w-3.5" /> Security
            </TabsTrigger>
            <TabsTrigger value="time" className="gap-1.5 shrink-0">
              <Clock className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Time Tracking</span><span className="sm:hidden">Time</span>
            </TabsTrigger>
            <TabsTrigger value="quotas" className="gap-1.5 shrink-0">
              <Target className="h-3.5 w-3.5" /> Quotas
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5 shrink-0">
              <Bell className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Notifications</span><span className="sm:hidden">Alerts</span>
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-1.5 shrink-0">
              <Webhook className="h-3.5 w-3.5" /> Webhooks
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-1.5 shrink-0">
              <Key className="h-3.5 w-3.5" /> <span className="hidden sm:inline">API Keys</span><span className="sm:hidden">Keys</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="preferences">
          <div className="mb-5">
            <h2 className="text-base font-semibold">Personal Preferences</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Customize how the app looks and feels for your account only.
            </p>
          </div>
          <PreferencesTab token={token} />
        </TabsContent>

        <TabsContent value="integrations">
          <div className="mb-5">
            <h2 className="text-base font-semibold">Connected Accounts</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Connect your personal accounts so the CRM can sync emails, files, and storage on your behalf.
            </p>
          </div>
          <IntegrationsTab token={token} setActiveTab={setActiveTab} />
        </TabsContent>

        <TabsContent value="email">
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold">Company Email</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Link your company email so CRM emails are sent from your own address.
              </p>
            </div>
            <EmailSettingsTab token={token} />
          </div>
        </TabsContent>

        <TabsContent value="theme">
          <ThemeTab token={token} />
        </TabsContent>

        <TabsContent value="security">
          <div className="mb-5">
            <h2 className="text-base font-semibold">Security Status</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Live view of all active security controls protecting this CRM. Refreshes every 30 seconds.
            </p>
          </div>
          <SecurityTab token={token} />
        </TabsContent>

        <TabsContent value="time">
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
            <div className="mb-5">
              <h2 className="text-base font-semibold">Time Tracking</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure target hourly rate for profitability calculations.
              </p>
            </div>
            <TimeTrackingTab token={token} />
          </div>
        </TabsContent>

        <TabsContent value="quotas">
          <div className="space-y-8">
            <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4 text-indigo-500" /> Quota Categories
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Manage built-in and custom quota metric types.
                </p>
              </div>
              <QuotaCategoriesManager token={token} />
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-6">
              <div className="mb-5">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-indigo-500" /> Per-Member Quota Targets
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Override role-level quotas with personal targets for individual team members.
                </p>
              </div>
              <UserQuotaAssigner token={token} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationsTab token={token} />
        </TabsContent>

        <TabsContent value="webhooks">
          <WebhooksTab token={token} />
        </TabsContent>

        <TabsContent value="api-keys">
          <ApiKeysTab token={token} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
