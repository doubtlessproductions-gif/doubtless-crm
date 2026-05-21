import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Save, Globe, Eye, EyeOff,
  ChevronUp, ChevronDown, Trash2, Plus,
  Type, Heading, Image as ImageIcon, Video, Music, Code2, Minus, LayoutGrid, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Local types ───────────────────────────────────────────────────────────────

type BlockType = "text" | "heading" | "image" | "video" | "audio" | "embed" | "divider" | "grid";

interface TextBlock    { id: string; type: "text";    content: string }
interface HeadingBlock { id: string; type: "heading"; text: string; level: 1 | 2 | 3 }
interface ImageBlock   { id: string; type: "image";   url: string; alt?: string; caption?: string }
interface VideoBlock   { id: string; type: "video";   url: string; title?: string }
interface AudioBlock   { id: string; type: "audio";   url: string; title?: string }
interface EmbedBlock   { id: string; type: "embed";   url: string; title?: string }
interface DividerBlock { id: string; type: "divider" }
interface GridBlock    { id: string; type: "grid";    columns: 2 | 3; children: ContentBlock[] }
type ContentBlock = TextBlock | HeadingBlock | ImageBlock | VideoBlock | AudioBlock | EmbedBlock | DividerBlock | GridBlock;

interface PageData {
  id?: number;
  title: string;
  slug: string;
  description: string;
  blocks: ContentBlock[];
  status?: "draft" | "published";
  contactId?: number | null;
  artistId?: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function toSlug(title: string): string {
  return title.toLowerCase().trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeBlock(type: BlockType): ContentBlock {
  const id = crypto.randomUUID();
  switch (type) {
    case "text":    return { id, type, content: "" };
    case "heading": return { id, type, text: "", level: 2 };
    case "image":   return { id, type, url: "", alt: "", caption: "" };
    case "video":   return { id, type, url: "", title: "" };
    case "audio":   return { id, type, url: "", title: "" };
    case "embed":   return { id, type, url: "", title: "" };
    case "divider": return { id, type };
    case "grid":    return { id, type, columns: 2, children: [] };
  }
}

// ── Block palette definition ──────────────────────────────────────────────────

const PALETTE: { type: BlockType; label: string; icon: React.FC<{ className?: string }>; color: string }[] = [
  { type: "heading",  label: "Heading",  icon: Heading,     color: "text-zinc-600"    },
  { type: "text",     label: "Text",     icon: Type,        color: "text-zinc-600"    },
  { type: "image",    label: "Image",    icon: ImageIcon,   color: "text-blue-500"    },
  { type: "video",    label: "Video",    icon: Video,       color: "text-violet-500"  },
  { type: "audio",    label: "Audio",    icon: Music,       color: "text-purple-500"  },
  { type: "embed",    label: "Embed",    icon: Code2,       color: "text-orange-500"  },
  { type: "divider",  label: "Divider",  icon: Minus,       color: "text-zinc-400"    },
  { type: "grid",     label: "Grid",     icon: LayoutGrid,  color: "text-emerald-500" },
];

function blockIcon(type: BlockType) {
  const entry = PALETTE.find((p) => p.type === type);
  if (!entry) return null;
  return <entry.icon className={cn("h-3.5 w-3.5 shrink-0", entry.color)} />;
}

function blockSummary(block: ContentBlock): string {
  switch (block.type) {
    case "text":    return block.content.slice(0, 60) || "Empty text";
    case "heading": return block.text || `Heading ${block.level}`;
    case "image":   return block.url ? new URL(block.url, "http://x").pathname.split("/").pop() ?? block.url : "No URL";
    case "video":   return block.title || block.url || "No URL";
    case "audio":   return block.title || block.url || "No URL";
    case "embed":   return block.title || block.url || "No URL";
    case "divider": return "──────";
    case "grid":    return `${block.columns}-column grid · ${block.children.length} item${block.children.length !== 1 ? "s" : ""}`;
  }
}

// ── Config panel per block type ───────────────────────────────────────────────

function BlockConfig({
  block,
  onChange,
  isChild = false,
}: {
  block: ContentBlock;
  onChange: (updates: Partial<ContentBlock>) => void;
  isChild?: boolean;
}) {
  const inputCls = "h-8 text-sm";
  const labelCls = "text-xs font-medium text-zinc-600";

  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className={labelCls}>Text</Label>
            <Input
              className={inputCls}
              value={block.text}
              placeholder="Heading text"
              onChange={(e) => onChange({ text: e.target.value } as any)}
            />
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>Level</Label>
            <Select
              value={String(block.level)}
              onValueChange={(v) => onChange({ level: parseInt(v) as 1 | 2 | 3 } as any)}
            >
              <SelectTrigger className={inputCls}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">H1 — Large</SelectItem>
                <SelectItem value="2">H2 — Medium</SelectItem>
                <SelectItem value="3">H3 — Small</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );

    case "text":
      return (
        <div className="space-y-1">
          <Label className={labelCls}>Content</Label>
          <Textarea
            className="text-sm min-h-[120px] resize-y"
            value={block.content}
            placeholder="Write your text here…"
            onChange={(e) => onChange({ content: e.target.value } as any)}
          />
        </div>
      );

    case "image":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className={labelCls}>Image URL</Label>
            <Input className={inputCls} value={block.url} placeholder="https://…" onChange={(e) => onChange({ url: e.target.value } as any)} />
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>Alt text</Label>
            <Input className={inputCls} value={block.alt ?? ""} placeholder="Describe the image" onChange={(e) => onChange({ alt: e.target.value } as any)} />
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>Caption</Label>
            <Input className={inputCls} value={block.caption ?? ""} placeholder="Optional caption" onChange={(e) => onChange({ caption: e.target.value } as any)} />
          </div>
          {block.url && (
            <img src={block.url} alt={block.alt} className="w-full rounded-lg object-cover max-h-32" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
        </div>
      );

    case "video":
    case "audio":
    case "embed":
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className={labelCls}>
              {block.type === "video" ? "Video URL (YouTube, Vimeo, or .mp4)" : block.type === "audio" ? "Audio URL (.mp3, .wav, etc.)" : "Embed URL"}
            </Label>
            <Input className={inputCls} value={block.url} placeholder="https://…" onChange={(e) => onChange({ url: e.target.value } as any)} />
          </div>
          <div className="space-y-1">
            <Label className={labelCls}>Title (optional)</Label>
            <Input className={inputCls} value={block.title ?? ""} placeholder="Display title" onChange={(e) => onChange({ title: e.target.value } as any)} />
          </div>
        </div>
      );

    case "divider":
      return <p className="text-xs text-zinc-400 text-center py-2">No configuration needed</p>;

    case "grid":
      if (isChild) return <p className="text-xs text-zinc-400">Nested grids not supported</p>;
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className={labelCls}>Columns</Label>
            <Select
              value={String(block.columns)}
              onValueChange={(v) => onChange({ columns: parseInt(v) as 2 | 3 } as any)}
            >
              <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2 columns</SelectItem>
                <SelectItem value="3">3 columns</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-zinc-400">Add child blocks from the canvas below the grid card.</p>
        </div>
      );
  }
}

