import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Mail, Search, RefreshCw, Plug2, Inbox, Paperclip, ChevronDown, ChevronLeft,
  Reply, Trash2, Link2, PenSquare, Loader2, Send, X, CheckCircle2,
  User, Music, Disc, FileText, MessageSquare, TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

// ── Types ─────────────────────────────────────────────────────────────────────

interface OutlookMessage {
  id: string;
  subject: string | null;
  from: { emailAddress: { name: string; address: string } } | null;
  toRecipients?: { emailAddress: { name: string; address: string } }[];
  ccRecipients?: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  bodyPreview: string;
  hasAttachments: boolean;
  body?: { contentType: string; content: string };
}

interface InboxResponse  { messages: OutlookMessage[]; hasMore: boolean; skip: number; top: number; }
interface StatusResponse { connected: boolean; email: string | null; }

export interface EmailLink {
  id: number;
  userId: number;
  messageId: string;
  messageSubject: string | null;
  messageSenderName: string | null;
  messageSenderEmail: string | null;
  messageDate: string | null;
  entityType: string;
  entityId: number;
  linkedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = (Date.now() - d.getTime()) / 86_400_000;
  if (diffDays < 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function senderLabel(msg: OutlookMessage): string {
  const ea = msg.from?.emailAddress;
  return ea?.name && ea.name !== ea.address ? ea.name : (ea?.address ?? "Unknown");
}

const ENTITY_TABS = [
  { id: "contact", label: "Contacts", Icon: User },
  { id: "artist",  label: "Artists",  Icon: Music },
  { id: "release", label: "Releases", Icon: Disc },
  { id: "deal",    label: "Deals",    Icon: TrendingUp },
  { id: "invoice", label: "Invoices", Icon: FileText },
  { id: "thread",  label: "Threads",  Icon: MessageSquare },
];

const ENTITY_ENDPOINTS: Record<string, string> = {
  contact: "/api/contacts",
  artist:  "/api/artists",
  release: "/api/releases",
  deal:    "/api/deals",
  invoice: "/api/invoices",
  thread:  "/api/messages/threads",
};

function entityLabel(type: string, item: Record<string, unknown>): string {
  switch (type) {
    case "contact": return String(item["name"] || item["email"] || `Contact ${item["id"]}`);
    case "artist":  return String(item["name"] || `Artist ${item["id"]}`);
    case "release": return String(item["title"] || `Release ${item["id"]}`);
    case "deal":    return String(item["title"] || `Deal ${item["id"]}`);
    case "invoice": return item["invoiceNumber"] ? `Invoice #${item["invoiceNumber"]}` : `Invoice ${item["id"]}`;
    case "thread":  return String(item["title"] || `Thread ${item["id"]}`);
    default:        return `Item ${item["id"]}`;
  }
}

function entitySubLabel(type: string, item: Record<string, unknown>): string {
  switch (type) {
    case "contact": return String(item["email"] || item["company"] || "");
    case "artist":  return String(item["genre"] || item["email"] || "");
    case "release": return String(item["artistName"] || item["releaseDate"] || "");
    case "deal":    return String(item["stage"] ? `Stage: ${item["stage"]}` : item["value"] ? `$${item["value"]}` : "");
    case "invoice": return String(item["status"] || (item["total"] ? `$${item["total"]}` : ""));
    case "thread":  return "";
    default:        return "";
  }
}

function normaliseEntityList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["contacts", "artists", "releases", "deals", "invoices", "threads", "items", "data"]) {
      if (Array.isArray(d[key])) return d[key] as Record<string, unknown>[];
    }
  }
  return [];
}

// ── Not-connected / reconnect banners ─────────────────────────────────────────

