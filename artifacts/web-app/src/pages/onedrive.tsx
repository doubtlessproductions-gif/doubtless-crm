import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  RefreshCw, Search, Folder, FolderOpen, ExternalLink, ChevronRight,
  HardDrive, Plug2, Users, Globe, ArrowLeft, Upload, FolderPlus, Download,
  Trash2, Pencil, Link2, X, Check, Clock, FileText, ChevronDown,
  Loader2, User, Mic2, Music, Briefcase, Receipt, MessageSquare, File,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const API = "/api/onedrive";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DriveItem {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  webUrl: string;
  file?: { mimeType: string };
  folder?: { childCount: number };
  "@microsoft.graph.downloadUrl"?: string;
  remoteItem?: {
    id: string;
    parentReference: { driveId: string; driveType?: string };
    folder?: { childCount: number };
    file?: { mimeType: string };
    size?: number;
    lastModifiedDateTime?: string;
    webUrl?: string;
  };
}

interface SiteItem {
  id: string;
  name: string;
  displayName: string;
  webUrl: string;
  description?: string;
}

interface NavEntry {
  name: string;
  fetchUrl: string;
  driveId: string | null;
  folderId: string | null; // for upload target
}

interface FileLinkRecord {
  id: number;
  fileId: string;
  fileName: string | null;
  fileWebUrl: string | null;
  fileMimeType: string | null;
  entityType: string;
  entityId: number;
  linkedAt: string;
}

type Section = "my-drive" | "recent" | "shared" | "sites";