// ── Main builder ──────────────────────────────────────────────────────────────

export default function ProjectPageBuilder() {
  const [, paramsMatch] = useRoute("/pages/builder/:id");
  const pageId = paramsMatch?.id ? parseInt(paramsMatch.id) : null;
  const isEdit = !!pageId;

  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();

  const authH = useCallback(
    (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token],
  );

  // ── State ──────────────────────────────────────────────────────────────────
  const [title, setTitle]       = useState("");
  const [slug, setSlug]         = useState("");
  const [desc, setDesc]         = useState("");
  const [blocks, setBlocks]     = useState<ContentBlock[]>([]);
  const [status, setStatus]     = useState<"draft" | "published">("draft");
  const [slugEdited, setSlugEdited] = useState(false);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [linkedContactId, setLinkedContactId] = useState<string>("none");
  const [linkedArtistId, setLinkedArtistId]   = useState<string>("none");

  // ── Load existing page ─────────────────────────────────────────────────────
  const { data: existing } = useQuery<PageData>({
    queryKey: ["project-page", pageId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pages/${pageId}`, { headers: authH() });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: isEdit && !!token,
  });

  // ── Contacts + Artists (for client linking) ────────────────────────────────
  const { data: contacts } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["contacts-for-builder"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/contacts`, { headers: authH() });
      return r.json();
    },
    enabled: !!token,
  });
  const { data: artists } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["artists-for-builder"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/artists`, { headers: authH() });
      return r.json();
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setSlug(existing.slug);
      setDesc(existing.description ?? "");
      setBlocks(existing.blocks as ContentBlock[]);
      setStatus(existing.status ?? "draft");
      setSlugEdited(true);
      setLinkedContactId(existing.contactId ? String(existing.contactId) : "none");
      setLinkedArtistId(existing.artistId ? String(existing.artistId) : "none");
    }
  }, [existing]);

  // Auto-generate slug from title
  useEffect(() => {
    if (!slugEdited && title) setSlug(toSlug(title));
  }, [title, slugEdited]);

  // ── Block mutations ────────────────────────────────────────────────────────
  const addBlock = (type: BlockType) => {
    const b = makeBlock(type);
    setBlocks((prev) => [...prev, b]);
    setSelectedId(b.id);
    setSelectedChildId(null);
  };

  const moveBlock = (id: string, dir: "up" | "down") => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap]!, next[idx]!];
      return next;
    });
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) { setSelectedId(null); setSelectedChildId(null); }
  };

  const updateBlock = (id: string, updates: Partial<ContentBlock>) => {
    setBlocks((prev) => prev.map((b) => b.id === id ? { ...b, ...updates } as ContentBlock : b));
  };

  // Grid child ops
  const addChild = (gridId: string, type: BlockType) => {
    if (type === "grid" || type === "divider") return;
    const child = makeBlock(type);
    setBlocks((prev) => prev.map((b) =>
      b.id === gridId && b.type === "grid"
        ? { ...b, children: [...b.children, child] }
        : b,
    ) as ContentBlock[]);
    setSelectedChildId(child.id);
  };

  const moveChild = (gridId: string, childId: string, dir: "up" | "down") => {
    setBlocks((prev) => prev.map((b) => {
      if (b.id !== gridId || b.type !== "grid") return b;
      const idx = b.children.findIndex((c) => c.id === childId);
      const swap = dir === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swap < 0 || swap >= b.children.length) return b;
      const next = [...b.children];
      [next[idx], next[swap]] = [next[swap]!, next[idx]!];
      return { ...b, children: next };
    }) as ContentBlock[]);
  };

  const removeChild = (gridId: string, childId: string) => {
    setBlocks((prev) => prev.map((b) =>
      b.id === gridId && b.type === "grid"
        ? { ...b, children: b.children.filter((c) => c.id !== childId) }
        : b,
    ) as ContentBlock[]);
    if (selectedChildId === childId) setSelectedChildId(null);
  };

  const updateChild = (gridId: string, childId: string, updates: Partial<ContentBlock>) => {
    setBlocks((prev) => prev.map((b) =>
      b.id === gridId && b.type === "grid"
        ? { ...b, children: b.children.map((c) => c.id === childId ? { ...c, ...updates } as ContentBlock : c) }
        : b,
    ) as ContentBlock[]);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        title, slug, description: desc, blocks,
        contactId: linkedContactId !== "none" ? parseInt(linkedContactId) : null,
        artistId: linkedArtistId !== "none" ? parseInt(linkedArtistId) : null,
      };
      const url  = isEdit ? `${BASE}/api/pages/${pageId}` : `${BASE}/api/pages`;
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { ...authH(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error((e as any).error || "Save failed");
      }
      return r.json() as Promise<PageData>;
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["project-pages"] });
      qc.invalidateQueries({ queryKey: ["project-page", pageId] });
      toast({ title: "Page saved" });
      if (!isEdit) setLocation(`/pages/builder/${saved.id}`);
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!pageId) throw new Error("Save the page first");
      const r = await fetch(`${BASE}/api/pages/${pageId}/publish`, {
        method: "POST",
        headers: authH(),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<PageData>;
    },
    onSuccess: (saved) => {
      setStatus(saved.status ?? "draft");
      qc.invalidateQueries({ queryKey: ["project-pages"] });
      toast({ title: saved.status === "published" ? "Page published" : "Page unpublished" });
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  // ── Derived selection ──────────────────────────────────────────────────────
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;
  const selectedGrid  = selectedBlock?.type === "grid" ? selectedBlock : null;
  const selectedChild = selectedGrid
    ? selectedGrid.children.find((c) => c.id === selectedChildId) ?? null
    : null;

  const CHILD_PALETTE = PALETTE.filter((p) => p.type !== "grid" && p.type !== "divider");

  return (
    <div className="flex flex-col h-full bg-zinc-50">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-white shrink-0 flex-wrap">
        <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setLocation("/pages")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Pages
        </Button>

        <div className="h-5 w-px bg-zinc-200" />

        <Input
          className="h-8 text-sm font-medium w-56"
          placeholder="Page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-zinc-400">/p/</span>
          <Input
            className="h-8 text-xs font-mono w-40"
            placeholder="slug"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
          />
        </div>

        <Badge
          variant="outline"
          className={status === "published"
            ? "text-emerald-700 border-emerald-200 bg-emerald-50 text-xs"
            : "text-zinc-500 text-xs"}
        >
          {status === "published" ? "Published" : "Draft"}
        </Badge>

        {/* Client assignment */}
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          <Select value={linkedContactId} onValueChange={setLinkedContactId}>
            <SelectTrigger className="h-7 text-xs w-32">
              <SelectValue placeholder="Contact…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No contact</SelectItem>
              {contacts?.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={linkedArtistId} onValueChange={setLinkedArtistId}>
            <SelectTrigger className="h-7 text-xs w-32">
              <SelectValue placeholder="Artist…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No artist</SelectItem>
              {artists?.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {isEdit && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
            >
              {status === "published"
                ? <><EyeOff className="h-3.5 w-3.5 mr-1.5" />Unpublish</>
                : <><Eye className="h-3.5 w-3.5 mr-1.5" />Publish</>}
            </Button>
          )}
          <Button
            size="sm"
            className="h-8"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !title || !slug}
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left: Palette ──────────────────────────────────────────────── */}
        <aside className="w-44 border-r bg-white flex flex-col shrink-0">
          <div className="px-3 py-2 border-b">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Add Block</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {PALETTE.map(({ type, label, icon: Icon, color }) => (
              <button
                key={type}
                onClick={() => addBlock(type)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 transition-colors text-left"
              >
                <Icon className={cn("h-4 w-4 shrink-0", color)} />
                {label}
              </button>
            ))}
          </div>

          {/* Page meta */}
          <div className="border-t p-3 space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Description</p>
            <Textarea
              className="text-xs min-h-[60px] resize-none"
              placeholder="Short description…"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
        </aside>

        {/* ── Center: Canvas ──────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {blocks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center text-zinc-400 gap-2 border-2 border-dashed border-zinc-200 rounded-xl">
              <Globe className="h-8 w-8 text-zinc-300" />
              <p className="text-sm">Click a block type on the left to start building</p>
            </div>
          )}

          {blocks.map((block, idx) => {
            const isSelected = selectedId === block.id;
            return (
              <div key={block.id} className="space-y-1">
                {/* Block card */}
                <div
                  onClick={() => { setSelectedId(block.id); setSelectedChildId(null); }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all bg-white",
                    isSelected
                      ? "border-violet-400 shadow-sm ring-1 ring-violet-200"
                      : "border-zinc-200 hover:border-zinc-300",
                  )}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {blockIcon(block.type)}
                    <span className="text-xs font-medium text-zinc-500 capitalize w-14 shrink-0">
                      {block.type}
                    </span>
                    <span className="text-xs text-zinc-700 truncate">{blockSummary(block)}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => moveBlock(block.id, "up")}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-zinc-100 disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                    <button
                      onClick={() => moveBlock(block.id, "down")}
                      disabled={idx === blocks.length - 1}
                      className="p-1 rounded hover:bg-zinc-100 disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                    <button
                      onClick={() => removeBlock(block.id)}
                      className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Grid children (expanded inline when grid is selected) */}
                {block.type === "grid" && isSelected && (
                  <div className="ml-6 space-y-1">
                    {block.children.map((child, ci) => (
                      <div
                        key={child.id}
                        onClick={() => setSelectedChildId(child.id)}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer bg-white text-xs transition-all",
                          selectedChildId === child.id
                            ? "border-violet-300 ring-1 ring-violet-100"
                            : "border-zinc-200 hover:border-zinc-300",
                        )}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {blockIcon(child.type)}
                          <span className="text-zinc-500 capitalize w-12 shrink-0">{child.type}</span>
                          <span className="text-zinc-700 truncate">{blockSummary(child)}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => moveChild(block.id, child.id, "up")} disabled={ci === 0} className="p-1 rounded hover:bg-zinc-100 disabled:opacity-30">
                            <ChevronUp className="h-3 w-3 text-zinc-400" />
                          </button>
                          <button onClick={() => moveChild(block.id, child.id, "down")} disabled={ci === block.children.length - 1} className="p-1 rounded hover:bg-zinc-100 disabled:opacity-30">
                            <ChevronDown className="h-3 w-3 text-zinc-400" />
                          </button>
                          <button onClick={() => removeChild(block.id, child.id)} className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* Add child button */}
                    <div className="flex gap-1 flex-wrap px-1">
                      {CHILD_PALETTE.map(({ type, icon: Icon, color }) => (
                        <button
                          key={type}
                          onClick={() => addChild(block.id, type)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500 hover:bg-zinc-50 hover:border-zinc-400 transition-colors"
                          title={`Add ${type}`}
                        >
                          <Icon className={cn("h-3 w-3", color)} />
                          <Plus className="h-2.5 w-2.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Right: Config ───────────────────────────────────────────────── */}
        <aside className="w-64 border-l bg-white flex flex-col shrink-0">
          <div className="px-3 py-2 border-b">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">
              {selectedChild ? `${selectedChild.type} (grid child)` : selectedBlock ? selectedBlock.type : "Block config"}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {!selectedBlock && (
              <p className="text-xs text-zinc-400 text-center pt-8">
                Click a block to configure it
              </p>
            )}

            {selectedBlock && !selectedChild && (
              <BlockConfig
                block={selectedBlock}
                onChange={(updates) => updateBlock(selectedBlock.id, updates)}
              />
            )}

            {selectedBlock && selectedChild && (
              <BlockConfig
                block={selectedChild}
                onChange={(updates) => updateChild(selectedBlock.id, selectedChild.id, updates)}
                isChild
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