function NotConnectedBanner({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-72 text-center gap-2">
      <Mail className="h-12 w-12 text-[#0078d4]/30 mb-2" />
      <p className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">Outlook not connected</p>
      <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs mx-auto">
        Connect your Microsoft / Outlook account to browse your inbox, send emails, and link them to CRM records.
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onConnect}>
          <Plug2 className="h-3.5 w-3.5 mr-1.5" />Connect Outlook
        </Button>
        <a href="/settings?tab=integrations">
          <Button size="sm" variant="outline">Go to Settings</Button>
        </a>
      </div>
    </div>
  );
}

function NeedsReconnectBanner({ onConnect, message }: { onConnect: () => void; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-72 text-center gap-2">
      <Mail className="h-12 w-12 text-amber-400/60 mb-2" />
      <p className="font-semibold text-sm text-zinc-800 dark:text-zinc-200">Reconnect required</p>
      <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-sm mx-auto">
        {message ?? "Your Outlook connection needs updated permissions. Please reconnect."}
      </p>
      <Button size="sm" onClick={onConnect}>
        <Plug2 className="h-3.5 w-3.5 mr-1.5" />Reconnect Outlook
      </Button>
    </div>
  );
}

// ── Message row ───────────────────────────────────────────────────────────────

function MessageRow({ msg, isSelected, onClick }: {
  msg: OutlookMessage; isSelected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border/50 hover:bg-muted/60 transition-colors",
        isSelected && "bg-muted",
        !msg.isRead && "bg-blue-50/60 dark:bg-blue-950/20",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {!msg.isRead
            ? <span className="block w-2 h-2 rounded-full bg-blue-500 mt-1" />
            : <span className="block w-2 h-2" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className={cn("text-sm truncate", !msg.isRead ? "font-semibold" : "font-medium")}>
              {senderLabel(msg)}
            </span>
            <span className="text-[11px] text-muted-foreground shrink-0">{formatDate(msg.receivedDateTime)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <p className={cn("text-xs truncate", !msg.isRead ? "font-medium text-foreground" : "text-muted-foreground")}>
              {msg.subject || "(no subject)"}
            </p>
            {msg.hasAttachments && <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.bodyPreview}</p>
        </div>
      </div>
    </button>
  );
}

// ── Compose dialog ────────────────────────────────────────────────────────────

function ComposeDialog({ open, onClose, token }: {
  open: boolean; onClose: () => void; token: string | null;
}) {
  const [to, setTo]           = useState("");
  const [cc, setCc]           = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody]       = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  const reset = () => { setTo(""); setCc(""); setSubject(""); setBody(""); };

  const send = async () => {
    if (!to.trim() || !subject.trim()) return;
    setSending(true);
    try {
      const r = await fetch("/api/outlook/send", {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body, cc: cc.trim() }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast({ title: d.message || "Failed to send email", variant: "destructive" });
      } else {
        toast({ title: "Email sent" });
        reset(); onClose();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenSquare className="h-4 w-4 text-[#0078d4]" /> New Email
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="recipient@example.com" autoFocus />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">CC (optional)</Label>
            <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Message</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} placeholder="Write your message…" className="resize-none text-sm" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={send} disabled={sending || !to.trim() || !subject.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Reply dialog ──────────────────────────────────────────────────────────────

function ReplyDialog({ msg, open, onClose, token }: {
  msg: OutlookMessage | null; open: boolean; onClose: () => void; token: string | null;
}) {
  const [body, setBody]       = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  useEffect(() => { if (!open) setBody(""); }, [open]);

  const send = async () => {
    if (!msg || !body.trim()) return;
    setSending(true);
    try {
      const r = await fetch(`/api/outlook/messages/${msg.id}/reply`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ comment: body }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast({ title: d.message || "Failed to send reply", variant: "destructive" });
      } else {
        toast({ title: "Reply sent" });
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  if (!msg) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Reply className="h-4 w-4 text-[#0078d4]" /> Reply to {senderLabel(msg)}
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">Re: {msg.subject || "(no subject)"}</p>
        </DialogHeader>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          placeholder="Write your reply…"
          className="resize-none text-sm"
          autoFocus
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={sending || !body.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Reply className="h-4 w-4 mr-1.5" />}
            Send Reply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Link dialog ───────────────────────────────────────────────────────────────

function LinkDialog({ msg, open, onClose, token, existingLinks, onLinked, onUnlinked }: {
  msg: OutlookMessage | null;
  open: boolean;
  onClose: () => void;
  token: string | null;
  existingLinks: EmailLink[];
  onLinked: (link: EmailLink) => void;
  onUnlinked: (linkId: number) => void;
}) {
  const [activeTab, setActiveTab] = useState("contact");
  const [search, setSearch]       = useState("");
  const [items, setItems]         = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading]     = useState(false);
  const [linking, setLinking]     = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    const endpoint = ENTITY_ENDPOINTS[activeTab];
    if (!endpoint) return;
    setLoading(true);
    setItems([]);
    fetch(endpoint, { headers: authHeaders(token) })
      .then((r) => r.json())
      .then((data) => setItems(normaliseEntityList(data)))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [activeTab, open, token]);

  useEffect(() => { if (!open) setSearch(""); }, [open]);

  const isLinked = (entityId: number) =>
    existingLinks.some((l) => l.entityType === activeTab && l.entityId === entityId);

  const getExistingLink = (entityId: number) =>
    existingLinks.find((l) => l.entityType === activeTab && l.entityId === entityId);

  const handleLink = async (entityId: number) => {
    if (!msg) return;
    setLinking(entityId);
    try {
      const r = await fetch(`/api/outlook/messages/${msg.id}/link`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType:         activeTab,
          entityId,
          messageSubject:     msg.subject,
          messageSenderName:  msg.from?.emailAddress.name,
          messageSenderEmail: msg.from?.emailAddress.address,
          messageDate:        msg.receivedDateTime,
        }),
      });
      if (r.ok) {
        const link = await r.json() as EmailLink;
        onLinked(link);
        const label = entityLabel(activeTab, items.find((i) => i["id"] === entityId) ?? {});
        toast({ title: `Linked to ${label}` });
      } else {
        toast({ title: "Failed to link email", variant: "destructive" });
      }
    } finally {
      setLinking(null);
    }
  };

  const handleUnlink = async (entityId: number) => {
    const l = getExistingLink(entityId);
    if (!l) return;
    setLinking(entityId);
    try {
      await fetch(`/api/outlook/links/${l.id}`, { method: "DELETE", headers: authHeaders(token) });
      onUnlinked(l.id);
    } finally {
      setLinking(null);
    }
  };

  const filtered = items.filter((item) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      entityLabel(activeTab, item).toLowerCase().includes(s) ||
      entitySubLabel(activeTab, item).toLowerCase().includes(s)
    );
  });

  if (!msg) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg flex flex-col max-h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-[#0078d4]" /> Link to CRM
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{msg.subject || "(no subject)"}</p>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSearch(""); }} className="flex flex-col flex-1 min-h-0">
          <TabsList className="w-full grid grid-cols-6 shrink-0">
            {ENTITY_TABS.map(({ id, label, Icon }) => (
              <TabsTrigger key={id} value={id} className="text-xs px-1 gap-0.5">
                <Icon className="h-3 w-3 shrink-0" />
                <span className="hidden sm:inline truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="relative mt-3 shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${ENTITY_TABS.find((t) => t.id === activeTab)?.label ?? ""}…`}
              className="pl-8 h-9 text-sm"
            />
          </div>

          <div className="flex-1 overflow-y-auto mt-2 min-h-0">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-10">
                {search ? "No matches found" : "Nothing here yet"}
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((item) => {
                  const id     = item["id"] as number;
                  const linked = isLinked(id);
                  return (
                    <button
                      key={id}
                      onClick={() => linked ? handleUnlink(id) : handleLink(id)}
                      disabled={linking === id}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors",
                        linked
                          ? "bg-blue-50 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/30 dark:border-blue-800"
                          : "bg-background hover:bg-muted/60 border-border",
                      )}
                    >
                      <div className="text-left min-w-0 flex-1">
                        <p className="font-medium truncate">{entityLabel(activeTab, item)}</p>
                        {entitySubLabel(activeTab, item) && (
                          <p className="text-xs text-muted-foreground truncate">{entitySubLabel(activeTab, item)}</p>
                        )}
                      </div>
                      <div className="shrink-0 ml-2">
                        {linking === id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                        ) : linked ? (
                          <CheckCircle2 className="h-4 w-4 text-blue-500" />
                        ) : (
                          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Linked entities strip (shown in message detail) ───────────────────────────

const ENTITY_TYPE_COLORS: Record<string, string> = {
  contact: "bg-sky-50   border-sky-200   text-sky-700",
  artist:  "bg-violet-50 border-violet-200 text-violet-700",
  release: "bg-amber-50  border-amber-200  text-amber-700",
  deal:    "bg-green-50  border-green-200  text-green-700",
  invoice: "bg-orange-50 border-orange-200 text-orange-700",
  thread:  "bg-pink-50   border-pink-200   text-pink-700",
};

function LinkedEntityBadges({ links, onUnlink }: {
  links: EmailLink[];
  onUnlink: (linkId: number) => void;
}) {
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-5 py-3 border-t border-border/50 bg-muted/30">
      {links.map((l) => (
        <span
          key={l.id}
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border",
            ENTITY_TYPE_COLORS[l.entityType] ?? "bg-zinc-50 border-zinc-200 text-zinc-600",
          )}
        >
          <span className="capitalize">{l.entityType}</span>
          <span className="opacity-60">·</span>
          <span className="truncate max-w-[120px]">#{l.entityId}</span>
          <button
            onClick={() => onUnlink(l.id)}
            className="ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
            aria-label="Unlink"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
    </div>
  );
}

// ── Message detail ─────────────────────────────────────────────────────────────

function MessageDetail({ msg, fullBody, bodyLoading, links, onReply, onDelete, onLink, onUnlink }: {
  msg: OutlookMessage;
  fullBody: string | null;
  bodyLoading: boolean;
  links: EmailLink[];
  onReply: () => void;
  onDelete: () => void;
  onLink: () => void;
  onUnlink: (linkId: number) => void;
}) {
  const ea = msg.from?.emailAddress;
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/50 shrink-0">
        <h2 className="text-base font-semibold mb-2 leading-snug">{msg.subject || "(no subject)"}</h2>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{ea?.name || ea?.address || "Unknown"}</span>
            {ea?.name && ea.name !== ea.address && <span className="ml-1">&lt;{ea.address}&gt;</span>}
          </span>
          <span>·</span>
          <span>{new Date(msg.receivedDateTime).toLocaleString()}</span>
          {msg.hasAttachments && (
            <><span>·</span><span className="flex items-center gap-1"><Paperclip className="h-3 w-3" />Has attachments</span></>
          )}
          {!msg.isRead && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Unread</Badge>}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 mt-3">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onReply}>
            <Reply className="h-3.5 w-3.5" />Reply
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onLink}>
            <Link2 className="h-3.5 w-3.5" />Link to…
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-7 text-xs gap-1 text-red-500 hover:text-red-600 hover:border-red-300 hover:bg-red-50 ml-auto"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />Delete
          </Button>
        </div>
      </div>

      {/* Linked-entity badges strip */}
      {links.length > 0 && <LinkedEntityBadges links={links} onUnlink={onUnlink} />}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {bodyLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : fullBody ? (
          fullBody.toLowerCase().includes("<html") || fullBody.includes("<br") || fullBody.includes("<div") ? (
            <iframe
              srcDoc={fullBody}
              sandbox="allow-same-origin"
              className="w-full min-h-[400px] h-full border-0"
              title="Email body"
            />
          ) : (
            <div className="p-5 text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">{fullBody}</div>
          )
        ) : (
          <div className="p-5">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">{msg.bodyPreview}</p>
            <p className="text-xs text-muted-foreground mt-4 italic opacity-70">
              Full message body limited to the first 255 characters from Microsoft Graph.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutlookPage() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchInput, setSearchInput]   = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [allMessages, setAllMessages]   = useState<OutlookMessage[]>([]);
  const [skip, setSkip]                 = useState(0);
  const [hasMore, setHasMore]           = useState(false);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [selected, setSelected]         = useState<OutlookMessage | null>(null);
  const [scopeError, setScopeError]     = useState(false);
  const [tokenExpired, setTokenExpired] = useState(false);

  // Full body + links for selected message
  const [fullBody, setFullBody]         = useState<string | null>(null);
  const [bodyLoading, setBodyLoading]   = useState(false);
  const [msgLinks, setMsgLinks]         = useState<EmailLink[]>([]);

  // Dialog state
  const [composeOpen, setComposeOpen]   = useState(false);
  const [replyOpen, setReplyOpen]       = useState(false);
  const [linkOpen, setLinkOpen]         = useState(false);
  const [deleteOpen, setDeleteOpen]     = useState(false);
  const [deleting, setDeleting]         = useState(false);

  const connectListenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  // ── Status query ─────────────────────────────────────────────────────────────
  const { data: status, isLoading: statusLoading } = useQuery<StatusResponse>({
    queryKey: ["outlook", "status"],
    queryFn: () => fetch("/api/outlook/status", { headers: authHeaders(token) }).then((r) => r.json()),
    enabled: !!token,
    staleTime: 30_000,
  });

  // ── Inbox query ──────────────────────────────────────────────────────────────
  const { data: inboxData, isLoading: inboxLoading, isFetching, refetch } = useQuery<InboxResponse>({
    queryKey: ["outlook", "inbox", activeSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ skip: "0", top: String(PAGE_SIZE) });
      if (activeSearch) params.set("search", activeSearch);
      const r = await fetch(`/api/outlook/inbox?${params}`, { headers: authHeaders(token) });
      if (r.status === 401) {
        const body = await r.json().catch(() => ({}));
        if (body.needsReconnect) { setTokenExpired(true); setScopeError(false); return { messages: [], hasMore: false, skip: 0, top: PAGE_SIZE }; }
      }
      if (r.status === 403) {
        const body = await r.json().catch(() => ({}));
        if (body.error === "insufficient_scope" || body.error === "not_connected") {
          setScopeError(true); setTokenExpired(false); return { messages: [], hasMore: false, skip: 0, top: PAGE_SIZE };
        }
      }
      setScopeError(false); setTokenExpired(false);
      if (!r.ok) throw new Error("Failed to fetch inbox");
      return r.json();
    },
    enabled: !!token && !!status?.connected,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (inboxData) {
      setAllMessages(inboxData.messages);
      setSkip(inboxData.messages.length);
      setHasMore(inboxData.hasMore);
      setSelected(null);
    }
  }, [inboxData]);

  useEffect(() => { setAllMessages([]); setSkip(0); setHasMore(false); setSelected(null); }, [activeSearch]);

  // Fetch full body + message links when a message is selected
  useEffect(() => {
    if (!selected || !token) { setFullBody(null); setMsgLinks([]); return; }
    setBodyLoading(true);
    setFullBody(null);
    setMsgLinks([]);

    const bodyPromise = fetch(`/api/outlook/messages/${selected.id}`, { headers: authHeaders(token) })
      .then((r) => r.ok ? r.json() : null)
      .then((data: OutlookMessage | null) => {
        if (data?.body?.content) setFullBody(data.body.content);
      })
      .catch(() => {})
      .finally(() => setBodyLoading(false));

    const linksPromise = fetch(`/api/outlook/messages/${selected.id}/links`, { headers: authHeaders(token) })
      .then((r) => r.ok ? r.json() : [])
      .then((data: EmailLink[]) => setMsgLinks(Array.isArray(data) ? data : []))
      .catch(() => {});

    void bodyPromise;
    void linksPromise;
  }, [selected?.id, token]);

  // ── Load more ────────────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ skip: String(skip), top: String(PAGE_SIZE) });
      if (activeSearch) params.set("search", activeSearch);
      const r = await fetch(`/api/outlook/inbox?${params}`, { headers: authHeaders(token) });
      if (!r.ok) return;
      const data = await r.json() as InboxResponse;
      setAllMessages((prev) => [...prev, ...data.messages]);
      setSkip((s) => s + data.messages.length);
      setHasMore(data.hasMore);
    } finally { setLoadingMore(false); }
  }, [loadingMore, hasMore, skip, activeSearch, token]);

  // ── Connect popup ─────────────────────────────────────────────────────────────
  const openConnectPopup = useCallback(async () => {
    const r = await fetch("/api/auth/microsoft/url", { headers: authHeaders(token) });
    if (!r.ok) return;
    const { url } = await r.json() as { url: string };
    const popup = window.open(url, "microsoft-oauth", "width=520,height=640,scrollbars=yes,noreferrer");
    if (connectListenerRef.current) window.removeEventListener("message", connectListenerRef.current);
    const handler = (e: MessageEvent) => {
      const d = e.data as { type?: string; success?: boolean } | undefined;
      if (d?.type !== "microsoft-oauth") return;
      window.removeEventListener("message", handler);
      connectListenerRef.current = null;
      if (d.success) {
        setTokenExpired(false); setScopeError(false);
        queryClient.invalidateQueries({ queryKey: ["outlook"] });
        queryClient.invalidateQueries({ queryKey: ["outlook-unread"] });
      }
    };
    connectListenerRef.current = handler;
    window.addEventListener("message", handler);
    const timer = setInterval(() => {
      if (popup?.closed) { clearInterval(timer); queryClient.invalidateQueries({ queryKey: ["outlook"] }); }
    }, 800);
  }, [token, queryClient]);

  // ── Delete message ────────────────────────────────────────────────────────────
  const doDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/outlook/messages/${selected.id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      });
      if (r.ok) {
        setAllMessages((prev) => prev.filter((m) => m.id !== selected.id));
        setSelected(null);
        setDeleteOpen(false);
        toast({ title: "Email deleted (moved to Deleted Items)" });
        queryClient.invalidateQueries({ queryKey: ["outlook-unread"] });
      } else {
        const d = await r.json().catch(() => ({}));
        toast({ title: d.message || "Failed to delete email", variant: "destructive" });
      }
    } finally { setDeleting(false); }
  };

  // ── Search ────────────────────────────────────────────────────────────────────
  function handleSearch(e: React.FormEvent) { e.preventDefault(); setActiveSearch(searchInput.trim()); }
  function clearSearch() { setSearchInput(""); setActiveSearch(""); }

  // ── Render ────────────────────────────────────────────────────────────────────
  const isConnected    = status?.connected ?? false;
  const connectedEmail = status?.email ?? "";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <Mail className="h-5 w-5 text-[#0078d4]" />
          <h1 className="text-lg font-semibold">Outlook Inbox</h1>
          {isConnected && connectedEmail && (
            <span className="text-xs text-muted-foreground">{connectedEmail}</span>
          )}
        </div>
        {isConnected && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" className="h-8 gap-1.5 bg-[#0078d4] hover:bg-[#106ebe]" onClick={() => setComposeOpen(true)}>
              <PenSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Compose</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["outlook-unread"] }); }} disabled={isFetching}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", isFetching && "animate-spin")} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        )}
      </div>

      {/* Body */}
      {statusLoading ? (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading…</div>
      ) : !isConnected ? (
        <NotConnectedBanner onConnect={openConnectPopup} />
      ) : tokenExpired ? (
        <NeedsReconnectBanner onConnect={openConnectPopup} message="Your Outlook session has expired. Please reconnect to restore inbox access." />
      ) : scopeError ? (
        <NeedsReconnectBanner onConnect={openConnectPopup} message="Your Outlook connection needs updated permissions (Mail.ReadWrite). Please reconnect in Settings." />
      ) : (
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Left pane: search + list */}
          <div className={cn("flex flex-col shrink-0 border-r border-border/50 overflow-hidden w-full md:w-80", selected ? "hidden md:flex" : "flex")}>
            <form onSubmit={handleSearch} className="flex gap-1.5 p-3 border-b border-border/50 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search inbox…" className="pl-8 h-8 text-sm" />
              </div>
              <Button type="submit" size="sm" className="h-8 px-2.5"><Search className="h-3.5 w-3.5" /></Button>
              {activeSearch && (
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={clearSearch}>✕</Button>
              )}
            </form>

            {activeSearch && (
              <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/40 border-b border-border/30 shrink-0">
                Results for &ldquo;<strong>{activeSearch}</strong>&rdquo;
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {inboxLoading ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading inbox…</div>
              ) : allMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2">
                  <Inbox className="h-8 w-8 opacity-30" />
                  <span>{activeSearch ? "No messages found" : "Your inbox is empty"}</span>
                </div>
              ) : (
                <>
                  {allMessages.map((msg) => (
                    <MessageRow key={msg.id} msg={msg} isSelected={selected?.id === msg.id} onClick={() => setSelected(msg)} />
                  ))}
                  {hasMore && (
                    <div className="p-3 flex justify-center border-t border-border/30">
                      <Button size="sm" variant="outline" onClick={loadMore} disabled={loadingMore} className="w-full">
                        {loadingMore ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5 mr-1.5" />}
                        {loadingMore ? "Loading…" : "Load more messages"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right pane */}
          <div className={cn("flex-1 overflow-hidden bg-background flex flex-col", !selected && "hidden md:flex")}>
            {selected ? (
              <>
                <div className="h-12 flex items-center gap-2 px-4 border-b border-border/50 shrink-0 md:hidden bg-background">
                  <button onClick={() => setSelected(null)} className="p-1.5 rounded hover:bg-muted text-muted-foreground" aria-label="Back to inbox">
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <span className="text-sm font-medium truncate">{selected.subject ?? "(no subject)"}</span>
                </div>
                <div className="flex-1 overflow-hidden">
                  <MessageDetail
                    msg={selected}
                    fullBody={fullBody}
                    bodyLoading={bodyLoading}
                    links={msgLinks}
                    onReply={() => setReplyOpen(true)}
                    onDelete={() => setDeleteOpen(true)}
                    onLink={() => setLinkOpen(true)}
                    onUnlink={(linkId) => {
                      fetch(`/api/outlook/links/${linkId}`, { method: "DELETE", headers: authHeaders(token) })
                        .then(() => setMsgLinks((prev) => prev.filter((l) => l.id !== linkId)))
                        .catch(() => {});
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="hidden md:flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <Mail className="h-10 w-10 opacity-20" />
                <p className="text-sm">Select a message to preview</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Compose dialog */}
      <ComposeDialog open={composeOpen} onClose={() => setComposeOpen(false)} token={token} />

      {/* Reply dialog */}
      <ReplyDialog msg={selected} open={replyOpen} onClose={() => setReplyOpen(false)} token={token} />

      {/* Link dialog */}
      <LinkDialog
        msg={selected}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        token={token}
        existingLinks={msgLinks}
        onLinked={(link) => setMsgLinks((prev) => [...prev.filter((l) => l.id !== link.id), link])}
        onUnlinked={(linkId) => setMsgLinks((prev) => prev.filter((l) => l.id !== linkId))}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this email?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the email to your Deleted Items folder in Outlook.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
