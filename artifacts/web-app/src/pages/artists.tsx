import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from "react";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/hooks/use-auth";
import {
  useListArtists, useCreateArtist, useUpdateArtist, useDeleteArtist,
  useGetArtist, useGetArtistProfile, useUpsertArtistProfile,
  useGenerateArtistAiAnalysis,
  useListArtistTasks, useCreateArtistTask, useUpdateArtistTask, useDeleteArtistTask,
  useListArtistSavedViews, useCreateArtistSavedView, useDeleteArtistSavedView,
  useAdminListUsers,
  useSearchSpotifyArtists, useSearchYoutubeChannels, useImportDiscoveredArtist,
  useListArtistOutreach, useGenerateOutreachMessage, useUpdateOutreachMessage,
  useDeleteOutreachMessage, useSendOutreachMessage, useMarkOutreachReplied,
  useGetOutreachQueue, useUpdateOutreachQueueItem, useDeleteOutreachQueueItem,
  useBulkSendOutreach, useListArtistNotes,
  useListArtistDuplicates, useUpdateArtistDuplicate, useMergeArtists, useScanArtistDuplicates,
  useGetMe,
  useGetArtistGraph, useGetArtistTerritoryStats,
  useListArtistRelationships, useCreateArtistRelationship, useDeleteArtistRelationship,
  useListContacts, getListContactsQueryKey,
  useListCustomLabelStatuses, useCreateCustomLabelStatus, useDeleteCustomLabelStatus,
  getListCustomLabelStatusesQueryKey,
  getListArtistsQueryKey, getGetArtistQueryKey, getListArtistOutreachQueryKey,
  getGetOutreachQueueQueryKey, getListArtistDuplicatesQueryKey,
  getListArtistRelationshipsQueryKey,
} from "@workspace/api-client-react";
import type { OutreachMessage } from "@workspace/api-client-react";
import type { SpotifyArtistResult, YoutubeChannelResult } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Music, Plus, Pencil, Trash2, Search, ExternalLink, Download,
  Youtube, Instagram, Twitter, Disc3, User, DollarSign,
  CalendarDays, Loader2, X, Star, CheckSquare, Square,
  Upload, CheckCircle, Brain, ListChecks, SlidersHorizontal,
  Bookmark, BookmarkCheck, Flame, Zap, Snowflake, EyeOff,
  ChevronDown, Sparkles, Circle, Users, Globe2, AlertCircle,
  MessageSquare, Mail, Send, Clock, MailOpen, Trash,
  GitMerge, Copy, RefreshCw, Network, MapPin, Link2, Maximize2,
  Music2, Radio,
} from "lucide-react";
import { useLocation } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip } from "react-leaflet";
import type { Artist, ArtistAiAnalysis, ArtistTask, AdminUser, ArtistRelationship } from "@workspace/api-client-react";
import { ArtistBodyEngagementLevel } from "@workspace/api-client-react";
import { ImageUploadButton, getStorageImgSrc } from "@/components/image-upload-button";

type FGInstance = { zoomToFit: (ms?: number, px?: number) => void };
const ForceGraph2D = lazy(() =>
  (import("react-force-graph-2d") as Promise<{ default: React.ForwardRefExoticComponent<Record<string, unknown> & React.RefAttributes<FGInstance>> }>)
    .then(m => ({ default: m.default }))
);

// ── Status config ─────────────────────────────────────────────────────────────

type LabelStatus = "unsigned" | "in_talks" | "signed" | "released" | "dropped" | "distribution" | "recording_time" | "mixing_mastering" | "video_services";
type OutreachStatus = "new" | "contacted" | "in_talks" | "signed" | "passed";
type LeadTier = "hot" | "warm" | "cold" | "inactive";
type Tier = "standard" | "silver" | "gold" | "platinum";

const STATUS_LABELS: Record<string, string> = {
  unsigned: "Unsigned", in_talks: "In Talks", signed: "Signed",
  released: "Released", dropped: "Dropped",
  distribution: "Distribution", recording_time: "Recording Time",
  mixing_mastering: "Mixing & Mastering", video_services: "Video Services",
};

const STATUS_COLORS: Record<string, string> = {
  unsigned:         "bg-zinc-100 text-zinc-700 border-zinc-300",
  in_talks:         "bg-blue-50 text-blue-700 border-blue-300",
  signed:           "bg-green-50 text-green-700 border-green-300",
  released:         "bg-purple-50 text-purple-700 border-purple-300",
  dropped:          "bg-red-50 text-red-700 border-red-300",
  distribution:     "bg-orange-50 text-orange-700 border-orange-300",
  recording_time:   "bg-teal-50 text-teal-700 border-teal-300",
  mixing_mastering: "bg-indigo-50 text-indigo-700 border-indigo-300",
  video_services:   "bg-rose-50 text-rose-700 border-rose-300",
};

const OUTREACH_LABELS: Record<OutreachStatus, string> = {
  new: "New", contacted: "Contacted", in_talks: "In Talks",
  signed: "Signed", passed: "Passed",
};

const OUTREACH_COLORS: Record<OutreachStatus, string> = {
  new:       "bg-sky-50 text-sky-700 border-sky-300",
  contacted: "bg-indigo-50 text-indigo-700 border-indigo-300",
  in_talks:  "bg-amber-50 text-amber-700 border-amber-300",
  signed:    "bg-green-50 text-green-700 border-green-300",
  passed:    "bg-zinc-100 text-zinc-500 border-zinc-300",
};

const LEAD_TIER_CONFIG: Record<LeadTier, { label: string; color: string; icon: React.ReactNode }> = {
  hot:      { label: "Hot",      color: "text-red-600 bg-red-50",     icon: <Flame className="h-3 w-3" /> },
  warm:     { label: "Warm",     color: "text-amber-600 bg-amber-50", icon: <Zap className="h-3 w-3" /> },
  cold:     { label: "Cold",     color: "text-blue-600 bg-blue-50",   icon: <Snowflake className="h-3 w-3" /> },
  inactive: { label: "Inactive", color: "text-zinc-500 bg-zinc-100",  icon: <EyeOff className="h-3 w-3" /> },
};

const TIER_CONFIG: Record<Tier, { label: string; color: string }> = {
  standard: { label: "Standard",  color: "bg-zinc-100 text-zinc-700" },
  silver:   { label: "Silver",    color: "bg-slate-100 text-slate-600" },
  gold:     { label: "Gold",      color: "bg-yellow-100 text-yellow-700" },
  platinum: { label: "Platinum",  color: "bg-violet-100 text-violet-700" },
};

const STREAMING_ICONS: Record<string, React.ReactNode> = {
  spotify:   <Disc3     className="h-3.5 w-3.5" />,
  youtube:   <Youtube   className="h-3.5 w-3.5" />,
  instagram: <Instagram className="h-3.5 w-3.5" />,
  twitter:   <Twitter   className="h-3.5 w-3.5" />,
  bandcamp:  <Music2    className="h-3.5 w-3.5" />,
  groover:   <Radio     className="h-3.5 w-3.5" />,
};

const FOLLOWERS_OPTIONS = ["<1K", "1K-10K", "10K-100K", "100K+"];

const EMPTY_FORM = {
  name: "", genre: "", labelStatus: [] as string[],
  outreachStatus: "new" as OutreachStatus,
  revenuePotential: "", followersEstimate: "", engagementLevel: "",
  city: "", state: "", country: "",
  bio: "", email: "", phone: "", tags: "",
  imageUrl: "",
  contactId: null as number | null,
  spotify: "", appleMusic: "", audiomack: "", youtube: "", soundcloud: "", tidal: "",
  bandcamp: "",
  instagram: "", facebook: "", tiktok: "", twitter: "",
  bandsintown: "", songkick: "", website: "", groover: "",
  // discovery source IDs — preserved through create so duplicate guard works
  spotifyId: "" as string | null,
  youtubeChannelId: "" as string | null,
};

const EMPTY_PROFILE = {
  tier: "standard" as Tier,
  royaltySplitPct: "50",
  contractStart: "",
  contractEnd: "",
  managerId: "",
  notes: "",
  bankKeys: [""] as string[],
  bankVals: [""] as string[],
};

// ── Filter state ──────────────────────────────────────────────────────────────

interface FilterState {
  search: string;
  leadTier: string;
  outreachStatus: string;
  genre: string;
  city: string;
  state: string;
  followersEstimate: string;
  engagementLevel: string;
  labelStatus: string;
}

const EMPTY_FILTERS: FilterState = {
  search: "", leadTier: "", outreachStatus: "", genre: "",
  city: "", state: "", followersEstimate: "", engagementLevel: "", labelStatus: "",
};

function activeFilterCount(f: FilterState) {
  return Object.entries(f).filter(([k, v]) => k !== "search" && v !== "").length;
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim()); cur = "";
    } else { cur += ch; }
  }
  fields.push(cur.trim());
  return fields;
}

const normHeader = (s: string) => s.toLowerCase().replace(/[\s_\-().]+/g, "");

interface ArtistCsvRow { name: string; genre: string; labelStatus: string; email: string; phone: string; tags: string[]; bio: string; }

function parseArtistCsv(text: string): { rows: ArtistCsvRow[]; skipped: number } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0 };
  const headers = parseCsvLine(lines[0]!).map(normHeader);
  const idx = (keys: string[]) => keys.map(k => headers.indexOf(k)).find(i => i !== -1) ?? -1;
  const col = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");

  const nameIdx   = idx(["name", "artistname", "fullname", "displayname", "firstname"]);
  const genreIdx  = idx(["genre", "style", "musicgenre"]);
  const statusIdx = idx(["labelstatus", "status", "signingstatus"]);
  const emailIdx  = idx(["email", "emailaddress", "workemail"]);
  const phoneIdx  = idx(["phone", "phonenumber", "mobile", "telephone"]);
  const tagsIdx   = idx(["tags", "labels", "keywords"]);
  const bioIdx    = idx(["bio", "biography", "description", "about", "notes"]);

  const VALID_STATUSES = new Set(["unsigned", "in_talks", "signed", "released", "dropped", "distribution", "recording_time", "mixing_mastering", "video_services"]);

  const rows: ArtistCsvRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const name = col(cols, nameIdx);
    if (!name) { skipped++; continue; }
    const rawStatus = col(cols, statusIdx).toLowerCase().replace(/\s+/g, "_");
    rows.push({
      name,
      genre:       col(cols, genreIdx),
      labelStatus: VALID_STATUSES.has(rawStatus) ? rawStatus : "unsigned",
      email:       col(cols, emailIdx),
      phone:       col(cols, phoneIdx),
      tags:        tagsIdx >= 0 ? col(cols, tagsIdx).split(";").map(t => t.trim()).filter(Boolean) : [],
      bio:         col(cols, bioIdx),
    });
  }
  return { rows, skipped };
}

// ── Import dialog ─────────────────────────────────────────────────────────────

