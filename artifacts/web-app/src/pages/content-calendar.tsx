import { useState } from "react";
import {
  useListContentPosts, useCreateContentPost, useUpdateContentPost,
  useDeleteContentPost, getListContentPostsQueryKey,
  useGetMyConnections, getGetMyConnectionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays, Plus, Pencil, Trash2, Loader2, Mail,
  Send, AlertTriangle, CheckCircle2, Wifi, WifiOff, ExternalLink, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentPost } from "@workspace/api-client-react";

type Platform = "instagram" | "tiktok" | "twitter" | "youtube" | "facebook" | "email" | "sms" | "slack" | "linkedin";
type PostStatus = "draft" | "scheduled" | "posted" | "cancelled" | "failed" | "posting";

const PUBLISHABLE_PLATFORMS: Platform[] = ["instagram", "facebook", "slack"];

// ── Brand SVG icons ────────────────────────────────────────────────────────────
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <defs>
        <linearGradient id="ig-g" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f9ce34" />
          <stop offset="35%" stopColor="#ee2a7b" />
          <stop offset="100%" stopColor="#6228d7" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#ig-g)" />
      <circle cx="12" cy="12" r="4.5" fill="none" stroke="white" strokeWidth="1.5" />
      <circle cx="17.5" cy="6.5" r="1.1" fill="white" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.72a8.13 8.13 0 0 0 4.77 1.53V6.79a4.85 4.85 0 0 1-1-.1z" />
    </svg>
  );
}

function XTwitterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.737-8.857L2.25 2.25H8.08l4.213 5.567L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#1877f2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#0a66c2">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

function SlackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 124 124" className={className}>
      <path d="M26.3 78.8c0 7.2-5.8 13-13 13s-13-5.8-13-13 5.8-13 13-13h13v13zm6.5 0c0-7.2 5.8-13 13-13s13 5.8 13 13v32.5c0 7.2-5.8 13-13 13s-13-5.8-13-13V78.8z" fill="#E01E5A" />
      <path d="M45.8 26.3c-7.2 0-13-5.8-13-13s5.8-13 13-13 13 5.8 13 13v13h-13zm0 6.5c7.2 0 13 5.8 13 13s-5.8 13-13 13H13.3c-7.2 0-13-5.8-13-13s5.8-13 13-13h32.5z" fill="#36C5F0" />
      <path d="M97.7 45.8c0-7.2 5.8-13 13-13s13 5.8 13 13-5.8 13-13 13h-13v-13zm-6.5 0c0 7.2-5.8 13-13 13s-13-5.8-13-13V13.3c0-7.2 5.8-13 13-13s13 5.8 13 13v32.5z" fill="#2EB67D" />
      <path d="M78.2 97.7c7.2 0 13 5.8 13 13s-5.8 13-13 13-13-5.8-13-13v-13h13zm0-6.5c-7.2 0-13-5.8-13-13s5.8-13 13-13h32.5c7.2 0 13 5.8 13 13s-5.8 13-13 13H78.2z" fill="#ECB22E" />
    </svg>
  );
}

function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="#ff0000">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

