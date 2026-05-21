import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft, Pencil, Plus, X, ExternalLink, Globe,
  Music, Music2, Youtube, Instagram, Twitter, Disc3, Radio,
  User, Mail, Phone, MapPin, Building, DollarSign,
  Calendar, Loader2, Trash2, Link2, FileDown, Copy,
  FileText, Sparkles, Search, HardDrive,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  if (isLoading) return <p className="text-sm text-zinc-400 py-3">Loading linked files…</p>;
  if (!links.length)
    return (
      <p className="text-sm text-zinc-400 italic py-2">
        No OneDrive files linked yet. Open OneDrive, select a file, and use &ldquo;Link to CRM record&rdquo;.
      </p>
    );

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <div key={link.id} className="flex items-start gap-2 p-3 rounded-lg border border-zinc-100 bg-zinc-50 text-sm">
          <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{link.fileName ?? "(unnamed file)"}</p>
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

  if (isLoading) return <p className="text-sm text-zinc-400 py-3">Loading linked emails…</p>;
  if (!links.length)
    return (
      <p className="text-sm text-zinc-400 italic py-2">
        No Outlook emails linked yet. Open an email in Outlook and use &ldquo;Link to…&rdquo;.
      </p>
    );

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <div key={link.id} className="flex items-start gap-2 p-3 rounded-lg border border-blue-100 bg-blue-50/40 text-sm dark:bg-blue-950/20 dark:border-blue-900">
          <Mail className="h-3.5 w-3.5 text-[#0078d4] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{link.messageSubject ?? "(no subject)"}</p>
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
import { ImageUploadButton, getStorageImgSrc } from "@/components/image-upload-button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Status config ─────────────────────────────────────────────────────────────

type LabelStatus = "unsigned" | "in_talks" | "signed" | "released" | "dropped" | "distribution" | "recording_time" | "mixing_mastering" | "video_services";

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

// ── Platform config ───────────────────────────────────────────────────────────

interface PlatformDef {
  key: string;
  label: string;
  color: string;
  linkType: "streaming" | "social";
}

const PLATFORMS: PlatformDef[] = [
  { key: "spotify",     label: "Spotify",      color: "#1DB954", linkType: "streaming" },
  { key: "appleMusic",  label: "Apple Music",   color: "#FC3C44", linkType: "streaming" },
  { key: "bandcamp",    label: "Bandcamp",      color: "#1DA0C3", linkType: "streaming" },
  { key: "audiomack",   label: "Audiomack",     color: "#FF6728", linkType: "streaming" },
  { key: "youtube",     label: "YouTube",       color: "#FF0000", linkType: "streaming" },
  { key: "soundcloud",  label: "SoundCloud",    color: "#FF5500", linkType: "streaming" },
  { key: "tidal",       label: "Tidal",         color: "#000000", linkType: "streaming" },
  { key: "instagram",   label: "Instagram",     color: "#E1306C", linkType: "social"    },
  { key: "facebook",    label: "Facebook",      color: "#1877F2", linkType: "social"    },
  { key: "tiktok",      label: "TikTok",        color: "#010101", linkType: "social"    },
  { key: "twitter",     label: "X (Twitter)",   color: "#000000", linkType: "social"    },
  { key: "groover",     label: "Groover",        color: "#6741D9", linkType: "social"    },
  { key: "bandsintown", label: "Bandsintown",   color: "#00B4B3", linkType: "social"    },
  { key: "songkick",    label: "Songkick",      color: "#F80046", linkType: "social"    },
  { key: "website",     label: "Website",       color: "#6366f1", linkType: "social"    },
];