function ImportArtistsDialog({
  open, onClose, token, onImported,
}: { open: boolean; onClose: () => void; token: string | null; onImported: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ArtistCsvRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const reset = () => { setRows([]); setSkipped(0); setFileName(""); setDone(null); };

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { rows: r, skipped: s } = parseArtistCsv(e.target?.result as string);
      setRows(r); setSkipped(s); setDone(null);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!token || rows.length === 0) return;
    setLoading(true);
    try {
      const payload = rows.map(r => ({
        name:        r.name,
        genre:       r.genre || null,
        labelStatus: r.labelStatus ? [r.labelStatus] : [],
        email:       r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) ? r.email : null,
        phone:       r.phone || null,
        tags:        r.tags,
        bio:         r.bio || null,
      }));
      const res = await fetch("/api/artists/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ artists: payload }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Import failed", variant: "destructive" }); return; }
      setDone(data.imported);
      onImported();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-violet-600" /> Import Artists
          </DialogTitle>
        </DialogHeader>

        {done !== null ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="h-10 w-10 text-green-500" />
            <p className="text-lg font-semibold text-zinc-900">Import complete</p>
            <p className="text-sm text-zinc-500">{done} artist{done !== 1 ? "s" : ""} added to the roster.</p>
            <Button onClick={handleClose} className="mt-2">Done</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-4">
            <div
              className="relative border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center hover:border-violet-300 hover:bg-violet-50/30 transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.txt"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              <Upload className="h-8 w-8 text-zinc-300 mx-auto mb-3 pointer-events-none" />
              <p className="font-medium text-zinc-700 pointer-events-none">Drop your CSV here, or click to browse</p>
              <p className="text-xs text-zinc-400 mt-1 pointer-events-none">Columns: name, genre, email, phone, tags, bio</p>
              <p className="text-xs text-zinc-400 mt-0.5 pointer-events-none">Max 1,000 rows.</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
              <p className="font-medium text-zinc-700 mb-1">Expected CSV format</p>
              <p className="font-mono text-[11px] bg-white border rounded px-2 py-1.5 select-all">
                name,genre,email,phone,tags,bio<br />
                "Jane Smith","R&amp;B","jane@example.com","555-0100","vip;new","Amazing vocalist"
              </p>
              <p>Tags are semicolon-separated. <span className="font-medium">label_status</span> can be: unsigned, in_talks, signed, released, dropped.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-zinc-800">{fileName}</p>
                <p className="text-sm text-zinc-500">
                  <span className="text-green-600 font-medium">{rows.length} valid row{rows.length !== 1 ? "s" : ""}</span>
                  {skipped > 0 && <span className="text-amber-600 ml-2">· {skipped} skipped (no name)</span>}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={reset}>
                <X className="h-3.5 w-3.5" /> Change file
              </Button>
            </div>

            <div className="border border-zinc-200 rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    {["Name", "Genre", "Status", "Email", "Tags"].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-zinc-500 uppercase tracking-wide text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-zinc-50">
                      <td className="px-3 py-2 font-medium text-zinc-800">{r.name}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.genre || "—"}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.labelStatus}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.email || "—"}</td>
                      <td className="px-3 py-2">
                        {r.tags.map((t, j) => <span key={j} className="inline-block bg-zinc-100 text-zinc-600 rounded px-1.5 py-0.5 mr-1 text-[10px]">{t}</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && (
                <p className="text-center text-xs text-zinc-400 py-2 bg-zinc-50 border-t">
                  … and {rows.length - 8} more row{rows.length - 8 !== 1 ? "s" : ""}
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleImport} disabled={loading}>
                {loading
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</>
                  : <><Upload className="h-4 w-4" /> Import {rows.length} Artist{rows.length !== 1 ? "s" : ""}</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── AI Analysis tab ───────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "bg-green-500" : value >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function AiAnalysisTab({ artist }: { artist: Artist }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const generateMut = useGenerateArtistAiAnalysis();

  // Check if analysis is embedded in artist data
  const analysis = (artist as Artist & { aiAnalysis?: ArtistAiAnalysis | null }).aiAnalysis;

  function handleGenerate() {
    generateMut.mutate({ id: artist.id }, {
      onSuccess: () => {
        toast({ title: "AI analysis complete" });
        qc.invalidateQueries({ queryKey: getGetArtistQueryKey(artist.id) });
        qc.invalidateQueries({ queryKey: getListArtistsQueryKey() });
      },
      onError: () => toast({ title: "AI analysis failed", variant: "destructive" }),
    });
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <Brain className="h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">No AI analysis yet</p>
        <p className="text-xs text-muted-foreground/70 max-w-xs">
          Generate a smart summary, lead tier, and scoring based on this artist's profile.
        </p>
        <Button size="sm" onClick={handleGenerate} disabled={generateMut.isPending} className="gap-1.5">
          {generateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generateMut.isPending ? "Analyzing…" : "Run AI Analysis"}
        </Button>
      </div>
    );
  }

  const tier = analysis.leadTier as LeadTier;
  const tierConf = LEAD_TIER_CONFIG[tier] ?? LEAD_TIER_CONFIG.cold;

  return (
    <div className="space-y-5">
      {/* Tier + summary */}
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${tierConf.color}`}>
          {tierConf.icon}{tierConf.label} Lead
        </span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-muted-foreground" onClick={handleGenerate} disabled={generateMut.isPending}>
          {generateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Summary</p>
        <p className="text-sm leading-relaxed text-foreground">{analysis.summary}</p>
      </div>

      {/* Scores */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Scores</p>
        <ScoreBar label="Branding" value={analysis.brandingScore} />
        <ScoreBar label="Growth Potential" value={analysis.growthScore} />
        <ScoreBar label="Professionalism" value={analysis.professionalismScore} />
      </div>

      {/* Recommendations */}
      {(analysis.recommendations as string[]).length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recommendations</p>
          <ul className="space-y-1.5">
            {(analysis.recommendations as string[]).map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="shrink-0 h-4 w-4 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-muted-foreground">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 pt-1 border-t">
        Last analyzed {new Date(analysis.updatedAt).toLocaleDateString()}
      </p>
    </div>
  );
}

// ── Artist Tasks tab ──────────────────────────────────────────────────────────

function TasksTab({ artist }: { artist: Artist }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: tasks = [] } = useListArtistTasks(artist.id, { query: { queryKey: ["artistTasks", artist.id] } });
  const { data: users = [] } = useAdminListUsers({ query: { queryKey: ["adminUsers"] } });
  const createTask = useCreateArtistTask();
  const updateTask = useUpdateArtistTask();
  const deleteTask = useDeleteArtistTask();

  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newAssignee, setNewAssignee] = useState("_none");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const assigneeId = newAssignee !== "_none" ? parseInt(newAssignee) : null;
    createTask.mutate(
      { id: artist.id, data: { title: newTitle.trim(), dueDate: newDue || null, assigneeId } },
      {
        onSuccess: () => {
          setNewTitle(""); setNewDue(""); setNewAssignee("_none");
          qc.invalidateQueries({ queryKey: ["artistTasks", artist.id] });
        },
        onError: () => toast({ title: "Failed to add task", variant: "destructive" }),
      },
    );
  }

  function handleToggle(task: ArtistTask) {
    updateTask.mutate(
      { id: artist.id, taskId: task.id, data: { title: task.title, completed: !task.completedAt, assigneeId: task.assigneeId ?? null } },
      { onSuccess: () => qc.invalidateQueries({ queryKey: ["artistTasks", artist.id] }) },
    );
  }

  function handleDelete(taskId: number) {
    deleteTask.mutate(
      { id: artist.id, taskId },
      { onSuccess: () => qc.invalidateQueries({ queryKey: ["artistTasks", artist.id] }) },
    );
  }

  const open = tasks.filter(t => !t.completedAt);
  const done = tasks.filter(t => !!t.completedAt);
  const userMap = new Map((users as AdminUser[]).map(u => [u.id, u.name]));

  return (
    <div className="space-y-4">
      {/* Add task form */}
      <form onSubmit={handleAdd} className="space-y-2 pb-3 border-b">
        <Input
          placeholder="Task title…"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          className="h-8 text-sm"
        />
        <div className="flex gap-2">
          <Input
            type="date"
            value={newDue}
            onChange={e => setNewDue(e.target.value)}
            className="flex-1 h-8 text-sm"
          />
          <Select value={newAssignee} onValueChange={setNewAssignee}>
            <SelectTrigger className="flex-1 h-8 text-xs">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">Unassigned</SelectItem>
              {(users as AdminUser[]).map(u => (
                <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" className="h-8 px-3" disabled={!newTitle.trim() || createTask.isPending}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </form>

      {/* Open tasks */}
      {open.length > 0 && (
        <div className="space-y-1.5">
          {open.map(task => (
            <TaskRow key={task.id} task={task} userMap={userMap} onToggle={handleToggle} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Done tasks */}
      {done.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 mt-3">Completed</p>
          <div className="space-y-1.5 opacity-60">
            {done.map(task => (
              <TaskRow key={task.id} task={task} userMap={userMap} onToggle={handleToggle} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      {tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <ListChecks className="h-8 w-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">No tasks yet</p>
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, userMap, onToggle, onDelete }: {
  task: ArtistTask;
  userMap: Map<number, string>;
  onToggle: (t: ArtistTask) => void;
  onDelete: (id: number) => void;
}) {
  const isComplete = !!task.completedAt;
  const assigneeName = task.assigneeId ? (userMap.get(task.assigneeId) ?? `#${task.assigneeId}`) : null;

  return (
    <div className={`flex items-start gap-2 group px-2 py-2 rounded-lg hover:bg-muted/50 ${isComplete ? "opacity-60" : ""}`}>
      <button onClick={() => onToggle(task)} className="shrink-0 mt-0.5 text-muted-foreground hover:text-primary transition-colors">
        {isComplete
          ? <CheckCircle className="h-4 w-4 text-green-500" />
          : <Circle className="h-4 w-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm ${isComplete ? "line-through text-muted-foreground" : ""}`}>{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {task.dueDate && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <CalendarDays className="h-3 w-3" />{task.dueDate}
            </span>
          )}
          {assigneeName && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <User className="h-3 w-3" />{assigneeName}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => onDelete(task.id)}
        className="shrink-0 mt-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Outreach tab ───────────────────────────────────────────────────────────────

const OUTREACH_TYPE_LABELS: Record<string, string> = {
  dm: "DM",
  email: "Email",
  proposal: "Proposal",
  recommendation: "Recommendation",
};

const OUTREACH_STATUS_COLORS: Record<string, string> = {
  draft:    "bg-zinc-100 text-zinc-600",
  approved: "bg-blue-100 text-blue-700",
  sent:     "bg-violet-100 text-violet-700",
  replied:  "bg-green-100 text-green-700",
};

const OUTREACH_STATUS_LABELS: Record<string, string> = {
  draft:    "Draft",
  approved: "Approved",
  sent:     "Sent",
  replied:  "Replied",
};

function OutreachTab({ artist, initialContext }: { artist: Artist; initialContext?: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [generating, setGenerating] = useState(false);
  const [genType, setGenType] = useState<"dm" | "email" | "proposal" | "recommendation">("email");
  const [genContext, setGenContext] = useState(initialContext ?? "");
  const [genEmail, setGenEmail] = useState(artist.email ?? "");
  const [showGenForm, setShowGenForm] = useState(!!initialContext);
  const [selected, setSelected] = useState<OutreachMessage | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [replyNotes, setReplyNotes] = useState("");
  const [showReplyForm, setShowReplyForm] = useState(false);

  const { data: messages = [], isLoading } = useListArtistOutreach(artist.id);
  const { data: notes = [] } = useListArtistNotes(artist.id);
  const generateMut = useGenerateOutreachMessage();
  const updateMut   = useUpdateOutreachMessage();
  const deleteMut   = useDeleteOutreachMessage();
  const sendMut     = useSendOutreachMessage();
  const replyMut    = useMarkOutreachReplied();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListArtistOutreachQueryKey(artist.id) });

  function handleGenerate() {
    setGenerating(true);
    generateMut.mutate(
      { id: artist.id, data: { type: genType, contextNotes: genContext || undefined, recipientEmail: genEmail || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Draft generated" });
          invalidate();
          setShowGenForm(false);
          setGenContext("");
        },
        onError: () => toast({ title: "Generation failed", variant: "destructive" }),
        onSettled: () => setGenerating(false),
      },
    );
  }

  function handleApprove(msg: OutreachMessage) {
    updateMut.mutate(
      { id: artist.id, msgId: msg.id, data: { status: "approved" } },
      {
        onSuccess: () => { toast({ title: "Approved" }); invalidate(); },
        onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
      },
    );
  }

  function handleSave(msg: OutreachMessage) {
    updateMut.mutate(
      { id: artist.id, msgId: msg.id, data: { subject: editSubject, body: editBody, recipientEmail: editEmail || null } },
      {
        onSuccess: () => { toast({ title: "Saved" }); invalidate(); setSelected(null); },
        onError: () => toast({ title: "Save failed", variant: "destructive" }),
      },
    );
  }

  function handleSend(msg: OutreachMessage) {
    if (!msg.recipientEmail && !editEmail) {
      toast({ title: "Set a recipient email first", variant: "destructive" });
      return;
    }
    const run = (m: OutreachMessage) => sendMut.mutate(
      { id: artist.id, msgId: m.id },
      {
        onSuccess: () => { toast({ title: "Sent via Outlook" }); invalidate(); setSelected(null); },
        onError: (e: unknown) => {
          const msg2 = (e as { message?: string })?.message ?? "Send failed";
          toast({ title: msg2, variant: "destructive" });
        },
      },
    );
    if (!msg.recipientEmail && editEmail) {
      updateMut.mutate(
        { id: artist.id, msgId: msg.id, data: { recipientEmail: editEmail } },
        { onSuccess: (updated) => run(updated), onError: () => toast({ title: "Failed to set email", variant: "destructive" }) },
      );
    } else {
      run(msg);
    }
  }

  function handleMarkReplied(msg: OutreachMessage) {
    replyMut.mutate(
      { id: artist.id, msgId: msg.id, data: { replyNotes: replyNotes || undefined } },
      {
        onSuccess: () => { toast({ title: "Marked as replied" }); invalidate(); setSelected(null); setShowReplyForm(false); setReplyNotes(""); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      },
    );
  }

  function handleDelete(msg: OutreachMessage) {
    deleteMut.mutate(
      { id: artist.id, msgId: msg.id },
      {
        onSuccess: () => { toast({ title: "Deleted" }); invalidate(); setSelected(null); },
        onError: () => toast({ title: "Delete failed", variant: "destructive" }),
      },
    );
  }

  function openEdit(msg: OutreachMessage) {
    setSelected(msg);
    setEditBody(msg.body);
    setEditSubject(msg.subject ?? "");
    setEditEmail(msg.recipientEmail ?? "");
    setShowReplyForm(false);
    setReplyNotes("");
  }

  if (selected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setSelected(null)}>
            ← Back
          </button>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${OUTREACH_STATUS_COLORS[selected.status]}`}>
              {OUTREACH_STATUS_LABELS[selected.status]}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
              {OUTREACH_TYPE_LABELS[selected.type]}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
            <input
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              value={editSubject}
              onChange={e => setEditSubject(e.target.value)}
              placeholder="Subject line…"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Recipient Email</label>
            <input
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              value={editEmail}
              onChange={e => setEditEmail(e.target.value)}
              placeholder="recipient@example.com"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message Body</label>
            <textarea
              rows={9}
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
              value={editBody}
              onChange={e => setEditBody(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" className="text-xs" onClick={() => handleSave(selected)} disabled={updateMut.isPending}>
            Save Edits
          </Button>
          {selected.status === "draft" && (
            <Button size="sm" variant="outline" className="text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
              onClick={() => handleApprove(selected)} disabled={updateMut.isPending}>
              <CheckCircle className="h-3.5 w-3.5 mr-1" />Approve
            </Button>
          )}
          {selected.status === "draft" && (
            <p className="text-xs text-amber-600 self-center">Requires approval before sending</p>
          )}
          {selected.status === "approved" && (
            <Button size="sm" className="text-xs bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => handleSend(selected)} disabled={sendMut.isPending || updateMut.isPending}>
              {sendMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              Send via Outlook
            </Button>
          )}
          {selected.status === "sent" && !showReplyForm && (
            <Button size="sm" variant="outline" className="text-xs text-green-700 border-green-200 hover:bg-green-50"
              onClick={() => setShowReplyForm(true)}>
              <MailOpen className="h-3.5 w-3.5 mr-1" />Mark Replied
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-xs text-destructive ml-auto"
            onClick={() => handleDelete(selected)} disabled={deleteMut.isPending}>
            <Trash className="h-3.5 w-3.5 mr-1" />Delete
          </Button>
        </div>

        {showReplyForm && (
          <div className="space-y-2 border rounded-lg p-3 bg-green-50/50">
            <p className="text-xs font-medium text-green-800">Log Reply</p>
            <textarea
              rows={3}
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-400 resize-none"
              placeholder="Optional reply notes…"
              value={replyNotes}
              onChange={e => setReplyNotes(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" className="text-xs bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleMarkReplied(selected)} disabled={replyMut.isPending}>
                {replyMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5 mr-1" />}
                Confirm Reply
              </Button>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowReplyForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {selected.contextNotes && (
          <div className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
            <span className="font-medium">Context notes: </span>{selected.contextNotes}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/60 pt-1 border-t">
          Created {new Date(selected.createdAt).toLocaleDateString()}
          {selected.sentAt && ` · Sent ${new Date(selected.sentAt).toLocaleDateString()}`}
          {selected.repliedAt && ` · Replied ${new Date(selected.repliedAt).toLocaleDateString()}`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Generate form */}
      {showGenForm ? (
        <div className="border rounded-lg p-3 space-y-3 bg-violet-50/40">
          <p className="text-xs font-semibold text-violet-800">Generate AI Outreach</p>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message Type</label>
            <select
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
              value={genType}
              onChange={e => setGenType(e.target.value as typeof genType)}
            >
              {Object.entries(OUTREACH_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Recipient Email <span className="text-muted-foreground/60">(optional)</span></label>
            <input
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              value={genEmail}
              onChange={e => setGenEmail(e.target.value)}
              placeholder="artist@example.com"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Context Notes <span className="text-muted-foreground/60">(optional)</span></label>
            <textarea
              rows={2}
              className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
              placeholder="Any specific goals, tone, or details to include…"
              value={genContext}
              onChange={e => setGenContext(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1"
              onClick={handleGenerate} disabled={generating}>
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Generate Draft"}
            </Button>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowGenForm(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" className="w-full text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
          onClick={() => setShowGenForm(true)}>
          <Sparkles className="h-3.5 w-3.5" />Generate AI Outreach
        </Button>
      )}

      {/* Message list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
          <p className="text-sm">No outreach messages yet</p>
          <p className="text-xs opacity-70">Generate an AI-drafted message above</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => openEdit(msg)}
              className="w-full text-left border rounded-lg px-3 py-2.5 hover:bg-muted/40 transition-colors space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium truncate flex-1">
                  {msg.subject || OUTREACH_TYPE_LABELS[msg.type]}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${OUTREACH_STATUS_COLORS[msg.status]}`}>
                    {OUTREACH_STATUS_LABELS[msg.status]}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{msg.body}</p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                <Clock className="h-3 w-3" />
                {new Date(msg.createdAt).toLocaleDateString()}
                {msg.recipientEmail && (
                  <><Mail className="h-3 w-3 ml-1" /><span className="truncate max-w-[120px]">{msg.recipientEmail}</span></>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Conversation history (sent + reply records) */}
      {notes.length > 0 && (
        <div className="pt-2 border-t space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />Conversation History
          </p>
          {notes.map(note => (
            <div key={note.id} className={`rounded-lg border px-3 py-2.5 space-y-1 text-xs ${
              note.type === "outreach_sent"
                ? "bg-violet-50/60 border-violet-100"
                : note.type === "outreach_reply"
                  ? "bg-green-50/60 border-green-100"
                  : "bg-muted/30"
            }`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground truncate flex-1">
                  {note.subject ?? (note.type === "outreach_sent" ? "Message sent" : "Reply received")}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                  note.type === "outreach_sent"
                    ? "bg-violet-100 text-violet-700"
                    : note.type === "outreach_reply"
                      ? "bg-green-100 text-green-700"
                      : "bg-zinc-100 text-zinc-600"
                }`}>
                  {note.type === "outreach_sent" ? "Sent" : note.type === "outreach_reply" ? "Reply" : "Note"}
                </span>
              </div>
              <p className="text-muted-foreground line-clamp-3">{note.body}</p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 pt-0.5">
                <span>{note.authorName}</span>
                {note.sentTo && <><Mail className="h-3 w-3" /><span className="truncate max-w-[140px]">{note.sentTo}</span></>}
                <span className="ml-auto">{new Date(note.createdAt).toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Profile tab ────────────────────────────────────────────────────────────────

function ProfileTab({ artist }: { artist: Artist }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useGetArtistProfile(artist.id, {
    query: { queryKey: ["artistProfile", artist.id], retry: false },
  });

  const upsertMut = useUpsertArtistProfile();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_PROFILE);

  function startEdit() {
    if (profile) {
      const bank = (profile.bankDetails ?? {}) as Record<string, string>;
      const keys = Object.keys(bank);
      setForm({
        tier:            profile.tier as Tier,
        royaltySplitPct: String(profile.royaltySplitPct),
        contractStart:   profile.contractStart ?? "",
        contractEnd:     profile.contractEnd ?? "",
        managerId:       profile.managerId ? String(profile.managerId) : "",
        notes:           profile.notes ?? "",
        bankKeys:        keys.length ? keys : [""],
        bankVals:        keys.length ? keys.map(k => bank[k]) : [""],
      });
    } else {
      setForm(EMPTY_PROFILE);
    }
    setEditing(true);
  }

  function handleSave() {
    const bankDetails: Record<string, string> = {};
    form.bankKeys.forEach((k, i) => { if (k.trim()) bankDetails[k.trim()] = form.bankVals[i] ?? ""; });

    upsertMut.mutate({
      artistId: artist.id,
      data: {
        tier:            form.tier,
        royaltySplitPct: parseInt(form.royaltySplitPct) || 50,
        contractStart:   form.contractStart || undefined,
        contractEnd:     form.contractEnd || undefined,
        managerId:       form.managerId ? parseInt(form.managerId) : undefined,
        notes:           form.notes || undefined,
        bankDetails:     Object.keys(bankDetails).length ? bankDetails : undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Profile saved" });
        setEditing(false);
        qc.invalidateQueries({ queryKey: ["artistProfile", artist.id] });
      },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    });
  }

  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  if (!editing) {
    if (!profile) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
          <User className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No profile yet</p>
          <Button size="sm" onClick={startEdit}><Plus className="h-4 w-4 mr-1" />Create Profile</Button>
        </div>
      );
    }

    const bank = (profile.bankDetails ?? {}) as Record<string, string>;
    const tier = profile.tier as Tier;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 ${TIER_CONFIG[tier].color}`}>
              <Star className="h-3 w-3" />{TIER_CONFIG[tier].label}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={startEdit}><Pencil className="h-3 w-3 mr-1" />Edit</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Royalty Split</p>
            <p className="font-semibold text-lg flex items-center gap-1"><DollarSign className="h-4 w-4 text-green-600" />{profile.royaltySplitPct}%</p>
          </div>
          {profile.contractStart && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contract Start</p>
              <p className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{profile.contractStart}</p>
            </div>
          )}
          {profile.contractEnd && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contract End</p>
              <p className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{profile.contractEnd}</p>
            </div>
          )}
          {profile.managerId && (
            <div className="space-y-0.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Manager ID</p>
              <p>#{profile.managerId}</p>
            </div>
          )}
        </div>

        {Object.keys(bank).length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bank Details</p>
            <div className="rounded-lg border divide-y text-sm">
              {Object.entries(bank).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                  <span className="font-mono font-medium">{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {profile.notes && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-muted-foreground">{profile.notes}</p>
          </div>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Tier</Label>
          <Select value={form.tier} onValueChange={v => setForm(f => ({ ...f, tier: v as Tier }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(TIER_CONFIG) as Tier[]).map(t => <SelectItem key={t} value={t}>{TIER_CONFIG[t].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Royalty Split %</Label>
          <Input type="number" min="0" max="100" value={form.royaltySplitPct}
            onChange={e => setForm(f => ({ ...f, royaltySplitPct: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label>Contract Start</Label>
          <Input type="date" value={form.contractStart} onChange={e => setForm(f => ({ ...f, contractStart: e.target.value }))} />
        </div>
        <div className="space-y-1">
          <Label>Contract End</Label>
          <Input type="date" value={form.contractEnd} onChange={e => setForm(f => ({ ...f, contractEnd: e.target.value }))} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>Bank Details</Label>
          <Button type="button" size="sm" variant="ghost" className="h-6 text-xs"
            onClick={() => setForm(f => ({ ...f, bankKeys: [...f.bankKeys, ""], bankVals: [...f.bankVals, ""] }))}>
            + Add Row
          </Button>
        </div>
        <div className="space-y-1.5">
          {form.bankKeys.map((k, i) => (
            <div key={i} className="flex gap-2">
              <Input placeholder="Field (e.g. account)" value={k}
                onChange={e => setForm(f => { const keys = [...f.bankKeys]; keys[i] = e.target.value; return { ...f, bankKeys: keys }; })} />
              <Input placeholder="Value" value={form.bankVals[i] ?? ""}
                onChange={e => setForm(f => { const vals = [...f.bankVals]; vals[i] = e.target.value; return { ...f, bankVals: vals }; })} />
              {form.bankKeys.length > 1 && (
                <Button type="button" size="icon" variant="ghost" className="shrink-0 h-9 w-9 text-destructive"
                  onClick={() => setForm(f => ({ ...f, bankKeys: f.bankKeys.filter((_, j) => j !== i), bankVals: f.bankVals.filter((_, j) => j !== i) }))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Internal notes…" />
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={upsertMut.isPending}>
          {upsertMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Save Profile
        </Button>
      </div>
    </div>
  );
}

// ── Relationships tab ─────────────────────────────────────────────────────────

const REL_TYPE_LABELS: Record<string, string> = {
  collaborator: "Collaborator", producer: "Producer", engineer: "Engineer",
  venue: "Venue", label: "Label", other: "Other",
};
const ENTITY_TYPE_LABELS: Record<string, string> = {
  artist: "Artist (Roster)", producer: "Producer", engineer: "Engineer",
  venue: "Venue", label: "Label",
};

function RelationshipsTab({ artist, canEdit }: { artist: Artist; canEdit: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rels = [] } = useListArtistRelationships(artist.id, {
    query: { queryKey: getListArtistRelationshipsQueryKey(artist.id) },
  });
  const { data: allArtists = [] } = useListArtists({}, {
    query: { queryKey: [...getListArtistsQueryKey(), "all"] as unknown[] },
  });
  const createRel = useCreateArtistRelationship();
  const deleteRel = useDeleteArtistRelationship();

  const [showForm, setShowForm] = useState(false);
  const [relType, setRelType] = useState("collaborator");
  const [entityType, setEntityType] = useState("artist");
  const [entityId, setEntityId] = useState("");
  const [entityName, setEntityName] = useState("");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setRelType("collaborator"); setEntityType("artist");
    setEntityId(""); setEntityName(""); setNotes(""); setShowForm(false);
  };

  const handleAdd = () => {
    if (entityType === "artist" && !entityId) { toast({ title: "Select an artist", variant: "destructive" }); return; }
    if (entityType !== "artist" && !entityName.trim()) { toast({ title: "Enter entity name", variant: "destructive" }); return; }
    createRel.mutate(
      {
        id: artist.id,
        data: {
          relationshipType: relType as ArtistRelationship["relationshipType"],
          toEntityType: entityType as ArtistRelationship["toEntityType"],
          toEntityId: entityType === "artist" ? parseInt(entityId) : null,
          toEntityName: entityType !== "artist" ? entityName : null,
          notes: notes || null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Relationship added" });
          qc.invalidateQueries({ queryKey: getListArtistRelationshipsQueryKey(artist.id) });
          resetForm();
        },
        onError: () => toast({ title: "Failed to add relationship", variant: "destructive" }),
      },
    );
  };

  const handleDelete = (relId: number) => {
    deleteRel.mutate(
      { id: artist.id, relId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListArtistRelationshipsQueryKey(artist.id) });
          toast({ title: "Relationship removed" });
        },
        onError: () => toast({ title: "Failed to remove", variant: "destructive" }),
      },
    );
  };

  const otherArtists = allArtists.filter(a => a.id !== artist.id);

  return (
    <div className="space-y-3">
      {rels.length === 0 && !showForm && (
        <div className="text-center py-8 text-muted-foreground">
          <Network className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No relationships yet</p>
        </div>
      )}

      {rels.map(rel => {
        const linkedArtist = rel.toEntityType === "artist" && rel.toEntityId
          ? allArtists.find(a => a.id === rel.toEntityId)
          : null;
        const entityLabel = linkedArtist?.name ?? rel.toEntityName ?? `#${rel.toEntityId}`;
        return (
          <div key={rel.id} className="flex items-start gap-2 p-3 bg-zinc-50 rounded-lg border">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded capitalize">{REL_TYPE_LABELS[rel.relationshipType] ?? rel.relationshipType}</span>
                <span className="text-xs text-muted-foreground capitalize">{rel.toEntityType}</span>
                <span className="text-xs font-medium truncate">→ {entityLabel}</span>
              </div>
              {rel.notes && <p className="text-xs text-muted-foreground mt-1">{rel.notes}</p>}
            </div>
            {canEdit && (
              <button
                onClick={() => handleDelete(rel.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                aria-label="Remove relationship"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {canEdit && (
        !showForm ? (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="gap-1.5 w-full">
            <Plus className="h-3.5 w-3.5" /> Add Relationship
          </Button>
        ) : (
          <div className="border rounded-lg p-3 space-y-3 bg-zinc-50">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New Relationship</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={relType} onValueChange={setRelType}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(REL_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Entity Type</Label>
                <Select value={entityType} onValueChange={v => { setEntityType(v); setEntityId(""); setEntityName(""); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ENTITY_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-xs">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {entityType === "artist" ? (
              <div className="space-y-1">
                <Label className="text-xs">Artist</Label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select artist…" /></SelectTrigger>
                  <SelectContent>
                    {otherArtists.map(a => (
                      <SelectItem key={a.id} value={String(a.id)} className="text-xs">{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={entityName} onChange={e => setEntityName(e.target.value)} placeholder="Entity name…" className="h-8 text-xs" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" className="h-8 text-xs" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={resetForm} className="flex-1">Cancel</Button>
              <Button size="sm" onClick={handleAdd} disabled={createRel.isPending} className="flex-1 gap-1">
                {createRel.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Add
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Artist detail sheet ───────────────────────────────────────────────────────

function ArtistSheet({ artist, onClose, onEdit, onDelete, initialTab, initialContext }: {
  artist: Artist; onClose: () => void; onEdit: () => void; onDelete: () => void;
  initialTab?: string; initialContext?: string;
}) {
  const [, navigate] = useLocation();
  const { data: meData } = useGetMe();
  const canEdit = meData?.role === "owner" || meData?.role === "admin" || meData?.role === "manager" || meData?.role === "ar";
  const canDelete = meData?.role === "owner" || meData?.role === "admin" || meData?.permissions?.["artists:delete"] === true;
  const { data: _sheetCustomStatuses = [] } = useListCustomLabelStatuses();
  const sheetStatusLabels: Record<string, string> = { ...STATUS_LABELS, ...Object.fromEntries(_sheetCustomStatuses.map(s => [s.key, s.name])) };
  const sheetStatusColors: Record<string, string> = { ...STATUS_COLORS, ...Object.fromEntries(_sheetCustomStatuses.map(s => [s.key, s.colorClass])) };
  const streaming = (artist.streamingLinks ?? {}) as Record<string, string>;
  const social    = (artist.socialLinks ?? {}) as Record<string, string>;
  const allLinks  = { ...streaming, ...social };
  const statuses  = (artist.labelStatus ?? []) as string[];
  const outreach  = (artist.outreachStatus ?? "new") as OutreachStatus;

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent className="w-[440px] sm:w-[500px] overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-xl">{artist.name}</SheetTitle>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {artist.genre && <p className="text-sm text-muted-foreground">{artist.genre}</p>}
                {(artist.city || artist.state) && (
                  <span className="text-xs text-muted-foreground/70">
                    {[artist.city, artist.state].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <div className="flex flex-wrap gap-1 justify-end">
                {statuses.length > 0 ? statuses.map(s => (
                  <Badge key={s} variant="outline" className={`text-[10px] ${sheetStatusColors[s] ?? ""}`}>{sheetStatusLabels[s] ?? s}</Badge>
                )) : (
                  <Badge variant="outline" className={`text-[10px] ${sheetStatusColors["unsigned"]}`}>{sheetStatusLabels["unsigned"]}</Badge>
                )}
              </div>
              <Badge variant="outline" className={`text-[10px] ${OUTREACH_COLORS[outreach]}`}>
                {OUTREACH_LABELS[outreach]}
              </Badge>
            </div>
          </div>
        </SheetHeader>

        <Tabs defaultValue={initialTab ?? "info"} className="mt-4">
          <TabsList className="w-full grid grid-cols-3 sm:grid-cols-6 text-xs">
            <TabsTrigger value="info" className="text-xs gap-1"><User className="h-3.5 w-3.5 shrink-0" /><span>Info</span></TabsTrigger>
            <TabsTrigger value="ai" className="text-xs gap-1"><Brain className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline">AI</span><span className="sm:hidden">AI</span></TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs gap-1"><ListChecks className="h-3.5 w-3.5 shrink-0" /><span>Tasks</span></TabsTrigger>
            <TabsTrigger value="outreach" className="text-xs gap-1"><MessageSquare className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline">Outreach</span><span className="sm:hidden">Chat</span></TabsTrigger>
            <TabsTrigger value="profile" className="text-xs gap-1"><Star className="h-3.5 w-3.5 shrink-0" /><span>Profile</span></TabsTrigger>
            <TabsTrigger value="network" className="text-xs gap-1"><Network className="h-3.5 w-3.5 shrink-0" /><span className="hidden sm:inline">Rels</span><span className="sm:hidden">Net</span></TabsTrigger>
          </TabsList>

          {/* Info tab */}
          <TabsContent value="info" className="mt-4 space-y-4">
            {artist.bio && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Bio</p>
                <p className="text-sm leading-relaxed">{artist.bio}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {artist.email && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</p>
                  <a href={`mailto:${artist.email}`} className="text-blue-600 hover:underline truncate block">{artist.email}</a>
                </div>
              )}
              {artist.phone && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Phone</p>
                  <p>{artist.phone}</p>
                </div>
              )}
              {artist.revenuePotential && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Revenue Potential</p>
                  <p className="flex items-center gap-1"><DollarSign className="h-3.5 w-3.5 text-green-600" />{artist.revenuePotential}</p>
                </div>
              )}
              {artist.followersEstimate && (
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Followers Est.</p>
                  <p>{artist.followersEstimate}</p>
                </div>
              )}
            </div>

            {artist.tags.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {artist.tags.map(tag => (
                    <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {Object.keys(allLinks).length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Links</p>
                <div className="space-y-1">
                  {Object.entries(allLinks).map(([key, url]) => (
                    <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                      {STREAMING_ICONS[key] ?? <ExternalLink className="h-3.5 w-3.5" />}
                      <span className="capitalize">{key}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="h-3.5 w-3.5 mr-1" />Edit Artist</Button>
              {canDelete && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
                  <Trash2 className="h-3.5 w-3.5 mr-1" />Remove
                </Button>
              )}
              <Button size="sm" variant="ghost" className="ml-auto text-violet-600 hover:text-violet-700"
                onClick={() => { onClose(); navigate("/royalties"); }}>
                <DollarSign className="h-3.5 w-3.5 mr-1" />View Royalties
              </Button>
            </div>
          </TabsContent>

          {/* AI tab */}
          <TabsContent value="ai" className="mt-4">
            <AiAnalysisTab artist={artist} />
          </TabsContent>

          {/* Tasks tab */}
          <TabsContent value="tasks" className="mt-4">
            <TasksTab artist={artist} />
          </TabsContent>

          {/* Outreach tab */}
          <TabsContent value="outreach" className="mt-4">
            <OutreachTab artist={artist} initialContext={initialContext} />
          </TabsContent>

          {/* Profile tab */}
          <TabsContent value="profile" className="mt-4">
            <ProfileTab artist={artist} />
          </TabsContent>

          {/* Network/Relationships tab */}
          <TabsContent value="network" className="mt-4">
            <RelationshipsTab artist={artist} canEdit={canEdit} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

function FilterBar({
  filters, onChange, savedViews, onSaveView, onLoadView, onDeleteView,
}: {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  savedViews: Array<{ id: number; name: string; filters: Record<string, unknown> }>;
  onSaveView: (name: string) => void;
  onLoadView: (id: number) => void;
  onDeleteView: (id: number) => void;
}) {
  const count = activeFilterCount(filters);
  const [viewName, setViewName] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const { data: _fbCustomStatuses = [] } = useListCustomLabelStatuses();
  const fbStatusLabels: Record<string, string> = { ...STATUS_LABELS, ...Object.fromEntries(_fbCustomStatuses.map(s => [s.key, s.name])) };

  function clearAll() { onChange(EMPTY_FILTERS); }

  function handleSave() {
    if (!viewName.trim()) return;
    onSaveView(viewName.trim());
    setViewName(""); setSaveOpen(false);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-8 w-52 text-sm"
          placeholder="Search artists..."
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      {/* Advanced filter popover */}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" variant={count > 0 ? "secondary" : "outline"} className="gap-1.5 h-8">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {count > 0 && <span className="bg-primary text-primary-foreground text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">{count}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4" align="start">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Filter Artists</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Lead Tier</Label>
                <Select value={filters.leadTier || "_all"} onValueChange={v => onChange({ ...filters, leadTier: v === "_all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Any</SelectItem>
                    {(["hot", "warm", "cold", "inactive"] as LeadTier[]).map(t => (
                      <SelectItem key={t} value={t}>{LEAD_TIER_CONFIG[t].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Outreach Status</Label>
                <Select value={filters.outreachStatus || "_all"} onValueChange={v => onChange({ ...filters, outreachStatus: v === "_all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Any</SelectItem>
                    {(Object.keys(OUTREACH_LABELS) as OutreachStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{OUTREACH_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label Status</Label>
                <Select value={filters.labelStatus || "_all"} onValueChange={v => onChange({ ...filters, labelStatus: v === "_all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Any</SelectItem>
                    {(Object.keys(fbStatusLabels) as LabelStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{fbStatusLabels[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Followers Est.</Label>
                <Select value={filters.followersEstimate || "_all"} onValueChange={v => onChange({ ...filters, followersEstimate: v === "_all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Any</SelectItem>
                    {FOLLOWERS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Engagement Level</Label>
                <Select value={filters.engagementLevel || "_all"} onValueChange={v => onChange({ ...filters, engagementLevel: v === "_all" ? "" : v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Any</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Genre</Label>
                <Input className="h-8 text-xs" placeholder="e.g. Hip-Hop" value={filters.genre} onChange={e => onChange({ ...filters, genre: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Input className="h-8 text-xs" placeholder="e.g. Atlanta" value={filters.city} onChange={e => onChange({ ...filters, city: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">State</Label>
                <Input className="h-8 text-xs" placeholder="e.g. GA" value={filters.state} onChange={e => onChange({ ...filters, state: e.target.value })} />
              </div>
            </div>
            {count > 0 && (
              <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground h-7" onClick={clearAll}>
                <X className="h-3 w-3 mr-1" /> Clear all filters
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Active filter chips */}
      {filters.leadTier && (
        <FilterChip label={`Tier: ${LEAD_TIER_CONFIG[filters.leadTier as LeadTier]?.label ?? filters.leadTier}`} onRemove={() => onChange({ ...filters, leadTier: "" })} />
      )}
      {filters.outreachStatus && (
        <FilterChip label={`Outreach: ${OUTREACH_LABELS[filters.outreachStatus as OutreachStatus] ?? filters.outreachStatus}`} onRemove={() => onChange({ ...filters, outreachStatus: "" })} />
      )}
      {filters.labelStatus && (
        <FilterChip label={`Status: ${fbStatusLabels[filters.labelStatus] ?? filters.labelStatus}`} onRemove={() => onChange({ ...filters, labelStatus: "" })} />
      )}
      {filters.genre && <FilterChip label={`Genre: ${filters.genre}`} onRemove={() => onChange({ ...filters, genre: "" })} />}
      {filters.city && <FilterChip label={`City: ${filters.city}`} onRemove={() => onChange({ ...filters, city: "" })} />}
      {filters.state && <FilterChip label={`State: ${filters.state}`} onRemove={() => onChange({ ...filters, state: "" })} />}
      {filters.followersEstimate && <FilterChip label={`Followers: ${filters.followersEstimate}`} onRemove={() => onChange({ ...filters, followersEstimate: "" })} />}
      {filters.engagementLevel && <FilterChip label={`Engagement: ${filters.engagementLevel.charAt(0).toUpperCase() + filters.engagementLevel.slice(1)}`} onRemove={() => onChange({ ...filters, engagementLevel: "" })} />}

      {/* Saved views dropdown */}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 ml-auto">
            <Bookmark className="h-3.5 w-3.5" />
            Saved Views
            {savedViews.length > 0 && <span className="text-[10px] text-muted-foreground">({savedViews.length})</span>}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <div className="space-y-2">
            {savedViews.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">No saved views yet</p>
            )}
            {savedViews.map(view => (
              <div key={view.id} className="flex items-center gap-2 group">
                <button
                  onClick={() => onLoadView(view.id)}
                  className="flex-1 text-left text-xs font-medium hover:text-primary truncate py-1"
                >
                  <BookmarkCheck className="h-3 w-3 inline mr-1.5 text-muted-foreground" />
                  {view.name}
                </button>
                <button
                  onClick={() => onDeleteView(view.id)}
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}

            <div className="pt-2 border-t">
              {saveOpen ? (
                <div className="flex gap-1">
                  <Input
                    className="h-7 text-xs flex-1"
                    placeholder="View name…"
                    value={viewName}
                    onChange={e => setViewName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setSaveOpen(false); }}
                    autoFocus
                  />
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={handleSave} disabled={!viewName.trim()}>Save</Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="w-full h-7 text-xs gap-1 text-muted-foreground" onClick={() => setSaveOpen(true)}>
                  <Plus className="h-3 w-3" /> Save current view
                </Button>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-primary/60"><X className="h-3 w-3" /></button>
    </span>
  );
}

// ── Discovery helpers ─────────────────────────────────────────────────────────

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

// ── Auto-Sweep (candidate discovery) ─────────────────────────────────────────

interface SweepConfig {
  id: number | null;
  genres: string[];
  platforms: string[];
  minFollowers: number;
  maxFollowers: number | null;
  minPopularity: number;
  frequencyHours: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunCount: number;
}

interface SweepCandidate {
  id: number;
  source: string;
  sourceId: string;
  name: string;
  genres: string[];
  followers: number | null;
  popularity: number | null;
  imageUrl: string | null;
  profileUrl: string;
  bio: string | null;
  aiHook: string | null;
  aiLeadTier: string | null;
  status: "new" | "imported" | "dismissed";
  importedArtistId: number | null;
  discoveredAt: string;
}

const TIER_BADGE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  hot:      { label: "Hot",      cls: "bg-red-50 text-red-700 border-red-200",      icon: <Flame className="h-2.5 w-2.5" />     },
  warm:     { label: "Warm",     cls: "bg-amber-50 text-amber-700 border-amber-200", icon: <Zap className="h-2.5 w-2.5" />       },
  cold:     { label: "Cold",     cls: "bg-sky-50 text-sky-700 border-sky-200",       icon: <Snowflake className="h-2.5 w-2.5" /> },
  inactive: { label: "Inactive", cls: "bg-zinc-100 text-zinc-500 border-zinc-300",   icon: <EyeOff className="h-2.5 w-2.5" />    },
};

function SweepView({ onImported, onDraftOutreach, token }: {
  onImported: (id: number) => void;
  onDraftOutreach: (artistId: number, hook: string | null) => void;
  token: string | null;
}) {
  const { toast } = useToast();
  const authHeaders: Record<string, string> = token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };

  // Config
  const [config, setConfig] = useState<SweepConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<SweepConfig | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Candidates
  const [candidates, setCandidates] = useState<SweepCandidate[]>([]);
  const [candStatus, setCandStatus] = useState<"new" | "imported" | "dismissed">("new");
  const [loadingCands, setLoadingCands] = useState(false);

  // Actions
  const [running, setRunning] = useState(false);
  const [importingId, setImportingId] = useState<number | null>(null);
  const [dismissingId, setDismissingId] = useState<number | null>(null);

  // Genre input
  const [genreInput, setGenreInput] = useState("");

  const loadConfig = useCallback(async () => {
    try {
      const r = await fetch("/api/artist-sweeper/config", { headers: authHeaders });
      if (r.ok) {
        const data = await r.json() as SweepConfig;
        setConfig(data);
        setConfigDraft(data);
      }
    } catch { /* non-fatal */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCandidates = useCallback(async (status: "new" | "imported" | "dismissed") => {
    setLoadingCands(true);
    try {
      const r = await fetch(`/api/artist-sweeper/candidates?status=${status}`, { headers: authHeaders });
      if (r.ok) setCandidates(await r.json() as SweepCandidate[]);
    } catch { /* non-fatal */ }
    setLoadingCands(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useEffect(() => { void loadCandidates(candStatus); }, [loadCandidates, candStatus]);

  const saveConfig = async () => {
    if (!configDraft) return;
    setSavingConfig(true);
    try {
      const r = await fetch("/api/artist-sweeper/config", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          genres: configDraft.genres,
          platforms: configDraft.platforms.length ? configDraft.platforms : ["spotify"],
          minFollowers: configDraft.minFollowers,
          maxFollowers: configDraft.maxFollowers,
          minPopularity: configDraft.minPopularity,
          frequencyHours: configDraft.frequencyHours,
          enabled: configDraft.enabled,
        }),
      });
      if (r.ok) {
        const updated = await r.json() as SweepConfig;
        setConfig(updated);
        setConfigDraft(updated);
        setConfigOpen(false);
        toast({ title: "Sweep config saved" });
      } else {
        toast({ title: "Save failed", variant: "destructive" });
      }
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    setSavingConfig(false);
  };

  const runSweep = async () => {
    setRunning(true);
    try {
      const r = await fetch("/api/artist-sweeper/run", { method: "POST", headers: authHeaders });
      if (r.ok) {
        const { found, inserted } = await r.json() as { found: number; inserted: number };
        toast({ title: `Sweep complete — ${inserted} new candidates found (${found} scanned)` });
        await Promise.all([loadConfig(), loadCandidates("new")]);
      } else {
        const d = await r.json() as { error?: string };
        toast({ title: d.error ?? "Sweep failed", variant: "destructive" });
      }
    } catch { toast({ title: "Sweep failed", variant: "destructive" }); }
    setRunning(false);
  };

  const importCandidate = async (cand: SweepCandidate, thenDraft = false) => {
    setImportingId(cand.id);
    try {
      const r = await fetch(`/api/artist-sweeper/candidates/${cand.id}/import`, { method: "POST", headers: authHeaders });
      if (r.ok) {
        const { artistId, alreadyExists } = await r.json() as { artistId: number; alreadyExists: boolean };
        if (!thenDraft) {
          toast({ title: alreadyExists ? "Already in roster" : `${cand.name} added — enriching data…` });
          onImported(artistId);
          setCandidates(prev => prev.filter(c => c.id !== cand.id));
        } else {
          onDraftOutreach(artistId, cand.aiHook);
          setCandidates(prev => prev.filter(c => c.id !== cand.id));
        }
      } else {
        toast({ title: "Import failed", variant: "destructive" });
      }
    } catch { toast({ title: "Import failed", variant: "destructive" }); }
    setImportingId(null);
  };

  const dismissCandidate = async (id: number) => {
    setDismissingId(id);
    try {
      const r = await fetch(`/api/artist-sweeper/candidates/${id}/dismiss`, { method: "POST", headers: authHeaders });
      if (r.ok) setCandidates(prev => prev.filter(c => c.id !== id));
    } catch { /* non-fatal */ }
    setDismissingId(null);
  };

  const addGenre = () => {
    const g = genreInput.trim();
    if (!g || !configDraft) return;
    if (!configDraft.genres.includes(g)) {
      setConfigDraft({ ...configDraft, genres: [...configDraft.genres, g] });
    }
    setGenreInput("");
  };

  const removeGenre = (g: string) => {
    if (!configDraft) return;
    setConfigDraft({ ...configDraft, genres: configDraft.genres.filter(x => x !== g) });
  };

  const togglePlatform = (p: string) => {
    if (!configDraft) return;
    const has = configDraft.platforms.includes(p);
    const next = has ? configDraft.platforms.filter(x => x !== p) : [...configDraft.platforms, p];
    if (next.length === 0) return; // must have at least one
    setConfigDraft({ ...configDraft, platforms: next });
  };

  const newCount = candidates.filter(c => c.status === "new").length;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="border-b bg-white px-6 py-3 shrink-0 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Auto-Sweep</p>
            <p className="text-xs text-muted-foreground truncate">
              {config
                ? config.genres.length
                  ? `${config.genres.slice(0, 3).join(", ")}${config.genres.length > 3 ? ` +${config.genres.length - 3}` : ""} · every ${config.frequencyHours}h`
                  : "No genres configured — add genres to enable sweeping"
                : "Loading config…"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {config?.lastRunAt && (
            <span className="text-[10px] text-muted-foreground hidden sm:block">
              Last run: {new Date(config.lastRunAt).toLocaleString()} · {config.lastRunCount} found
            </span>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 h-8"
            onClick={() => setConfigOpen(o => !o)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Configure
          </Button>
          <Button size="sm" className="gap-1.5 h-8 bg-violet-600 hover:bg-violet-700"
            onClick={() => void runSweep()} disabled={running || !config?.genres.length}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run Sweep
          </Button>
        </div>
      </div>

      {/* Config panel */}
      {configOpen && configDraft && (
        <div className="border-b bg-zinc-50 px-6 py-4 shrink-0 space-y-4">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider">Sweep Configuration</p>

          {/* Genres */}
          <div className="space-y-2">
            <Label className="text-xs">Genres to sweep</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {configDraft.genres.map(g => (
                <span key={g} className="flex items-center gap-1 bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-0.5 text-xs font-medium">
                  {g}
                  <button onClick={() => removeGenre(g)} className="hover:text-red-500"><X className="h-2.5 w-2.5" /></button>
                </span>
              ))}
              {configDraft.genres.length === 0 && <p className="text-xs text-muted-foreground italic">No genres added yet</p>}
            </div>
            <div className="flex gap-2 max-w-sm">
              <Input className="h-8 text-xs" placeholder="e.g. Afrobeats, Drill, R&B…"
                value={genreInput}
                onChange={e => setGenreInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addGenre(); } }}
              />
              <Button size="sm" variant="outline" className="h-8 px-3" onClick={addGenre}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Platforms */}
            <div className="space-y-1.5">
              <Label className="text-xs">Platforms</Label>
              <div className="flex gap-2">
                {(["spotify", "youtube"] as const).map(p => (
                  <button key={p} onClick={() => togglePlatform(p)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      configDraft.platforms.includes(p)
                        ? p === "spotify" ? "bg-green-50 border-green-300 text-green-700" : "bg-red-50 border-red-300 text-red-700"
                        : "bg-white border-zinc-200 text-zinc-400"
                    }`}>
                    {p === "spotify" ? <Disc3 className="h-3 w-3" /> : <Youtube className="h-3 w-3" />}
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Min followers */}
            <div className="space-y-1.5">
              <Label className="text-xs">Min followers</Label>
              <Input className="h-8 text-xs" type="number" min={0}
                value={configDraft.minFollowers}
                onChange={e => setConfigDraft({ ...configDraft, minFollowers: parseInt(e.target.value) || 0 })}
              />
            </div>

            {/* Frequency */}
            <div className="space-y-1.5">
              <Label className="text-xs">Frequency (hours)</Label>
              <Select value={String(configDraft.frequencyHours)}
                onValueChange={v => setConfigDraft({ ...configDraft, frequencyHours: parseInt(v) })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[6, 12, 24, 48, 72, 168].map(h => (
                    <SelectItem key={h} value={String(h)} className="text-xs">
                      Every {h < 24 ? `${h}h` : `${h / 24}d`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Enabled toggle */}
            <div className="space-y-1.5">
              <Label className="text-xs">Auto-sweep</Label>
              <button
                onClick={() => setConfigDraft({ ...configDraft, enabled: !configDraft.enabled })}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border font-medium transition-colors ${
                  configDraft.enabled ? "bg-green-50 border-green-300 text-green-700" : "bg-zinc-50 border-zinc-300 text-zinc-500"
                }`}>
                {configDraft.enabled ? <CheckCircle className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                {configDraft.enabled ? "Enabled" : "Disabled"}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" className="h-8" onClick={() => void saveConfig()} disabled={savingConfig}>
              {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Save config
            </Button>
            <Button size="sm" variant="ghost" className="h-8" onClick={() => { setConfigDraft(config); setConfigOpen(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div className="border-b bg-white px-6 shrink-0">
        <div className="flex gap-0">
          {(["new", "imported", "dismissed"] as const).map(s => (
            <button key={s} onClick={() => setCandStatus(s)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                candStatus === s
                  ? "border-violet-600 text-violet-700"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s === "new" && newCount > 0 && (
                <span className="ml-1.5 bg-violet-100 text-violet-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {newCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Candidates list */}
      <div className="flex-1 overflow-auto p-6">
        {loadingCands && (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        )}

        {!loadingCands && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            {candStatus === "new" ? (
              <>
                <Sparkles className="h-12 w-12 text-muted-foreground/20" />
                <p className="text-sm font-medium text-muted-foreground">No candidates yet</p>
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  {config?.genres.length
                    ? "Click \"Run Sweep\" to discover new artists matching your configured genres."
                    : "Add genres to your sweep config, then run a sweep to discover new artists."}
                </p>
                {!config?.genres.length && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfigOpen(true)}>
                    <SlidersHorizontal className="h-3.5 w-3.5" /> Open Config
                  </Button>
                )}
              </>
            ) : (
              <>
                <Circle className="h-10 w-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">No {candStatus} candidates</p>
              </>
            )}
          </div>
        )}

        {!loadingCands && candidates.length > 0 && (
          <div className="space-y-2">
            {candidates.map(cand => {
              const tier = cand.aiLeadTier ? TIER_BADGE[cand.aiLeadTier] : null;
              return (
                <div key={cand.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-zinc-100 bg-white hover:border-zinc-200 hover:shadow-sm transition-all">
                  {/* Image */}
                  <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-zinc-100 flex items-center justify-center">
                    {cand.imageUrl
                      ? <img src={cand.imageUrl} alt={cand.name} className="w-full h-full object-cover" />
                      : <User className="h-5 w-5 text-zinc-300" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate">{cand.name}</p>
                      {cand.source === "spotify"
                        ? <Disc3 className="h-3 w-3 text-green-600 shrink-0" />
                        : <Youtube className="h-3 w-3 text-red-500 shrink-0" />}
                      {tier && (
                        <span className={`flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${tier.cls}`}>
                          {tier.icon}{tier.label}
                        </span>
                      )}
                    </div>

                    {/* Genres */}
                    {cand.genres.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {cand.genres.slice(0, 4).map(g => (
                          <span key={g} className="text-[10px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded-full">{g}</span>
                        ))}
                      </div>
                    )}

                    {/* Followers + popularity */}
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {cand.followers !== null && cand.followers > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />{fmtFollowers(cand.followers)}
                        </span>
                      )}
                      {cand.popularity !== null && cand.popularity > 0 && (
                        <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full border border-green-200 text-[10px] font-medium">
                          {cand.popularity} pop
                        </span>
                      )}
                    </div>

                    {/* AI hook */}
                    {cand.aiHook && (
                      <p className="text-xs text-violet-600 italic mt-1 flex items-start gap-1">
                        <Sparkles className="h-3 w-3 shrink-0 mt-0.5" />{cand.aiHook}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={cand.profileUrl} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded-md hover:bg-zinc-100 transition-colors"
                      title="Open profile">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {candStatus === "new" && (
                      <>
                        <Button size="sm" variant="outline"
                          className="h-7 px-2 text-xs gap-1 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
                          onClick={() => void dismissCandidate(cand.id)}
                          disabled={dismissingId === cand.id || importingId === cand.id}>
                          {dismissingId === cand.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="outline"
                          className="h-7 px-3 text-xs gap-1 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700"
                          onClick={() => void importCandidate(cand, true)}
                          disabled={importingId === cand.id}
                          title="Import & open outreach with AI hook pre-filled">
                          {importingId === cand.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><Mail className="h-3 w-3" />Draft</>}
                        </Button>
                        <Button size="sm"
                          className="h-7 px-3 text-xs gap-1 bg-violet-600 hover:bg-violet-700"
                          onClick={() => void importCandidate(cand)}
                          disabled={importingId === cand.id}>
                          {importingId === cand.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <><Plus className="h-3 w-3" />Import</>}
                        </Button>
                      </>
                    )}
                    {candStatus === "imported" && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-green-600 font-medium flex items-center gap-1">
                          <CheckCircle className="h-3 w-3" />In roster
                        </span>
                        {cand.importedArtistId && (
                          <Button size="sm" variant="outline"
                            className="h-6 px-2 text-[10px] gap-0.5 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700"
                            onClick={() => onDraftOutreach(cand.importedArtistId!, cand.aiHook)}
                            title="Open outreach with AI hook pre-filled">
                            <Mail className="h-3 w-3" />Draft
                          </Button>
                        )}
                      </div>
                    )}
                    {candStatus === "dismissed" && (
                      <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                        <EyeOff className="h-3 w-3" />Dismissed
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Discover tab ──────────────────────────────────────────────────────────────

function DiscoverTab({ onImported, onDraftOutreach }: {
  onImported: (artistId: number) => void;
  onDraftOutreach: (artistId: number, hook: string | null) => void;
}) {
  const { toast } = useToast();
  const { token: discoverToken } = useAuth();
  const importArtist = useImportDiscoveredArtist();
  const [discoverMode, setDiscoverMode] = useState<"sweep" | "search">("sweep");
  type DiscoverPlatform = "spotify" | "youtube" | "bandcamp" | "groover";
  const [platform, setPlatform] = useState<DiscoverPlatform>("spotify");
  const [inputQ, setInputQ] = useState("");
  const [inputGenre, setInputGenre] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [submittedGenre, setSubmittedGenre] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlImporting, setUrlImporting] = useState(false);

  // Spotify pagination: offset-based
  const [spotifyOffset, setSpotifyOffset] = useState(0);
  const SPOTIFY_LIMIT = 20;

  // YouTube pagination: cursor-based
  const [ytPageTokenStack, setYtPageTokenStack] = useState<string[]>([]); // history stack
  const [ytPageToken, setYtPageToken] = useState<string | undefined>(undefined);

  const spotifyQuery = useSearchSpotifyArtists(
    { q: submittedQ, genre: submittedGenre || undefined, limit: SPOTIFY_LIMIT, offset: spotifyOffset },
    { query: { enabled: platform === "spotify" && !!submittedQ, queryKey: ["discoverSpotify", submittedQ, submittedGenre, spotifyOffset] } },
  );

  const youtubeQuery = useSearchYoutubeChannels(
    { q: submittedQ, limit: 20, pageToken: ytPageToken },
    { query: { enabled: platform === "youtube" && !!submittedQ, queryKey: ["discoverYoutube", submittedQ, ytPageToken ?? ""] } },
  );

  const activeQuery = platform === "spotify" ? spotifyQuery : youtubeQuery;
  const isErr503 = (activeQuery.error as { status?: number } | null)?.status === 503;

  // Paginated result shapes
  const spotifyPage = spotifyQuery.data;
  const ytPage = youtubeQuery.data;
  const spotifyResults = spotifyPage?.results ?? [];
  const ytResults = ytPage?.results ?? [];
  const activeResults = platform === "spotify" ? spotifyResults : ytResults;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = inputQ.trim();
    if (!q) return;
    setSubmittedQ(q);
    setSubmittedGenre(inputGenre.trim());
    setSpotifyOffset(0);
    setYtPageToken(undefined);
    setYtPageTokenStack([]);
  }

  function handlePlatformSwitch(p: DiscoverPlatform) {
    setPlatform(p);
    setSubmittedQ("");
    setInputQ("");
    setInputGenre("");
    setUrlInput("");
    setSpotifyOffset(0);
    setYtPageToken(undefined);
    setYtPageTokenStack([]);
  }

  async function handleUrlImport() {
    const url = urlInput.trim();
    if (!url) return;
    setUrlImporting(true);
    let name = "Unknown Artist";
    try {
      if (platform === "bandcamp") {
        const sub = url.match(/https?:\/\/([^.]+)\.bandcamp\.com/);
        if (sub) name = sub[1].replace(/-/g, " ");
        else name = url.split("/").filter(Boolean).pop() ?? "Unknown Artist";
      } else if (platform === "groover") {
        const slug = url.split("/band/")[1]?.split("/")[0] ?? url.split("/").filter(Boolean).pop() ?? "Unknown Artist";
        name = slug.replace(/-/g, " ");
      }
      name = name.trim() ? name.replace(/\b\w/g, c => c.toUpperCase()) : "Unknown Artist";
    } catch { name = "Unknown Artist"; }
    try {
      const r = await fetch("/api/discovery/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${discoverToken}` },
        body: JSON.stringify({ source: platform, sourceId: url, name, genres: [], imageUrl: null, profileUrl: url, bio: null }),
      });
      if (r.ok) {
        const { artistId, alreadyExists } = await r.json() as { artistId: number; alreadyExists: boolean };
        toast({ title: alreadyExists ? "Artist already in CRM" : `${name} added to roster` });
        onImported(artistId);
        setUrlInput("");
      } else {
        toast({ title: "Import failed", variant: "destructive" });
      }
    } catch { toast({ title: "Import failed", variant: "destructive" }); }
    setUrlImporting(false);
  }

  function spotifyPrev() {
    setSpotifyOffset(o => Math.max(0, o - SPOTIFY_LIMIT));
  }
  function spotifyNext() {
    setSpotifyOffset(o => o + SPOTIFY_LIMIT);
  }

  function ytNext() {
    const next = ytPage?.nextPageToken;
    if (!next) return;
    setYtPageTokenStack(s => [...s, ytPageToken ?? ""]);
    setYtPageToken(next);
  }
  function ytPrev() {
    const stack = [...ytPageTokenStack];
    const prev = stack.pop();
    setYtPageTokenStack(stack);
    setYtPageToken(prev === "" ? undefined : prev);
  }

  function handleAddToRoster(source: "spotify" | "youtube", r: SpotifyArtistResult | YoutubeChannelResult) {
    const sp = r as SpotifyArtistResult;
    const yt = r as YoutubeChannelResult;
    const genres = source === "spotify" ? sp.genres : yt.topicCategories ?? [];
    importArtist.mutate(
      {
        data: {
          source,
          sourceId: r.id,
          name: r.name,
          genres,
          imageUrl: source === "spotify" ? (sp.imageUrl ?? null) : (yt.thumbnailUrl ?? null),
          profileUrl: r.profileUrl,
          bio: source === "youtube" ? (yt.description || null) : null,
        },
      },
      {
        onSuccess: ({ artistId, alreadyExists }) => {
          toast({ title: alreadyExists ? "Artist already in CRM" : "Artist added to roster" });
          onImported(artistId);
        },
        onError: () => {
          toast({ title: "Import failed", variant: "destructive" });
        },
      },
    );
  }

  const showPagination = !!submittedQ && !activeQuery.isFetching && !activeQuery.error && activeResults.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Mode toggle */}
      <div className="border-b bg-white px-6 py-2 shrink-0 flex items-center gap-1">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
          <button
            onClick={() => setDiscoverMode("sweep")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              discoverMode === "sweep" ? "bg-white shadow text-violet-700" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            <Sparkles className="h-3 w-3" /> Auto-Sweep
          </button>
          <button
            onClick={() => setDiscoverMode("search")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              discoverMode === "search" ? "bg-white shadow text-zinc-700" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            <Search className="h-3 w-3" /> Manual Search
          </button>
        </div>
      </div>

      {/* Sweep view */}
      {discoverMode === "sweep" && (
        <SweepView onImported={onImported} onDraftOutreach={onDraftOutreach} token={discoverToken} />
      )}

      {/* Manual search */}
      {discoverMode === "search" && <div className="flex flex-col flex-1 overflow-hidden">
      {/* Search header */}
      <div className="border-b px-6 py-4 space-y-3 bg-white shrink-0">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-violet-600" />
          <p className="text-sm font-medium text-muted-foreground">
            {platform === "bandcamp" || platform === "groover"
              ? `Import an artist from ${platform === "bandcamp" ? "Bandcamp" : "Groover"} by pasting their profile URL`
              : "Search Spotify and YouTube for new talent to add to your A&R roster"}
          </p>
        </div>

        {/* Platform selector */}
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 w-fit flex-wrap">
          {(["spotify", "youtube", "bandcamp", "groover"] as const).map(p => {
            const PLATFORM_STYLES: Record<string, string> = {
              spotify:  "text-green-700",
              youtube:  "text-red-600",
              bandcamp: "text-sky-600",
              groover:  "text-violet-600",
            };
            return (
              <button key={p} onClick={() => handlePlatformSwitch(p)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  platform === p ? `bg-white shadow ${PLATFORM_STYLES[p]}` : "text-zinc-500 hover:text-zinc-700"
                }`}>
                {p === "spotify"  && <Disc3   className="h-3.5 w-3.5" />}
                {p === "youtube"  && <Youtube className="h-3.5 w-3.5" />}
                {p === "bandcamp" && <Radio   className="h-3.5 w-3.5" />}
                {p === "groover"  && <Zap     className="h-3.5 w-3.5" />}
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            );
          })}
        </div>

        {/* Search form (Spotify / YouTube) */}
        {(platform === "spotify" || platform === "youtube") && (
          <form onSubmit={handleSearch} className="flex flex-wrap gap-2 max-w-2xl">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder={platform === "spotify" ? "Artist name or keyword…" : "Channel name or keyword…"}
                value={inputQ}
                onChange={e => setInputQ(e.target.value)}
              />
            </div>
            {platform === "spotify" && (
              <Input className="h-9 w-36" placeholder="Genre (optional)"
                value={inputGenre} onChange={e => setInputGenre(e.target.value)} />
            )}
            <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={!inputQ.trim() || activeQuery.isFetching}>
              {activeQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Search
            </Button>
          </form>
        )}

        {/* URL import form (Bandcamp / Groover) */}
        {(platform === "bandcamp" || platform === "groover") && (
          <div className="flex gap-2 max-w-2xl">
            <div className="relative flex-1">
              <Link2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="pl-8 h-9"
                placeholder={platform === "bandcamp" ? "https://artistname.bandcamp.com" : "https://groover.co/en/band/artist-slug/"}
                value={urlInput} onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleUrlImport(); } }}
              />
            </div>
            <Button size="sm" className="h-9 gap-1.5" disabled={!urlInput.trim() || urlImporting} onClick={() => void handleUrlImport()}>
              {urlImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Import Artist
            </Button>
          </div>
        )}
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-auto p-6">
        {/* API key / config warning */}
        {isErr503 && (() => {
          const errData = (activeQuery.error as { response?: { data?: { missingKey?: string } } } | null)
            ?.response?.data;
          const isPremium = errData?.missingKey === "SPOTIFY_PREMIUM";
          return (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 flex items-start gap-2.5 max-w-lg">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <div>
                <p className="font-semibold">
                  {isPremium ? "Spotify Premium required" : "API key not configured"}
                </p>
                <p className="text-xs mt-1 leading-relaxed">
                  {isPremium
                    ? "The Spotify app credentials belong to an account without an active Spotify Premium subscription. Spotify's Web API requires Premium to use the search endpoint. Please upgrade the app owner's account or create a new Spotify app under a Premium account."
                    : platform === "spotify"
                      ? "An admin needs to add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the environment variables."
                      : "An admin needs to add YOUTUBE_API_KEY to the environment variables."}
                </p>
              </div>
            </div>
          );
        })()}

        {/* Loading */}
        {activeQuery.isFetching && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state (before first search / URL import) */}
        {!submittedQ && !activeQuery.isFetching && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            {platform === "spotify"  && <Disc3  className="h-12 w-12 text-muted-foreground/20 mb-3" />}
            {platform === "youtube"  && <Youtube className="h-12 w-12 text-muted-foreground/20 mb-3" />}
            {platform === "bandcamp" && <Radio  className="h-12 w-12 text-muted-foreground/20 mb-3" />}
            {platform === "groover"  && <Zap    className="h-12 w-12 text-muted-foreground/20 mb-3" />}
            {(platform === "spotify" || platform === "youtube") ? (
              <>
                <p className="text-sm font-medium text-muted-foreground">
                  Search {platform === "spotify" ? "Spotify" : "YouTube"} for artists
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
                  Find new talent by name, genre, or keyword. Click "Add to Roster" to open the create form pre-filled with their details.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-muted-foreground">
                  Import from {platform === "bandcamp" ? "Bandcamp" : "Groover"}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-xs">
                  {platform === "bandcamp"
                    ? "Paste an artist's Bandcamp page URL above (e.g. artistname.bandcamp.com) to add them to your roster."
                    : "Paste a Groover band profile URL above (e.g. groover.co/en/band/artist-slug) to add them to your roster."}
                </p>
              </>
            )}
          </div>
        )}

        {/* No results */}
        {submittedQ && !activeQuery.isFetching && !isErr503 && !activeQuery.error && activeResults.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Search className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No results for "{submittedQ}"</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try a different keyword or artist name.</p>
          </div>
        )}

        {/* Other error */}
        {activeQuery.error && !isErr503 && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700 flex items-start gap-2.5 max-w-lg">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>Search failed. Please try again.</p>
          </div>
        )}

        {/* Results grid */}
        {!activeQuery.isFetching && activeResults.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground">
                {platform === "spotify" && spotifyPage
                  ? `Showing ${spotifyOffset + 1}–${spotifyOffset + spotifyResults.length} of ${spotifyPage.total.toLocaleString()} results for "${submittedQ}"`
                  : `${ytResults.length} result${ytResults.length !== 1 ? "s" : ""} for "${submittedQ}"`}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {platform === "spotify"
                ? spotifyResults.map(r => (
                    <SpotifyArtistCard
                      key={r.id}
                      result={r}
                      onAddToRoster={() => handleAddToRoster("spotify", r)}
                    />
                  ))
                : ytResults.map(r => (
                    <YoutubeChannelCard
                      key={r.id}
                      result={r}
                      onAddToRoster={() => handleAddToRoster("youtube", r)}
                    />
                  ))}
            </div>

            {/* Pagination controls */}
            {showPagination && (
              <div className="flex items-center justify-center gap-3 mt-6">
                {platform === "spotify" ? (
                  <>
                    <Button
                      variant="outline" size="sm"
                      onClick={spotifyPrev}
                      disabled={spotifyOffset === 0 || activeQuery.isFetching}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {Math.floor(spotifyOffset / SPOTIFY_LIMIT) + 1}
                      {spotifyPage ? ` of ${Math.ceil(spotifyPage.total / SPOTIFY_LIMIT)}` : ""}
                    </span>
                    <Button
                      variant="outline" size="sm"
                      onClick={spotifyNext}
                      disabled={
                        activeQuery.isFetching ||
                        (!!spotifyPage && spotifyOffset + SPOTIFY_LIMIT >= spotifyPage.total)
                      }
                    >
                      Next
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline" size="sm"
                      onClick={ytPrev}
                      disabled={ytPageTokenStack.length === 0 || activeQuery.isFetching}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={ytNext}
                      disabled={!ytPage?.nextPageToken || activeQuery.isFetching}
                    >
                      Next
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>}
    </div>
  );
}

function SpotifyArtistCard({ result, onAddToRoster }: {
  result: SpotifyArtistResult;
  onAddToRoster: () => void;
}) {
  const already = result.importedArtistId != null;
  return (
    <Card className="overflow-hidden">
      {result.imageUrl ? (
        <div className="h-28 bg-zinc-100 overflow-hidden">
          <img src={result.imageUrl} alt={result.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="h-28 bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center">
          <Disc3 className="h-10 w-10 text-green-300" />
        </div>
      )}
      <CardContent className="p-3 space-y-2">
        <div>
          <p className="font-semibold text-sm truncate">{result.name}</p>
          {result.genres.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">{result.genres.slice(0, 3).join(", ")}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />
          <span>{fmtFollowers(result.followers)}</span>
          {result.popularity > 0 && (
            <span className="ml-auto text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full font-medium border border-green-200">
              {result.popularity} pop
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 pt-0.5">
          <a href={result.profileUrl} target="_blank" rel="noopener noreferrer"
            className="shrink-0 p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {already ? (
            <span className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
              <CheckCircle className="h-3.5 w-3.5" /> In CRM
            </span>
          ) : (
            <Button size="sm" className="flex-1 h-7 text-xs gap-1" onClick={onAddToRoster}>
              <Plus className="h-3 w-3" /> Add to Roster
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function YoutubeChannelCard({ result, onAddToRoster }: {
  result: YoutubeChannelResult;
  onAddToRoster: () => void;
}) {
  const already = result.importedArtistId != null;
  return (
    <Card className="overflow-hidden">
      {result.thumbnailUrl ? (
        <div className="h-28 bg-zinc-100 overflow-hidden">
          <img src={result.thumbnailUrl} alt={result.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="h-28 bg-gradient-to-br from-red-50 to-rose-100 flex items-center justify-center">
          <Youtube className="h-10 w-10 text-red-300" />
        </div>
      )}
      <CardContent className="p-3 space-y-2">
        <div>
          <p className="font-semibold text-sm truncate">{result.name}</p>
          {result.topicCategories.length > 0 ? (
            <p className="text-xs text-muted-foreground truncate">{result.topicCategories.slice(0, 2).join(", ")}</p>
          ) : result.description ? (
            <p className="text-xs text-muted-foreground line-clamp-1">{result.description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="h-3 w-3" />{fmtFollowers(result.subscriberCount)} subs</span>
          <span>{result.videoCount.toLocaleString()} videos</span>
        </div>
        <div className="flex items-center gap-1.5 pt-0.5">
          <a href={result.profileUrl} target="_blank" rel="noopener noreferrer"
            className="shrink-0 p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {already ? (
            <span className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
              <CheckCircle className="h-3.5 w-3.5" /> In CRM
            </span>
          ) : (
            <Button size="sm" className="flex-1 h-7 text-xs gap-1" onClick={onAddToRoster}>
              <Plus className="h-3 w-3" /> Add to Roster
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Outreach Queue panel (global view) ────────────────────────────────────────

type QueueItem = import("@workspace/api-client-react").OutreachQueueItem;

function OutreachQueuePanel({ onOpenArtist }: { onOpenArtist: (id: number) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editingItem, setEditingItem] = useState<QueueItem | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: queue = [], isLoading } = useGetOutreachQueue();
  const updateMut   = useUpdateOutreachQueueItem();
  const discardMut  = useDeleteOutreachQueueItem();
  const sendMut     = useSendOutreachMessage();
  const approveMut  = useUpdateOutreachMessage();
  const bulkSendMut = useBulkSendOutreach();

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetOutreachQueueQueryKey() });

  function handleApprove(artistId: number, msgId: number) {
    approveMut.mutate(
      { id: artistId, msgId, data: { status: "approved" } },
      {
        onSuccess: () => { toast({ title: "Approved — ready to send" }); invalidate(); },
        onError: () => toast({ title: "Failed to approve", variant: "destructive" }),
      },
    );
  }

  function handleSend(artistId: number, msgId: number, recipientEmail: string | null | undefined) {
    if (!recipientEmail) {
      toast({ title: "No recipient email — open the artist and set one first", variant: "destructive" });
      return;
    }
    sendMut.mutate(
      { id: artistId, msgId },
      {
        onSuccess: () => { toast({ title: "Sent via Outlook" }); invalidate(); },
        onError: () => toast({ title: "Send failed — check Outlook connection", variant: "destructive" }),
      },
    );
  }

  function handleDiscard(msgId: number) {
    discardMut.mutate(
      { msgId },
      {
        onSuccess: () => { toast({ title: "Discarded from queue" }); invalidate(); setSelectedIds(s => { const n = new Set(s); n.delete(msgId); return n; }); },
        onError: () => toast({ title: "Discard failed", variant: "destructive" }),
      },
    );
  }

  function toggleSelect(msgId: number) {
    setSelectedIds(s => { const n = new Set(s); n.has(msgId) ? n.delete(msgId) : n.add(msgId); return n; });
  }

  function handleBulkSend() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    bulkSendMut.mutate(
      { data: { msgIds: ids } },
      {
        onSuccess: (result) => {
          invalidate();
          setSelectedIds(new Set());
          const s = result.sent.length, f = result.failed.length;
          if (f === 0) {
            toast({ title: `Bulk send complete — ${s} message${s !== 1 ? "s" : ""} sent` });
          } else {
            toast({
              title: `${s} sent, ${f} failed`,
              description: result.failed.map(e => `#${e.id}: ${e.reason}`).join("; "),
              variant: "destructive",
            });
          }
        },
        onError: () => toast({ title: "Bulk send failed", variant: "destructive" }),
      },
    );
  }

  function openEdit(item: QueueItem) {
    setEditingItem(item);
    setEditBody(item.body);
    setEditSubject(item.subject ?? "");
    setEditEmail(item.recipientEmail ?? "");
  }

  function handleSaveEdit() {
    if (!editingItem) return;
    updateMut.mutate(
      { msgId: editingItem.id, data: { subject: editSubject, body: editBody, recipientEmail: editEmail || null } },
      {
        onSuccess: () => { toast({ title: "Saved" }); invalidate(); setEditingItem(null); },
        onError: () => toast({ title: "Save failed", variant: "destructive" }),
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (editingItem) {
    return (
      <div className="flex-1 overflow-auto p-6 space-y-3 max-w-2xl">
        <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => setEditingItem(null)}>← Back to queue</button>
        <p className="text-sm font-semibold">
          Editing: {(editingItem as QueueItem & { artistName: string }).artistName}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{OUTREACH_TYPE_LABELS[editingItem.type]}</span>
        </p>
        <div className="space-y-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
            <input className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              value={editSubject} onChange={e => setEditSubject(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Recipient Email</label>
            <input className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
              value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="recipient@example.com" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message Body</label>
            <textarea rows={10} className="w-full text-sm border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
              value={editBody} onChange={e => setEditBody(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="text-xs" onClick={handleSaveEdit} disabled={updateMut.isPending}>Save Changes</Button>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setEditingItem(null)}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-10">
        <MessageSquare className="h-12 w-12 text-muted-foreground/20" />
        <p className="text-base font-medium text-muted-foreground">Outreach queue is empty</p>
        <p className="text-sm text-muted-foreground/70 max-w-xs">
          Open any artist, go to the Outreach tab, and generate a draft to get started.
        </p>
      </div>
    );
  }

  const drafts   = queue.filter(m => m.status === "draft");
  const approved = queue.filter(m => m.status === "approved");

  const renderGroup = (title: string, items: typeof queue, badgeClass: string, isApproved = false) => {
    if (items.length === 0) return null;
    const allSelected = isApproved && items.length > 0 && items.every(m => selectedIds.has(m.id));

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {isApproved && (
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded cursor-pointer accent-violet-600"
              checked={allSelected}
              onChange={() => {
                if (allSelected) {
                  setSelectedIds(s => { const n = new Set(s); items.forEach(m => n.delete(m.id)); return n; });
                } else {
                  setSelectedIds(s => { const n = new Set(s); items.forEach(m => n.add(m.id)); return n; });
                }
              }}
              title="Select all approved"
            />
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>{title}</span>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        {items.map(msg => (
          <div key={msg.id} className={`border rounded-xl px-4 py-3 bg-card hover:bg-muted/20 transition-colors space-y-2 ${
            isApproved && selectedIds.has(msg.id) ? "ring-1 ring-violet-400" : ""
          }`}>
            <div className="flex items-start justify-between gap-3">
              {isApproved && (
                <input
                  type="checkbox"
                  className="mt-1 h-3.5 w-3.5 shrink-0 rounded cursor-pointer accent-violet-600"
                  checked={selectedIds.has(msg.id)}
                  onChange={() => toggleSelect(msg.id)}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <button
                    className="text-sm font-semibold text-violet-700 hover:underline truncate"
                    onClick={() => onOpenArtist(msg.artistId)}
                  >
                    {(msg as QueueItem & { artistName: string }).artistName}
                  </button>
                  {(msg as QueueItem & { artistGenre?: string | null }).artistGenre && (
                    <span className="text-xs text-muted-foreground">· {(msg as QueueItem & { artistGenre?: string | null }).artistGenre}</span>
                  )}
                </div>
                <p className="text-xs font-medium text-foreground truncate">{msg.subject || OUTREACH_TYPE_LABELS[msg.type]}</p>
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{msg.body}</p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium capitalize">
                  {OUTREACH_TYPE_LABELS[msg.type]}
                </span>
                {msg.recipientEmail && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" />{msg.recipientEmail}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t flex-wrap">
              <span className="text-[10px] text-muted-foreground mr-auto">
                By {(msg as QueueItem & { creatorName: string }).creatorName} · {new Date(msg.createdAt).toLocaleDateString()}
              </span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground"
                onClick={() => openEdit(msg)}>
                <Pencil className="h-3 w-3 mr-1" />Edit
              </Button>
              {msg.status === "draft" && (
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs text-blue-700 border-blue-200 hover:bg-blue-50"
                  onClick={() => handleApprove(msg.artistId, msg.id)} disabled={approveMut.isPending}>
                  <CheckCircle className="h-3 w-3 mr-1" />Approve
                </Button>
              )}
              {msg.status === "approved" && (
                <Button size="sm" className="h-6 px-2 text-xs bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={() => handleSend(msg.artistId, msg.id, msg.recipientEmail)} disabled={sendMut.isPending}>
                  <Send className="h-3 w-3 mr-1" />Send
                </Button>
              )}
              {msg.status === "draft" && (
                <span className="text-[10px] text-amber-600">Needs approval first</span>
              )}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive"
                onClick={() => handleDiscard(msg.id)} disabled={discardMut.isPending}>
                <Trash className="h-3 w-3 mr-1" />Discard
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs"
                onClick={() => onOpenArtist(msg.artistId)}>
                Open Artist
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <MessageSquare className="h-5 w-5 text-violet-600" />
        <h2 className="text-base font-semibold">Outreach Queue</h2>
        <span className="text-xs text-muted-foreground">({queue.length} pending)</span>
        {selectedIds.size > 0 && (
          <Button size="sm" className="ml-auto text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
            onClick={handleBulkSend} disabled={bulkSendMut.isPending}>
            {bulkSendMut.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />}
            Bulk Send ({selectedIds.size})
          </Button>
        )}
      </div>
      {renderGroup("Drafts — Awaiting Approval", drafts, "bg-zinc-100 text-zinc-600", false)}
      {renderGroup("Approved — Ready to Send", approved, "bg-blue-100 text-blue-700", true)}
    </div>
  );
}

// ── Duplicates Tab ────────────────────────────────────────────────────────────

interface DuplicatePair {
  id: number;
  artistIdA: number;
  artistIdB: number;
  confidenceScore: number;
  evidence: string[];
  status: string;
  artistA: Artist | null;
  artistB: Artist | null;
  createdAt: string;
}

function confBadge(score: number) {
  if (score >= 0.85) return { label: "High", cls: "bg-red-50 text-red-700 border border-red-200" };
  if (score >= 0.60) return { label: "Medium", cls: "bg-amber-50 text-amber-700 border border-amber-200" };
  return { label: "Low", cls: "bg-blue-50 text-blue-700 border border-blue-200" };
}

const MERGEABLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "name", label: "Name" },
  { key: "genre", label: "Genre" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "bio", label: "Bio" },
  { key: "labelStatus", label: "Label Status" },
  { key: "outreachStatus", label: "Outreach Status" },
  { key: "revenuePotential", label: "Revenue" },
  { key: "followersEstimate", label: "Followers" },
  { key: "engagementLevel", label: "Engagement" },
];

function fieldVal(artist: Artist | null, key: string): string {
  if (!artist) return "—";
  const v = (artist as unknown as Record<string, unknown>)[key];
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function DuplicatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<DuplicatePair | null>(null);
  const [fieldPrefs, setFieldPrefs] = useState<Record<string, "a" | "b">>({});
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending");
  const [swapped, setSwapped] = useState(false);

  const { data: rawCandidates = [], isLoading } = useListArtistDuplicates(
    { status: statusFilter },
    { query: { queryKey: getListArtistDuplicatesQueryKey({ status: statusFilter }) } },
  );
  const candidates = rawCandidates as DuplicatePair[];

  const updateMut = useUpdateArtistDuplicate();
  const mergeMut = useMergeArtists();
  const scanMut = useScanArtistDuplicates();

  function openPair(pair: DuplicatePair) {
    setSelected(pair);
    setFieldPrefs({});
    setSwapped(false);
  }

  function handleSwap() {
    setSwapped(s => !s);
    // Mirror field prefs: "a"↔"b" so the user's selections stay semantically correct
    setFieldPrefs(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === "a" ? "b" : "a"])));
  }

  function handleDismiss(id: number) {
    updateMut.mutate({ id, data: { status: "dismissed" } }, {
      onSuccess: () => {
        toast({ title: "Marked as not a duplicate" });
        qc.invalidateQueries({ queryKey: getListArtistDuplicatesQueryKey() });
        setSelected(null);
      },
      onError: () => toast({ title: "Action failed", variant: "destructive" }),
    });
  }

  function handleMerge() {
    if (!selected) return;
    const primaryId  = swapped ? selected.artistIdB : selected.artistIdA;
    const secondaryId = swapped ? selected.artistIdA : selected.artistIdB;
    mergeMut.mutate({
      data: {
        primaryId,
        secondaryId,
        fieldPreferences: fieldPrefs,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Artists merged successfully" });
        qc.invalidateQueries({ queryKey: getListArtistsQueryKey() });
        qc.invalidateQueries({ queryKey: getListArtistDuplicatesQueryKey() });
        setSelected(null);
      },
      onError: () => toast({ title: "Merge failed", variant: "destructive" }),
    });
  }

  function handleScan() {
    scanMut.mutate(undefined, {
      onSuccess: (res) => {
        const r = res as { candidates: number };
        toast({ title: `Scan complete — ${r.candidates} pair(s) found` });
        qc.invalidateQueries({ queryKey: getListArtistDuplicatesQueryKey() });
      },
      onError: () => toast({ title: "Scan failed", variant: "destructive" }),
    });
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Duplicate Candidates</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Suspected duplicate profiles detected by fuzzy name matching and social handle overlap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-100 rounded-lg p-0.5">
            {(["pending", "all"] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize ${
                  statusFilter === s ? "bg-white shadow text-zinc-900" : "text-zinc-500"
                }`}
              >
                {s === "pending" ? "Pending" : "All"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={handleScan} disabled={scanMut.isPending} className="gap-1.5">
            {scanMut.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            Scan Now
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-300" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <Copy className="h-10 w-10 text-zinc-200" />
          <p className="text-sm font-medium text-zinc-500">No duplicate candidates</p>
          <p className="text-xs text-zinc-400 max-w-xs">
            {statusFilter === "pending"
              ? "No pending duplicates. Run a scan to check for new matches."
              : "No candidates yet. Run a scan to get started."}
          </p>
          <Button size="sm" variant="outline" onClick={handleScan} disabled={scanMut.isPending} className="gap-1.5 mt-1">
            {scanMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Run Scan
          </Button>
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden shadow-sm bg-white divide-y">
          {candidates.map(pair => {
            const { label, cls } = confBadge(pair.confidenceScore);
            return (
              <button
                key={pair.id}
                onClick={() => openPair(pair)}
                className="w-full text-left px-4 py-3.5 hover:bg-zinc-50 transition-colors flex items-center gap-3"
              >
                <div className="shrink-0 flex items-center -space-x-2">
                  <div className="h-8 w-8 rounded-full bg-violet-100 flex items-center justify-center border-2 border-white text-xs font-bold text-violet-700 uppercase">
                    {(pair.artistA?.name ?? "?")[0]}
                  </div>
                  <div className="h-8 w-8 rounded-full bg-pink-100 flex items-center justify-center border-2 border-white text-xs font-bold text-pink-700 uppercase">
                    {(pair.artistB?.name ?? "?")[0]}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900 truncate">
                      {pair.artistA?.name ?? `Artist #${pair.artistIdA}`}
                    </span>
                    <GitMerge className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                    <span className="text-sm font-medium text-zinc-900 truncate">
                      {pair.artistB?.name ?? `Artist #${pair.artistIdB}`}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">
                    {(pair.evidence as string[]).slice(0, 2).join(" · ")}
                    {(pair.evidence as string[]).length > 2 && ` · +${(pair.evidence as string[]).length - 2} more`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                  {pair.status !== "pending" && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 capitalize">{pair.status}</span>
                  )}
                  <span className="text-xs text-zinc-400 tabular-nums">{Math.round(pair.confidenceScore * 100)}%</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Side-by-side comparison sheet */}
      <Sheet open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0 flex flex-col">
          {selected && (
            <>
              <SheetHeader className="px-6 py-4 border-b shrink-0">
                <SheetTitle className="flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-violet-600" /> Compare &amp; Merge
                </SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    const { label, cls } = confBadge(selected.confidenceScore);
                    return (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cls}`}>
                        {label} confidence ({Math.round(selected.confidenceScore * 100)}%)
                      </span>
                    );
                  })()}
                </div>
                {(selected.evidence as string[]).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(selected.evidence as string[]).map((e, i) => (
                      <span key={i} className="text-[11px] bg-violet-50 text-violet-700 border border-violet-200 rounded px-2 py-0.5">{e}</span>
                    ))}
                  </div>
                )}
              </SheetHeader>

              <div className="flex-1 overflow-auto px-6 py-4 space-y-2">
                {/* Primary / secondary selection + swap */}
                <div className="grid grid-cols-[1fr_56px_1fr] gap-2 mb-1">
                  <div className={`rounded-lg px-3 py-2 text-center border-2 ${swapped ? "border-transparent bg-pink-50" : "border-violet-300 bg-violet-50"}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-0.5">
                      {swapped ? "Secondary (deleted)" : "Primary (kept)"}
                    </p>
                    <p className="text-xs font-semibold text-zinc-800 truncate">
                      {selected.artistA?.name ?? `#${selected.artistIdA}`}
                    </p>
                  </div>
                  <div className="flex items-center justify-center">
                    <button
                      onClick={handleSwap}
                      title="Swap which artist is kept as primary"
                      className="flex flex-col items-center gap-0.5 text-zinc-400 hover:text-violet-600 transition-colors group"
                    >
                      <RefreshCw className="h-4 w-4 group-hover:rotate-180 transition-transform duration-300" />
                      <span className="text-[9px] uppercase font-medium">Swap</span>
                    </button>
                  </div>
                  <div className={`rounded-lg px-3 py-2 text-center border-2 ${swapped ? "border-violet-300 bg-violet-50" : "border-transparent bg-pink-50"}`}>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400 mb-0.5">
                      {swapped ? "Primary (kept)" : "Secondary (deleted)"}
                    </p>
                    <p className="text-xs font-semibold text-zinc-800 truncate">
                      {selected.artistB?.name ?? `#${selected.artistIdB}`}
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 text-center pb-2">
                  Click <strong>Swap</strong> above to choose which profile is kept. Click a field value to choose which version to keep.
                </p>

                {MERGEABLE_FIELDS.map(({ key, label }) => {
                  const leftArtist  = swapped ? selected.artistB : selected.artistA;
                  const rightArtist = swapped ? selected.artistA : selected.artistB;
                  const valLeft  = fieldVal(leftArtist, key);
                  const valRight = fieldVal(rightArtist, key);
                  const same = valLeft === valRight;
                  const pref = fieldPrefs[key] ?? "a";
                  return (
                    <div key={key} className={`grid grid-cols-[1fr_56px_1fr] gap-2 items-stretch rounded-lg border ${same ? "bg-zinc-50" : "bg-white"} p-1.5`}>
                      <button
                        onClick={() => setFieldPrefs(p => ({ ...p, [key]: "a" }))}
                        className={`text-left px-3 py-2 rounded-md text-xs transition-all border-2 ${
                          pref === "a"
                            ? "border-violet-400 bg-violet-50 font-medium text-zinc-900"
                            : "border-transparent bg-zinc-50 text-zinc-500 hover:bg-zinc-100"
                        }`}
                      >
                        {valLeft}{pref === "a" && <span className="ml-1 text-violet-500">✓</span>}
                      </button>
                      <div className="flex items-center justify-center">
                        <span className="text-[10px] text-zinc-400 uppercase leading-tight text-center">{label}</span>
                      </div>
                      <button
                        onClick={() => setFieldPrefs(p => ({ ...p, [key]: "b" }))}
                        className={`text-left px-3 py-2 rounded-md text-xs transition-all border-2 ${
                          pref === "b"
                            ? "border-pink-400 bg-pink-50 font-medium text-zinc-900"
                            : "border-transparent bg-zinc-50 text-zinc-500 hover:bg-zinc-100"
                        }`}
                      >
                        {valRight}{pref === "b" && <span className="ml-1 text-pink-500">✓</span>}
                      </button>
                    </div>
                  );
                })}

                <p className="text-xs text-zinc-400 pt-2 pb-1 border-t mt-3">
                  All notes, tasks, and outreach history from the secondary profile will transfer to the primary. The secondary profile will be soft-deleted.
                </p>
              </div>

              <div className="border-t px-6 py-4 flex gap-2 justify-end bg-white shrink-0">
                <Button variant="outline" size="sm" onClick={() => handleDismiss(selected.id)} disabled={updateMut.isPending}>
                  Not a Duplicate
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                  Skip
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
                  onClick={handleMerge}
                  disabled={mergeMut.isPending}
                >
                  {mergeMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitMerge className="h-3.5 w-3.5" />}
                  Merge into {swapped ? (selected.artistB?.name ?? "Artist B") : (selected.artistA?.name ?? "Artist A")}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Network graph tab ─────────────────────────────────────────────────────────

const STATUS_COLORS_HEX: Record<string, string> = {
  signed: "#22c55e", in_talks: "#f59e0b", released: "#8b5cf6",
  dropped: "#ef4444", unsigned: "#6b7280",
  distribution: "#f97316", recording_time: "#14b8a6",
  mixing_mastering: "#6366f1", video_services: "#f43f5e",
};
const LEAD_TIER_COLORS_HEX: Record<string, string> = {
  hot: "#ef4444", warm: "#f97316", cold: "#3b82f6", inactive: "#6b7280",
};
const GENRE_PALETTE = ["#22c55e","#f59e0b","#8b5cf6","#06b6d4","#ef4444","#ec4899","#f97316","#14b8a6","#6366f1","#84cc16"];
const ENTITY_TYPE_COLORS: Record<string, string> = {
  producer: "#f59e0b", engineer: "#06b6d4", venue: "#10b981", label: "#8b5cf6", other: "#6b7280",
};

const REL_TYPE_OPTIONS = ["all", "collaborator", "producer", "engineer", "venue", "label", "other"] as const;
const LABEL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all",              label: "All statuses" },
  { value: "unsigned",         label: "Unsigned" },
  { value: "in_talks",         label: "In Talks" },
  { value: "signed",           label: "Signed" },
  { value: "released",         label: "Released" },
  { value: "dropped",          label: "Dropped" },
  { value: "distribution",     label: "Distribution" },
  { value: "recording_time",   label: "Recording Time" },
  { value: "mixing_mastering", label: "Mixing & Mastering" },
  { value: "video_services",   label: "Video Services" },
];

function NetworkTab() {
  const { data: graphData, isLoading } = useGetArtistGraph();
  const { data: _ntCustomStatuses = [] } = useListCustomLabelStatuses();
  const ntStatusLabels: Record<string, string> = { ...STATUS_LABELS, ...Object.fromEntries(_ntCustomStatuses.map(s => [s.key, s.name])) };
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [relTypeFilter, setRelTypeFilter] = useState<string>("all");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("");
  const [genreNetFilter, setGenreNetFilter] = useState<string>("all");
  const [leadTierNetFilter, setLeadTierNetFilter] = useState<string>("all");
  const [colorBy, setColorBy] = useState<"label" | "genre" | "lead_tier">("label");
  const [pinnedNodeIds, setPinnedNodeIds] = useState<Set<number>>(new Set());
  const fgRef = useRef<FGInstance | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allNodes = graphData?.nodes ?? [];
  const allLinks = graphData?.links ?? [];

  // Unique genres and cities from artist nodes for filter dropdowns
  const artistNodes = allNodes.filter(n => (n as Record<string, unknown>).nodeType !== "external");
  const allNodeGenres = Array.from(new Set(
    artistNodes.map(n => (n as Record<string, unknown>).genre as string).filter(Boolean)
  )).sort();
  const allNodeCities = Array.from(new Set(
    artistNodes.map(n => String((n as Record<string, unknown>).city ?? "")).filter(Boolean)
  )).sort();

  // Genre → color map (deterministic palette assignment)
  const genreColorMap = new Map(allNodeGenres.map((g, i) => [g, GENRE_PALETTE[i % GENRE_PALETTE.length]]));

  // Apply all node-level filters (external entity nodes always pass through)
  const nodes = allNodes.filter(n => {
    const nd = n as Record<string, unknown>;
    if (nd.nodeType === "external") return true;
    const labelOk = labelFilter === "all" || (Array.isArray(nd.labelStatus) ? (nd.labelStatus as string[]).includes(labelFilter) : nd.labelStatus === labelFilter);
    const cityOk = !cityFilter || String(nd.city ?? "").toLowerCase().includes(cityFilter.toLowerCase());
    const genreOk = genreNetFilter === "all" || nd.genre === genreNetFilter;
    const tierOk = leadTierNetFilter === "all" || nd.leadTier === leadTierNetFilter;
    return labelOk && cityOk && genreOk && tierOk;
  });
  const filteredNodeIds = new Set(nodes.map(n => n.id));

  // Apply relationship type filter to links; also restrict to visible nodes
  const links = allLinks.filter(l => {
    const inNodes = filteredNodeIds.has(l.source as number) && filteredNodeIds.has(l.target as number);
    const typeMatch = relTypeFilter === "all" || l.type === relTypeFilter;
    return inNodes && typeMatch;
  });

  // Highlighted nodes: those connected by filtered links when a rel-type filter is active
  const highlightedNodeIds = relTypeFilter !== "all"
    ? new Set(links.flatMap(l => [l.source as number, l.target as number]))
    : null;

  const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null;
  const selectedRels = (graphData?.allRelationships ?? []).filter(r => r.fromArtistId === selectedNodeId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Controls bar */}
      <div className="border-b bg-white px-3 py-2 flex items-center gap-2 shrink-0 flex-wrap">
        <span className="text-sm text-muted-foreground shrink-0">
          {nodes.length}/{allNodes.length} artists · {links.length} link{links.length !== 1 ? "s" : ""}
          {pinnedNodeIds.size > 0 && <span className="ml-1 text-amber-500">· {pinnedNodeIds.size} pinned</span>}
        </span>
        <button
          onClick={() => fgRef.current?.zoomToFit(400, 32)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-2 shrink-0"
          title="Fit all nodes in view"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Fit all
        </button>
        {pinnedNodeIds.size > 0 && (
          <button
            onClick={() => {
              setPinnedNodeIds(prev => {
                prev.forEach(id => {
                  const n = nodes.find(nd => nd.id === id) as Record<string, unknown> | undefined;
                  if (n) { delete n.fx; delete n.fy; }
                });
                return new Set();
              });
            }}
            className="flex items-center gap-1 text-xs text-amber-500 hover:text-amber-700 transition-colors shrink-0"
            title="Unpin all nodes"
          >
            <MapPin className="h-3.5 w-3.5" />
            Unpin all
          </button>
        )}

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* City filter */}
          <Input
            className="h-7 text-xs w-28"
            placeholder="City…"
            value={cityFilter}
            onChange={e => { setCityFilter(e.target.value); setSelectedNodeId(null); }}
          />

          {/* Genre filter */}
          {allNodeGenres.length > 0 && (
            <Select value={genreNetFilter} onValueChange={v => { setGenreNetFilter(v); setSelectedNodeId(null); }}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue placeholder="Genre" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All genres</SelectItem>
                {allNodeGenres.map(g => (
                  <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Lead tier filter */}
          <Select value={leadTierNetFilter} onValueChange={v => { setLeadTierNetFilter(v); setSelectedNodeId(null); }}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Lead tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All tiers</SelectItem>
              {(["hot", "warm", "cold", "inactive"] as const).map(t => (
                <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Relationship type filter */}
          <Select value={relTypeFilter} onValueChange={v => { setRelTypeFilter(v); setSelectedNodeId(null); }}>
            <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Rel type" /></SelectTrigger>
            <SelectContent>
              {REL_TYPE_OPTIONS.map(t => (
                <SelectItem key={t} value={t} className="text-xs capitalize">
                  {t === "all" ? "All rel types" : REL_TYPE_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Label status filter */}
          <Select value={labelFilter} onValueChange={v => { setLabelFilter(v); setSelectedNodeId(null); }}>
            <SelectTrigger className="h-7 text-xs w-36"><SelectValue placeholder="Label status" /></SelectTrigger>
            <SelectContent>
              {LABEL_STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Color by selector */}
          <Select value={colorBy} onValueChange={v => setColorBy(v as "label" | "genre" | "lead_tier")}>
            <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="label" className="text-xs">Color: Label</SelectItem>
              <SelectItem value="genre" className="text-xs">Color: Genre</SelectItem>
              <SelectItem value="lead_tier" className="text-xs">Color: Lead Tier</SelectItem>
            </SelectContent>
          </Select>

          {/* Dynamic legend */}
          <div className="hidden lg:flex items-center gap-2 flex-wrap">
            {colorBy === "label" && Object.entries(STATUS_COLORS_HEX).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ background: c }} />
                <span className="capitalize">{k.replace("_", " ")}</span>
              </span>
            ))}
            {colorBy === "lead_tier" && Object.entries(LEAD_TIER_COLORS_HEX).map(([k, c]) => (
              <span key={k} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ background: c }} />
                <span className="capitalize">{k}</span>
              </span>
            ))}
            {colorBy === "genre" && allNodeGenres.slice(0, 6).map(g => (
              <span key={g} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="h-2 w-2 rounded-full inline-block shrink-0" style={{ background: genreColorMap.get(g) ?? "#6b7280" }} />
                <span>{g}</span>
              </span>
            ))}
            {/* External entity legend */}
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-1 border-l pl-2">
              <span className="inline-block shrink-0 w-2 h-2 rotate-45 border border-muted-foreground" />
              <span>External</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Graph canvas */}
        <div ref={containerRef} className="flex-1 relative bg-zinc-950 overflow-hidden">
          {nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Network className="h-10 w-10 text-zinc-600" />
              <p className="text-zinc-500 text-sm text-center px-8">
                {allNodes.length === 0
                  ? "Add artists to your roster and create relationships to see the network graph"
                  : "No artists match the current filters"}
              </p>
            </div>
          ) : (
            <Suspense fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              </div>
            }>
              <ForceGraph2D
                ref={fgRef}
                graphData={{ nodes: nodes as Record<string, unknown>[], links: links as Record<string, unknown>[] }}
                nodeLabel={(n: Record<string, unknown>) => {
                  const isPinned = pinnedNodeIds.has(n.id as number);
                  return `${String(n.name ?? "")}${isPinned ? " 📌" : ""} (right-click to ${isPinned ? "unpin" : "pin"})`;
                }}
                nodeRelSize={5}
                onNodeRightClick={(n: Record<string, unknown>, evt: MouseEvent) => {
                  evt.preventDefault();
                  const id = n.id as number;
                  const nd = n as Record<string, unknown>;
                  if (pinnedNodeIds.has(id)) {
                    delete nd.fx;
                    delete nd.fy;
                    setPinnedNodeIds(prev => { const s = new Set(prev); s.delete(id); return s; });
                  } else {
                    nd.fx = nd.x as number;
                    nd.fy = nd.y as number;
                    setPinnedNodeIds(prev => new Set([...prev, id]));
                  }
                }}
                linkColor={(l: Record<string, unknown>) => {
                  const typeColor: Record<string, string> = {
                    producer: "#f59e0b", engineer: "#06b6d4", venue: "#10b981",
                    label: "#8b5cf6", collaborator: "#6b7280", other: "#374151",
                  };
                  return typeColor[String(l.type)] ?? "#374151";
                }}
                linkWidth={1.5}
                backgroundColor="#09090b"
                onNodeClick={(n: Record<string, unknown>) => {
                  const id = n.id as number;
                  setSelectedNodeId(prev => (prev === id ? null : id));
                }}
                width={size.w}
                height={size.h}
                nodeCanvasObject={(node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
                  const x = node.x as number ?? 0;
                  const y = node.y as number ?? 0;
                  const isSelected = selectedNodeId === (node.id as number);
                  const isDimmed = highlightedNodeIds !== null && !highlightedNodeIds.has(node.id as number);
                  const isExternal = node.nodeType === "external";
                  const r = isSelected ? 7 : (isExternal ? 6 : 5);
                  ctx.globalAlpha = isDimmed ? 0.15 : 1;

                  let baseColor: string;
                  if (isExternal) {
                    baseColor = ENTITY_TYPE_COLORS[String(node.entityType ?? "")] ?? "#6b7280";
                  } else if (colorBy === "lead_tier") {
                    baseColor = LEAD_TIER_COLORS_HEX[String(node.leadTier ?? "")] ?? "#6b7280";
                  } else if (colorBy === "genre") {
                    baseColor = genreColorMap.get(String(node.genre ?? "")) ?? "#6b7280";
                  } else {
                    baseColor = STATUS_COLORS_HEX[(Array.isArray(node.labelStatus) ? (node.labelStatus as string[])[0] : String(node.labelStatus)) ?? "unsigned"] ?? "#6b7280";
                  }

                  if (isExternal) {
                    // Render external entities as diamonds
                    ctx.fillStyle = baseColor;
                    ctx.beginPath();
                    ctx.moveTo(x, y - r);
                    ctx.lineTo(x + r, y);
                    ctx.lineTo(x, y + r);
                    ctx.lineTo(x - r, y);
                    ctx.closePath();
                    ctx.fill();
                    if (isSelected) {
                      ctx.strokeStyle = "#ffffff";
                      ctx.lineWidth = 1.5;
                      ctx.stroke();
                    }
                  } else {
                    ctx.fillStyle = baseColor;
                    ctx.beginPath();
                    ctx.arc(x, y, r, 0, 2 * Math.PI);
                    ctx.fill();
                    if (isSelected) {
                      ctx.strokeStyle = "#ffffff";
                      ctx.lineWidth = 1.5;
                      ctx.stroke();
                    }
                  }

                  if (globalScale >= 1.8) {
                    const fontSize = 10 / globalScale;
                    ctx.font = `${fontSize}px sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillStyle = "#d1d5db";
                    ctx.fillText(String(node.name ?? ""), x, y + r + 1);
                  }

                  // Pin indicator: small amber dot at top-right of node
                  if (pinnedNodeIds.has(node.id as number)) {
                    ctx.fillStyle = "#f59e0b";
                    ctx.beginPath();
                    ctx.arc(x + r - 1, y - r + 1, 2.5, 0, 2 * Math.PI);
                    ctx.fill();
                  }

                  ctx.globalAlpha = 1;
                }}
              />
            </Suspense>
          )}
        </div>

        {/* Selected node side panel */}
        {selectedNode && (
          <div className="w-64 border-l bg-white overflow-y-auto shrink-0">
            <div className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{String(selectedNode.name)}</p>
                  <p className="text-xs text-muted-foreground">{String((selectedNode as Record<string, unknown>).genre ?? "Unknown genre")}</p>
                </div>
                <button onClick={() => setSelectedNodeId(null)} className="shrink-0 mt-0.5">
                  <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
              <div className="text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: STATUS_COLORS_HEX[((selectedNode as Record<string, unknown>).labelStatus as string[])?.[0] ?? "unsigned"] ?? "#6b7280" }} />
                  <span className="capitalize">{((selectedNode as Record<string, unknown>).labelStatus as string[] ?? []).map(s => ntStatusLabels[s] ?? s).join(", ") || "Unsigned"}</span>
                </div>
                {!!(selectedNode as Record<string, unknown>).city || !!(selectedNode as Record<string, unknown>).state ? (
                  <p className="text-muted-foreground">
                    {[String((selectedNode as Record<string, unknown>).city ?? ""), String((selectedNode as Record<string, unknown>).state ?? "")].filter(s => s).join(", ")}
                  </p>
                ) : null}
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Outreach:</span>
                  <span className="capitalize">{String((selectedNode as Record<string, unknown>).outreachStatus ?? "new").replace("_", " ")}</span>
                </div>
              </div>
              {selectedRels.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Connections</p>
                  <div className="space-y-1.5">
                    {selectedRels
                      .filter(r => relTypeFilter === "all" || r.relationshipType === relTypeFilter)
                      .map(r => {
                        const name = r.toEntityName
                          ?? allNodes.find(n => n.id === r.toEntityId)?.name as string | undefined
                          ?? `Artist #${r.toEntityId}`;
                        return (
                          <div key={r.id} className="text-xs flex items-start gap-1.5">
                            <span className="bg-violet-100 text-violet-700 rounded px-1 py-0.5 text-[10px] font-medium capitalize shrink-0">
                              {REL_TYPE_LABELS[r.relationshipType] ?? r.relationshipType}
                            </span>
                            <span className="text-muted-foreground truncate">{String(name)}</span>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
              {selectedRels.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No connections recorded for this artist</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Territory heatmap tab ──────────────────────────────────────────────────────

type TerritoryCity = {
  city: string; state: string | null; country: string | null;
  lat: number | null; lng: number | null; count: number;
  labelBreakdown: Record<string, number>;
  outreachBreakdown: Record<string, number>;
  genreBreakdown: Record<string, number>;
  leadTierBreakdown: Record<string, number>;
  topGenre: string | null;
  averageLeadTier: string | null;
  outreachSent: number;
  responded: number;
  responseRate: number;
  recentCount: number;
  growthRate: number | null;
};

const DATE_RANGE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
];

const OUTREACH_STATUS_OPTIONS = [
  { value: "all", label: "All outreach" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "in_talks", label: "In talks" },
  { value: "signed", label: "Signed" },
  { value: "passed", label: "Passed" },
];

function TerritoryTab() {
  const [labelFilter, setLabelFilter] = useState("all");
  const [genreFilter, setGenreFilter] = useState("all");
  const [outreachFilter, setOutreachFilter] = useState("all");
  const [leadTierTerrFilter, setLeadTierTerrFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const { token } = useAuth();

  const { data, isLoading } = useQuery<{ cities: TerritoryCity[]; total: number; withCity: number; geocoded: number }>({
    queryKey: ["/api/artists/territory-stats", dateRange],
    queryFn: async () => {
      const url = `/api/artists/territory-stats${dateRange !== "all" ? `?since=${dateRange}` : ""}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Failed to fetch territory stats");
      return (await res.json()) as { cities: TerritoryCity[]; total: number; withCity: number; geocoded: number };
    },
  });

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const allCities: TerritoryCity[] = data?.cities ?? [];

  // Collect all genres across all cities for the filter dropdown
  const allGenres: string[] = Array.from(
    new Set(allCities.flatMap(c => Object.keys(c.genreBreakdown ?? {})))
  ).sort();

  const filteredCities = allCities.filter(c => {
    const labelOk = labelFilter === "all" || (c.labelBreakdown[labelFilter] ?? 0) > 0;
    const genreOk = genreFilter === "all" || ((c.genreBreakdown ?? {})[genreFilter] ?? 0) > 0;
    const outreachOk = outreachFilter === "all" || (c.outreachBreakdown[outreachFilter] ?? 0) > 0;
    const tierOk = leadTierTerrFilter === "all" || ((c.leadTierBreakdown ?? {})[leadTierTerrFilter] ?? 0) > 0;
    return labelOk && genreOk && outreachOk && tierOk;
  });
  const mapCities = filteredCities.filter(c => c.lat != null && c.lng != null);
  const maxCount = Math.max(1, ...filteredCities.map(c => c.count));

  // Aggregate stats for stats bar
  const totalOutreachSent = allCities.reduce((s, c) => s + c.outreachSent, 0);
  const totalResponded = allCities.reduce((s, c) => s + c.responded, 0);
  const overallResponseRate = totalOutreachSent > 0
    ? Math.round((totalResponded / totalOutreachSent) * 100)
    : 0;
  const totalRecentAdded = allCities.reduce((s, c) => s + c.recentCount, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Stats bar */}
      <div className="border-b bg-white px-3 py-2 flex items-center gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <span className="text-muted-foreground">Artists: <span className="font-semibold text-foreground">{data?.total ?? 0}</span></span>
          <span className="text-muted-foreground">Cities: <span className="font-semibold text-foreground">{allCities.length}</span></span>
          <span className="text-muted-foreground">Outreach sent: <span className="font-semibold text-foreground">{totalOutreachSent}</span></span>
          <span className="text-muted-foreground">Response rate: <span className={`font-semibold ${overallResponseRate >= 30 ? "text-emerald-600" : "text-foreground"}`}>{overallResponseRate}%</span></span>
          {totalRecentAdded > 0 && (
            <span className="text-muted-foreground">+<span className="font-semibold text-foreground">{totalRecentAdded}</span> last 30d</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {/* Date range */}
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_RANGE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Genre filter */}
          {allGenres.length > 0 && (
            <Select value={genreFilter} onValueChange={setGenreFilter}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue placeholder="Genre" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All genres</SelectItem>
                {allGenres.map(g => (
                  <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Outreach status filter */}
          <Select value={outreachFilter} onValueChange={setOutreachFilter}>
            <SelectTrigger className="h-7 text-xs w-32"><SelectValue placeholder="Outreach" /></SelectTrigger>
            <SelectContent>
              {OUTREACH_STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Lead tier filter */}
          <Select value={leadTierTerrFilter} onValueChange={setLeadTierTerrFilter}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue placeholder="Lead tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All tiers</SelectItem>
              {(["hot", "warm", "cold", "inactive"] as const).map(t => (
                <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Label status filter */}
          <Select value={labelFilter} onValueChange={setLabelFilter}>
            <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All statuses</SelectItem>
              {["signed", "in_talks", "unsigned", "released", "dropped"].map(s => (
                <SelectItem key={s} value={s} className="text-xs capitalize">{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden" style={{ isolation: "isolate" }}>
        {/* Map */}
        <div className="flex-[3] relative overflow-hidden">
          <MapContainer
            center={[39, -95]}
            zoom={4}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            {mapCities.map((city, i) => (
              <CircleMarker
                key={`${city.city}-${i}`}
                center={[city.lat!, city.lng!]}
                radius={Math.max(6, Math.sqrt(city.count / maxCount) * 32)}
                pathOptions={{
                  fillColor: "#7c3aed",
                  fillOpacity: 0.65,
                  color: "#5b21b6",
                  weight: 1.5,
                }}
              >
                <MapTooltip>
                  <div className="text-xs space-y-1 min-w-[140px]">
                    <p className="font-semibold">{city.city}{city.state ? `, ${city.state}` : ""}</p>
                    <p>{city.count} artist{city.count !== 1 ? "s" : ""}</p>
                    {city.topGenre && <p className="text-gray-600">Top genre: <span className="font-medium text-gray-800">{city.topGenre}</span></p>}
                    {city.averageLeadTier && (
                      <p className="text-gray-600">Lead tier: <span className={`font-medium ${city.averageLeadTier === "hot" ? "text-red-600" : city.averageLeadTier === "warm" ? "text-orange-500" : "text-gray-800"}`}>{city.averageLeadTier}</span></p>
                    )}
                    {city.outreachSent > 0 && (
                      <>
                        <p className="text-gray-600">Outreach sent: <span className="text-gray-800">{city.outreachSent}</span></p>
                        <p className="text-gray-600">Response rate: <span className="text-gray-800">{city.responseRate}%</span></p>
                      </>
                    )}
                    {city.growthRate !== null && (
                      <p className={city.growthRate >= 0 ? "text-emerald-600" : "text-red-500"}>
                        {city.growthRate >= 0 ? "+" : ""}{city.growthRate}% growth (30d)
                      </p>
                    )}
                    <div className="border-t pt-1 mt-1">
                      {(Object.entries(city.labelBreakdown) as [string, number][]).map(([k, v]) => (
                        <p key={k} className="capitalize text-gray-600">{k.replace("_", " ")}: {v}</p>
                      ))}
                    </div>
                  </div>
                </MapTooltip>
              </CircleMarker>
            ))}
          </MapContainer>
          {mapCities.length === 0 && allCities.length > 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 pointer-events-none gap-2">
              <MapPin className="h-8 w-8 text-amber-500" />
              <p className="text-sm text-muted-foreground text-center px-6">
                {filteredCities.length === 0
                  ? "No cities match the current filters"
                  : "Artists have city data but aren't geocoded yet — geocoding runs automatically in the background"}
              </p>
            </div>
          )}
          {allCities.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 pointer-events-none gap-2">
              <MapPin className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Add artists with a city to see them on the map</p>
            </div>
          )}
        </div>

        {/* City rankings sidebar — top 10 by density with growth rate */}
        <div className="w-72 border-l bg-white overflow-y-auto shrink-0 flex flex-col">
          <div className="px-3 py-2.5 border-b shrink-0">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Top Cities
              {(labelFilter !== "all" || genreFilter !== "all" || outreachFilter !== "all") && (
                <span className="ml-1 normal-case font-normal text-violet-600">• filtered</span>
              )}
            </p>
          </div>
          {filteredCities.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-muted-foreground text-sm">
              No cities match the current filters
            </div>
          ) : (
            <div className="divide-y">
              {filteredCities.slice(0, 10).map((city, i) => (
                <div key={`${city.city}-${i}`} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0 text-right">#{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {city.city}{city.state ? `, ${city.state}` : ""}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {city.country && (
                            <span className="text-[10px] text-muted-foreground">{city.country}</span>
                          )}
                          {city.topGenre && (
                            <span className="text-[10px] bg-violet-50 text-violet-600 rounded px-1">{city.topGenre}</span>
                          )}
                          {city.averageLeadTier && (
                            <span className={`text-[10px] rounded px-1 font-medium capitalize ${
                              city.averageLeadTier === "hot" ? "bg-red-50 text-red-600"
                              : city.averageLeadTier === "warm" ? "bg-orange-50 text-orange-600"
                              : "bg-zinc-100 text-zinc-500"
                            }`}>{city.averageLeadTier}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      <div className="text-sm font-bold text-violet-700 tabular-nums">{city.count}</div>
                      {city.growthRate !== null && (
                        <div className={`text-[10px] font-medium tabular-nums ${city.growthRate >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {city.growthRate >= 0 ? "+" : ""}{city.growthRate}%
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-500 rounded-full transition-all"
                      style={{ width: `${(city.count / maxCount) * 100}%` }}
                    />
                  </div>
                  {/* Outreach metrics */}
                  {city.outreachSent > 0 && (
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{city.outreachSent} contacted</span>
                      <span className={city.responseRate >= 30 ? "text-emerald-600 font-medium" : ""}>
                        {city.responseRate}% replied
                      </span>
                    </div>
                  )}
                  {city.lat == null && (
                    <p className="text-[10px] text-amber-500 mt-0.5 flex items-center gap-1">
                      <MapPin className="h-2.5 w-2.5" /> Not on map yet
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Artists() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token: artistsToken } = useAuth();
  const [, navigate] = useLocation();
  const { data: meMain } = useGetMe();
  const canDelete = meMain?.role === "owner" || meMain?.role === "admin" || meMain?.permissions?.["artists:delete"] === true;

  const [mainTab, setMainTab] = useState<"roster" | "discover" | "queue" | "duplicates" | "network" | "territory">("roster");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Artist | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [selectedArtistId, setSelectedArtistId] = useState<number | null>(null);
  const [outreachHook, setOutreachHook] = useState<{ tab: string; context: string } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [contactSearch, setContactSearch] = useState("");
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedArtistIds, setSelectedArtistIds] = useState<Set<number>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [customLinks, setCustomLinks] = useState<Array<{key: string; url: string; linkType: "streaming" | "social"}>>([]);
  const [newStatusName, setNewStatusName] = useState("");
  const [addingStatus, setAddingStatus] = useState(false);

  // Custom label statuses
  const { data: customStatuses = [] } = useListCustomLabelStatuses({
    query: { queryKey: getListCustomLabelStatusesQueryKey() },
  });
  const createCustomStatus = useCreateCustomLabelStatus();
  const deleteCustomStatus = useDeleteCustomLabelStatus();

  const allStatusLabels = useMemo(() => ({
    ...STATUS_LABELS,
    ...Object.fromEntries(customStatuses.map(s => [s.key, s.name])),
  }), [customStatuses]);

  const allStatusColors = useMemo(() => ({
    ...STATUS_COLORS,
    ...Object.fromEntries(customStatuses.map(s => [s.key, s.colorClass])),
  }), [customStatuses]);

  function handleAddCustomStatus() {
    const name = newStatusName.trim();
    if (!name) return;
    setAddingStatus(true);
    createCustomStatus.mutate(
      { data: { name } },
      {
        onSuccess: () => {
          setNewStatusName("");
          qc.invalidateQueries({ queryKey: getListCustomLabelStatusesQueryKey() });
          toast({ title: `"${name}" added` });
        },
        onError: () => toast({ title: "Name already exists", variant: "destructive" }),
        onSettled: () => setAddingStatus(false),
      },
    );
  }

  function handleDeleteCustomStatus(key: string, name: string) {
    deleteCustomStatus.mutate(
      { key },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListCustomLabelStatusesQueryKey() });
          toast({ title: `"${name}" removed` });
        },
      },
    );
  }

  // Global custom platforms from Settings > Integrations
  const [globalPlatforms, setGlobalPlatforms] = useState<Array<{id: number; name: string; linkType: string}>>([]);
  useEffect(() => {
    if (!artistsToken) return;
    fetch("/api/integrations/custom-platforms", { headers: { Authorization: `Bearer ${artistsToken}` } })
      .then((r) => r.json())
      .then((d) => setGlobalPlatforms(d as Array<{id: number; name: string; linkType: string}>))
      .catch(() => {});
  }, [artistsToken]);

  // Build query params from filters
  const queryParams = {
    search: filters.search || undefined,
    leadTier: filters.leadTier || undefined,
    outreachStatus: filters.outreachStatus || undefined,
    genre: filters.genre || undefined,
    city: filters.city || undefined,
    state: filters.state || undefined,
    followersEstimate: filters.followersEstimate || undefined,
    engagementLevel: filters.engagementLevel || undefined,
    labelStatus: filters.labelStatus || undefined,
  };

  const { data: artists = [] } = useListArtists(queryParams, {
    query: { queryKey: getListArtistsQueryKey(queryParams) },
  });

  // Always-fresh detail query; enabled only when a sheet is open
  const { data: selectedArtist = null } = useGetArtist(selectedArtistId!, {
    query: {
      enabled: selectedArtistId !== null,
      queryKey: getGetArtistQueryKey(selectedArtistId!),
    },
  });

  // Saved views
  const { data: savedViews = [] } = useListArtistSavedViews({
    query: { queryKey: ["artistSavedViews"] },
  });
  const createView = useCreateArtistSavedView();
  const deleteView = useDeleteArtistSavedView();

  // Contacts for the contact-picker in the create/edit form
  const { data: pickerContacts = [] } = useListContacts(
    { search: contactSearch || undefined },
    { query: { queryKey: getListContactsQueryKey({ search: contactSearch || undefined }), staleTime: 30_000 } },
  );

  const createArtist = useCreateArtist();
  const updateArtist = useUpdateArtist();
  const deleteArtist = useDeleteArtist();

  const toggleArtist = (id: number) => {
    setSelectedArtistIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const bulkArtistAction = async (action: "tag" | "untag" | "delete", tag?: string) => {
    if (selectedArtistIds.size === 0) return;
    if (action === "delete" && !canDelete) return;
    if (action === "delete" && !confirm(`Delete ${selectedArtistIds.size} artist(s)?`)) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/artists/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${artistsToken}` },
        body: JSON.stringify({ ids: [...selectedArtistIds], action, tag }),
      });
      if (!res.ok) { const { error } = await res.json().catch(() => ({ error: "Request failed" })); throw new Error(error); }
      qc.invalidateQueries({ queryKey: ["listArtists"] });
      setSelectedArtistIds(new Set());
      setBulkTag("");
      toast({ title: "Bulk action complete" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Bulk action failed", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    fetch(`/api/artists/export.csv${params.toString() ? `?${params}` : ""}`, {
      headers: { Authorization: `Bearer ${artistsToken}` },
    })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "artists.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["listArtists"] });
  }, [qc]);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setCustomLinks([]); setOpen(true); }

  function openEdit(a: Artist) {
    setEditing(a);
    setForm({
      name: a.name, genre: a.genre ?? "", labelStatus: (a.labelStatus ?? []) as string[],
      outreachStatus: ((a.outreachStatus ?? "new") as OutreachStatus),
      revenuePotential: a.revenuePotential ?? "",
      followersEstimate: a.followersEstimate ?? "",
      engagementLevel: a.engagementLevel ?? "",
      city: a.city ?? "", state: a.state ?? "", country: a.country ?? "",
      bio: a.bio ?? "", email: a.email ?? "", phone: a.phone ?? "",
      tags: a.tags.join(", "),
      imageUrl: a.imageUrl ?? "",
      contactId: a.contactId ?? null,
      spotify:     (a.streamingLinks as Record<string, string>)?.spotify    ?? "",
      appleMusic:  (a.streamingLinks as Record<string, string>)?.appleMusic ?? "",
      audiomack:   (a.streamingLinks as Record<string, string>)?.audiomack  ?? "",
      youtube:     (a.streamingLinks as Record<string, string>)?.youtube    ?? "",
      soundcloud:  (a.streamingLinks as Record<string, string>)?.soundcloud ?? "",
      tidal:       (a.streamingLinks as Record<string, string>)?.tidal      ?? "",
      bandcamp:    (a.streamingLinks as Record<string, string>)?.bandcamp   ?? "",
      instagram:   (a.socialLinks as Record<string, string>)?.instagram    ?? "",
      facebook:    (a.socialLinks as Record<string, string>)?.facebook     ?? "",
      tiktok:      (a.socialLinks as Record<string, string>)?.tiktok       ?? "",
      twitter:     (a.socialLinks as Record<string, string>)?.twitter      ?? "",
      bandsintown: (a.socialLinks as Record<string, string>)?.bandsintown  ?? "",
      songkick:    (a.socialLinks as Record<string, string>)?.songkick     ?? "",
      website:     (a.socialLinks as Record<string, string>)?.website      ?? "",
      groover:     (a.socialLinks as Record<string, string>)?.groover      ?? "",
      spotifyId: a.spotifyId ?? null,
      youtubeChannelId: a.youtubeChannelId ?? null,
    });
    const STANDARD_STREAMING = new Set(["spotify","appleMusic","audiomack","youtube","soundcloud","tidal","bandcamp"]);
    const STANDARD_SOCIAL    = new Set(["instagram","facebook","tiktok","twitter","bandsintown","songkick","website","groover"]);
    const extraSt = Object.entries((a.streamingLinks as Record<string,string>) ?? {}).filter(([k]) => !STANDARD_STREAMING.has(k)).map(([key, url]) => ({key, url, linkType: "streaming" as const}));
    const extraSo = Object.entries((a.socialLinks    as Record<string,string>) ?? {}).filter(([k]) => !STANDARD_SOCIAL.has(k)).map(([key, url])    => ({key, url, linkType: "social"    as const}));
    setCustomLinks([...extraSt, ...extraSo]);
    setOpen(true);
  }

  function buildPayload() {
    const streamingLinks: Record<string, string> = {};
    if (form.spotify)    streamingLinks["spotify"]    = form.spotify;
    if (form.appleMusic) streamingLinks["appleMusic"] = form.appleMusic;
    if (form.audiomack)  streamingLinks["audiomack"]  = form.audiomack;
    if (form.youtube)    streamingLinks["youtube"]    = form.youtube;
    if (form.soundcloud) streamingLinks["soundcloud"] = form.soundcloud;
    if (form.tidal)      streamingLinks["tidal"]      = form.tidal;
    if (form.bandcamp)   streamingLinks["bandcamp"]   = form.bandcamp;
    const socialLinks: Record<string, string> = {};
    if (form.instagram)   socialLinks["instagram"]   = form.instagram;
    if (form.facebook)    socialLinks["facebook"]    = form.facebook;
    if (form.tiktok)      socialLinks["tiktok"]      = form.tiktok;
    if (form.twitter)     socialLinks["twitter"]     = form.twitter;
    if (form.bandsintown) socialLinks["bandsintown"] = form.bandsintown;
    if (form.songkick)    socialLinks["songkick"]    = form.songkick;
    if (form.website)     socialLinks["website"]     = form.website;
    if (form.groover)     socialLinks["groover"]     = form.groover;
    for (const cl of customLinks) {
      if (cl.key.trim() && cl.url.trim()) {
        if (cl.linkType === "streaming") streamingLinks[cl.key.trim()] = cl.url.trim();
        else socialLinks[cl.key.trim()] = cl.url.trim();
      }
    }
    return {
      name: form.name, genre: form.genre || null, labelStatus: form.labelStatus,
      outreachStatus: form.outreachStatus,
      revenuePotential: form.revenuePotential || null,
      followersEstimate: form.followersEstimate || null,
      engagementLevel: (form.engagementLevel || null) as ArtistBodyEngagementLevel,
      city: form.city || null, state: form.state || null, country: form.country || null,
      bio: form.bio || null, email: form.email || null, phone: form.phone || null,
      imageUrl: form.imageUrl || null,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      streamingLinks, socialLinks, contactId: form.contactId,
      spotifyId: form.spotifyId || null,
      youtubeChannelId: form.youtubeChannelId || null,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editing) {
        const updated = await updateArtist.mutateAsync({ id: editing.id, data: buildPayload() });
        toast({ title: "Artist updated" });
        if (selectedArtistId === editing.id) qc.invalidateQueries({ queryKey: getGetArtistQueryKey(editing.id) });
      } else {
        await createArtist.mutateAsync({ data: buildPayload() });
        toast({ title: "Artist added to roster" });
      }
      setOpen(false);
      invalidate();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteArtist.mutateAsync({ id: deleteId });
      toast({ title: "Artist removed" });
      if (selectedArtistId === deleteId) setSelectedArtistId(null);
      invalidate();
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  }

  function handleSaveView(name: string) {
    const { search: _s, ...filterFields } = filters;
    createView.mutate(
      { data: { name, filters: filterFields as Record<string, unknown> } },
      {
        onSuccess: () => {
          toast({ title: "View saved" });
          qc.invalidateQueries({ queryKey: ["artistSavedViews"] });
        },
      },
    );
  }

  function handleLoadView(id: number) {
    const view = savedViews.find(v => v.id === id);
    if (!view) return;
    setFilters({ ...EMPTY_FILTERS, ...(view.filters as Partial<FilterState>) });
    toast({ title: `Loaded view: ${view.name}` });
  }

  function handleDeleteView(id: number) {
    deleteView.mutate({ id }, { onSuccess: () => qc.invalidateQueries({ queryKey: ["artistSavedViews"] }) });
  }

  const statusGroups = (Object.keys(allStatusLabels) as LabelStatus[])
    .map(status => ({
      status,
      items: artists.filter(a => {
        const statuses = (a.labelStatus ?? []) as string[];
        return status === "unsigned"
          ? statuses.length === 0 || statuses.includes("unsigned")
          : statuses.includes(status);
      }),
    }))
    .filter(g => g.items.length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-6 py-4 shrink-0 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Music className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Artists</h1>
              <p className="text-xs text-muted-foreground">{artists.length} artist{artists.length !== 1 ? "s" : ""} in roster</p>
            </div>
            {/* Roster / Discover tab switcher */}
            <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 ml-2">
              <button
                onClick={() => setMainTab("roster")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mainTab === "roster" ? "bg-white shadow text-foreground" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <Music className="h-3.5 w-3.5" /> Roster
              </button>
              <button
                onClick={() => setMainTab("discover")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mainTab === "discover" ? "bg-white shadow text-violet-700" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <Globe2 className="h-3.5 w-3.5" /> Discover
              </button>
              <button
                onClick={() => setMainTab("queue")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mainTab === "queue" ? "bg-white shadow text-violet-700" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <MessageSquare className="h-3.5 w-3.5" /> Queue
              </button>
              <button
                onClick={() => setMainTab("duplicates")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mainTab === "duplicates" ? "bg-white shadow text-violet-700" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <GitMerge className="h-3.5 w-3.5" /> Duplicates
              </button>
              <button
                onClick={() => setMainTab("network")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mainTab === "network" ? "bg-white shadow text-violet-700" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <Network className="h-3.5 w-3.5" /> Network
              </button>
              <button
                onClick={() => setMainTab("territory")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  mainTab === "territory" ? "bg-white shadow text-violet-700" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                <MapPin className="h-3.5 w-3.5" /> Territory
              </button>
            </div>
          </div>
          {mainTab === "roster" && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5">
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="gap-1.5">
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
              <Button
                size="sm"
                variant={isSelectMode ? "secondary" : "outline"}
                onClick={() => { setIsSelectMode(v => !v); setSelectedArtistIds(new Set()); }}
                className="gap-1.5"
              >
                {isSelectMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {isSelectMode ? "Cancel" : "Select"}
              </Button>
              <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Artist</Button>
            </div>
          )}
        </div>

        {/* Filter bar — roster only */}
        {mainTab === "roster" && (
          <FilterBar
            filters={filters}
            onChange={setFilters}
            savedViews={savedViews as Array<{ id: number; name: string; filters: Record<string, unknown> }>}
            onSaveView={handleSaveView}
            onLoadView={handleLoadView}
            onDeleteView={handleDeleteView}
          />
        )}
      </div>

      {/* Discover tab content */}
      {mainTab === "discover" && (
        <DiscoverTab
          onImported={artistId => {
            setSelectedArtistId(artistId);
            setMainTab("roster");
            qc.invalidateQueries({ queryKey: getListArtistsQueryKey() });
          }}
          onDraftOutreach={(artistId, hook) => {
            setOutreachHook({ tab: "outreach", context: hook ?? "" });
            setSelectedArtistId(artistId);
            setMainTab("roster");
            qc.invalidateQueries({ queryKey: getListArtistsQueryKey() });
          }}
        />
      )}

      {/* Outreach Queue tab content */}
      {mainTab === "queue" && (
        <OutreachQueuePanel
          onOpenArtist={id => {
            setSelectedArtistId(id);
            setMainTab("roster");
          }}
        />
      )}

      {/* Duplicates tab content */}
      {mainTab === "duplicates" && <DuplicatesTab />}

      {/* Network graph tab */}
      {mainTab === "network" && <NetworkTab />}

      {/* Territory heatmap tab */}
      {mainTab === "territory" && <TerritoryTab />}

      {/* Roster grid */}
      {mainTab === "roster" && (
        <div className="flex-1 overflow-auto p-6">
          {artists.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Music className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {activeFilterCount(filters) > 0 || filters.search ? "No artists match these filters" : "No artists yet"}
              </p>
              {(activeFilterCount(filters) > 0 || filters.search) ? (
                <Button size="sm" variant="outline" className="mt-4" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>
              ) : (
                <Button size="sm" className="mt-4" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />Add Artist</Button>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              {statusGroups.map(({ status, items }) => (
                <section key={status}>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className={allStatusColors[status]}>{allStatusLabels[status]}</Badge>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {items.map(artist => (
                      <ArtistCard
                        key={artist.id}
                        artist={artist}
                        isSelected={selectedArtistIds.has(artist.id)}
                        isSelectMode={isSelectMode}
                        onToggle={() => toggleArtist(artist.id)}
                        onOpen={() => { if (!isSelectMode) navigate(`/artists/${artist.id}`); }}
                        onEdit={() => openEdit(artist)}
                        onDelete={() => setDeleteId(artist.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bulk toolbar */}
      {isSelectMode && selectedArtistIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-zinc-900 text-white rounded-xl shadow-xl px-4 py-3 text-sm flex-wrap justify-center max-w-xl">
          <span className="font-medium text-zinc-300 shrink-0">{selectedArtistIds.size} selected</span>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <input
            type="text"
            placeholder="Tag name…"
            value={bulkTag}
            onChange={e => setBulkTag(e.target.value)}
            className="bg-zinc-800 text-white text-xs rounded-lg px-2.5 py-1.5 w-28 outline-none border border-zinc-700 placeholder:text-zinc-500"
          />
          <button
            onClick={() => { if (bulkTag) bulkArtistAction("tag", bulkTag); }}
            disabled={!bulkTag || bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >+ Tag</button>
          <button
            onClick={() => { if (bulkTag) bulkArtistAction("untag", bulkTag); }}
            disabled={!bulkTag || bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >− Untag</button>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          {canDelete && (
            <button
              onClick={() => bulkArtistAction("delete")}
              disabled={bulkLoading}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
            >Delete</button>
          )}
          <button onClick={() => setSelectedArtistIds(new Set())} className="ml-1 text-zinc-400 hover:text-white shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <ImportArtistsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        token={artistsToken}
        onImported={() => qc.invalidateQueries({ queryKey: getListArtistsQueryKey() })}
      />

      {/* Detail sheet */}
      {selectedArtist && (
        <ArtistSheet
          artist={selectedArtist}
          initialTab={outreachHook?.tab}
          initialContext={outreachHook?.context}
          onClose={() => { setSelectedArtistId(null); setOutreachHook(null); }}
          onEdit={() => { openEdit(selectedArtist); }}
          onDelete={() => { setDeleteId(selectedArtist.id); setSelectedArtistId(null); setOutreachHook(null); }}
        />
      )}

      {/* Add / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Artist" : "Add Artist"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Artist name" required />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Profile Image</Label>
                <div className="flex gap-2">
                  <Input
                    value={form.imageUrl}
                    onChange={e => setForm({ ...form, imageUrl: e.target.value })}
                    placeholder="Paste URL or upload →"
                    className="flex-1"
                  />
                  <ImageUploadButton
                    token={artistsToken ?? ""}
                    onUpload={url => setForm(f => ({ ...f, imageUrl: url }))}
                    onError={msg => toast({ title: msg, variant: "destructive" })}
                    label="Upload"
                    size="sm"
                  />
                </div>
                {form.imageUrl && (
                  <img
                    src={getStorageImgSrc(form.imageUrl, artistsToken ?? "")}
                    alt="Preview"
                    className="mt-1 h-12 w-12 rounded-full object-cover border"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )}
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Linked CRM Contact</Label>
                <div className="flex gap-2">
                  <Input
                    value={contactSearch}
                    onChange={e => setContactSearch(e.target.value)}
                    placeholder="Search contacts…"
                    className="flex-1 text-sm"
                  />
                  {form.contactId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-zinc-400 hover:text-zinc-700"
                      onClick={() => setForm(f => ({ ...f, contactId: null }))}
                      title="Unlink contact"
                    >
                      ✕ Unlink
                    </Button>
                  )}
                </div>
                {contactSearch && (pickerContacts as { id: number; name: string; email: string | null; company: string | null }[]).length > 0 && (
                  <div className="border rounded-lg bg-white shadow-sm max-h-40 overflow-y-auto">
                    {(pickerContacts as { id: number; name: string; email: string | null; company: string | null }[]).map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setForm(f => ({ ...f, contactId: c.id })); setContactSearch(""); }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-zinc-50 flex items-center gap-2 ${form.contactId === c.id ? "bg-violet-50 text-violet-700 font-medium" : ""}`}
                      >
                        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="truncate">{c.name}</span>
                          {c.company && <span className="text-zinc-400 text-xs ml-1">· {c.company}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {form.contactId && (() => {
                  const linked = (pickerContacts as { id: number; name: string; email: string | null; company: string | null }[]).find(c => c.id === form.contactId);
                  return linked ? (
                    <p className="text-xs text-violet-600 flex items-center gap-1">
                      <span>✓</span> Linked to <span className="font-medium">{linked.name}</span>
                    </p>
                  ) : form.contactId ? (
                    <p className="text-xs text-violet-600">✓ Contact #{form.contactId} linked (search to change)</p>
                  ) : null;
                })()}
              </div>
              <div className="space-y-1.5">
                <Label>Genre</Label>
                <Input value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} placeholder="e.g. Hip-Hop, R&B" />
              </div>
              <div className="space-y-1.5">
                <Label>Label Status</Label>
                <div className="border rounded-md p-2.5 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {Object.entries(STATUS_LABELS).map(([val, lbl]) => (
                      <label key={val} className="flex items-center gap-2 cursor-pointer select-none text-sm">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-zinc-300 accent-primary"
                          checked={(form.labelStatus as string[]).includes(val)}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...(form.labelStatus as string[]), val]
                              : (form.labelStatus as string[]).filter(s => s !== val);
                            setForm({ ...form, labelStatus: next });
                          }}
                        />
                        {lbl}
                      </label>
                    ))}
                  </div>
                  {customStatuses.length > 0 && (
                    <div className="border-t pt-2 grid grid-cols-2 gap-1.5">
                      {customStatuses.map(cs => (
                        <div key={cs.key} className="flex items-center gap-1 group">
                          <label className="flex items-center gap-2 cursor-pointer select-none text-sm flex-1 min-w-0">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-zinc-300 accent-primary shrink-0"
                              checked={(form.labelStatus as string[]).includes(cs.key)}
                              onChange={e => {
                                const next = e.target.checked
                                  ? [...(form.labelStatus as string[]), cs.key]
                                  : (form.labelStatus as string[]).filter(s => s !== cs.key);
                                setForm({ ...form, labelStatus: next });
                              }}
                            />
                            <span className="truncate">{cs.name}</span>
                          </label>
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600 p-0.5 shrink-0"
                            title="Delete custom status"
                            onClick={() => handleDeleteCustomStatus(cs.key, cs.name)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="border-t pt-2 flex items-center gap-1.5">
                    <Input
                      className="h-7 text-xs flex-1"
                      placeholder="Add custom status…"
                      value={newStatusName}
                      onChange={e => setNewStatusName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddCustomStatus(); } }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1 shrink-0"
                      disabled={!newStatusName.trim() || addingStatus}
                      onClick={handleAddCustomStatus}
                    >
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Outreach Status</Label>
                <Select value={form.outreachStatus} onValueChange={v => setForm({ ...form, outreachStatus: v as OutreachStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(OUTREACH_LABELS) as [OutreachStatus, string][]).map(([val, label]) => <SelectItem key={val} value={val}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Revenue Potential</Label>
                <Input value={form.revenuePotential} onChange={e => setForm({ ...form, revenuePotential: e.target.value })} placeholder="e.g. $50K/yr, High" />
              </div>
              <div className="space-y-1.5">
                <Label>Followers Est.</Label>
                <Select value={form.followersEstimate || "_none"} onValueChange={v => setForm({ ...form, followersEstimate: v === "_none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select range" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Unknown</SelectItem>
                    {FOLLOWERS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Engagement Level</Label>
                <Select value={form.engagementLevel || "_none"} onValueChange={v => setForm({ ...form, engagementLevel: v === "_none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select level" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Unknown</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="e.g. Atlanta" />
              </div>
              <div className="space-y-1.5">
                <Label>State</Label>
                <Input value={form.state} onChange={e => setForm({ ...form, state: e.target.value })} placeholder="e.g. GA" />
              </div>
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="e.g. United States" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label className="flex items-center gap-1.5">
                  Coordinates
                  <span className="text-[10px] font-normal text-muted-foreground">(auto-geocoded from city/country)</span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={editing?.lat != null ? String(editing.lat) : ""}
                    placeholder="Latitude"
                    className="flex-1 bg-muted/40 text-muted-foreground cursor-default text-xs"
                  />
                  <Input
                    readOnly
                    value={editing?.lng != null ? String(editing.lng) : ""}
                    placeholder="Longitude"
                    className="flex-1 bg-muted/40 text-muted-foreground cursor-default text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="artist@label.com" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Bio</Label>
                <Textarea value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} rows={3} placeholder="Short artist bio..." />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Tags <span className="text-muted-foreground text-xs">(comma-separated)</span></Label>
                <Input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="trap, melodic, underground" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Streaming Links</p>
              <div className="grid grid-cols-2 gap-2">
                <Input value={form.spotify}    onChange={e => setForm({ ...form, spotify:    e.target.value })} placeholder="Spotify URL" />
                <Input value={form.appleMusic} onChange={e => setForm({ ...form, appleMusic: e.target.value })} placeholder="Apple Music URL" />
                <Input value={form.audiomack}  onChange={e => setForm({ ...form, audiomack:  e.target.value })} placeholder="Audiomack URL" />
                <Input value={form.youtube}    onChange={e => setForm({ ...form, youtube:    e.target.value })} placeholder="YouTube URL" />
                <Input value={form.soundcloud} onChange={e => setForm({ ...form, soundcloud: e.target.value })} placeholder="SoundCloud URL" />
                <Input value={form.tidal}      onChange={e => setForm({ ...form, tidal:      e.target.value })} placeholder="Tidal URL" />
                <Input value={form.bandcamp}   onChange={e => setForm({ ...form, bandcamp:   e.target.value })} placeholder="Bandcamp URL" />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Social Links</p>
              <div className="grid grid-cols-2 gap-2">
                <Input value={form.instagram}   onChange={e => setForm({ ...form, instagram:   e.target.value })} placeholder="Instagram URL" />
                <Input value={form.facebook}    onChange={e => setForm({ ...form, facebook:    e.target.value })} placeholder="Facebook URL" />
                <Input value={form.tiktok}      onChange={e => setForm({ ...form, tiktok:      e.target.value })} placeholder="TikTok URL" />
                <Input value={form.twitter}     onChange={e => setForm({ ...form, twitter:     e.target.value })} placeholder="X / Twitter URL" />
                <Input value={form.bandsintown} onChange={e => setForm({ ...form, bandsintown: e.target.value })} placeholder="Bandsintown URL" />
                <Input value={form.songkick}    onChange={e => setForm({ ...form, songkick:    e.target.value })} placeholder="Songkick URL" />
                <Input value={form.website}     onChange={e => setForm({ ...form, website:     e.target.value })} placeholder="Website URL" />
                <Input value={form.groover}     onChange={e => setForm({ ...form, groover:     e.target.value })} placeholder="Groover URL" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Platforms</p>
                <button type="button" onClick={() => setCustomLinks(prev => [...prev, {key:"",url:"",linkType:"streaming"}])} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800">
                  <Plus className="h-3 w-3" /> Add platform
                </button>
              </div>
              {globalPlatforms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {globalPlatforms
                    .filter((gp) => !customLinks.some((cl) => cl.key.toLowerCase() === gp.name.toLowerCase()))
                    .map((gp) => (
                      <button
                        key={gp.id}
                        type="button"
                        onClick={() => setCustomLinks(prev => [...prev, { key: gp.name.toLowerCase(), url: "", linkType: gp.linkType as "streaming" | "social" }])}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 transition-colors"
                      >
                        + {gp.name}
                      </button>
                    ))}
                </div>
              )}
              {customLinks.length === 0 && globalPlatforms.length === 0 && <p className="text-xs text-muted-foreground italic">Add any platform not listed above (e.g. Deezer, SoundXchange…)</p>}
              {customLinks.map((cl, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <select
                    value={cl.linkType}
                    onChange={e => setCustomLinks(prev => prev.map((c, j) => j === i ? {...c, linkType: e.target.value as "streaming"|"social"} : c))}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs shrink-0"
                  >
                    <option value="streaming">Streaming</option>
                    <option value="social">Social</option>
                  </select>
                  <Input className="h-9 text-xs" placeholder="Platform name (e.g. deezer)" value={cl.key}
                    onChange={e => setCustomLinks(prev => prev.map((c, j) => j === i ? {...c, key: e.target.value} : c))} />
                  <Input className="h-9 text-xs" placeholder="URL" value={cl.url}
                    onChange={e => setCustomLinks(prev => prev.map((c, j) => j === i ? {...c, url: e.target.value} : c))} />
                  <button type="button" onClick={() => setCustomLinks(prev => prev.filter((_, j) => j !== i))} className="text-zinc-400 hover:text-red-500 shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createArtist.isPending || updateArtist.isPending}>
                {editing ? "Save Changes" : "Add Artist"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove artist?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove them from the roster.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Artist card ───────────────────────────────────────────────────────────────

function ArtistCard({ artist, onOpen, onEdit, onDelete, isSelected, isSelectMode, onToggle }: {
  artist: Artist; onOpen: () => void; onEdit: () => void; onDelete: () => void;
  isSelected?: boolean; isSelectMode?: boolean; onToggle?: () => void;
}) {
  const { data: _cardCustomStatuses = [] } = useListCustomLabelStatuses();
  const cardStatusLabels: Record<string, string> = { ...STATUS_LABELS, ...Object.fromEntries(_cardCustomStatuses.map(s => [s.key, s.name])) };
  const cardStatusColors: Record<string, string> = { ...STATUS_COLORS, ...Object.fromEntries(_cardCustomStatuses.map(s => [s.key, s.colorClass])) };
  const streaming = (artist.streamingLinks ?? {}) as Record<string, string>;
  const social    = (artist.socialLinks ?? {}) as Record<string, string>;
  const allLinks  = { ...streaming, ...social };
  const artistStatuses = (artist.labelStatus ?? []) as string[];
  const outreach  = (artist.outreachStatus ?? "new") as OutreachStatus;
  const analysis  = (artist as Artist & { aiAnalysis?: ArtistAiAnalysis | null }).aiAnalysis;
  const tier      = analysis?.leadTier as LeadTier | undefined;

  return (
    <Card
      className={`group hover:shadow-md transition-shadow cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
      onClick={() => { if (isSelectMode) { onToggle?.(); } else { onOpen(); } }}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          {isSelectMode && (
            <button
              className="shrink-0 mt-0.5"
              onClick={e => { e.stopPropagation(); onToggle?.(); }}
              aria-label={isSelected ? "Deselect" : "Select"}
            >
              {isSelected
                ? <CheckSquare className="h-4 w-4 text-primary" />
                : <Square className="h-4 w-4 text-muted-foreground" />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold truncate">{artist.name}</CardTitle>
            {artist.genre && <p className="text-xs text-muted-foreground mt-0.5">{artist.genre}</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {artistStatuses.length > 0 ? artistStatuses.map(s => (
              <Badge key={s} variant="outline" className={`text-[10px] ${cardStatusColors[s] ?? ""}`}>{cardStatusLabels[s] ?? s}</Badge>
            )) : (
              <Badge variant="outline" className={`text-[10px] ${cardStatusColors["unsigned"]}`}>{cardStatusLabels["unsigned"]}</Badge>
            )}
            {tier && (
              <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${LEAD_TIER_CONFIG[tier]?.color ?? ""}`}>
                {LEAD_TIER_CONFIG[tier]?.icon}{LEAD_TIER_CONFIG[tier]?.label}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {artist.bio && <p className="text-xs text-muted-foreground line-clamp-2">{artist.bio}</p>}

        <div className="flex items-center gap-1.5 flex-wrap">
          {outreach !== "new" && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${OUTREACH_COLORS[outreach]}`}>
              {OUTREACH_LABELS[outreach]}
            </span>
          )}
          {artist.tags.slice(0, 2).map(tag => (
            <span key={tag} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">{tag}</span>
          ))}
          {artist.tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{artist.tags.length - 2}</span>}
        </div>

        {Object.keys(allLinks).length > 0 && (
          <div className="flex items-center gap-1.5">
            {Object.entries(allLinks).map(([key, url]) => (
              <a key={key} href={url} target="_blank" rel="noopener noreferrer"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title={key} onClick={e => e.stopPropagation()}>
                {STREAMING_ICONS[key] ?? <ExternalLink className="h-3.5 w-3.5" />}
              </a>
            ))}
          </div>
        )}

        {/* AI score mini-bar */}
        {analysis && (
          <div className="flex items-center gap-2 pt-0.5">
            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${analysis.growthScore >= 70 ? "bg-green-500" : analysis.growthScore >= 40 ? "bg-amber-500" : "bg-red-400"}`}
                style={{ width: `${analysis.growthScore}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{analysis.growthScore} growth</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={e => { e.stopPropagation(); onEdit(); }}>
            <Pencil className="h-3 w-3 mr-1" />Edit
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); onDelete(); }}>
            <Trash2 className="h-3 w-3 mr-1" />Remove
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs ml-auto" onClick={e => { e.stopPropagation(); onOpen(); }}>
            <Star className="h-3 w-3 mr-1" />Profile
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