// ── Platform configuration ─────────────────────────────────────────────────────
const PLATFORM_CONFIG: Record<Platform, { label: string; color: string; icon: React.ReactNode; badgeIcon: React.ReactNode; provider: string | null }> = {
  instagram: { label: "Instagram",  color: "bg-pink-50 text-pink-700 border-pink-200",       icon: <InstagramIcon className="h-3.5 w-3.5" />, badgeIcon: <InstagramIcon className="h-3 w-3" />, provider: "instagram" },
  tiktok:    { label: "TikTok",     color: "bg-zinc-50 text-zinc-800 border-zinc-200",       icon: <TikTokIcon className="h-3.5 w-3.5" />,    badgeIcon: <TikTokIcon className="h-3 w-3" />,    provider: "tiktok" },
  twitter:   { label: "X/Twitter",  color: "bg-sky-50 text-sky-700 border-sky-200",          icon: <XTwitterIcon className="h-3.5 w-3.5" />,  badgeIcon: <XTwitterIcon className="h-3 w-3" />,  provider: "twitter" },
  youtube:   { label: "YouTube",    color: "bg-red-50 text-red-700 border-red-200",          icon: <YouTubeIcon className="h-3.5 w-3.5" />,   badgeIcon: <YouTubeIcon className="h-3 w-3" />,   provider: null },
  facebook:  { label: "Facebook",   color: "bg-blue-50 text-blue-700 border-blue-200",       icon: <FacebookIcon className="h-3.5 w-3.5" />,  badgeIcon: <FacebookIcon className="h-3 w-3" />,  provider: "facebook" },
  slack:     { label: "Slack",      color: "bg-purple-50 text-purple-700 border-purple-200", icon: <SlackIcon className="h-3.5 w-3.5" />,     badgeIcon: <SlackIcon className="h-3 w-3" />,     provider: "slack" },
  linkedin:  { label: "LinkedIn",   color: "bg-blue-50 text-blue-600 border-blue-200",       icon: <LinkedInIcon className="h-3.5 w-3.5" />,  badgeIcon: <LinkedInIcon className="h-3 w-3" />,  provider: "linkedin" },
  email:     { label: "Email",      color: "bg-violet-50 text-violet-700 border-violet-200", icon: <Mail className="h-3.5 w-3.5" />,          badgeIcon: <Mail className="h-3 w-3" />,          provider: null },
  sms:       { label: "SMS",        color: "bg-green-50 text-green-700 border-green-200",    icon: <span className="text-[10px] font-bold">SMS</span>, badgeIcon: <span className="text-[9px] font-bold leading-none">SMS</span>, provider: null },
};

const STATUS_CONFIG: Record<PostStatus, { label: string; color: string }> = {
  draft:     { label: "Draft",      color: "bg-zinc-100 text-zinc-600" },
  scheduled: { label: "Scheduled",  color: "bg-blue-100 text-blue-700" },
  posting:   { label: "Posting…",   color: "bg-yellow-100 text-yellow-700" },
  posted:    { label: "Posted",     color: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelled",  color: "bg-red-100 text-red-600" },
  failed:    { label: "Failed",     color: "bg-red-100 text-red-700" },
};

const PLATFORMS = Object.keys(PLATFORM_CONFIG) as Platform[];
const STATUSES  = ["draft", "scheduled", "posted", "cancelled"] as const;
const EMPTY = { platform: "instagram" as Platform, scheduledAt: "", copy: "", mediaUrls: "", status: "draft" as PostStatus };

function PlatformBadge({ platform }: { platform: Platform }) {
  const cfg = PLATFORM_CONFIG[platform];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      {cfg.badgeIcon}{cfg.label}
    </span>
  );
}