function PlatformIcon({ platformKey, size = 18 }: { platformKey: string; size?: number }) {
  const p = PLATFORMS.find(x => x.key === platformKey);
  const color = p?.color ?? "#6b7280";
  if (platformKey === "youtube")   return <Youtube   size={size} style={{ color }} />;
  if (platformKey === "instagram") return <Instagram size={size} style={{ color }} />;
  if (platformKey === "twitter")   return <Twitter   size={size} style={{ color }} />;
  if (platformKey === "spotify")   return <Disc3     size={size} style={{ color }} />;
  if (platformKey === "website")   return <Globe     size={size} style={{ color }} />;
  if (platformKey === "bandcamp")  return <Radio     size={size} style={{ color }} />;
  const label = p?.label ?? platformKey;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-bold shrink-0"
      style={{
        width: size, height: size, backgroundColor: color,
        fontSize: Math.round(size * 0.45),
      }}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

// ── Streaming embeds helpers ──────────────────────────────────────────────────

function getStreamEmbedUrl(platformKey: string, url: string): string | null {
  if (!url) return null;
  if (platformKey === "spotify" && url.includes("open.spotify.com/artist/")) {
    const id = url.split("open.spotify.com/artist/")[1]?.split("?")[0];
    return id ? `https://open.spotify.com/embed/artist/${id}?utm_source=generator` : null;
  }
  if (platformKey === "appleMusic" && url.includes("music.apple.com")) {
    return url.replace("music.apple.com", "embed.music.apple.com");
  }
  if (platformKey === "soundcloud" && url.includes("soundcloud.com")) {
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23FF5500&show_artwork=true&show_comments=false&hide_related=true&sharing=false`;
  }
  if (platformKey === "youtube") {
    const vidMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (vidMatch) return `https://www.youtube.com/embed/${vidMatch[1]}`;
  }
  return null;
}

function StreamingTab({ artist, onEdit }: { artist: ArtistData; onEdit: () => void }) {
  const sl = artist.streamingLinks ?? {};
  const streamingPlatforms = PLATFORMS.filter(p => p.linkType === "streaming");
  const setLinks = streamingPlatforms.filter(p => sl[p.key]);
  const missingLinks = streamingPlatforms.filter(p => !sl[p.key]);

  if (setLinks.length === 0) {
    return (
      <div className="p-8 flex flex-col items-center gap-3 text-center">
        <Radio className="h-8 w-8 text-zinc-300" />
        <p className="text-sm text-zinc-500">No streaming links added yet.</p>
        <button
          onClick={onEdit}
          className="text-xs text-violet-600 hover:underline"
        >
          Edit profile to add Spotify, Apple Music, Bandcamp and more
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {setLinks.map(p => {
        const url = sl[p.key];
        const embedUrl = getStreamEmbedUrl(p.key, url);
        return (
          <div key={p.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlatformIcon platformKey={p.key} size={18} />
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{p.label}</span>
              </div>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {embedUrl ? (
              <iframe
                src={embedUrl}
                className="w-full rounded-xl border-0 block"
                style={{ height: p.key === "soundcloud" ? 166 : 352 }}
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                title={`${p.label} player`}
              />
            ) : (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <PlatformIcon platformKey={p.key} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{p.label}</p>
                  <p className="text-xs text-zinc-500 truncate">{url}</p>
                </div>
                <ExternalLink className="h-4 w-4 text-zinc-400 shrink-0" />
              </a>
            )}
          </div>
        );
      })}
      {missingLinks.length > 0 && (
        <p className="text-[11px] text-zinc-400 text-center border-t pt-3">
          Not set: {missingLinks.map(p => p.label).join(" · ")}
          {" — "}
          <button onClick={onEdit} className="text-violet-500 hover:underline">add in edit</button>
        </p>
      )}
    </div>
  );
}

// ── Profile completion ────────────────────────────────────────────────────────

function calcCompletion(artist: ArtistData): number {
  let score = 0;
  if (artist.name)         score += 10;
  if (artist.genre)        score += 10;
  if (artist.bio)          score += 15;
  if (artist.imageUrl)     score += 10;
  if (artist.email)        score += 10;
  if (artist.phone)        score += 5;
  if (artist.city || artist.country)              score += 5;
  if (artist.originCity || artist.originCountry)  score += 5;
  const sl = artist.streamingLinks ?? {};
  const so = artist.socialLinks ?? {};
  if (sl["spotify"])    score += 10;
  if (so["instagram"])  score += 10;
  if ((artist.photoUrls ?? []).length > 0) score += 10;
  return Math.min(score, 100);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ArtistData {
  id: number;
  name: string;
  genre?: string | null;
  bio?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  originCity?: string | null;
  originState?: string | null;
  originCountry?: string | null;
  imageUrl?: string | null;
  photoUrls?: string[];
  labelStatus?: string[];
  outreachStatus?: string;
  streamingLinks?: Record<string, string>;
  socialLinks?: Record<string, string>;
  tags?: string[];
  contactId?: number | null;
  followersEstimate?: string | null;
  revenuePotential?: string | null;
  engagementLevel?: string | null;
}

interface EditForm {
  name: string;
  genre: string;
  bio: string;
  email: string;
  phone: string;
  imageUrl: string;
  city: string;
  state: string;
  country: string;
  originCity: string;
  originState: string;
  originCountry: string;
  labelStatus: string[];
  streamingLinks: Record<string, string>;
  socialLinks: Record<string, string>;
  photoUrls: string[];
}

function toEditForm(a: ArtistData): EditForm {
  return {
    name: a.name ?? "",
    genre: a.genre ?? "",
    bio: a.bio ?? "",
    email: a.email ?? "",
    phone: a.phone ?? "",
    imageUrl: a.imageUrl ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    country: a.country ?? "",
    originCity: a.originCity ?? "",
    originState: a.originState ?? "",
    originCountry: a.originCountry ?? "",
    labelStatus: (a.labelStatus as string[] | undefined) ?? [],
    streamingLinks: { ...(a.streamingLinks ?? {}) },
    socialLinks: { ...(a.socialLinks ?? {}) },
    photoUrls: [...(a.photoUrls ?? [])],
  };
}

function formToBody(f: EditForm) {
  return {
    name: f.name,
    genre: f.genre || undefined,
    bio: f.bio || undefined,
    email: f.email || undefined,
    phone: f.phone || undefined,
    imageUrl: f.imageUrl || undefined,
    city: f.city || undefined,
    state: f.state || undefined,
    country: f.country || undefined,
    originCity: f.originCity || undefined,
    originState: f.originState || undefined,
    originCountry: f.originCountry || undefined,
    labelStatus: f.labelStatus,
    streamingLinks: f.streamingLinks,
    socialLinks: f.socialLinks,
    photoUrls: f.photoUrls,
  };
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
      {icon}
      <p className="text-sm text-center max-w-xs">{text}</p>
    </div>
  );
}

// ── Edit dialog ───────────────────────────────────────────────────────────────

function EditArtistDialog({
  artist, onClose, onSave, isSaving, token,
}: {
  artist: ArtistData;
  onClose: () => void;
  onSave: (data: ReturnType<typeof formToBody>) => void;
  isSaving: boolean;
  token: string | null;
}) {
  const [form, setForm] = useState<EditForm>(() => toEditForm(artist));
  const [addPhoto, setAddPhoto] = useState("");
  const [editTab, setEditTab] = useState("basic");
  const { toast } = useToast();

  function setField<K extends keyof EditForm>(k: K, v: EditForm[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function setLink(type: "streaming" | "social", key: string, val: string) {
    if (type === "streaming") {
      setForm(f => ({ ...f, streamingLinks: { ...f.streamingLinks, [key]: val } }));
    } else {
      setForm(f => ({ ...f, socialLinks: { ...f.socialLinks, [key]: val } }));
    }
  }

  function addPhotoUrl() {
    if (!addPhoto.trim()) return;
    setForm(f => ({ ...f, photoUrls: [...f.photoUrls, addPhoto.trim()] }));
    setAddPhoto("");
  }

  function removePhoto(url: string) {
    setForm(f => ({ ...f, photoUrls: f.photoUrls.filter(u => u !== url) }));
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Artist</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b mb-4 -mx-1 overflow-x-auto">
          {(["basic", "location", "links", "photos"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setEditTab(tab)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium capitalize whitespace-nowrap transition-colors",
                editTab === tab
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "basic" ? "Basic Info" : tab === "location" ? "Location" : tab === "links" ? "Links" : "Photos"}
            </button>
          ))}
        </div>

        {editTab === "basic" && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={form.name} onChange={e => setField("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Genre</Label>
              <Input value={form.genre} onChange={e => setField("genre", e.target.value)} placeholder="Hip-Hop, R&B, Pop…" />
            </div>
            <div className="space-y-1.5">
              <Label>Label Status</Label>
              <div className="border rounded-md p-2.5 grid grid-cols-2 gap-1.5">
                {Object.entries(STATUS_LABELS).map(([val, lbl]) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer select-none text-sm">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-zinc-300 accent-primary"
                      checked={form.labelStatus.includes(val)}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...form.labelStatus, val]
                          : form.labelStatus.filter(s => s !== val);
                        setField("labelStatus", next);
                      }}
                    />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Bio</Label>
              <Textarea
                value={form.bio}
                onChange={e => setField("bio", e.target.value)}
                rows={4}
                placeholder="Artist bio…"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.email} onChange={e => setField("email", e.target.value)} type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={e => setField("phone", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Profile Image URL</Label>
              <div className="flex gap-2">
                <Input
                  value={form.imageUrl}
                  onChange={e => setField("imageUrl", e.target.value)}
                  placeholder="https://… or upload →"
                  className="flex-1"
                />
                <ImageUploadButton
                  token={token}
                  onUpload={url => setField("imageUrl", url)}
                  onError={msg => toast({ title: msg, variant: "destructive" })}
                  label="Upload"
                  size="sm"
                />
              </div>
              {form.imageUrl && (
                <img
                  src={getStorageImgSrc(form.imageUrl, token)}
                  alt="Preview"
                  className="mt-2 h-16 w-16 rounded-full object-cover border"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
            </div>
          </div>
        )}

        {editTab === "location" && (
          <div className="space-y-4">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Current Location</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>City</Label>
                <Input value={form.city} onChange={e => setField("city", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>State / Province</Label>
                <Input value={form.state} onChange={e => setField("state", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Country</Label>
                <Input value={form.country} onChange={e => setField("country", e.target.value)} />
              </div>
            </div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide pt-2">Origin / Hometown</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Origin City</Label>
                <Input value={form.originCity} onChange={e => setField("originCity", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Origin State</Label>
                <Input value={form.originState} onChange={e => setField("originState", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Origin Country</Label>
                <Input value={form.originCountry} onChange={e => setField("originCountry", e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {editTab === "links" && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Streaming</p>
            {PLATFORMS.filter(p => p.linkType === "streaming").map(p => (
              <div key={p.key} className="flex items-center gap-2">
                <PlatformIcon platformKey={p.key} size={18} />
                <div className="flex-1">
                  <Input
                    placeholder={`${p.label} URL…`}
                    value={form.streamingLinks[p.key] ?? ""}
                    onChange={e => setLink("streaming", p.key, e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
              </div>
            ))}
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide pt-2">Social</p>
            {PLATFORMS.filter(p => p.linkType === "social").map(p => (
              <div key={p.key} className="flex items-center gap-2">
                <PlatformIcon platformKey={p.key} size={18} />
                <div className="flex-1">
                  <Input
                    placeholder={`${p.label} URL…`}
                    value={form.socialLinks[p.key] ?? ""}
                    onChange={e => setLink("social", p.key, e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {editTab === "photos" && (
          <div className="space-y-4">
            {form.photoUrls.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {form.photoUrls.map((url, i) => (
                  <div key={i} className="relative group aspect-square rounded-lg overflow-hidden bg-zinc-100">
                    <img
                      src={getStorageImgSrc(url, token)}
                      alt={`photo ${i + 1}`}
                      className="h-full w-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <button
                      onClick={() => removePhoto(url)}
                      className="absolute top-1 right-1 h-5 w-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="Paste image URL…"
                value={addPhoto}
                onChange={e => setAddPhoto(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPhotoUrl(); } }}
                className="text-sm"
              />
              <Button size="sm" variant="outline" onClick={addPhotoUrl} disabled={!addPhoto.trim()} className="shrink-0">
                <Plus className="h-4 w-4" />
              </Button>
              <ImageUploadButton
                token={token}
                onUpload={url => setForm(f => ({ ...f, photoUrls: [...f.photoUrls, url] }))}
                onError={msg => toast({ title: msg, variant: "destructive" })}
                icon="image"
                size="sm"
              />
            </div>
            {form.photoUrls.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No photos yet. Paste a URL or upload an image above.</p>
            )}
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>Cancel</Button>
          <Button onClick={() => onSave(formToBody(form))} disabled={isSaving || !form.name.trim()}>
            {isSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Content generation templates ──────────────────────────────────────────────

const CONTENT_TEMPLATES = [
  { key: "artist_bio",    label: "Artist Bio",       icon: "👤" },
  { key: "instagram",     label: "Instagram Caption", icon: "📸" },
  { key: "twitter",       label: "X (Twitter) Post",  icon: "🐦" },
  { key: "press_release", label: "Press Release",     icon: "📰" },
  { key: "email_blast",   label: "Email Blast",       icon: "📧" },
] as const;

type ContentType = typeof CONTENT_TEMPLATES[number]["key"];

function buildGenreHashtags(genre: string | null | undefined): string {
  if (!genre) return "";
  return genre.split(/[,/]/).slice(0, 3).map(g => `#${g.trim().replace(/\s+/g, "")}`).join(" ");
}

function generateContent(type: ContentType, artist: ArtistData): string {
  const name = artist.name || "the artist";
  const genre = artist.genre || "music";
  const genreHashtags = buildGenreHashtags(artist.genre);
  const city = [artist.city, artist.state, artist.country].filter(Boolean).join(", ") || "an undisclosed location";
  const origin = [artist.originCity, artist.originCountry].filter(Boolean).join(", ") || city;
  const bio = artist.bio || "";
  const labelStatuses = (artist.labelStatus as string[] | undefined) ?? [];
  const spotifyUrl = artist.streamingLinks?.["spotify"] || "";
  const igHandle = artist.socialLinks?.["instagram"] ? `@${artist.socialLinks["instagram"].replace(/.*instagram\.com\//, "").replace(/\/$/, "")}` : `@${name.toLowerCase().replace(/\s+/g, "")}`;
  const followers = artist.followersEstimate ? `${artist.followersEstimate} estimated followers` : "";

  if (type === "artist_bio") {
    return `${name} is a ${genre} artist${origin !== city ? ` originally from ${origin}` : ""} based in ${city}. ${bio ? bio + "\n\n" : ""}${labelStatuses.includes("signed") ? `Currently signed and actively releasing music` : labelStatuses.includes("in_talks") ? `Currently in label talks` : `An independent force building momentum`}, ${name} brings a distinct sound that resonates with fans worldwide.${followers ? ` With ${followers}, their reach continues to grow.` : ""}${spotifyUrl ? `\n\nStream on Spotify: ${spotifyUrl}` : ""}`;
  }

  if (type === "instagram") {
    return `🎵 ${name}\n\n${bio ? bio.slice(0, 120) + (bio.length > 120 ? "..." : "") + "\n\n" : ""}🌍 Based in ${city}${spotifyUrl ? `\n🎧 Stream now — link in bio` : ""}\n\n${genreHashtags} #newmusic #indieartist #${name.toLowerCase().replace(/\s+/g, "")}`;
  }

  if (type === "twitter") {
    const short = bio ? bio.slice(0, 80) + (bio.length > 80 ? "..." : "") : `${genre} artist from ${city}`;
    return `🎵 ${name} — ${short}${spotifyUrl ? `\n\nStream: ${spotifyUrl}` : ""}\n\n${genreHashtags} #newmusic`;
  }

  if (type === "press_release") {
    const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return `FOR IMMEDIATE RELEASE\n${date}\n\n${name.toUpperCase()} ANNOUNCES DEBUT ON THE ${genre.toUpperCase()} SCENE\n\n[CITY] — ${name}, a rising ${genre} artist from ${city}, is making waves with their unique sound and compelling artistry.${bio ? "\n\n" + bio : ""}\n\n${labelStatuses.includes("signed") ? `${name} is signed and actively working on new material.` : labelStatuses.includes("in_talks") ? `${name} is currently in discussions with labels.` : `As an independent artist, ${name} retains full creative control of their music.`}${followers ? `\n\nWith ${followers}, their fanbase continues to expand rapidly.` : ""}${spotifyUrl ? `\n\nStream their music at: ${spotifyUrl}` : ""}\n\n###\n\nMedia Contact:\n[Name] | [Email] | [Phone]`;
  }

  if (type === "email_blast") {
    return `Subject: Introducing ${name} — ${genre} Artist From ${city}\n\nHi [Name],\n\nI wanted to reach out to introduce you to ${name}, a talented ${genre} artist based in ${city}.${bio ? "\n\n" + bio : ""}\n\n${labelStatuses.includes("signed") ? `They are currently signed and working on upcoming releases.` : `They are currently unsigned and actively seeking the right partnership.`}${followers ? ` Their social following stands at ${followers}.` : ""}\n\n${spotifyUrl ? `You can hear their music here: ${spotifyUrl}\n\n` : ""}I believe ${name} could be a great fit for [opportunity]. Would love to set up a quick call to discuss further.\n\nBest,\n[Your name]`;
  }

  return "";
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ArtistProfile() {
  const [, params] = useRoute("/artists/:id");
  const [, navigate] = useLocation();
  const id = parseInt(params?.id ?? "0");
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [addPhotoInput, setAddPhotoInput] = useState("");
  const [linkReleaseOpen, setLinkReleaseOpen] = useState(false);
  const [releaseSearch, setReleaseSearch] = useState("");
  const [contentType, setContentType] = useState<"instagram" | "twitter" | "press_release" | "artist_bio" | "email_blast">("artist_bio");
  const [generatedContent, setGeneratedContent] = useState("");

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: artist, isLoading } = useQuery<ArtistData>({
    queryKey: ["artist-profile", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/artists/${id}`, { headers: authHeaders });
      if (!res.ok) throw new Error("Artist not found");
      return res.json();
    },
    enabled: !!id && !!token,
  });

  const { data: releases = [] } = useQuery<any[]>({
    queryKey: ["artist-profile-releases", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/artists/${id}/releases`, { headers: authHeaders });
      return res.ok ? res.json() : [];
    },
    enabled: !!id && !!token,
  });

  const { data: deals = [] } = useQuery<any[]>({
    queryKey: ["artist-profile-deals", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/artists/${id}/deals`, { headers: authHeaders });
      return res.ok ? res.json() : [];
    },
    enabled: !!id && !!token,
  });

  const { data: contact = null } = useQuery<any>({
    queryKey: ["artist-profile-contact", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/artists/${id}/contact`, { headers: authHeaders });
      return res.ok ? res.json() : null;
    },
    enabled: !!id && !!token,
  });

  const { data: contentPosts = [] } = useQuery<any[]>({
    queryKey: ["artist-profile-content", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/artists/${id}/content-posts`, { headers: authHeaders });
      return res.ok ? res.json() : [];
    },
    enabled: !!id && !!token,
  });

  // All releases for the link picker
  const { data: allReleases = [] } = useQuery<any[]>({
    queryKey: ["all-releases-picker"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/releases`, { headers: authHeaders });
      return res.ok ? res.json() : [];
    },
    enabled: !!token && linkReleaseOpen,
    staleTime: 30_000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const linkReleaseMutation = useMutation({
    mutationFn: async (releaseId: number) => {
      const res = await fetch(`${BASE}/api/releases/${releaseId}/link-artist`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ artistId: id }),
      });
      if (!res.ok) throw new Error("Failed to link release");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist-profile-releases", id] });
      qc.invalidateQueries({ queryKey: ["all-releases-picker"] });
      setLinkReleaseOpen(false);
      toast({ title: "Release linked", description: "The release is now connected to this artist." });
    },
    onError: () => toast({ title: "Error", description: "Could not link release.", variant: "destructive" }),
  });

  // ── Mutation ─────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await fetch(`${BASE}/api/artists/${id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? "Failed to update artist");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist-profile", id] });
      toast({ title: "Artist updated" });
      setEditOpen(false);
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  // ── Inline photo add ──────────────────────────────────────────────────────

  async function handleAddPhoto() {
    if (!addPhotoInput.trim() || !artist) return;
    const photos = [...(artist.photoUrls ?? []), addPhotoInput.trim()];
    await updateMutation.mutateAsync({ ...formToBody(toEditForm(artist)), photoUrls: photos });
    setAddPhotoInput("");
  }

  async function handleRemovePhoto(url: string) {
    if (!artist) return;
    const photos = (artist.photoUrls ?? []).filter(u => u !== url);
    updateMutation.mutate({ ...formToBody(toEditForm(artist)), photoUrls: photos });
  }

  // ── Loading / error ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <User className="h-10 w-10 opacity-20" />
        <p className="text-sm">Artist not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/artists")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Artists
        </Button>
      </div>
    );
  }

  const completion = calcCompletion(artist);
  const completionColor =
    completion >= 80 ? "#22c55e" : completion >= 50 ? "#eab308" : "#ef4444";

  const allLinks = {
    ...Object.fromEntries(
      PLATFORMS.filter(p => p.linkType === "streaming")
        .map(p => [p.key, (artist.streamingLinks ?? {})[p.key] ?? ""])
    ),
    ...Object.fromEntries(
      PLATFORMS.filter(p => p.linkType === "social")
        .map(p => [p.key, (artist.socialLinks ?? {})[p.key] ?? ""])
    ),
  };

  const photoUrls = artist.photoUrls ?? [];

  return (
    <div className="flex-1 overflow-y-auto bg-zinc-50 dark:bg-zinc-950">

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
        <button
          onClick={() => navigate("/artists")}
          className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Artists</span>
        </button>
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">{artist.name}</h1>
        <Button size="sm" onClick={() => setEditOpen(true)} className="gap-1.5 shrink-0">
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Edit Artist</span>
        </Button>
      </div>

      <div className="p-4 sm:p-8 max-w-4xl mx-auto space-y-5">

        {/* ── Profile card ──────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border shadow-sm p-6">
          <div className="flex items-start gap-5">
            {/* Circular avatar */}
            <div className="h-24 w-24 rounded-full overflow-hidden shrink-0 ring-2 ring-zinc-100 dark:ring-zinc-800">
              {artist.imageUrl ? (
                <img
                  src={getStorageImgSrc(artist.imageUrl, token)}
                  alt={artist.name}
                  className="h-full w-full object-cover"
                  onError={e => {
                    const t = e.target as HTMLImageElement;
                    t.style.display = "none";
                    t.parentElement!.classList.add("bg-gradient-to-br", "from-violet-500", "to-indigo-600");
                  }}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-3xl font-bold">
                  {artist.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 leading-tight">{artist.name}</h2>
                  {artist.genre && (
                    <p className="text-sm text-zinc-500 mt-0.5">{artist.genre}</p>
                  )}
                </div>
                {(artist.labelStatus as string[] | undefined)?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {(artist.labelStatus as string[]).map(s => (
                      <Badge key={s} variant="outline" className={cn("text-xs shrink-0", STATUS_COLORS[s] ?? "")}>
                        {STATUS_LABELS[s] ?? s}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Profile completion bar */}
              <div className="mt-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-400">Profile Status</span>
                  <span className="text-xs font-semibold" style={{ color: completionColor }}>{completion}%</span>
                </div>
                <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${completion}%`, backgroundColor: completionColor }}
                  />
                </div>
              </div>

              {/* Locations */}
              <div className="mt-3 flex flex-col gap-1">
                {(artist.originCity || artist.originState || artist.originCountry) && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <MapPin className="h-3 w-3 text-zinc-400 shrink-0" />
                    <span className="text-zinc-400">Origin:</span>
                    <span>{[artist.originCity, artist.originState, artist.originCountry].filter(Boolean).join(", ")}</span>
                  </div>
                )}
                {(artist.city || artist.state || artist.country) && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                    <MapPin className="h-3 w-3 text-zinc-400 shrink-0" />
                    <span className="text-zinc-400">Current:</span>
                    <span>{[artist.city, artist.state, artist.country].filter(Boolean).join(", ")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contact row */}
          {(artist.email || artist.phone) && (
            <div className="mt-4 pt-4 border-t flex flex-wrap gap-4">
              {artist.email && (
                <a
                  href={`mailto:${artist.email}`}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
                >
                  <Mail className="h-3.5 w-3.5" /> {artist.email}
                </a>
              )}
              {artist.phone && (
                <span className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                  <Phone className="h-3.5 w-3.5 text-zinc-400" /> {artist.phone}
                </span>
              )}
              {artist.followersEstimate && (
                <span className="flex items-center gap-1.5 text-sm text-zinc-500">
                  <User className="h-3.5 w-3.5 text-zinc-400" /> {artist.followersEstimate} followers
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Bio ───────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border shadow-sm p-6">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-3">Artist Bio</h3>
          {artist.bio ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">{artist.bio}</p>
          ) : (
            <p className="text-sm text-zinc-400 italic">
              No bio added yet.{" "}
              <button onClick={() => setEditOpen(true)} className="underline text-blue-500">Add one</button>
            </p>
          )}
        </div>

        {/* ── Photos ────────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Artist Photos</h3>
            <span className="text-xs text-zinc-400">{photoUrls.length} photo{photoUrls.length !== 1 ? "s" : ""}</span>
          </div>

          {photoUrls.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
              {photoUrls.map((url, i) => (
                <div key={i} className="relative group aspect-square rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                  <img
                    src={getStorageImgSrc(url, token)}
                    alt={`Artist photo ${i + 1}`}
                    className="h-full w-full object-cover"
                    onError={e => {
                      const t = e.target as HTMLImageElement;
                      t.style.display = "none";
                    }}
                  />
                  <button
                    onClick={() => void handleRemovePhoto(url)}
                    className="absolute top-1.5 right-1.5 h-6 w-6 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="Paste image URL to add a photo…"
              value={addPhotoInput}
              onChange={e => setAddPhotoInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleAddPhoto(); } }}
              className="text-sm"
            />
            <Button
              size="sm" variant="outline"
              onClick={() => void handleAddPhoto()}
              disabled={!addPhotoInput.trim() || updateMutation.isPending}
              className="shrink-0"
            >
              {updateMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Plus className="h-4 w-4 mr-1" /> Add</>
              }
            </Button>
            <ImageUploadButton
              token={token}
              onUpload={url => {
                const photos = [...(artist.photoUrls ?? []), url];
                updateMutation.mutate({ ...formToBody(toEditForm(artist)), photoUrls: photos });
              }}
              onError={msg => toast({ title: msg, variant: "destructive" })}
              icon="image"
              size="sm"
              disabled={updateMutation.isPending}
            />
          </div>
        </div>

        {/* ── Artist Links ──────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border shadow-sm p-6">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Artist Links</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
            {PLATFORMS.map(p => {
              const url = allLinks[p.key];
              return (
                <div key={p.key} className="flex items-center gap-3 min-w-0">
                  <PlatformIcon platformKey={p.key} size={22} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide leading-none mb-0.5">
                      {p.label} Link
                    </p>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline truncate block"
                      >
                        {url}
                      </a>
                    ) : (
                      <p className="text-xs text-zinc-300 dark:text-zinc-600">
                        No {p.label} Link
                      </p>
                    )}
                  </div>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-zinc-600 shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Linked data tabs ─────────────────────────────────────────── */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border shadow-sm overflow-hidden">
          <Tabs defaultValue="releases">
            <div className="border-b bg-zinc-50 dark:bg-zinc-800/50 px-2 sm:px-4 flex flex-wrap items-center gap-x-2 gap-y-1 py-1 sm:py-0">
              <div className="overflow-x-auto flex-1 min-w-0">
                <TabsList className="h-10 sm:h-11 bg-transparent p-0 gap-0.5 sm:gap-1 w-max">
                  <TabsTrigger value="releases"  className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    Releases {releases.length > 0 && <span className="ml-1 text-[10px] bg-zinc-200 dark:bg-zinc-700 rounded-full px-1.5 py-0.5">{releases.length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="pipeline"  className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    Pipeline {deals.length > 0 && <span className="ml-1 text-[10px] bg-zinc-200 dark:bg-zinc-700 rounded-full px-1.5 py-0.5">{deals.length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="contacts"  className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    Contact
                  </TabsTrigger>
                  <TabsTrigger value="content"   className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    Content
                  </TabsTrigger>
                  <TabsTrigger value="emails"   className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    <Mail className="h-3 w-3 mr-1" />Emails
                  </TabsTrigger>
                  <TabsTrigger value="streaming" className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    <Radio className="h-3 w-3 mr-1" />Streaming
                  </TabsTrigger>
                  <TabsTrigger value="files"    className="text-xs data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-full px-2 sm:px-3">
                    <HardDrive className="h-3 w-3 mr-1" />Files
                  </TabsTrigger>
                </TabsList>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 gap-1 shrink-0"
                onClick={() => setLinkReleaseOpen(true)}
              >
                <Link2 className="h-3 w-3" />
                <span className="hidden sm:inline">Link release</span><span className="sm:hidden">Link</span>
              </Button>
            </div>

            {/* Releases tab */}
            <TabsContent value="releases" className="p-4 m-0">
              {releases.length === 0 ? (
                <EmptyState
                  icon={<Music className="h-8 w-8 opacity-20" />}
                  text="No releases linked to this artist yet."
                />
              ) : (
                <div className="space-y-2">
                  {releases.map((rel: any) => (
                    <div
                      key={rel.id}
                      className="flex items-center gap-3 p-3 rounded-xl border hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      {rel.coverArtUrl ? (
                        <img
                          src={rel.coverArtUrl}
                          alt={rel.title}
                          className="h-12 w-12 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                          <Music2 className="h-5 w-5 text-zinc-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{rel.title}</p>
                        <p className="text-xs text-zinc-500">
                          {rel.releaseDate ? new Date(rel.releaseDate).toLocaleDateString() : "No date"}
                          {rel.genre ? ` · ${rel.genre}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs shrink-0",
                          rel.status === "live" ? "text-green-700 border-green-300 bg-green-50" :
                          rel.status === "scheduled" ? "text-blue-700 border-blue-300 bg-blue-50" :
                          "text-zinc-600 border-zinc-300",
                        )}
                      >
                        {rel.status}
                      </Badge>
                      {rel.audioUrl && (
                        <a
                          href={rel.audioUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-400 hover:text-zinc-600 shrink-0"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Pipeline tab */}
            <TabsContent value="pipeline" className="p-4 m-0">
              {!artist.contactId ? (
                <EmptyState
                  icon={<Building className="h-8 w-8 opacity-20" />}
                  text="No contact linked to this artist. Link a contact in Edit Artist to see pipeline deals."
                />
              ) : deals.length === 0 ? (
                <EmptyState
                  icon={<DollarSign className="h-8 w-8 opacity-20" />}
                  text="No pipeline deals found for this artist's linked contact."
                />
              ) : (
                <div className="space-y-2">
                  {deals.map((deal: any) => (
                    <div
                      key={deal.id}
                      className="flex items-center gap-3 p-3 rounded-xl border hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                        <DollarSign className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{deal.title}</p>
                        {deal.value && (
                          <p className="text-xs text-zinc-500">
                            ${parseFloat(deal.value).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs capitalize shrink-0">
                        {String(deal.stage ?? "").replace(/_/g, " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Contact tab */}
            <TabsContent value="contacts" className="p-4 m-0">
              {!contact ? (
                <EmptyState
                  icon={<User className="h-8 w-8 opacity-20" />}
                  text="No contact linked. Edit the artist to link a CRM contact."
                />
              ) : (
                <div className="flex items-center gap-4 p-4 rounded-xl border">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {contact.name?.charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100">{contact.name}</p>
                    {contact.email && (
                      <p className="text-sm text-zinc-500 truncate">{contact.email}</p>
                    )}
                    {contact.phone && (
                      <p className="text-sm text-zinc-500">{contact.phone}</p>
                    )}
                  </div>
                  <button
                    onClick={() => navigate("/contacts")}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 shrink-0"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              )}
            </TabsContent>

            {/* Content tab — builder + scheduled posts */}
            <TabsContent value="content" className="p-0 m-0">
              {/* ── Content Builder ── */}
              <div className="p-4 border-b bg-gradient-to-b from-violet-50/60 to-transparent dark:from-violet-900/10">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-violet-500" />
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Content Builder</p>
                  <span className="text-[10px] bg-violet-100 text-violet-600 rounded-full px-1.5 py-0.5 font-medium">Draft only — no posting</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {CONTENT_TEMPLATES.map(t => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => {
                        setContentType(t.key);
                        if (artist) setGeneratedContent(generateContent(t.key, artist));
                      }}
                      className={cn(
                        "text-xs px-2.5 py-1 rounded-full border transition-colors",
                        contentType === t.key
                          ? "bg-violet-600 text-white border-violet-600"
                          : "bg-white text-zinc-600 border-zinc-200 hover:border-violet-300 hover:text-violet-700 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
                      )}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>
                {generatedContent ? (
                  <div className="space-y-2">
                    <Textarea
                      value={generatedContent}
                      onChange={e => setGeneratedContent(e.target.value)}
                      className="text-sm font-mono resize-none bg-white dark:bg-zinc-900 min-h-[160px]"
                      rows={8}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1.5"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedContent);
                          toast({ title: "Copied to clipboard" });
                        }}
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs gap-1.5"
                        onClick={() => {
                          const tmpl = CONTENT_TEMPLATES.find(t => t.key === contentType);
                          const blob = new Blob([generatedContent], { type: "text/plain" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `${artist?.name ?? "artist"}_${tmpl?.label.toLowerCase().replace(/\s+/g, "_") ?? "content"}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        <FileDown className="h-3 w-3" /> Download .txt
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs text-zinc-400 hover:text-zinc-600 ml-auto"
                        onClick={() => { if (artist) setGeneratedContent(generateContent(contentType, artist)); }}
                      >
                        Reset to template
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-sm text-zinc-400">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    Select a template above to generate draft content from this artist&apos;s profile
                  </div>
                )}
              </div>

              {/* ── Scheduled content posts ── */}
              {contentPosts.length > 0 && (
                <div className="p-4 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-2">Scheduled Content Posts</p>
                  {contentPosts.map((post: any) => (
                    <div
                      key={post.id}
                      className="flex items-center gap-3 p-3 rounded-xl border hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <div className="h-9 w-9 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                        <PlatformIcon platformKey={post.platform} size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 capitalize">{post.platform}</p>
                        <p className="text-xs text-zinc-500 truncate">{post.copy || "No copy"}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            post.status === "posted"    ? "text-green-700 border-green-300 bg-green-50" :
                            post.status === "scheduled" ? "text-blue-700 border-blue-300 bg-blue-50"   :
                            "text-zinc-500",
                          )}
                        >
                          {post.status}
                        </Badge>
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          {post.scheduledAt ? new Date(post.scheduledAt).toLocaleDateString() : "—"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Emails tab */}
            <TabsContent value="emails" className="p-4 m-0">
              <LinkedEmailsPanel entityType="artist" entityId={id} authToken={token} />
            </TabsContent>

            {/* Streaming tab */}
            <TabsContent value="streaming" className="m-0">
              <StreamingTab artist={artist} onEdit={() => setEditOpen(true)} />
            </TabsContent>

            {/* Files tab */}
            <TabsContent value="files" className="p-4 m-0">
              <LinkedFilesPanel entityType="artist" entityId={id} authToken={token} />
            </TabsContent>
          </Tabs>
        </div>

      </div>

      {/* ── Edit dialog ───────────────────────────────────────────────────── */}
      {editOpen && (
        <EditArtistDialog
          artist={artist}
          token={token}
          onClose={() => setEditOpen(false)}
          onSave={data => updateMutation.mutate(data)}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* ── Link release dialog ───────────────────────────────────────────── */}
      <Dialog open={linkReleaseOpen} onOpenChange={setLinkReleaseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-violet-500" />
              Link a release to {artist?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
              <Input
                value={releaseSearch}
                onChange={e => setReleaseSearch(e.target.value)}
                placeholder="Search releases…"
                className="pl-8 text-sm"
              />
            </div>
            <div className="max-h-72 overflow-y-auto divide-y rounded-lg border bg-white dark:bg-zinc-900">
              {(allReleases as any[])
                .filter(r => !releaseSearch || r.title?.toLowerCase().includes(releaseSearch.toLowerCase()))
                .map((r: any) => {
                  const alreadyLinked = r.artistId === id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={alreadyLinked || linkReleaseMutation.isPending}
                      onClick={() => linkReleaseMutation.mutate(r.id)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors",
                        alreadyLinked && "opacity-50 cursor-default",
                      )}
                    >
                      {r.coverArtUrl ? (
                        <img src={r.coverArtUrl} alt={r.title} className="h-10 w-10 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                          <Music2 className="h-4 w-4 text-zinc-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{r.title}</p>
                        <p className="text-xs text-zinc-500">
                          {r.releaseDate ?? "No date"}
                          {r.artistName && r.artistId !== id ? ` · currently: ${r.artistName}` : ""}
                        </p>
                      </div>
                      {alreadyLinked ? (
                        <Badge variant="outline" className="text-[10px] text-violet-600 border-violet-300 bg-violet-50 shrink-0">Linked</Badge>
                      ) : (
                        <span className="text-xs text-violet-500 shrink-0">Link →</span>
                      )}
                    </button>
                  );
                })}
              {allReleases.length === 0 && (
                <div className="py-8 text-center text-sm text-zinc-400">
                  {linkReleaseOpen ? "Loading…" : "No releases found"}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setLinkReleaseOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