interface CrmContact { id: number; firstName: string; lastName: string; email?: string | null; }
interface CrmArtist  { id: number; name: string; genre?: string | null; }
interface CrmRelease { id: number; title: string; artistName?: string | null; }
interface CrmDeal    { id: number; title: string; stage?: string | null; }
interface CrmInvoice { id: number; invoiceNumber?: string | null; clientName?: string | null; totalAmount?: string | null; }
interface CrmThread  { id: number; title: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number) {
  if (!bytes) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function mimeEmoji(item: DriveItem): string {
  const isFolder = item.folder || item.remoteItem?.folder;
  if (isFolder) return "📁";
  const mime = item.file?.mimeType ?? item.remoteItem?.file?.mimeType ?? "";
  const name = item.name;
  if (mime.includes("word")       || name.match(/\.docx?$/i))   return "📝";
  if (mime.includes("excel")      || name.match(/\.xlsx?$/i))   return "📊";
  if (mime.includes("powerpoint") || name.match(/\.pptx?$/i))   return "📽️";
  if (mime.includes("pdf")        || name.match(/\.pdf$/i))     return "📄";
  if (mime.includes("image"))                                    return "🖼️";
  if (mime.includes("video"))                                    return "🎬";
  if (mime.includes("audio"))                                    return "🎵";
  if (mime.includes("zip") || mime.includes("compressed"))       return "🗜️";
  return "📋";
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function checkNotConnected(r: Response): Promise<Response> {
  if (r.status === 403) {
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (body.error === "not_connected") {
      throw Object.assign(new Error("not_connected"), { connectUrl: body.connectUrl ?? "/settings?tab=integrations" });
    }
  }
  return r;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NotConnectedBanner() {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center gap-1">
      <HardDrive className="h-10 w-10 text-[#0078d4]/30 mb-2" />
      <p className="font-medium text-sm text-zinc-800">OneDrive not connected</p>
      <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs mx-auto">
        Connect your OneDrive account in Settings to browse your files, upload documents, and link them to CRM records.
      </p>
      <a href="/settings?tab=integrations">
        <Button size="sm"><Plug2 className="h-3.5 w-3.5 mr-1.5" />Connect in Settings</Button>
      </a>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center">
      <FolderOpen className="h-10 w-10 text-muted-foreground/30 mb-3" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

// ── Link to CRM dialog ────────────────────────────────────────────────────────

const ENTITY_ENDPOINTS: Record<string, string> = {
  contact: "/api/contacts",
  artist:  "/api/artists",
  release: "/api/releases",
  deal:    "/api/deals",
  invoice: "/api/invoices",
  thread:  "/api/messages/threads",
};

function LinkDialog({
  open, onClose, file, authToken,
}: {
  open: boolean;
  onClose: () => void;
  file: DriveItem | null;
  authToken: string | null;
}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("contact");
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState<number | null>(null);
  const [linked, setLinked] = useState<number | null>(null);

  const { data: contacts = [] } = useQuery<CrmContact[]>({
    queryKey: ["link-contacts"], queryFn: () =>
      fetch("/api/contacts", { headers: authHeaders(authToken) }).then(r => r.json()),
    enabled: open && activeTab === "contact",
  });
  const { data: artists = [] } = useQuery<CrmArtist[]>({
    queryKey: ["link-artists"], queryFn: () =>
      fetch("/api/artists", { headers: authHeaders(authToken) }).then(r => r.json()),
    enabled: open && activeTab === "artist",
  });
  const { data: releases = [] } = useQuery<CrmRelease[]>({
    queryKey: ["link-releases"], queryFn: () =>
      fetch("/api/releases", { headers: authHeaders(authToken) }).then(r => r.json()),
    enabled: open && activeTab === "release",
  });
  const { data: deals = [] } = useQuery<CrmDeal[]>({
    queryKey: ["link-deals"], queryFn: () =>
      fetch("/api/deals", { headers: authHeaders(authToken) }).then(r => r.json()),
    enabled: open && activeTab === "deal",
  });
  const { data: invoices = [] } = useQuery<CrmInvoice[]>({
    queryKey: ["link-invoices"], queryFn: () =>
      fetch("/api/invoices", { headers: authHeaders(authToken) }).then(r => r.json()),
    enabled: open && activeTab === "invoice",
  });
  const { data: threads = [] } = useQuery<CrmThread[]>({
    queryKey: ["link-threads"], queryFn: () =>
      fetch("/api/messages/threads", { headers: authHeaders(authToken) }).then(r => r.json()),
    enabled: open && activeTab === "thread",
  });

  const doLink = async (entityId: number) => {
    if (!file) return;
    setLinking(entityId);
    await fetch(`${API}/files/${encodeURIComponent(file.id)}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(authToken) },
      body: JSON.stringify({
        entityType:   activeTab,
        entityId,
        fileName:     file.name,
        fileWebUrl:   file.webUrl || file.remoteItem?.webUrl,
        fileMimeType: file.file?.mimeType ?? file.remoteItem?.file?.mimeType ?? null,
      }),
    });
    void qc.invalidateQueries({ queryKey: ["onedrive-file-links", file.id] });
    void qc.invalidateQueries({ queryKey: ["onedrive-linked", activeTab] });
    setLinking(null);
    setLinked(entityId);
    setTimeout(() => setLinked(null), 1500);
  };

  type AnyEntity = CrmContact | CrmArtist | CrmRelease | CrmDeal | CrmInvoice | CrmThread;
  const tabs: { key: string; label: string; icon: React.ReactNode; items: AnyEntity[]; label2: (e: AnyEntity) => string; sub: (e: AnyEntity) => string }[] = [
    {
      key: "contact", label: "Contacts", icon: <User className="h-3.5 w-3.5" />,
      items: contacts as AnyEntity[],
      label2: (e) => `${(e as CrmContact).firstName} ${(e as CrmContact).lastName}`,
      sub: (e) => (e as CrmContact).email ?? "",
    },
    {
      key: "artist", label: "Artists", icon: <Mic2 className="h-3.5 w-3.5" />,
      items: artists as AnyEntity[],
      label2: (e) => (e as CrmArtist).name,
      sub: (e) => (e as CrmArtist).genre ?? "",
    },
    {
      key: "release", label: "Releases", icon: <Music className="h-3.5 w-3.5" />,
      items: releases as AnyEntity[],
      label2: (e) => (e as CrmRelease).title,
      sub: (e) => (e as CrmRelease).artistName ?? "",
    },
    {
      key: "deal", label: "Deals", icon: <Briefcase className="h-3.5 w-3.5" />,
      items: deals as AnyEntity[],
      label2: (e) => (e as CrmDeal).title,
      sub: (e) => (e as CrmDeal).stage ?? "",
    },
    {
      key: "invoice", label: "Invoices", icon: <Receipt className="h-3.5 w-3.5" />,
      items: invoices as AnyEntity[],
      label2: (e) => (e as CrmInvoice).invoiceNumber ?? `#${(e as CrmInvoice).id}`,
      sub: (e) => (e as CrmInvoice).clientName ?? "",
    },
    {
      key: "thread", label: "Threads", icon: <MessageSquare className="h-3.5 w-3.5" />,
      items: threads as AnyEntity[],
      label2: (e) => (e as CrmThread).title,
      sub: () => "",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setSearch(""); setLinked(null); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4 text-[#0078d4]" />
            Link file to CRM record
          </DialogTitle>
          {file && (
            <p className="text-xs text-muted-foreground truncate pt-0.5">
              {mimeEmoji(file)} {file.name}
            </p>
          )}
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={(t) => { setActiveTab(t); setSearch(""); }}>
          <TabsList className="w-full grid grid-cols-6 h-8">
            {tabs.map(t => (
              <TabsTrigger key={t.key} value={t.key} className="text-xs gap-1 px-1">
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map(t => {
            const filtered = (t.items as AnyEntity[]).filter(e =>
              t.label2(e).toLowerCase().includes(search.toLowerCase()) ||
              t.sub(e).toLowerCase().includes(search.toLowerCase())
            );
            return (
              <TabsContent key={t.key} value={t.key} className="mt-2">
                <Input
                  placeholder={`Search ${t.label.toLowerCase()}…`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-8 text-xs mb-2"
                />
                <ScrollArea className="h-56">
                  {filtered.length === 0
                    ? <p className="text-xs text-zinc-400 text-center py-6">No {t.label.toLowerCase()} found</p>
                    : filtered.map(e => (
                      <div key={e.id} className="flex items-center gap-2 px-1 py-1.5 hover:bg-muted/40 rounded-md">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{t.label2(e)}</p>
                          {t.sub(e) && <p className="text-xs text-muted-foreground truncate">{t.sub(e)}</p>}
                        </div>
                        <Button
                          size="sm"
                          variant={linked === e.id ? "default" : "outline"}
                          className="h-6 px-2 text-xs shrink-0"
                          disabled={linking === e.id}
                          onClick={() => void doLink(e.id)}
                        >
                          {linking === e.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : linked === e.id
                            ? <Check className="h-3 w-3" />
                            : "Link"}
                        </Button>
                      </div>
                    ))}
                </ScrollArea>
              </TabsContent>
            );
          })}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── New Folder dialog ─────────────────────────────────────────────────────────

function NewFolderDialog({ open, onClose, onConfirm }: {
  open: boolean; onClose: () => void; onConfirm: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onConfirm(name.trim());
    setSaving(false);
    setName("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setName(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
        <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
          <Input
            placeholder="Folder name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!name.trim() || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Rename dialog ─────────────────────────────────────────────────────────────

function RenameDialog({ open, onClose, item, onConfirm }: {
  open: boolean; onClose: () => void; item: DriveItem | null; onConfirm: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name === item?.name) return;
    setSaving(true);
    await onConfirm(name.trim());
    setSaving(false);
    onClose();
  };

  // Sync name when item changes
  const latestName = item?.name ?? "";
  if (open && name !== latestName && !saving) {
    // Only reset if the dialog just opened
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Rename</DialogTitle></DialogHeader>
        <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            onFocus={e => {
              // Select text before extension
              const dotIdx = e.target.value.lastIndexOf(".");
              if (dotIdx > 0) e.target.setSelectionRange(0, dotIdx);
              else e.target.select();
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!name.trim() || name === item?.name || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── File detail panel ─────────────────────────────────────────────────────────

function FileDetailPanel({ item, authToken, onClose, onLink, onUnlink }: {
  item: DriveItem;
  authToken: string | null;
  onClose: () => void;
  onLink: () => void;
  onUnlink: (linkId: number) => Promise<void>;
}) {
  const { data: links = [], isLoading } = useQuery<FileLinkRecord[]>({
    queryKey: ["onedrive-file-links", item.id],
    queryFn: () => fetch(`${API}/files/${encodeURIComponent(item.id)}/links`, {
      headers: authHeaders(authToken),
    }).then(r => r.ok ? r.json() : []),
    enabled: !!authToken,
  });

  const isFolder = !!(item.folder || item.remoteItem?.folder);
  const mime = item.file?.mimeType ?? item.remoteItem?.file?.mimeType ?? "";
  const size = item.size ?? item.remoteItem?.size ?? 0;
  const modified = item.lastModifiedDateTime || item.remoteItem?.lastModifiedDateTime;
  const webUrl = item.webUrl || item.remoteItem?.webUrl;
  const childCount = item.folder?.childCount ?? item.remoteItem?.folder?.childCount;

  const entityIcon: Record<string, React.ReactNode> = {
    contact: <User className="h-3 w-3" />,
    artist: <Mic2 className="h-3 w-3" />,
    release: <Music className="h-3 w-3" />,
    deal: <Briefcase className="h-3 w-3" />,
    invoice: <Receipt className="h-3 w-3" />,
    thread: <MessageSquare className="h-3 w-3" />,
  };

  return (
    <div className="w-64 border-l bg-white flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <p className="text-xs font-semibold text-zinc-700 truncate">File Details</p>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="text-center">
          <span className="text-5xl">{mimeEmoji(item)}</span>
          <p className="text-sm font-medium mt-2 break-words leading-tight">{item.name}</p>
          {mime && <p className="text-xs text-zinc-400 mt-0.5">{mime.split("/").pop()?.toUpperCase()}</p>}
        </div>
        <div className="text-xs space-y-2 text-zinc-600">
          {!isFolder && <div className="flex justify-between"><span className="text-zinc-400">Size</span><span>{formatSize(size)}</span></div>}
          {isFolder && childCount != null && <div className="flex justify-between"><span className="text-zinc-400">Items</span><span>{childCount}</span></div>}
          {modified && <div className="flex justify-between"><span className="text-zinc-400">Modified</span><span>{new Date(modified).toLocaleDateString()}</span></div>}
        </div>
        {webUrl && (
          <a href={webUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="w-full gap-1 text-xs h-7">
              <ExternalLink className="h-3 w-3" /> Open in OneDrive
            </Button>
          </a>
        )}
        {!isFolder && (
          <Button variant="outline" size="sm" className="w-full gap-1 text-xs h-7" onClick={onLink}>
            <Link2 className="h-3 w-3" /> Link to CRM record
          </Button>
        )}
        {!isFolder && (
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Linked CRM records ({links.length})
            </p>
            {isLoading
              ? <p className="text-xs text-zinc-400">Loading…</p>
              : links.length === 0
              ? <p className="text-xs text-zinc-400 italic">Not linked to any records</p>
              : (
                <div className="space-y-1.5">
                  {links.map(lk => (
                    <div key={lk.id} className="flex items-center gap-1.5 text-xs bg-zinc-50 border rounded px-2 py-1.5">
                      <span className="text-zinc-500">{entityIcon[lk.entityType] ?? <File className="h-3 w-3" />}</span>
                      <span className="flex-1 truncate capitalize">{lk.entityType} #{lk.entityId}</span>
                      <button
                        onClick={() => void onUnlink(lk.id)}
                        className="text-zinc-300 hover:text-red-400 transition-colors shrink-0"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OneDrivePage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Navigation
  const [section, setSection]           = useState<Section>("my-drive");
  const [myDriveStack, setMyDriveStack] = useState<NavEntry[]>([]);
  const [sharedStack,  setSharedStack]  = useState<NavEntry[]>([]);
  const [siteStack,    setSiteStack]    = useState<NavEntry[]>([]);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);

  // Search
  const [search,      setSearch]      = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Dialogs
  const [newFolderOpen,   setNewFolderOpen]   = useState(false);
  const [renameItem,      setRenameItem]      = useState<DriveItem | null>(null);
  const [deleteItem,      setDeleteItem]      = useState<DriveItem | null>(null);
  const [linkItem,        setLinkItem]        = useState<DriveItem | null>(null);
  const [detailItem,      setDetailItem]      = useState<DriveItem | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);

  // ── Derived nav state ──────────────────────────────────────────────────────

  const currentMyDriveUrl    = myDriveStack.length ? myDriveStack[myDriveStack.length - 1]!.fetchUrl : `${API}/files`;
  const currentMyDriveDriveId = myDriveStack.length ? myDriveStack[myDriveStack.length - 1]!.driveId : null;
  const currentMyDriveFolderId = myDriveStack.length ? myDriveStack[myDriveStack.length - 1]!.folderId : null;

  const currentSharedUrl    = sharedStack.length ? sharedStack[sharedStack.length - 1]!.fetchUrl : `${API}/shared`;
  const currentSharedDriveId = sharedStack.length ? sharedStack[sharedStack.length - 1]!.driveId : null;

  const currentSiteUrl     = siteStack.length
    ? siteStack[siteStack.length - 1]!.fetchUrl
    : selectedSite ? `${API}/sites/${encodeURIComponent(selectedSite.id)}/files` : null;
  const currentSiteDriveId = siteStack.length ? siteStack[siteStack.length - 1]!.driveId : null;

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: status } = useQuery<{ connected: boolean }>({
    queryKey: ["onedrive-status"],
    queryFn: () => fetch(`${API}/status`, { headers: authHeaders(token) }).then(r => r.json()),
    enabled: !!token,
  });
  const connected = status?.connected === true;

  const { data: myDriveFiles = [], isFetching: myDriveFetching, refetch: refetchMyDrive, error: myDriveError } =
    useQuery<DriveItem[], Error>({
      queryKey: ["onedrive-files", currentMyDriveUrl],
      queryFn: async () => {
        const r = await checkNotConnected(await fetch(currentMyDriveUrl, { headers: authHeaders(token) }));
        return r.ok ? r.json() : [];
      },
      enabled: !!token && connected && section === "my-drive" && !searchQuery,
      retry: (_, e) => e.message !== "not_connected",
    });

  const { data: recentFiles = [], isFetching: recentFetching, refetch: refetchRecent } =
    useQuery<DriveItem[]>({
      queryKey: ["onedrive-recent"],
      queryFn: async () => {
        const r = await checkNotConnected(await fetch(`${API}/recent`, { headers: authHeaders(token) }));
        return r.ok ? r.json() : [];
      },
      enabled: !!token && connected && section === "recent" && !searchQuery,
    });

  const { data: sharedFiles = [], isFetching: sharedFetching, refetch: refetchShared, error: sharedError } =
    useQuery<DriveItem[], Error>({
      queryKey: ["onedrive-shared", currentSharedUrl],
      queryFn: async () => {
        const r = await checkNotConnected(await fetch(currentSharedUrl, { headers: authHeaders(token) }));
        return r.ok ? r.json() : [];
      },
      enabled: !!token && connected && section === "shared",
      retry: (_, e) => e.message !== "not_connected",
    });

  const { data: sites = [], isFetching: sitesFetching, refetch: refetchSites } =
    useQuery<SiteItem[]>({
      queryKey: ["onedrive-sites"],
      queryFn: async () => {
        const r = await checkNotConnected(await fetch(`${API}/sites`, { headers: authHeaders(token) }));
        return r.ok ? r.json() : [];
      },
      enabled: !!token && connected && section === "sites",
      retry: false,
    });

  const { data: siteFiles = [], isFetching: siteFilesFetching, refetch: refetchSiteFiles } =
    useQuery<DriveItem[]>({
      queryKey: ["onedrive-site-files", currentSiteUrl],
      queryFn: async () => {
        if (!currentSiteUrl) return [];
        const r = await checkNotConnected(await fetch(currentSiteUrl, { headers: authHeaders(token) }));
        return r.ok ? r.json() : [];
      },
      enabled: !!token && connected && section === "sites" && !!selectedSite && !!currentSiteUrl,
      retry: false,
    });

  const { data: siteDriveData } = useQuery<{ driveId: string | null }>({
    queryKey: ["onedrive-site-drive-id", selectedSite?.id],
    queryFn: async () => {
      const r = await fetch(`${API}/sites/${encodeURIComponent(selectedSite!.id)}/drive-id`, { headers: authHeaders(token) });
      return r.ok ? r.json() : { driveId: null };
    },
    enabled: !!token && connected && !!selectedSite,
  });
  const resolvedSiteDriveId = currentSiteDriveId ?? siteDriveData?.driveId ?? null;

  const { data: searchResults = [], isFetching: searching, error: searchError } =
    useQuery<DriveItem[], Error>({
      queryKey: ["onedrive-search", searchQuery],
      queryFn: async () => {
        const r = await checkNotConnected(
          await fetch(`${API}/search?q=${encodeURIComponent(searchQuery)}`, { headers: authHeaders(token) })
        );
        return r.ok ? r.json() : [];
      },
      enabled: !!token && connected && searchQuery.length >= 2,
      retry: (_, e) => e.message !== "not_connected",
    });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidateCurrent = useCallback(() => {
    if (section === "my-drive") void refetchMyDrive();
    else if (section === "recent") void refetchRecent();
    else if (section === "shared") void refetchShared();
    else if (section === "sites" && selectedSite) void refetchSiteFiles();
  }, [section, selectedSite, refetchMyDrive, refetchRecent, refetchShared, refetchSiteFiles]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    if (currentMyDriveFolderId) fd.append("folderId", currentMyDriveFolderId);
    await fetch(`${API}/upload`, {
      method: "POST",
      headers: authHeaders(token),
      body: fd,
    });
    setUploading(false);
    invalidateCurrent();
    e.target.value = "";
  };

  const handleCreateFolder = async (name: string) => {
    await fetch(`${API}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ name, parentFolderId: currentMyDriveFolderId }),
    });
    invalidateCurrent();
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    await fetch(`${API}/items/${encodeURIComponent(deleteItem.id)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (detailItem?.id === deleteItem.id) setDetailItem(null);
    setDeleteItem(null);
    invalidateCurrent();
  };

  const handleRename = async (newName: string) => {
    if (!renameItem) return;
    const r = await fetch(`${API}/items/${encodeURIComponent(renameItem.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ name: newName }),
    });
    if (r.ok) {
      const updated = await r.json() as DriveItem;
      if (detailItem?.id === renameItem.id) setDetailItem(updated);
    }
    setRenameItem(null);
    invalidateCurrent();
  };

  const handleDownload = async (item: DriveItem) => {
    const r = await fetch(`${API}/items/${encodeURIComponent(item.id)}/download-url`, {
      headers: authHeaders(token),
    });
    if (r.ok) {
      const { url } = await r.json() as { url: string };
      window.open(url, "_blank");
    }
  };

  const handleUnlink = async (linkId: number) => {
    await fetch(`${API}/file-links/${linkId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    if (detailItem) {
      void qc.invalidateQueries({ queryKey: ["onedrive-file-links", detailItem.id] });
    }
  };

  // ── Derived not-connected ─────────────────────────────────────────────────

  const notConnected =
    status?.connected === false ||
    myDriveError?.message === "not_connected" ||
    sharedError?.message  === "not_connected" ||
    searchError?.message  === "not_connected";

  // ── Navigation ────────────────────────────────────────────────────────────

  function buildFolderUrl(item: DriveItem, parentDriveId: string | null): { fetchUrl: string; driveId: string | null; folderId: string | null } {
    if (item.remoteItem) {
      const rid    = item.remoteItem.id;
      const rDrive = item.remoteItem.parentReference.driveId;
      return { fetchUrl: `${API}/remote-folder?driveId=${encodeURIComponent(rDrive)}&itemId=${encodeURIComponent(rid)}`, driveId: rDrive, folderId: null };
    }
    if (parentDriveId) {
      return { fetchUrl: `${API}/remote-folder?driveId=${encodeURIComponent(parentDriveId)}&itemId=${encodeURIComponent(item.id)}`, driveId: parentDriveId, folderId: null };
    }
    return { fetchUrl: `${API}/files/${encodeURIComponent(item.id)}`, driveId: null, folderId: item.id };
  }

  function openFolderInSection(item: DriveItem) {
    const isFolder = !!(item.folder || item.remoteItem?.folder);
    if (!isFolder) return;
    setDetailItem(null);
    if (section === "my-drive") {
      const { fetchUrl, driveId, folderId } = buildFolderUrl(item, currentMyDriveDriveId);
      setMyDriveStack(s => [...s, { name: item.name, fetchUrl, driveId, folderId }]);
    } else if (section === "shared") {
      const { fetchUrl, driveId, folderId } = buildFolderUrl(item, currentSharedDriveId);
      setSharedStack(s => [...s, { name: item.name, fetchUrl, driveId, folderId }]);
    } else if (section === "sites") {
      const { fetchUrl, driveId, folderId } = buildFolderUrl(item, resolvedSiteDriveId);
      setSiteStack(s => [...s, { name: item.name, fetchUrl, driveId, folderId }]);
    }
  }

  function switchSection(s: Section) {
    setSection(s);
    setSearchQuery("");
    setSearch("");
    setDetailItem(null);
    if (s !== "sites") setSelectedSite(null);
  }

  function selectSite(site: SiteItem) {
    setSelectedSite(site);
    setSiteStack([]);
    setDetailItem(null);
  }

  const isFetching =
    (section === "my-drive" && myDriveFetching) ||
    (section === "recent"   && recentFetching)  ||
    (section === "shared"   && sharedFetching)  ||
    (section === "sites"    && (sitesFetching || siteFilesFetching)) ||
    searching;

  const canUploadOrCreate = section === "my-drive" && connected && !notConnected;

  const itemsToShow: DriveItem[] =
    searchQuery.length >= 2
      ? searchResults
      : section === "my-drive"
      ? myDriveFiles
      : section === "recent"
      ? recentFiles
      : section === "shared"
      ? sharedFiles
      : siteFiles;

  // ── Breadcrumb ─────────────────────────────────────────────────────────────

  const breadcrumb = (() => {
    if (searchQuery) return null;
    const base = "flex items-center gap-1 px-4 py-2 text-xs text-muted-foreground border-b bg-muted/20 shrink-0 overflow-x-auto";
    const btn  = "hover:text-foreground transition-colors font-medium whitespace-nowrap flex items-center gap-1";
    if (section === "my-drive") return (
      <div className={base}>
        <button onClick={() => { setMyDriveStack([]); setDetailItem(null); }} className={btn}>
          <HardDrive className="h-3 w-3" /> My Drive
        </button>
        {myDriveStack.map((f, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button onClick={() => { setMyDriveStack(s => s.slice(0, i + 1)); setDetailItem(null); }} className="hover:text-foreground transition-colors whitespace-nowrap">{f.name}</button>
          </span>
        ))}
      </div>
    );
    if (section === "recent") return (
      <div className={base}>
        <span className={`${btn} cursor-default`}><Clock className="h-3 w-3" /> Recent Files</span>
      </div>
    );
    if (section === "shared") return (
      <div className={base}>
        <button onClick={() => { setSharedStack([]); setDetailItem(null); }} className={btn}>
          <Users className="h-3 w-3" /> Shared with me
        </button>
        {sharedStack.map((f, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button onClick={() => { setSharedStack(s => s.slice(0, i + 1)); setDetailItem(null); }} className="hover:text-foreground transition-colors whitespace-nowrap">{f.name}</button>
          </span>
        ))}
      </div>
    );
    if (section === "sites") return (
      <div className={base}>
        <button onClick={() => { setSelectedSite(null); setSiteStack([]); setDetailItem(null); }} className={btn}>
          <Globe className="h-3 w-3" /> SharePoint Sites
        </button>
        {selectedSite && (
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button onClick={() => { setSiteStack([]); setDetailItem(null); }} className="hover:text-foreground transition-colors whitespace-nowrap">{selectedSite.displayName || selectedSite.name}</button>
          </span>
        )}
        {siteStack.map((f, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button onClick={() => { setSiteStack(s => s.slice(0, i + 1)); setDetailItem(null); }} className="hover:text-foreground transition-colors whitespace-nowrap">{f.name}</button>
          </span>
        ))}
      </div>
    );
    return null;
  })();

  // ── File row ────────────────────────────────────────────────────────────────

  function FileRow({ item }: { item: DriveItem }) {
    const isFolder  = !!(item.folder || item.remoteItem?.folder);
    const size      = item.size ?? item.remoteItem?.size ?? 0;
    const modified  = item.lastModifiedDateTime || item.remoteItem?.lastModifiedDateTime;
    const webUrl    = item.webUrl || item.remoteItem?.webUrl;
    const childCount = item.folder?.childCount ?? item.remoteItem?.folder?.childCount;
    const isSelected = detailItem?.id === item.id;
    const isReadOnly = section === "shared" || section === "sites" || !!item.remoteItem;

    return (
      <div
        className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group cursor-pointer ${isSelected ? "bg-[#0078d4]/5 border-l-2 border-[#0078d4]" : ""}`}
        onClick={() => setDetailItem(isSelected ? null : item)}
      >
        <span className="text-base shrink-0 select-none">{mimeEmoji(item)}</span>
        <div className="flex-1 min-w-0">
          {isFolder ? (
            <button
              onClick={(e) => { e.stopPropagation(); openFolderInSection(item); }}
              className="text-sm font-medium hover:underline truncate block text-left w-full"
            >
              {item.name}
            </button>
          ) : (
            <p className="text-sm font-medium truncate">{item.name}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {isFolder
              ? childCount != null ? `${childCount} items` : "Folder"
              : formatSize(size)}
            {modified && <> · {new Date(modified).toLocaleDateString()}</>}
            {item.remoteItem && <span className="ml-1.5 text-[#0078d4]">Shared</span>}
          </p>
        </div>
        <div
          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={e => e.stopPropagation()}
        >
          {!isFolder && webUrl && (
            <a href={webUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Open in Office">
                <ExternalLink className="h-3 w-3" />
              </Button>
            </a>
          )}
          {!isFolder && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Download"
              onClick={() => void handleDownload(item)}>
              <Download className="h-3 w-3" />
            </Button>
          )}
          {!isReadOnly && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Rename"
              onClick={() => setRenameItem(item)}>
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {!isFolder && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-[#0078d4] hover:text-[#005a9e]" title="Link to CRM"
              onClick={() => setLinkItem(item)}>
              <Link2 className="h-3 w-3" />
            </Button>
          )}
          {!isReadOnly && (
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-zinc-400 hover:text-red-500" title="Delete"
              onClick={() => setDeleteItem(item)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b bg-white px-5 py-3.5 flex items-center justify-between shrink-0 gap-3 flex-wrap shadow-sm">
        <div className="flex items-center gap-3">
          <HardDrive className="h-5 w-5 text-[#0078d4]" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Microsoft OneDrive</h1>
            <p className="text-xs">
              {connected
                ? <span className="text-green-600 font-medium">Connected</span>
                : <span className="text-amber-600">Not connected</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canUploadOrCreate && (
            <>
              <input ref={fileInputRef} type="file" className="hidden" onChange={e => void handleUpload(e)} />
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                Upload
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                onClick={() => setNewFolderOpen(true)}>
                <FolderPlus className="h-3.5 w-3.5" /> New Folder
              </Button>
            </>
          )}
          <form onSubmit={(e) => { e.preventDefault(); setSearchQuery(search); }} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 w-48 text-xs"
                placeholder="Search all files…"
                value={search}
                onChange={e => { setSearch(e.target.value); if (!e.target.value) { setSearch(""); setSearchQuery(""); } }}
                disabled={notConnected}
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={notConnected || search.length < 2}>
              Search
            </Button>
          </form>
          <Button size="sm" variant="outline" className="h-8 w-8 p-0"
            onClick={() => {
              if (searchQuery) return;
              if (section === "my-drive") void refetchMyDrive();
              else if (section === "recent") void refetchRecent();
              else if (section === "shared") void refetchShared();
              else if (!selectedSite) void refetchSites();
              else void refetchSiteFiles();
            }}
            disabled={isFetching || notConnected}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-44 border-r bg-muted/20 shrink-0 flex flex-col py-2 gap-0.5 px-2">
          {([
            { id: "my-drive" as Section, icon: HardDrive, label: "My Drive" },
            { id: "recent"   as Section, icon: Clock,     label: "Recent" },
            { id: "shared"   as Section, icon: Users,     label: "Shared" },
            { id: "sites"    as Section, icon: Globe,     label: "SharePoint" },
          ] as const).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => switchSection(id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors w-full text-left ${
                section === id && !searchQuery
                  ? "bg-[#0078d4]/10 text-[#0078d4]"
                  : "text-zinc-600 hover:bg-muted hover:text-zinc-900"
              }`}
              disabled={notConnected}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </div>

        {/* Main pane */}
        <div className="flex flex-col flex-1 min-w-0">
          {searchQuery && !notConnected && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs border-b bg-muted/20 shrink-0">
              <span className="text-muted-foreground">Results for <strong>&ldquo;{searchQuery}&rdquo;</strong></span>
              <Badge variant="secondary">{searchResults.length}</Badge>
              <Button size="sm" variant="ghost" className="h-5 text-xs px-1 ml-1"
                onClick={() => { setSearch(""); setSearchQuery(""); }}>
                Clear
              </Button>
            </div>
          )}
          {breadcrumb}

          <div className="flex flex-1 min-h-0">
            {/* File list */}
            <div className="flex-1 overflow-auto">
              {notConnected && <NotConnectedBanner />}

              {/* Site list */}
              {!notConnected && section === "sites" && !selectedSite && !searchQuery && (
                sitesFetching
                  ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
                  : sites.length === 0
                  ? <EmptyState message="No SharePoint sites found" />
                  : (
                    <div className="divide-y">
                      {sites.map(site => {
                        const abbr = (site.displayName || site.name).slice(0, 2).toUpperCase();
                        return (
                          <button key={site.id} onClick={() => selectSite(site)}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 w-full text-left group transition-colors">
                            <div className="h-8 w-8 rounded-lg bg-[#0078d4]/10 flex items-center justify-center text-[#0078d4] font-bold text-xs shrink-0">{abbr}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{site.displayName || site.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{site.webUrl}</p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  )
              )}

              {/* File list (My Drive, Recent, Shared, Site files, or Search) */}
              {!notConnected && (section !== "sites" || selectedSite || searchQuery) && (
                <>
                  {isFetching && itemsToShow.length === 0 && (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
                    </div>
                  )}
                  {!isFetching && itemsToShow.length === 0 && (
                    <EmptyState message={
                      searchQuery ? "No files matched your search"
                      : section === "recent" ? "No recent files"
                      : section === "shared" ? "Nothing has been shared with you yet"
                      : "This folder is empty"
                    } />
                  )}
                  {itemsToShow.length > 0 && (
                    <div className="divide-y divide-zinc-100">
                      {[...itemsToShow]
                        .sort((a, b) => {
                          const af = !!(a.folder || a.remoteItem?.folder);
                          const bf = !!(b.folder || b.remoteItem?.folder);
                          return (bf ? 1 : 0) - (af ? 1 : 0);
                        })
                        .map(item => <FileRow key={item.id} item={item} />)}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* File detail panel */}
            {detailItem && (
              <FileDetailPanel
                item={detailItem}
                authToken={token}
                onClose={() => setDetailItem(null)}
                onLink={() => setLinkItem(detailItem)}
                onUnlink={handleUnlink}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────── */}

      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onConfirm={handleCreateFolder}
      />

      <RenameDialog
        open={!!renameItem}
        onClose={() => setRenameItem(null)}
        item={renameItem}
        onConfirm={handleRename}
      />

      <AlertDialog open={!!deleteItem} onOpenChange={o => { if (!o) setDeleteItem(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleteItem?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the {deleteItem?.folder ? "folder" : "file"} to the Recycle Bin in OneDrive.
              Any CRM links to this file will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LinkDialog
        open={!!linkItem}
        onClose={() => setLinkItem(null)}
        file={linkItem}
        authToken={token}
      />
    </div>
  );
}
