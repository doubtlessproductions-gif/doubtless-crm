import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, addDays, parseISO, isBefore, startOfDay, parseISO as parseDateFns } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageUploadButton, AudioUploadButton } from "@/components/image-upload-button";
import {
  Disc, Plus, Mail, Video, Lock, Globe, Trash2,
  CheckCircle2, XCircle, Loader2, Zap, Clock, RefreshCw, Music,
  Upload, FolderOpen, Folder, FileMusic, ChevronRight, ChevronDown, ChevronLeft, List,
  AlertCircle, X, Search, Phone, User, ExternalLink,
  MessageSquare, Film, TrendingUp, BarChart2, Headphones, Youtube, Eye, ThumbsUp,
  Users, Star, AlertTriangle,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

// ── Linked Outlook Emails Panel ───────────────────────────────────────────────

interface EmailLinkRecord {
  id: number;
  messageSubject: string | null;
  messageSenderName: string | null;
  messageSenderEmail: string | null;
  messageDate: string | null;
}

function LinkedEmailsPanel({ entityType, entityId, authToken }: {
  entityType: string; entityId: number; authToken: string | null;
}) {
  const [removing, setRemoving] = useState<number | null>(null);
  const { data: links = [], isLoading, refetch } = useQuery<EmailLinkRecord[]>({
    queryKey: ["outlook-links", entityType, entityId],
    queryFn: () =>
      fetch(`/api/outlook/linked/${entityType}/${entityId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      }).then((r) => (r.ok ? r.json() : [])),
    enabled: !!authToken,
    staleTime: 30_000,
  });

  const unlink = async (linkId: number) => {
    setRemoving(linkId);
    await fetch(`/api/outlook/links/${linkId}`, {
      method: "DELETE",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    }).catch(() => {});
    void refetch();
    setRemoving(null);
  };

  if (isLoading) return <p className="text-xs text-zinc-400 py-2">Loading linked emails…</p>;
  if (!links.length)
    return (
      <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center">
        <p className="text-xs text-zinc-400">
          No Outlook emails linked. Select an email in Outlook and use &ldquo;Link to…&rdquo;.
        </p>
      </div>
    );

  return (
    <div className="space-y-1.5">
      {links.map((link) => (
        <div key={link.id} className="flex items-start gap-2.5 p-3 rounded-xl border border-blue-100 bg-blue-50/40 text-sm">
          <Mail className="h-3.5 w-3.5 text-[#0078d4] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-zinc-800 truncate">{link.messageSubject ?? "(no subject)"}</p>
            <p className="text-xs text-zinc-500">
              {link.messageSenderName || link.messageSenderEmail || "Unknown sender"}
              {link.messageDate && ` · ${new Date(link.messageDate).toLocaleDateString()}`}
            </p>
          </div>
          <button
            onClick={() => unlink(link.id)}
            disabled={removing === link.id}
            className="text-zinc-300 hover:text-red-400 transition-colors shrink-0 mt-0.5"
            aria-label="Unlink email"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Linked OneDrive Files Panel ───────────────────────────────────────────────

interface FileLinkRecord {
  id: number;
  fileId: string;
  fileName: string | null;
  fileWebUrl: string | null;
  fileMimeType: string | null;
}

function LinkedFilesPanel({ entityType, entityId, authToken }: {
  entityType: string; entityId: number; authToken: string | null;
}) {
  const [removing, setRemoving] = useState<number | null>(null);
  const { data: links = [], isLoading, refetch } = useQuery<FileLinkRecord[]>({
    queryKey: ["onedrive-linked", entityType, entityId],
    queryFn: () =>
      fetch(`/api/onedrive/linked/${entityType}/${entityId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      }).then((r) => (r.ok ? r.json() : [])),
    enabled: !!authToken,
    staleTime: 30_000,
  });

  const unlink = async (linkId: number) => {
    setRemoving(linkId);
    await fetch(`/api/onedrive/file-links/${linkId}`, {
      method: "DELETE",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    }).catch(() => {});
    void refetch();
    setRemoving(null);
  };

  if (isLoading) return <p className="text-xs text-zinc-400 py-2">Loading linked files…</p>;
  if (!links.length)
    return (
      <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center">
        <p className="text-xs text-zinc-400">
          No OneDrive files linked. Select a file in OneDrive and use &ldquo;Link to CRM record&rdquo;.
        </p>
      </div>
    );

  return (
    <div className="space-y-1.5">
      {links.map((link) => (
        <div key={link.id} className="flex items-start gap-2.5 p-3 rounded-xl border border-zinc-100 bg-zinc-50 text-sm">
          <FolderOpen className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-zinc-800 truncate">{link.fileName ?? "(unnamed file)"}</p>
            {link.fileWebUrl && (
              <a href={link.fileWebUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#0078d4] hover:underline truncate block">
                Open in OneDrive
              </a>
            )}
          </div>
          <button
            onClick={() => void unlink(link.id)}
            disabled={removing === link.id}
            className="text-zinc-300 hover:text-red-400 transition-colors shrink-0 mt-0.5"
            aria-label="Unlink file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Local types ───────────────────────────────────────────────────────────────

interface Release {
  id: number; artistId: number | null; artistName: string | null;
  title: string; releaseDate: string; audioUrl: string | null;
  coverArtUrl: string | null; status: "draft" | "scheduled" | "live";
  genre: string | null; upc: string | null; catalogNumber: string | null;
  releaseType: string | null; isrc: string | null; label: string | null;
  notes: string | null; explicit: boolean; language: string | null;
  distributorName: string | null; spotifyTrackId: string | null;
  youtubeVideoId: string | null;
  createdAt: string; updatedAt: string;
}
interface RolloutAction {
  id: number; releaseId: number; phase: string; type: string;
  scheduledFor: string; payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  completedAt: string | null; error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PHASES = ["tease", "announce", "engage", "drop", "post"] as const;
const PHASE_OFFSETS: Record<string, number> = { tease: -14, announce: -7, engage: -3, drop: 0, post: 3 };
const PHASE_COLORS: Record<string, string> = {
  tease:    "bg-violet-500", announce: "bg-blue-500",
  engage:   "bg-amber-500",  drop:     "bg-emerald-500", post: "bg-green-500",
};
const PHASE_LIGHT: Record<string, string> = {
  tease:    "border-violet-200 bg-violet-50/40", announce: "border-blue-200 bg-blue-50/40",
  engage:   "border-amber-200 bg-amber-50/40",   drop:     "border-emerald-200 bg-emerald-50/40",
  post:     "border-green-200 bg-green-50/40",
};
const ACTION_LABELS: Record<string, string> = {
  create_post: "Social Post", send_email: "Email Blast",
  drop_video: "Drop Video", unlock_content: "Unlock Access", publish_page: "Publish Page",
};
const ACTION_ICONS: Record<string, React.FC<{ className?: string }>> = {
  create_post: Disc, send_email: Mail, drop_video: Video, unlock_content: Lock, publish_page: Globe,
};
const RELEASE_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Draft",     cls: "bg-zinc-100 text-zinc-600" },
  scheduled: { label: "Scheduled", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  live:      { label: "Live",      cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};
const ACTION_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "text-zinc-400" },
  running: { label: "Running", cls: "text-blue-500 animate-pulse" },
  done:    { label: "Done",    cls: "text-emerald-600" },
  failed:  { label: "Failed",  cls: "text-red-500" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url: string, token: string | null, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: { ...authHeaders(token), ...(init?.headers ?? {}) },
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as any).error ?? "Request failed"); }
  return r.status === 204 ? null : r.json();
}

// ── Status icon for actions ───────────────────────────────────────────────────

function ActionStatusIcon({ status }: { status: string }) {
  if (status === "done")    return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  if (status === "failed")  return <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin shrink-0" />;
  return <Clock className="h-3.5 w-3.5 text-zinc-300 shrink-0" />;
}

// ── Rollout timeline ──────────────────────────────────────────────────────────

function RolloutTimeline({
  releaseDate, actions, onTrigger, isTriggerPending,
}: {
  releaseDate: string;
  actions: RolloutAction[];
  onTrigger: (actionId: number) => void;
  isTriggerPending: boolean;
}) {
  const base = parseISO(releaseDate);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-5 gap-2 min-w-[640px]">
        {PHASES.map((phase) => {
          const phaseDate = addDays(base, PHASE_OFFSETS[phase]!);
          const phaseActions = actions.filter((a) => a.phase === phase);
          const allDone = phaseActions.length > 0 && phaseActions.every((a) => a.status === "done");
          const hasFailed = phaseActions.some((a) => a.status === "failed");

          return (
            <div key={phase} className={cn("rounded-xl border overflow-hidden", PHASE_LIGHT[phase])}>
              {/* Phase header */}
              <div className={cn("px-3 py-2 text-white", PHASE_COLORS[phase])}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider">{phase}</p>
                  {allDone && <CheckCircle2 className="h-3.5 w-3.5 text-white/80" />}
                  {hasFailed && <XCircle className="h-3.5 w-3.5 text-white/80" />}
                </div>
                <p className="text-xs text-white/75 mt-0.5">{format(phaseDate, "MMM d, yyyy")}</p>
                <p className="text-xs text-white/60">
                  {PHASE_OFFSETS[phase] === 0 ? "Release day" :
                   PHASE_OFFSETS[phase]! < 0 ? `${Math.abs(PHASE_OFFSETS[phase]!)}d before` :
                   `${PHASE_OFFSETS[phase]}d after`}
                </p>
              </div>

              {/* Actions */}
              <div className="p-2 space-y-2">
                {phaseActions.length === 0 && (
                  <p className="text-xs text-zinc-400 text-center py-2">No actions</p>
                )}
                {phaseActions.map((action) => {
                  const Icon = ACTION_ICONS[action.type] ?? Disc;
                  const st = ACTION_STATUS[action.status] ?? ACTION_STATUS["pending"]!;
                  return (
                    <div key={action.id} className="bg-white/80 rounded-lg p-2 space-y-1.5 border border-white shadow-sm">
                      <div className="flex items-center gap-1.5">
                        <Icon className="h-3 w-3 text-zinc-500 shrink-0" />
                        <span className="text-xs font-medium text-zinc-700 flex-1 truncate">
                          {ACTION_LABELS[action.type] ?? action.type}
                        </span>
                        <ActionStatusIcon status={action.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className={cn("text-xs", st.cls)}>{st.label}</span>
                        {action.status === "pending" && (
                          <button
                            onClick={() => onTrigger(action.id)}
                            disabled={isTriggerPending}
                            className="flex items-center gap-0.5 text-xs text-violet-600 hover:text-violet-800 disabled:opacity-50"
                            title="Run now"
                          >
                            <Zap className="h-3 w-3" />
                            Run
                          </button>
                        )}
                        {action.status === "failed" && action.error && (
                          <span className="text-xs text-red-400 truncate max-w-[80px]" title={action.error}>
                            Error
                          </span>
                        )}
                        {action.status === "done" && action.completedAt && (
                          <span className="text-xs text-zinc-400">
                            {format(parseISO(action.completedAt), "HH:mm")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── New / Edit dialog ─────────────────────────────────────────────────────────

interface ArtistPickerItem { id: number; name: string; imageUrl: string | null; genre: string | null; labelStatus: string }

const RELEASE_TYPES = ["single", "ep", "album", "mixtape", "compilation"] as const;
const RELEASE_TYPE_LABELS: Record<string, string> = {
  single: "Single", ep: "EP", album: "Album", mixtape: "Mixtape", compilation: "Compilation",
};

function ReleaseDialog({
  open, onClose, initial, onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Release | null;
  onSave: (data: Partial<Release>) => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title:           initial?.title           ?? "",
    artistName:      initial?.artistName      ?? "",
    artistId:        initial?.artistId        ?? null as number | null,
    releaseDate:     initial?.releaseDate     ?? "",
    audioUrl:        initial?.audioUrl        ?? "",
    coverArtUrl:     initial?.coverArtUrl     ?? "",
    status:          initial?.status          ?? "draft" as "draft" | "scheduled" | "live",
    genre:           initial?.genre           ?? "",
    upc:             initial?.upc             ?? "",
    catalogNumber:   initial?.catalogNumber   ?? "",
    releaseType:     initial?.releaseType     ?? "",
    isrc:            initial?.isrc            ?? "",
    label:           initial?.label           ?? "",
    notes:           initial?.notes           ?? "",
    explicit:        initial?.explicit        ?? false,
    language:        initial?.language        ?? "",
    distributorName: initial?.distributorName ?? "",
    spotifyTrackId:  initial?.spotifyTrackId  ?? "",
    youtubeVideoId:  initial?.youtubeVideoId  ?? "",
  });
  const [artistSearch, setArtistSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const { data: rosterArtists = [] } = useQuery<ArtistPickerItem[]>({
    queryKey: ["artists-picker"],
    queryFn: () => apiFetch(`${BASE}/api/artists`, token),
    enabled: !!token && open,
    staleTime: 60_000,
  });

  const filteredArtists = artistSearch.length > 0
    ? rosterArtists.filter(a => a.name.toLowerCase().includes(artistSearch.toLowerCase())).slice(0, 6)
    : [];

  const set = (k: string, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));
  const inp = "h-8 text-sm";

  function selectArtist(a: ArtistPickerItem) {
    setForm(p => ({ ...p, artistId: a.id, artistName: a.name }));
    setArtistSearch("");
    setShowDropdown(false);
  }

  function clearArtist() {
    setForm(p => ({ ...p, artistId: null }));
    setArtistSearch("");
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Release" : "New Release"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="shrink-0 grid grid-cols-3 mx-1">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="platforms">Platforms</TabsTrigger>
          </TabsList>

          {/* ── Basic tab ── */}
          <TabsContent value="basic" className="flex-1 overflow-y-auto mt-0 px-1 pb-1">
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">Title *</Label>
                <Input className={inp} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="My New Single" />
              </div>

              {/* Artist picker */}
              <div className="space-y-1">
                <Label className="text-xs">Artist</Label>
                {form.artistId ? (
                  <div className="flex items-center gap-2 h-8 px-2.5 border rounded-md bg-violet-50 border-violet-200">
                    {rosterArtists.find(a => a.id === form.artistId)?.imageUrl && (
                      <img src={rosterArtists.find(a => a.id === form.artistId)!.imageUrl!} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                    )}
                    <span className="text-sm text-violet-800 font-medium flex-1 truncate">{form.artistName}</span>
                    <span className="text-[10px] text-violet-500 bg-violet-100 px-1.5 py-0.5 rounded-full font-medium shrink-0">A&R Linked</span>
                    <button onClick={clearArtist} className="text-violet-400 hover:text-violet-700 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
                    <Input
                      className="h-8 text-sm pl-8"
                      value={artistSearch || form.artistName}
                      onChange={e => { setArtistSearch(e.target.value); set("artistName", e.target.value); setShowDropdown(true); }}
                      onFocus={() => setShowDropdown(true)}
                      onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                      placeholder="Search A&R roster or type name…"
                    />
                    {showDropdown && filteredArtists.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg overflow-hidden">
                        {filteredArtists.map(a => (
                          <button key={a.id} onMouseDown={() => selectArtist(a)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-50 transition-colors">
                            {a.imageUrl
                              ? <img src={a.imageUrl} alt={a.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
                              : <div className="w-6 h-6 rounded-full bg-zinc-100 flex items-center justify-center shrink-0"><Music className="h-3 w-3 text-zinc-400" /></div>}
                            <span className="text-sm text-zinc-800 font-medium flex-1 truncate">{a.name}</span>
                            {a.genre && <span className="text-xs text-zinc-400 truncate">{a.genre}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Release Date *</Label>
                  <Input className={inp} type="date" value={form.releaseDate} onChange={(e) => set("releaseDate", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={form.releaseType || "none"} onValueChange={v => set("releaseType", v === "none" ? "" : v)}>
                    <SelectTrigger className={inp}><SelectValue placeholder="Select type…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— none —</SelectItem>
                      {RELEASE_TYPES.map(t => <SelectItem key={t} value={t}>{RELEASE_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Genre</Label>
                  <Input className={inp} value={form.genre} onChange={(e) => set("genre", e.target.value)} placeholder="Hip-hop, R&B…" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Status</Label>
                  <Select value={form.status} onValueChange={v => set("status", v)}>
                    <SelectTrigger className={inp}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="live">Live</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Cover art */}
              <div className="space-y-1">
                <Label className="text-xs">Cover Art</Label>
                <div className="flex gap-2 items-start">
                  <Input className={inp + " flex-1"} value={form.coverArtUrl} onChange={(e) => set("coverArtUrl", e.target.value)} placeholder="https://… or upload →" />
                  <ImageUploadButton token={token} onUpload={url => set("coverArtUrl", url)}
                    onError={msg => toast({ title: msg, variant: "destructive" })} size="sm" label="Upload" icon="image" />
                </div>
                {form.coverArtUrl && (
                  <img src={form.coverArtUrl} alt="cover" className="mt-1.5 h-16 w-16 rounded-lg object-cover border" />
                )}
              </div>

              {/* Audio */}
              <div className="space-y-1">
                <Label className="text-xs">Audio File</Label>
                <div className="flex gap-2 items-center">
                  <Input className={inp + " flex-1"} value={form.audioUrl} onChange={(e) => set("audioUrl", e.target.value)} placeholder="https://… .mp3 or upload →" />
                  <AudioUploadButton token={token} onUpload={url => set("audioUrl", url)}
                    onError={msg => toast({ title: msg, variant: "destructive" })} label="Upload" />
                </div>
                {form.audioUrl && (
                  <audio controls src={form.audioUrl} className="mt-1.5 w-full h-8" />
                )}
              </div>

              {/* Explicit */}
              <div className="flex items-center justify-between py-1">
                <Label className="text-xs">Explicit content</Label>
                <Switch checked={form.explicit} onCheckedChange={v => set("explicit", v)} />
              </div>
            </div>
          </TabsContent>

          {/* ── Details tab ── */}
          <TabsContent value="details" className="flex-1 overflow-y-auto mt-0 px-1 pb-1">
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">ISRC</Label>
                  <Input className={inp} value={form.isrc} onChange={(e) => set("isrc", e.target.value)} placeholder="US-ABC-24-00001" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">UPC / EAN</Label>
                  <Input className={inp} value={form.upc} onChange={(e) => set("upc", e.target.value)} placeholder="012345678901" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Catalog #</Label>
                  <Input className={inp} value={form.catalogNumber} onChange={(e) => set("catalogNumber", e.target.value)} placeholder="CAT-001" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Language</Label>
                  <Input className={inp} value={form.language} onChange={(e) => set("language", e.target.value)} placeholder="English" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input className={inp} value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Label name" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Distributor</Label>
                  <Input className={inp} value={form.distributorName} onChange={(e) => set("distributorName", e.target.value)} placeholder="DistroKid, TuneCore…" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea className="text-sm min-h-[80px] resize-none" value={form.notes}
                  onChange={(e) => set("notes", e.target.value)} placeholder="Internal notes about this release…" />
              </div>
            </div>
          </TabsContent>

          {/* ── Platforms tab ── */}
          <TabsContent value="platforms" className="flex-1 overflow-y-auto mt-0 px-1 pb-1">
            <div className="space-y-3 py-2">
              <p className="text-xs text-zinc-500 bg-zinc-50 border rounded-lg p-3">
                Link specific tracks and videos to pull live streaming stats from Spotify and YouTube on the release detail page.
              </p>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1.5">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-emerald-500"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                  Spotify Track ID
                </Label>
                <Input className={inp} value={form.spotifyTrackId} onChange={(e) => set("spotifyTrackId", e.target.value)}
                  placeholder="e.g. 4cOdK2wGLETKBW3PvgPWqT" />
                <p className="text-[11px] text-zinc-400">Found in the Spotify share link: open.spotify.com/track/<strong>ID</strong></p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1.5">
                  <Youtube className="h-3.5 w-3.5 text-red-500" />
                  YouTube Video ID
                </Label>
                <Input className={inp} value={form.youtubeVideoId} onChange={(e) => set("youtubeVideoId", e.target.value)}
                  placeholder="e.g. dQw4w9WgXcQ" />
                <p className="text-[11px] text-zinc-400">Found in the YouTube URL: youtube.com/watch?v=<strong>ID</strong></p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
                <p className="font-medium">How streaming stats work</p>
                <p>Spotify artist followers &amp; track popularity come from the linked A&R artist's Spotify ID plus the track ID above.</p>
                <p>YouTube channel subscribers &amp; video views come from the A&R artist's YouTube channel plus the video ID above.</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onSave({ ...form, releaseType: form.releaseType || null, genre: form.genre || null,
            upc: form.upc || null, catalogNumber: form.catalogNumber || null, isrc: form.isrc || null,
            label: form.label || null, notes: form.notes || null, language: form.language || null,
            distributorName: form.distributorName || null, spotifyTrackId: form.spotifyTrackId || null,
            youtubeVideoId: form.youtubeVideoId || null, audioUrl: form.audioUrl || null, coverArtUrl: form.coverArtUrl || null,
          })} disabled={!form.title || !form.releaseDate}>
            {initial ? "Save Changes" : "Create Release"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Linked artist card ────────────────────────────────────────────────────────

interface LinkedArtist {
  id: number; name: string; genre: string | null; labelStatus: string | string[];
  imageUrl: string | null; email: string | null; phone: string | null;
  outreachStatus: string;
  contact: { id: number; name: string; email: string | null; phone: string | null; company: string | null } | null;
}

const LABEL_STYLE: Record<string, string> = {
  unsigned: "bg-zinc-100 text-zinc-600",
  in_talks: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  signed:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
  released: "bg-blue-50 text-blue-700 border border-blue-200",
  dropped:  "bg-red-50 text-red-600 border border-red-200",
};

function LinkedArtistCard({ releaseId, artistId }: { releaseId: number; artistId: number | null }) {
  const { token } = useAuth();
  const [, setLocation] = useLocation();

  const { data: artist, isLoading, isError } = useQuery<LinkedArtist>({
    queryKey: ["release-artist", releaseId],
    queryFn: () => apiFetch(`${BASE}/api/releases/${releaseId}/artist`, token),
    enabled: !!token && !!artistId,
    retry: false,
  });

  if (!artistId) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-zinc-200 p-4 flex items-center gap-3 text-zinc-400">
        <User className="h-5 w-5 text-zinc-200 shrink-0" />
        <p className="text-sm">No artist linked — edit this release to connect it to your A&R roster</p>
      </div>
    );
  }

  if (isLoading) return <div className="h-16 rounded-xl bg-zinc-100 animate-pulse" />;
  if (isError || !artist) return null;

  const email = artist.contact?.email ?? artist.email;
  const phone = artist.contact?.phone ?? artist.phone;
  const labelStatusKey = Array.isArray(artist.labelStatus) ? (artist.labelStatus[0] ?? "unsigned") : (artist.labelStatus ?? "unsigned");
  const statusCls = LABEL_STYLE[labelStatusKey] ?? LABEL_STYLE["unsigned"]!;

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <div className="w-12 h-12 rounded-xl bg-zinc-100 overflow-hidden shrink-0">
          {artist.imageUrl
            ? <img src={artist.imageUrl} alt={artist.name} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center"><Music className="h-5 w-5 text-zinc-300" /></div>}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-zinc-900">{artist.name}</p>
            <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", statusCls)}>
              {labelStatusKey.replace("_", " ")}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            {artist.genre && <span className="text-xs text-zinc-500">{artist.genre}</span>}
            {email && (
              <a href={`mailto:${email}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Mail className="h-3 w-3" />{email}
              </a>
            )}
            {phone && (
              <span className="text-xs text-zinc-500 flex items-center gap-1">
                <Phone className="h-3 w-3" />{phone}
              </span>
            )}
          </div>
          {artist.contact && (
            <p className="text-xs text-zinc-400 mt-0.5">
              Contact: {artist.contact.name}{artist.contact.company ? ` · ${artist.contact.company}` : ""}
            </p>
          )}
        </div>

        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setLocation(`/artists?highlight=${artist.id}`)}>
          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />A&R Profile
        </Button>
      </div>
    </div>
  );
}

// ── CSV parser ────────────────────────────────────────────────────────────────

interface CsvRow {
  title: string; artistName: string; releaseDate: string;
  status: string; audioUrl: string; coverArtUrl: string;
  genre: string; upc: string; catalogNumber: string;
  _valid: boolean; _errors: string[];
}

// Maps any recognised header label → internal field key
// Normalisation: lowercase, strip all non-alpha chars  →  e.g. "Release Name" → "releasename"
const HEADER_MAP: Record<string, keyof Omit<CsvRow, "_valid" | "_errors">> = {
  // Simple / template format
  title:           "title",
  artist:          "artistName",
  artistname:      "artistName",
  date:            "releaseDate",
  status:          "status",
  audio:           "audioUrl",
  audiourl:        "audioUrl",
  cover:           "coverArtUrl",
  coverart:        "coverArtUrl",
  coverarturl:     "coverArtUrl",
  genre:           "genre",
  upc:             "upc",
  catalog:         "catalogNumber",
  catalogno:       "catalogNumber",
  catalognumber:   "catalogNumber",
  // Distributor export format (TuneCore / DistroKid / similar inventory CSVs)
  releasename:     "title",
  releaseartist:   "artistName",
  releasedate:     "releaseDate",
  releasegenre:    "genre",
  labelname:       "artistName",  // fallback when no Release Artist column
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (const ch of line + ",") {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === "," && !inQ) { cells.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  return cells;
}

// Column keys that should NOT overwrite a field already written by a higher-priority column.
// e.g. "Release Version" header normalises to "releaseversion" — we skip it so it doesn't
// clobber the "Release Name" value already mapped to title.
const SKIP_IF_SET: Set<string> = new Set(["releaseversion", "labelname", "primaryartists"]);

function parseCsv(text: string): CsvRow[] {
  // Strip UTF-8 BOM if present
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  // Build header → column-index mapping
  const firstCells = splitCsvLine(lines[0]!).map(c => c.toLowerCase().replace(/[^a-z]/g, ""));
  const hasHeader = firstCells.some(c => c in HEADER_MAP);

  const colMap: Array<{ field: keyof Omit<CsvRow, "_valid" | "_errors"> | null; skipIfSet: boolean }> = hasHeader
    ? firstCells.map(c => ({
        field:      HEADER_MAP[c] ?? null,
        skipIfSet:  SKIP_IF_SET.has(c),
      }))
    : ["title", "artistName", "releaseDate", "status", "audioUrl", "coverArtUrl"].map(f => ({
        field:     f as keyof Omit<CsvRow, "_valid" | "_errors">,
        skipIfSet: false,
      }));

  const dataLines = hasHeader ? lines.slice(1) : lines;

  // ── Pass 1: parse every raw line ──────────────────────────────────────────
  const rawRows: CsvRow[] = dataLines.map(line => {
    const cells = splitCsvLine(line);
    const row: CsvRow = {
      title: "", artistName: "", releaseDate: "", status: "",
      audioUrl: "", coverArtUrl: "", genre: "", upc: "", catalogNumber: "",
      _valid: false, _errors: [],
    };
    cells.forEach((val, i) => {
      const { field, skipIfSet } = colMap[i] ?? { field: null, skipIfSet: false };
      if (!field) return;
      const current = (row as unknown as Record<string, string>)[field];
      if (skipIfSet && current) return; // don't overwrite a higher-priority column
      (row as unknown as Record<string, string>)[field] = val.trim();
    });

    // Auto-derive status from date when not present
    if (!row.status || !["draft", "scheduled", "live"].includes(row.status)) {
      const today = new Date().toISOString().slice(0, 10);
      row.status = row.releaseDate && row.releaseDate < today ? "live" : "scheduled";
    }

    return row;
  }).filter(r => r.title || r.releaseDate);

  // ── Pass 2: deduplicate by catalogNumber, then by (title+artist+date) ─────
  // Distributor exports repeat release info on every track row
  const seen = new Map<string, CsvRow>();
  for (const row of rawRows) {
    const key = row.catalogNumber
      ? row.catalogNumber.toLowerCase()
      : `${row.title.toLowerCase()}|${(row.artistName || "").toLowerCase()}|${row.releaseDate}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  const deduped = Array.from(seen.values());

  // ── Pass 3: validate ──────────────────────────────────────────────────────
  return deduped.map(row => {
    const errors: string[] = [];
    if (!row.title) errors.push("Title required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.releaseDate)) errors.push("Date must be YYYY-MM-DD");
    row._valid = errors.length === 0;
    row._errors = errors;
    return row;
  });
}

function downloadCsvTemplate() {
  const csv = ["Title,Artist,Date,Status,AudioUrl,CoverArtUrl", "My New Single,Artist Name,2025-06-01,draft,,"].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "releases-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── CSV import dialog ─────────────────────────────────────────────────────────

function CsvImportDialog({
  open, rows, onClose, onImport, isPending,
}: {
  open: boolean;
  rows: CsvRow[];
  onClose: () => void;
  onImport: (rows: CsvRow[]) => void;
  isPending: boolean;
}) {
  const valid = rows.filter(r => r._valid);
  const invalid = rows.filter(r => !r._valid);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Releases from CSV</DialogTitle>
        </DialogHeader>
        {/* Column format guide */}
        <div className="flex items-center gap-1 py-1 shrink-0 flex-wrap">
          {["Title", "Artist", "Date", "Status"].map((col, i) => (
            <span key={col} className="flex items-center gap-1">
              <span className="px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-700 text-xs font-medium border border-zinc-200">{col}</span>
              {i < 3 && <span className="text-zinc-300 text-xs">·</span>}
            </span>
          ))}
          <span className="text-zinc-300 text-xs mx-1">+</span>
          {["Genre", "UPC", "CatalogNumber"].map(col => (
            <span key={col} className="px-2 py-0.5 rounded-md bg-zinc-50 text-zinc-400 text-xs border border-dashed border-zinc-200">{col}</span>
          ))}
          <span className="ml-auto text-xs text-violet-600 font-medium bg-violet-50 px-2 py-0.5 rounded border border-violet-200">
            Distributor exports supported — auto-deduplicates tracks → releases
          </span>
        </div>

        {/* Valid / error / dedup summary */}
        <div className="flex items-center gap-3 pb-1 shrink-0">
          <span className="text-xs text-emerald-600 font-medium">{valid.length} unique releases</span>
          {invalid.length > 0 && (
            <span className="text-xs text-red-500 font-medium flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />{invalid.length} with errors (skipped)
            </span>
          )}
          <span className="text-xs text-zinc-400">Status auto-derived from date if not present</span>
        </div>
        <div className="overflow-y-auto flex-1 border rounded-lg text-xs">
          <table className="w-full">
            <thead className="bg-zinc-50 sticky top-0">
              <tr>
                {["", "Title", "Artist", "Date", "Status", "Genre"].map(h => (
                  <th key={h} className="text-left px-2 py-1.5 text-zinc-600 font-semibold border-b">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={cn("border-b last:border-0", r._valid ? "bg-white" : "bg-red-50")}>
                  <td className="px-2 py-1.5 w-6">
                    {r._valid
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      : <span title={r._errors.join(", ")}><XCircle className="h-3 w-3 text-red-400" /></span>}
                  </td>
                  <td className="px-2 py-1.5 font-medium max-w-[160px] truncate">{r.title || <span className="text-zinc-300 italic">empty</span>}</td>
                  <td className="px-2 py-1.5 text-zinc-500 max-w-[100px] truncate">{r.artistName || "—"}</td>
                  <td className="px-2 py-1.5 text-zinc-500 whitespace-nowrap">{r.releaseDate || <span className="text-red-400">missing</span>}</td>
                  <td className="px-2 py-1.5">
                    <span className={cn("px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap",
                      r.status === "live" ? "bg-emerald-50 text-emerald-700" :
                      r.status === "scheduled" ? "bg-blue-50 text-blue-700" : "bg-zinc-100 text-zinc-600")}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-zinc-400 max-w-[100px] truncate">{r.genre || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="shrink-0 pt-2">
          <Button variant="ghost" size="sm" className="mr-auto text-zinc-500" onClick={downloadCsvTemplate}>
            <Upload className="h-3.5 w-3.5 mr-1.5 rotate-180" />Download Template
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onImport(valid)} disabled={valid.length === 0 || isPending}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            Import {valid.length} release{valid.length !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Release library (folder tree) ─────────────────────────────────────────────

function ReleaseLibrary({
  releases, selectedId, onSelect,
}: {
  releases: Release[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  const today = startOfDay(new Date());
  const upcoming = releases.filter(r => !isBefore(parseDateFns(r.releaseDate), today));
  const previous = releases.filter(r =>  isBefore(parseDateFns(r.releaseDate), today));

  const [expanded, setExpanded] = useState<Set<string>>(new Set(["upcoming", "previous"]));
  const toggle = (key: string) => setExpanded(p => { const s = new Set(p); s.has(key) ? s.delete(key) : s.add(key); return s; });

  function groupByArtist(list: Release[]) {
    const map = new Map<string, Release[]>();
    for (const r of list) {
      const key = r.artistName?.trim() || "Unknown Artist";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }

  function ArtistFolder({ sectionKey, artistName, items }: { sectionKey: string; artistName: string; items: Release[] }) {
    const folderKey = `${sectionKey}:${artistName}`;
    const isOpen = expanded.has(folderKey);
    return (
      <div>
        <button
          onClick={() => toggle(folderKey)}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-zinc-50 text-xs text-zinc-700"
        >
          {isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-400" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-400" />}
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
          <span className="font-medium truncate flex-1 text-left">{artistName}</span>
          <span className="text-zinc-400 shrink-0">{items.length}</span>
        </button>
        {isOpen && (
          <div className="ml-6 border-l border-zinc-100">
            {items
              .slice()
              .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
              .map(r => {
                const st = RELEASE_STATUS[r.status] ?? RELEASE_STATUS["draft"]!;
                return (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      "w-full flex items-center gap-2 pl-3 pr-2 py-1.5 text-xs transition-colors",
                      selectedId === r.id ? "bg-violet-50 text-violet-700" : "text-zinc-600 hover:bg-zinc-50",
                    )}
                  >
                    <FileMusic className="h-3 w-3 shrink-0 text-violet-400" />
                    <span className="flex-1 truncate text-left">{r.title}</span>
                    <span className="text-zinc-400 shrink-0">{format(parseDateFns(r.releaseDate), "MMM yyyy")}</span>
                  </button>
                );
              })}
          </div>
        )}
      </div>
    );
  }

  function Section({ sectionKey, label, items, icon }: { sectionKey: string; label: string; items: Release[]; icon: React.ReactNode }) {
    const isOpen = expanded.has(sectionKey);
    const groups = groupByArtist(items);
    return (
      <div>
        <button
          onClick={() => toggle(sectionKey)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-50 border-b hover:bg-zinc-100 transition-colors"
        >
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
          {icon}
          <span className="text-xs font-semibold text-zinc-700 flex-1 text-left">{label}</span>
          <span className="text-xs text-zinc-400 bg-zinc-200 px-1.5 py-0.5 rounded-full">{items.length}</span>
        </button>
        {isOpen && (
          <div>
            {groups.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-3 italic">No releases</p>
            ) : (
              groups.map(([artist, releases]) => (
                <ArtistFolder key={artist} sectionKey={sectionKey} artistName={artist} items={releases} />
              ))
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <Section
        sectionKey="upcoming"
        label="Upcoming Releases"
        items={upcoming}
        icon={<Disc className="h-3.5 w-3.5 text-violet-500" />}
      />
      <Section
        sectionKey="previous"
        label="Previously Released"
        items={previous}
        icon={<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
      />
    </div>
  );
}

// ── Streaming stats panel ─────────────────────────────────────────────────────

interface StreamingStats {
  spotifyArtist:  { id: string; name: string; followers: number; popularity: number; imageUrl: string | null; profileUrl: string } | null;
  spotifyTrack:   { id: string; name: string; popularity: number; previewUrl: string | null; durationMs: number; explicit: boolean; externalUrls: Record<string, string>; albumName: string | null } | null;
  youtubeChannel: { id: string; name: string; subscriberCount: number; videoCount: number; thumbnailUrl: string | null; profileUrl: string } | null;
  youtubeVideo:   { id: string; title: string; viewCount: number; likeCount: number; commentCount: number; publishedAt: string; thumbnailUrl: string | null; videoUrl: string } | null;
  errors: Record<string, string | null>;
}

function formatBigNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function StreamingStatsPanel({ releaseId, hasSpotifyLink, hasYoutubeLink }: {
  releaseId: number; hasSpotifyLink: boolean; hasYoutubeLink: boolean;
}) {
  const { token } = useAuth();
  const [enabled, setEnabled] = useState(false);

  const { data: stats, isFetching, isError, error, refetch } = useQuery<StreamingStats>({
    queryKey: ["release-streaming-stats", releaseId],
    queryFn: () => apiFetch(`${BASE}/api/releases/${releaseId}/streaming-stats`, token),
    enabled: !!token && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const noData = !hasSpotifyLink && !hasYoutubeLink;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-violet-500" />
          Streaming Stats
        </h3>
        <div className="flex items-center gap-2">
          {enabled && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          )}
          <Button size="sm" variant={enabled ? "outline" : "default"} className="h-7 text-xs"
            onClick={() => setEnabled(v => !v)}>
            {enabled ? "Hide" : "Load Stats"}
          </Button>
        </div>
      </div>

      {!enabled && (
        <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center">
          {noData ? (
            <div className="space-y-1">
              <AlertTriangle className="h-5 w-5 text-amber-400 mx-auto" />
              <p className="text-xs text-zinc-500">No streaming platforms linked.</p>
              <p className="text-xs text-zinc-400">Edit this release → Platforms tab to add Spotify track &amp; YouTube video IDs.</p>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">Click <strong>Load Stats</strong> to fetch live numbers from Spotify &amp; YouTube.</p>
          )}
        </div>
      )}

      {enabled && isFetching && !stats && (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />)}
        </div>
      )}

      {enabled && isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {(error as Error).message ?? "Failed to load stats"}
        </div>
      )}

      {enabled && stats && (
        <div className="space-y-3">
          {/* Spotify section */}
          {(stats.spotifyArtist || stats.spotifyTrack || stats.errors.spotifyArtist || stats.errors.spotifyTrack) && (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-zinc-50">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-emerald-500 shrink-0"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                <span className="text-xs font-semibold text-zinc-700">Spotify</span>
              </div>
              <div className="p-3 space-y-3">
                {stats.spotifyArtist && (
                  <div className="flex items-center gap-3">
                    {stats.spotifyArtist.imageUrl && (
                      <img src={stats.spotifyArtist.imageUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">{stats.spotifyArtist.name}</p>
                      <p className="text-[11px] text-zinc-400">Artist</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-zinc-900">{formatBigNum(stats.spotifyArtist.followers)}</p>
                      <p className="text-[11px] text-zinc-400 flex items-center gap-1 justify-end"><Users className="h-2.5 w-2.5" />followers</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-violet-700">{stats.spotifyArtist.popularity}</p>
                      <p className="text-[11px] text-zinc-400 flex items-center gap-1 justify-end"><Star className="h-2.5 w-2.5" />popularity</p>
                    </div>
                  </div>
                )}
                {stats.errors.spotifyArtist && (
                  <p className="text-[11px] text-zinc-400 flex items-center gap-1"><AlertCircle className="h-3 w-3 text-amber-400" />Artist: {stats.errors.spotifyArtist}</p>
                )}
                {stats.spotifyTrack && (
                  <div className="flex items-center gap-3 pt-1 border-t">
                    <Headphones className="h-4 w-4 text-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">{stats.spotifyTrack.name}</p>
                      <p className="text-[11px] text-zinc-400">Track{stats.spotifyTrack.albumName ? ` · ${stats.spotifyTrack.albumName}` : ""}</p>
                      {stats.spotifyTrack.previewUrl && (
                        <audio controls src={stats.spotifyTrack.previewUrl} className="mt-1.5 w-full h-7" />
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-violet-700">{stats.spotifyTrack.popularity}</p>
                      <p className="text-[11px] text-zinc-400">popularity</p>
                    </div>
                    <a href={stats.spotifyTrack.externalUrls["spotify"]} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-emerald-600 hover:text-emerald-700">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
                {stats.errors.spotifyTrack && (
                  <p className="text-[11px] text-zinc-400 flex items-center gap-1 border-t pt-1"><AlertCircle className="h-3 w-3 text-amber-400" />Track: {stats.errors.spotifyTrack}</p>
                )}
              </div>
            </div>
          )}

          {/* YouTube section */}
          {(stats.youtubeChannel || stats.youtubeVideo || stats.errors.youtubeChannel || stats.errors.youtubeVideo) && (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b bg-zinc-50">
                <Youtube className="h-3.5 w-3.5 text-red-500 shrink-0" />
                <span className="text-xs font-semibold text-zinc-700">YouTube</span>
              </div>
              <div className="p-3 space-y-3">
                {stats.youtubeChannel && (
                  <div className="flex items-center gap-3">
                    {stats.youtubeChannel.thumbnailUrl && (
                      <img src={stats.youtubeChannel.thumbnailUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">{stats.youtubeChannel.name}</p>
                      <p className="text-[11px] text-zinc-400">Channel</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-zinc-900">{formatBigNum(stats.youtubeChannel.subscriberCount)}</p>
                      <p className="text-[11px] text-zinc-400 flex items-center gap-1 justify-end"><Users className="h-2.5 w-2.5" />subscribers</p>
                    </div>
                    <a href={stats.youtubeChannel.profileUrl} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-red-500 hover:text-red-600">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
                {stats.errors.youtubeChannel && (
                  <p className="text-[11px] text-zinc-400 flex items-center gap-1"><AlertCircle className="h-3 w-3 text-amber-400" />Channel: {stats.errors.youtubeChannel}</p>
                )}
                {stats.youtubeVideo && (
                  <div className="flex items-center gap-3 pt-1 border-t">
                    {stats.youtubeVideo.thumbnailUrl && (
                      <img src={stats.youtubeVideo.thumbnailUrl} alt="" className="w-16 h-10 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-zinc-700 truncate">{stats.youtubeVideo.title}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-zinc-600 flex items-center gap-1">
                          <Eye className="h-3 w-3 text-zinc-400" />{formatBigNum(stats.youtubeVideo.viewCount)}
                        </span>
                        <span className="text-xs text-zinc-600 flex items-center gap-1">
                          <ThumbsUp className="h-3 w-3 text-zinc-400" />{formatBigNum(stats.youtubeVideo.likeCount)}
                        </span>
                      </div>
                    </div>
                    <a href={stats.youtubeVideo.videoUrl} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-red-500 hover:text-red-600">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
                {stats.errors.youtubeVideo && (
                  <p className="text-[11px] text-zinc-400 flex items-center gap-1 border-t pt-1"><AlertCircle className="h-3 w-3 text-amber-400" />Video: {stats.errors.youtubeVideo}</p>
                )}
              </div>
            </div>
          )}

          {!stats.spotifyArtist && !stats.spotifyTrack && !stats.youtubeChannel && !stats.youtubeVideo &&
           !stats.errors.spotifyArtist && !stats.errors.spotifyTrack && !stats.errors.youtubeChannel && !stats.errors.youtubeVideo && (
            <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center">
              <p className="text-xs text-zinc-400">No linked streaming platforms. Edit this release → Platforms tab to connect Spotify &amp; YouTube.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Releases() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "draft" | "scheduled" | "live">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Release | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "library">("list");
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: releases = [], isLoading } = useQuery<Release[]>({
    queryKey: ["releases"],
    queryFn: () => apiFetch(`${BASE}/api/releases`, token),
    enabled: !!token,
  });

  const { data: actions = [], isFetching: actionsLoading } = useQuery<RolloutAction[]>({
    queryKey: ["release-actions", selectedId],
    queryFn: () => apiFetch(`${BASE}/api/releases/${selectedId}/actions`, token),
    enabled: !!token && selectedId !== null,
    refetchInterval: 5000,
  });

  const { data: releaseThreads = [], refetch: refetchThreads } = useQuery<Array<{
    id: number; title: string; type: string; createdAt: string; messageCount?: number;
  }>>({
    queryKey: ["release-threads", selectedId],
    queryFn: () => apiFetch(`${BASE}/api/releases/${selectedId}/threads`, token),
    enabled: !!token && selectedId !== null,
  });

  const { data: releaseVideos = [] } = useQuery<Array<{
    id: number; title: string; status: string; createdAt: string; hasThumbnail?: boolean;
  }>>({
    queryKey: ["release-video-projects", selectedId],
    queryFn: () => apiFetch(`${BASE}/api/releases/${selectedId}/video-projects`, token),
    enabled: !!token && selectedId !== null,
    refetchInterval: 8000,
  });

  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [showThreadInput, setShowThreadInput] = useState(false);

  const createThreadMutation = useMutation({
    mutationFn: (title: string) =>
      apiFetch(`${BASE}/api/messages/threads`, token, {
        method: "POST",
        body: JSON.stringify({ type: "release", releaseId: selectedId, title }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (thread: { id: number }) => {
      refetchThreads();
      setNewThreadTitle("");
      setShowThreadInput(false);
      setLocation(`/messages?thread=${thread.id}`);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const selected = releases.find((r) => r.id === selectedId) ?? null;
  const filtered = releases.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (typeFilter !== "all" && r.releaseType !== typeFilter) return false;
    return true;
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: Partial<Release>) =>
      apiFetch(`${BASE}/api/releases`, token, { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    onSuccess: (r: Release) => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      setSelectedId(r.id);
      setDialogOpen(false);
      toast({ title: "Release created" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Release>) =>
      apiFetch(`${BASE}/api/releases/${editing!.id}`, token, { method: "PUT", body: JSON.stringify(data), headers: { "Content-Type": "application/json" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      setDialogOpen(false);
      setEditing(null);
      toast({ title: "Release updated" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`${BASE}/api/releases/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      setSelectedId(null);
      toast({ title: "Release deleted" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const scheduleMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`${BASE}/api/releases/${id}/schedule`, token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      qc.invalidateQueries({ queryKey: ["release-actions", selectedId] });
      toast({ title: "Rollout scheduled! Actions queued across 5 phases." });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const triggerMutation = useMutation({
    mutationFn: (actionId: number) =>
      apiFetch(`${BASE}/api/releases/${selectedId}/actions/${actionId}/trigger`, token, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["release-actions", selectedId] });
      toast({ title: "Action triggered" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const bulkImportMutation = useMutation({
    mutationFn: (rows: CsvRow[]) =>
      apiFetch(`${BASE}/api/releases/bulk`, token, {
        method: "POST",
        body: JSON.stringify(rows.map(r => ({
          title: r.title, artistName: r.artistName || null,
          releaseDate: r.releaseDate, status: r.status,
          audioUrl: r.audioUrl || null, coverArtUrl: r.coverArtUrl || null,
          genre: r.genre || null, upc: r.upc || null, catalogNumber: r.catalogNumber || null,
        }))),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: (res: { imported: number; errors: { row: number; title: string; error: string }[] }) => {
      qc.invalidateQueries({ queryKey: ["releases"] });
      setCsvDialogOpen(false);
      setCsvRows([]);
      if (csvFileRef.current) csvFileRef.current.value = "";
      toast({ title: `Imported ${res.imported} release${res.imported !== 1 ? "s" : ""}` +
        (res.errors.length ? ` · ${res.errors.length} failed` : "") });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) { toast({ title: "No valid rows found in CSV", variant: "destructive" }); return; }
      setCsvRows(rows);
      setCsvDialogOpen(true);
    };
    reader.readAsText(file);
  }

  const TABS: Array<typeof filter> = ["all", "draft", "scheduled", "live"];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 sm:px-6 py-2 sm:py-3 border-b bg-white shadow-sm shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Disc className="h-5 w-5 text-violet-500" />
          <h1 className="text-lg font-semibold text-zinc-900">Releases</h1>
        </div>

        {/* Status + Type filter — only in list view */}
        {viewMode === "list" && (
          <div className="w-full sm:w-auto sm:flex-1 overflow-x-auto">
            <div className="flex items-center gap-1 min-w-max">
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setFilter(t)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium transition-colors capitalize whitespace-nowrap",
                    filter === t ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100",
                  )}
                >
                  {t} {t !== "all" && `(${releases.filter((r) => r.status === t).length})`}
                </button>
              ))}
              <span className="text-zinc-200 mx-0.5">|</span>
              {(["all", ...RELEASE_TYPES] as string[]).map((t) => (
                <button
                  key={`type-${t}`}
                  onClick={() => setTypeFilter(t)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium transition-colors capitalize whitespace-nowrap",
                    typeFilter === t ? "bg-violet-600 text-white" : "text-zinc-500 hover:bg-zinc-100",
                  )}
                >
                  {t === "all" ? "All types" : RELEASE_TYPE_LABELS[t] ?? t}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={cn("px-2.5 py-1.5 transition-colors", viewMode === "list" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-50")}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode("library")}
              className={cn("px-2.5 py-1.5 border-l transition-colors", viewMode === "library" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-50")}
              title="Library view (by artist folder)"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Import CSV */}
          <input
            ref={csvFileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }}
          />
          <Button size="sm" variant="outline" onClick={() => csvFileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" />Import CSV
          </Button>

          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />New Release
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* Left panel — list or library */}
        <div className={cn("border-r shrink-0 overflow-y-auto bg-white flex flex-col w-full md:w-72", selectedId !== null ? "hidden md:flex" : "flex")}>
          {viewMode === "library" ? (
            isLoading ? (
              <div className="space-y-2 p-3">
                {[...Array(4)].map((_, i) => <div key={i} className="h-8 rounded-lg bg-zinc-100 animate-pulse" />)}
              </div>
            ) : (
              <ReleaseLibrary releases={releases} selectedId={selectedId} onSelect={setSelectedId} />
            )
          ) : (
            <>
              {isLoading && (
                <div className="space-y-2 p-3">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />)}
                </div>
              )}
              {!isLoading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-400">
                  <Disc className="h-8 w-8 text-zinc-200" />
                  <p className="text-sm">No releases</p>
                </div>
              )}
              <div className="p-2 space-y-1">
                {filtered.map((r) => {
                  const st = RELEASE_STATUS[r.status] ?? RELEASE_STATUS["draft"]!;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={cn(
                        "group flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all",
                        selectedId === r.id
                          ? "bg-violet-50 border border-violet-200"
                          : "hover:bg-zinc-50 border border-transparent",
                      )}
                    >
                      <div className="w-10 h-10 rounded-lg shrink-0 bg-zinc-100 overflow-hidden">
                        {r.coverArtUrl ? (
                          <img src={r.coverArtUrl} alt={r.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="h-4 w-4 text-zinc-300" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 truncate">{r.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {r.releaseType && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium border border-violet-100 capitalize">{RELEASE_TYPE_LABELS[r.releaseType] ?? r.releaseType}</span>
                          )}
                          {r.explicit && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-white font-bold">E</span>
                          )}
                          <span className="text-xs text-zinc-400 truncate">{r.artistName ?? "Unknown artist"} · {format(parseISO(r.releaseDate), "MMM d, yyyy")}</span>
                        </div>
                      </div>
                      <span className={cn("text-xs px-1.5 py-0.5 rounded-full border font-medium shrink-0", st.cls)}>
                        {st.label}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${r.title}"?`)) deleteMutation.mutate(r.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-zinc-300 hover:text-red-400 transition-all shrink-0"
                        title="Delete release"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Detail */}
        <div className={cn("flex-1 overflow-y-auto bg-zinc-50", !selectedId && "hidden md:flex md:flex-col")}>
          {!selected ? (
            <div className="hidden md:flex flex-col items-center justify-center h-full gap-3 text-zinc-400">
              <Disc className="h-12 w-12 text-zinc-200" />
              <p className="text-sm">Select a release to view its rollout plan</p>
            </div>
          ) : (
            <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
              {/* Mobile back button */}
              <button
                onClick={() => setSelectedId(null)}
                className="md:hidden flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 -mt-2 mb-2"
              >
                <ChevronLeft className="h-4 w-4" /> All Releases
              </button>
              {/* Release header */}
              <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
                {selected.coverArtUrl && (
                  <div className="h-40 overflow-hidden relative">
                    <img src={selected.coverArtUrl} alt={selected.title} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold text-zinc-900">{selected.title}</h2>
                        {selected.releaseType && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium border border-violet-200 capitalize">
                            {RELEASE_TYPE_LABELS[selected.releaseType] ?? selected.releaseType}
                          </span>
                        )}
                        {selected.explicit && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-white font-bold">E</span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-500 mt-0.5">
                        {selected.artistName && <span>{selected.artistName} · </span>}
                        {format(parseISO(selected.releaseDate), "MMMM d, yyyy")}
                        {selected.label && <span className="text-zinc-400"> · {selected.label}</span>}
                      </p>
                      {/* Metadata chips */}
                      <div className="flex flex-wrap gap-2 mt-2">
                        {selected.genre && <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{selected.genre}</span>}
                        {selected.language && <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">{selected.language}</span>}
                        {selected.isrc && <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-mono">ISRC: {selected.isrc}</span>}
                        {selected.upc && <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-mono">UPC: {selected.upc}</span>}
                        {selected.catalogNumber && <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-mono">{selected.catalogNumber}</span>}
                        {selected.distributorName && <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{selected.distributorName}</span>}
                        {selected.spotifyTrackId && (
                          <a href={`https://open.spotify.com/track/${selected.spotifyTrackId}`} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100 flex items-center gap-1">
                            <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 fill-current"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
                            Spotify
                          </a>
                        )}
                        {selected.youtubeVideoId && (
                          <a href={`https://www.youtube.com/watch?v=${selected.youtubeVideoId}`} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 flex items-center gap-1">
                            <Youtube className="h-2.5 w-2.5" />YouTube
                          </a>
                        )}
                      </div>
                      {selected.audioUrl && (
                        <audio controls src={selected.audioUrl} className="mt-3 w-full max-w-sm h-8" />
                      )}
                      {selected.notes && (
                        <p className="mt-3 text-xs text-zinc-500 bg-zinc-50 border rounded-lg p-2.5 leading-relaxed">{selected.notes}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap shrink-0">
                      <span className={cn(
                        "text-sm px-3 py-1 rounded-full border font-medium",
                        (RELEASE_STATUS[selected.status] ?? RELEASE_STATUS["draft"]!).cls,
                      )}>
                        {(RELEASE_STATUS[selected.status] ?? RELEASE_STATUS["draft"]!).label}
                      </span>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => scheduleMutation.mutate(selected.id)}
                        disabled={scheduleMutation.isPending}
                      >
                        {scheduleMutation.isPending
                          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                        {selected.status === "draft" ? "Schedule Rollout" : "Reschedule"}
                      </Button>

                      <Button size="sm" variant="outline" onClick={() => { setEditing(selected); setDialogOpen(true); }}>
                        Edit
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => {
                          if (confirm(`Delete "${selected.title}"?`)) deleteMutation.mutate(selected.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Streaming Stats */}
              <StreamingStatsPanel
                releaseId={selected.id}
                hasSpotifyLink={!!(selected.spotifyTrackId || selected.artistId)}
                hasYoutubeLink={!!(selected.youtubeVideoId || selected.artistId)}
              />

              {/* Linked artist */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 mb-2">Linked Artist</h3>
                <LinkedArtistCard releaseId={selected.id} artistId={selected.artistId} />
              </div>

              {/* ── Strategy Discussions ───────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-violet-500" />
                    Strategy Discussions
                  </h3>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setShowThreadInput(v => !v)}>
                    <Plus className="h-3 w-3 mr-1" />New Thread
                  </Button>
                </div>

                {showThreadInput && (
                  <div className="flex gap-2 mb-3">
                    <Input
                      className="h-8 text-sm flex-1"
                      placeholder="Thread name (e.g. Launch strategy, Rollout review…)"
                      value={newThreadTitle}
                      onChange={e => setNewThreadTitle(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && newThreadTitle.trim())
                          createThreadMutation.mutate(newThreadTitle.trim());
                        if (e.key === "Escape") setShowThreadInput(false);
                      }}
                      autoFocus
                    />
                    <Button size="sm" className="h-8"
                      disabled={!newThreadTitle.trim() || createThreadMutation.isPending}
                      onClick={() => createThreadMutation.mutate(newThreadTitle.trim())}>
                      {createThreadMutation.isPending
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <MessageSquare className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}

                {releaseThreads.length === 0 ? (
                  <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center">
                    <p className="text-xs text-zinc-400">No discussions yet — start one to coordinate release strategy with your team.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {releaseThreads.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setLocation(`/messages?thread=${t.id}`)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-zinc-200 bg-white hover:bg-violet-50 hover:border-violet-200 transition-all text-left group"
                      >
                        <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                          <MessageSquare className="h-3.5 w-3.5 text-violet-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-zinc-800 truncate">{t.title}</p>
                          <p className="text-xs text-zinc-400">
                            {format(parseISO(t.createdAt), "MMM d, yyyy")}
                          </p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-zinc-300 group-hover:text-violet-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Linked Outlook Emails ──────────────────────── */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5 mb-2">
                  <Mail className="h-3.5 w-3.5 text-[#0078d4]" />
                  Linked Emails
                </h3>
                <LinkedEmailsPanel entityType="release" entityId={selected.id} authToken={token} />
              </div>

              {/* ── Linked OneDrive Files ───────────────────────── */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5 mb-2">
                  <FolderOpen className="h-3.5 w-3.5 text-zinc-500" />
                  Linked Files
                </h3>
                <LinkedFilesPanel entityType="release" entityId={selected.id} authToken={token} />
              </div>

              {/* ── Video Projects ─────────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
                    <Film className="h-3.5 w-3.5 text-violet-500" />
                    Video Projects
                  </h3>
                  <Button size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setLocation("/video-engine")}>
                    <ExternalLink className="h-3 w-3 mr-1" />Video Engine
                  </Button>
                </div>

                {releaseVideos.length === 0 ? (
                  <div className="border-2 border-dashed border-zinc-200 rounded-xl p-4 text-center">
                    <p className="text-xs text-zinc-400">No video projects linked to this release yet.</p>
                    <Button size="sm" variant="ghost" className="mt-2 text-xs h-7 text-violet-600"
                      onClick={() => setLocation("/video-engine")}>
                      <Film className="h-3 w-3 mr-1" />Open Video Engine
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {releaseVideos.map(v => {
                      const statusColors: Record<string, string> = {
                        uploading:   "bg-zinc-100 text-zinc-600 border-zinc-200",
                        processing:  "bg-yellow-50 text-yellow-700 border-yellow-200",
                        watermarked: "bg-orange-50 text-orange-700 border-orange-200",
                        unlocked:    "bg-emerald-50 text-emerald-700 border-emerald-200",
                        failed:      "bg-red-50 text-red-600 border-red-200",
                      };
                      const sc = statusColors[v.status] ?? statusColors["uploading"]!;
                      return (
                        <button
                          key={v.id}
                          onClick={() => setLocation("/video-engine")}
                          className="w-full flex items-center gap-3 p-3 rounded-xl border border-zinc-200 bg-white hover:bg-violet-50 hover:border-violet-200 transition-all text-left group"
                        >
                          <div className="w-7 h-7 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                            <Film className="h-3.5 w-3.5 text-zinc-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-zinc-800 truncate">{v.title}</p>
                            <p className="text-xs text-zinc-400">{format(parseISO(v.createdAt), "MMM d, yyyy")}</p>
                          </div>
                          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full border capitalize shrink-0", sc)}>
                            {v.status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Rollout timeline */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-semibold text-zinc-700">Rollout Timeline</h3>
                  {actionsLoading && <Loader2 className="h-3.5 w-3.5 text-zinc-400 animate-spin" />}
                  {actions.length === 0 && (
                    <span className="text-xs text-zinc-400">
                      — Click "Schedule Rollout" to generate the 5-phase plan
                    </span>
                  )}
                </div>

                {actions.length > 0 ? (
                  <RolloutTimeline
                    releaseDate={selected.releaseDate}
                    actions={actions}
                    onTrigger={(actionId) => triggerMutation.mutate(actionId)}
                    isTriggerPending={triggerMutation.isPending}
                  />
                ) : (
                  <div className="border-2 border-dashed border-zinc-200 rounded-2xl p-8 text-center">
                    <p className="text-sm text-zinc-400">No rollout scheduled yet.</p>
                    <p className="text-xs text-zinc-300 mt-1">
                      Scheduling will create actions across 5 phases: Tease (−14d), Announce (−7d), Engage (−3d), Drop (day 0), Post (+3d)
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New / Edit dialog */}
      <ReleaseDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        initial={editing}
        onSave={(data) => editing ? updateMutation.mutate(data) : createMutation.mutate(data)}
      />

      {/* CSV import dialog */}
      <CsvImportDialog
        open={csvDialogOpen}
        rows={csvRows}
        onClose={() => { setCsvDialogOpen(false); setCsvRows([]); if (csvFileRef.current) csvFileRef.current.value = ""; }}
        onImport={(rows) => bulkImportMutation.mutate(rows)}
        isPending={bulkImportMutation.isPending}
      />
    </div>
  );
}