function formatDate(s: string) {
  if (!s) return "—";
  return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Post preview panels ────────────────────────────────────────────────────────
function PostPreview({ platform, copy, mediaUrl }: { platform: Platform; copy: string; mediaUrl?: string }) {
  const hasImage = !!mediaUrl;

  if (platform === "instagram") {
    return (
      <div className="mx-auto max-w-[300px] bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden text-sm">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-100">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 via-purple-600 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">DP</div>
          <span className="font-semibold text-xs flex-1">doubtless_productions</span>
          <span className="text-zinc-400 text-lg leading-none">···</span>
        </div>
        {hasImage ? (
          <img src={mediaUrl} alt="post" className="w-full aspect-square object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-full aspect-square bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center">
            <InstagramIcon className="h-10 w-10 opacity-20" />
          </div>
        )}
        <div className="px-3 py-2.5 space-y-1.5">
          <div className="flex items-center gap-3 text-zinc-700 text-base">
            <span>♥</span><span>💬</span><span>↗</span>
            <span className="ml-auto">🔖</span>
          </div>
          <p className="text-xs font-semibold">0 likes</p>
          <p className="text-xs leading-relaxed break-words">
            <span className="font-semibold mr-1">doubtless_productions</span>
            {copy || <span className="text-zinc-400 italic">Your caption will appear here…</span>}
          </p>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Just now</p>
        </div>
      </div>
    );
  }

  if (platform === "facebook") {
    return (
      <div className="mx-auto max-w-[300px] bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden text-sm">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold shrink-0">DP</div>
          <div className="flex-1">
            <p className="text-xs font-semibold leading-none">Doubtless Productions</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Just now · 🌐</p>
          </div>
          <span className="text-zinc-400 text-lg leading-none">···</span>
        </div>
        {copy && <p className="px-3 pb-2 text-xs leading-relaxed break-words">{copy}</p>}
        {hasImage ? (
          <img src={mediaUrl} alt="post" className="w-full object-cover" style={{ maxHeight: 180 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        ) : (
          <div className="w-full h-32 bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center">
            <FacebookIcon className="h-10 w-10 opacity-30" />
          </div>
        )}
        {!copy && <p className="px-3 pb-3 pt-1 text-xs text-zinc-400 italic">Your post content will appear here…</p>}
        <div className="border-t border-zinc-100 flex divide-x divide-zinc-100">
          {["👍 Like", "💬 Comment", "↗ Share"].map((a) => (
            <button key={a} className="flex-1 py-2 text-[11px] font-medium text-zinc-500 hover:bg-zinc-50">{a}</button>
          ))}
        </div>
      </div>
    );
  }

  if (platform === "twitter") {
    return (
      <div className="mx-auto max-w-[300px] bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden text-sm">
        <div className="flex gap-2.5 p-3">
          <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center text-white text-xs font-bold shrink-0">DP</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1 flex-wrap">
              <span className="font-bold text-xs">Doubtless Productions</span>
              <span className="text-[10px] text-zinc-400">@doubtlessHQ · now</span>
            </div>
            <p className="text-xs mt-1 leading-relaxed text-zinc-900 break-words">
              {copy || <span className="text-zinc-400 italic">Your tweet will appear here…</span>}
            </p>
            {hasImage && (
              <img src={mediaUrl} alt="post" className="w-full rounded-xl mt-2 object-cover" style={{ maxHeight: 140 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
            <div className="flex gap-4 mt-2 text-[11px] text-zinc-400">
              <span>💬 0</span><span>🔁 0</span><span>♥ 0</span><span>↗</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (platform === "slack") {
    return (
      <div className="mx-auto max-w-[300px] bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden text-sm">
        <div className="px-3 py-2 bg-zinc-800 text-zinc-300 text-xs font-semibold flex items-center gap-1.5">
          <SlackIcon className="h-3.5 w-3.5" />
          <span># general</span>
        </div>
        <div className="p-3 flex gap-2">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">DP</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-bold text-zinc-900">Doubtless Productions</span>
              <span className="text-[10px] text-zinc-400">just now</span>
            </div>
            <p className="text-xs mt-0.5 leading-relaxed text-zinc-700 whitespace-pre-wrap break-words">
              {copy || <span className="text-zinc-400 italic">Your message will appear here…</span>}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (platform === "linkedin") {
    return (
      <div className="mx-auto max-w-[300px] bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden text-sm">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="w-10 h-10 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold shrink-0">DP</div>
          <div className="flex-1">
            <p className="text-xs font-semibold leading-none">Doubtless Productions</p>
            <p className="text-[10px] text-zinc-400 mt-0.5">Music · Just now</p>
          </div>
        </div>
        <p className="px-3 pb-2.5 text-xs leading-relaxed break-words">
          {copy || <span className="text-zinc-400 italic">Your post will appear here…</span>}
        </p>
        {hasImage && (
          <img src={mediaUrl} alt="post" className="w-full object-cover" style={{ maxHeight: 160 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="border-t border-zinc-100 flex divide-x divide-zinc-100 mt-1">
          {["👍 Like", "💬 Comment", "🔁 Repost"].map((a) => (
            <button key={a} className="flex-1 py-1.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-50">{a}</button>
          ))}
        </div>
      </div>
    );
  }

  // Generic preview
  const cfg = PLATFORM_CONFIG[platform];
  return (
    <div className="mx-auto max-w-[300px] bg-white rounded-xl border border-zinc-200 shadow-sm p-6 text-center space-y-3">
      <div className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${cfg.color} border`}>
        {cfg.icon}
      </div>
      <p className="text-sm font-medium">{cfg.label}</p>
      {copy ? (
        <p className="text-xs text-zinc-600 leading-relaxed text-left break-words">{copy}</p>
      ) : (
        <p className="text-xs text-zinc-400 italic">Your content will appear here…</p>
      )}
      {hasImage && (
        <img src={mediaUrl} alt="post" className="w-full rounded-lg object-cover" style={{ maxHeight: 140 }} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ContentCalendar() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token } = useAuth();

  const [open,       setOpen]       = useState(false);
  const [editing,    setEditing]    = useState<ContentPost | null>(null);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);
  const [filter,     setFilter]     = useState<Platform | "all">("all");
  const [form,       setForm]       = useState(EMPTY);
  const [publishing, setPublishing] = useState<number | null>(null);
  const [dialogTab,  setDialogTab]  = useState<"form" | "preview">("form");

  const authH: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const queryParams = filter !== "all" ? { platform: filter } : {};
  const { data: posts = [] } = useListContentPosts(queryParams, {
    query: { queryKey: getListContentPostsQueryKey(queryParams), refetchInterval: 30000 },
  });

  const { data: connections = [] } = useGetMyConnections({
    query: { enabled: !!token, queryKey: getGetMyConnectionsQueryKey() },
  });

  // Build provider → { isWorkspace } map; includes both personal and workspace connections
  const connectionMap = new Map(
    connections.map((c) => [c.provider, { isWorkspace: !!(c as { isWorkspace?: boolean }).isWorkspace }])
  );
  const connectedProviders = new Set(connections.map((c) => c.provider));

  const createMut = useCreateContentPost();
  const updateMut = useUpdateContentPost();
  const deleteMut = useDeleteContentPost();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListContentPostsQueryKey({}) });
    PLATFORMS.forEach((p) => qc.invalidateQueries({ queryKey: getListContentPostsQueryKey({ platform: p }) }));
  };

  function openCreate() { setEditing(null); setForm(EMPTY); setDialogTab("form"); setOpen(true); }
  function openEdit(p: ContentPost) {
    setEditing(p);
    const dt = p.scheduledAt ? new Date(p.scheduledAt) : new Date();
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const mediaStr = Array.isArray(p.mediaUrls) ? (p.mediaUrls as string[]).join(", ") : "";
    setForm({ platform: p.platform as Platform, scheduledAt: local, copy: p.copy, mediaUrls: mediaStr, status: p.status as PostStatus });
    setDialogTab("form");
    setOpen(true);
  }

  function handleSave() {
    if (!form.scheduledAt) return;
    const mediaUrls = form.mediaUrls.split(",").map((s) => s.trim()).filter(Boolean);
    const data = {
      platform:    form.platform,
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      copy:        form.copy,
      mediaUrls,
      status:      (["failed", "posting"].includes(form.status) ? "draft" : form.status) as "draft" | "scheduled" | "posted" | "cancelled",
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Post updated" }); setOpen(false); invalidate(); },
        onError:   () => toast({ title: "Failed to update", variant: "destructive" }),
      });
    } else {
      createMut.mutate({ data }, {
        onSuccess: () => { toast({ title: "Post scheduled" }); setOpen(false); setForm(EMPTY); invalidate(); },
        onError:   () => toast({ title: "Failed to create", variant: "destructive" }),
      });
    }
  }

  function handleDelete(id: number) {
    deleteMut.mutate({ id }, {
      onSuccess: () => { toast({ title: "Deleted" }); setDeleteId(null); invalidate(); },
      onError:   () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  }

  async function handlePublish(post: ContentPost) {
    const provider = PLATFORM_CONFIG[post.platform as Platform]?.provider;
    if (provider && !connectedProviders.has(provider)) {
      toast({
        title: `${PLATFORM_CONFIG[post.platform as Platform].label} not connected`,
        description: "Go to Settings → Integrations to connect your account, or ask an admin to set up a company account.",
        variant: "destructive",
      });
      return;
    }
    setPublishing(post.id);
    try {
      const r = await fetch(`/api/content-posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH },
      });
      const data = await r.json() as { error?: string };
      if (r.ok) {
        toast({ title: "Published!", description: `Post sent to ${PLATFORM_CONFIG[post.platform as Platform].label}.` });
        invalidate();
      } else {
        toast({ title: "Publish failed", description: data.error, variant: "destructive" });
        invalidate();
      }
    } catch {
      toast({ title: "Publish failed", description: "Network error — please try again.", variant: "destructive" });
    } finally {
      setPublishing(null);
    }
  }

  const grouped = posts.reduce<Record<string, ContentPost[]>>((acc, p) => {
    const d = p.scheduledAt ? new Date(p.scheduledAt).toDateString() : "Unknown";
    (acc[d] ??= []).push(p);
    return acc;
  }, {});

  const publishablePlatformStatus = PUBLISHABLE_PLATFORMS.map((p) => {
    const conn = connectionMap.get(PLATFORM_CONFIG[p].provider!);
    return { platform: p, connected: !!conn, isWorkspace: conn?.isWorkspace ?? false };
  });

  const firstMediaUrl = form.mediaUrls.split(",")[0]?.trim();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays className="h-6 w-6 text-pink-600" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Content Calendar</h1>
            <p className="text-sm text-muted-foreground">Schedule and auto-publish social posts across all platforms</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Schedule Post</Button>
      </div>

      {/* Auto-publish connection status bar */}
      <div className="flex flex-wrap gap-2 p-3 bg-zinc-50 rounded-lg border border-zinc-200">
        <span className="text-xs text-muted-foreground self-center mr-1 font-medium">Auto-publish:</span>
        {publishablePlatformStatus.map(({ platform, connected, isWorkspace }) => (
          <span
            key={platform}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border",
              connected ? "bg-green-50 text-green-700 border-green-200" : "bg-zinc-100 text-zinc-400 border-zinc-200"
            )}
          >
            {PLATFORM_CONFIG[platform].badgeIcon}
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {PLATFORM_CONFIG[platform].label}
            {connected && isWorkspace && (
              <Badge className="bg-green-100 text-green-700 border border-green-300 text-[9px] px-1 py-0 h-4 ml-0.5 hover:bg-green-100">Shared</Badge>
            )}
            {!connected && <span className="text-[10px]">— not connected</span>}
          </span>
        ))}
        <a href="/settings?tab=integrations" className="ml-auto">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground">
            <ExternalLink className="h-3 w-3" /> Manage connections
          </Button>
        </a>
      </div>

      {/* Platform filter */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium border ${filter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-white border-zinc-200 hover:border-zinc-400"}`}>
          All Platforms
        </button>
        {PLATFORMS.map((p) => {
          const cfg = PLATFORM_CONFIG[p];
          return (
            <button key={p} onClick={() => setFilter(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-opacity inline-flex items-center gap-1.5 ${cfg.color} ${filter === p ? "opacity-100 ring-2 ring-offset-1 ring-current" : "opacity-70 hover:opacity-100"}`}>
              {cfg.badgeIcon}{cfg.label}
            </button>
          );
        })}
      </div>

      {posts.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <CalendarDays className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground">No posts scheduled yet.</p>
            <Button className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Schedule your first post</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([date, datePosts]) => (
            <div key={date}>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">{date}</h2>
              <div className="space-y-2">
                {datePosts.map((p) => {
                  const postAny = p as ContentPost & { publishError?: string };
                  const rawStatus: string = p.status;
                  const statusCfg = STATUS_CONFIG[rawStatus as PostStatus] ?? STATUS_CONFIG.draft;
                  const platformCfg = PLATFORM_CONFIG[p.platform as Platform];
                  const provider = platformCfg?.provider;
                  const conn = provider ? connectionMap.get(provider) : null;
                  const isConnected = !provider || !!conn;
                  const canPublish = PUBLISHABLE_PLATFORMS.includes(p.platform as Platform) && rawStatus !== "posted" && rawStatus !== "posting";
                  const isPublishing = publishing === p.id;
                  const error = postAny.publishError;

                  return (
                    <Card key={p.id} className={cn("hover:shadow-sm transition-shadow", rawStatus === "failed" && "border-red-200")}>
                      <CardContent className="py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex flex-wrap gap-2 items-center">
                            <PlatformBadge platform={p.platform as Platform} />
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>{statusCfg.label}</span>
                            <span className="text-xs text-muted-foreground">{formatDate(p.scheduledAt)}</span>
                            {provider && (
                              <span className={cn("text-[10px] flex items-center gap-0.5", isConnected ? "text-green-600" : "text-amber-600")}>
                                {isConnected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                                {isConnected
                                  ? (conn?.isWorkspace ? "Shared account" : "Connected")
                                  : "Not connected"}
                              </span>
                            )}
                          </div>
                          {p.copy && <p className="text-sm line-clamp-2">{p.copy}</p>}
                          {error && (
                            <div className="flex items-start gap-1.5 p-2 bg-red-50 border border-red-100 rounded text-xs text-red-700">
                              <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                              <span>{error}</span>
                            </div>
                          )}
                          {p.status === "posted" && p.postedAt && (
                            <div className="flex items-center gap-1.5 text-xs text-green-600">
                              <CheckCircle2 className="h-3 w-3" />
                              Published {formatDate(new Date(p.postedAt).toISOString())}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0 items-start">
                          {canPublish && (
                            <Button
                              size="sm"
                              variant={isConnected ? "default" : "outline"}
                              className={cn("h-7 text-xs gap-1", !isConnected && "text-amber-600 border-amber-200 hover:bg-amber-50")}
                              onClick={() => handlePublish(p)}
                              disabled={isPublishing}
                              title={isConnected ? `Publish now to ${platformCfg.label}` : `Connect ${platformCfg.label} in Settings first`}
                            >
                              {isPublishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              {isPublishing ? "" : "Post"}
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Schedule / Edit dialog with Preview tab */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Post" : "Schedule Post"}</DialogTitle>
          </DialogHeader>

          <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as "form" | "preview")}>
            <TabsList className="w-full mb-4">
              <TabsTrigger value="form" className="flex-1">Edit</TabsTrigger>
              <TabsTrigger value="preview" className="flex-1 gap-1.5">
                <Eye className="h-3.5 w-3.5" />Preview
              </TabsTrigger>
            </TabsList>

            <TabsContent value="form" className="space-y-4 mt-0">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Platform *</Label>
                  <Select value={form.platform} onValueChange={(v) => setForm((f) => ({ ...f, platform: v as Platform }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PLATFORMS.map((p) => {
                        const cfg = PLATFORM_CONFIG[p];
                        const provider = cfg.provider;
                        const conn = provider ? connectionMap.get(provider) : null;
                        const isConn = !provider || !!conn;
                        return (
                          <SelectItem key={p} value={p}>
                            <span className="flex items-center gap-2">
                              {cfg.label}
                              {provider && (
                                <span className={cn("text-[10px]", isConn ? "text-green-600" : "text-zinc-400")}>
                                  {isConn ? (conn?.isWorkspace ? "✓ shared" : "✓ connected") : "not connected"}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {(() => {
                    const provider = PLATFORM_CONFIG[form.platform]?.provider;
                    const conn = provider ? connectionMap.get(provider) : null;
                    const isConn = !provider || !!conn;
                    if (provider && !isConn && PUBLISHABLE_PLATFORMS.includes(form.platform)) {
                      return (
                        <p className="text-[10px] text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Not connected — <a href="/settings?tab=integrations" className="underline">connect in Settings</a>
                        </p>
                      );
                    }
                    if (!PUBLISHABLE_PLATFORMS.includes(form.platform)) {
                      return <p className="text-[10px] text-muted-foreground">Manual scheduling only for this platform.</p>;
                    }
                    return null;
                  })()}
                </div>
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as PostStatus }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Scheduled At *</Label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} />
                {form.status === "scheduled" && PUBLISHABLE_PLATFORMS.includes(form.platform) && (() => {
                  const provider = PLATFORM_CONFIG[form.platform]?.provider;
                  const isConn = !provider || connectedProviders.has(provider);
                  return isConn ? (
                    <p className="text-[10px] text-green-600">This post will be auto-published at the scheduled time.</p>
                  ) : null;
                })()}
              </div>
              <div className="space-y-1">
                <Label>Copy / Caption</Label>
                <Textarea value={form.copy} onChange={(e) => setForm((f) => ({ ...f, copy: e.target.value }))} rows={4} placeholder="Write your post copy here…" />
              </div>
              <div className="space-y-1">
                <Label>Media URLs <span className="text-muted-foreground font-normal text-xs">(comma-separated, required for Instagram)</span></Label>
                <Input
                  value={form.mediaUrls}
                  onChange={(e) => setForm((f) => ({ ...f, mediaUrls: e.target.value }))}
                  placeholder="https://example.com/image.jpg"
                />
              </div>
            </TabsContent>

            <TabsContent value="preview" className="mt-0">
              <div className="py-2">
                <p className="text-xs text-muted-foreground text-center mb-4">Live preview — updates as you type on the Edit tab</p>
                <PostPreview platform={form.platform} copy={form.copy} mediaUrl={firstMediaUrl} />
              </div>
            </TabsContent>
          </Tabs>

          {dialogTab === "form" && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !form.scheduledAt}>
                {(createMut.isPending || updateMut.isPending) ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {editing ? "Save" : "Schedule"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete post?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && handleDelete(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
