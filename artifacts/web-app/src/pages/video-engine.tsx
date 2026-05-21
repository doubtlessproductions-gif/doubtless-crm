import { useState, useRef, useEffect } from "react";
import {
  useListVideoProjects, useCreateVideoProject, useDeleteVideoProject,
  useUploadVideoFile, useCreateVideoInvoice, useUnlockVideoProject,
  useGetMe, getListVideoProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  Film, Plus, Upload, Lock, Unlock, Receipt, ExternalLink,
  Download, Play, Clock, CheckCircle2, XCircle, Loader2, Trash2, Image,
} from "lucide-react";
import type { VideoProject } from "@workspace/api-client-react";

type Status = "uploading" | "processing" | "watermarked" | "unlocked" | "failed";

const STATUS_CONFIG: Record<Status, { label: string; color: string; icon: React.ReactNode }> = {
  uploading:   { label: "Uploading",   color: "bg-zinc-100 text-zinc-700 border-zinc-200",      icon: <Upload className="h-3 w-3" /> },
  processing:  { label: "Processing",  color: "bg-yellow-50 text-yellow-700 border-yellow-200", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  watermarked: { label: "Watermarked", color: "bg-orange-50 text-orange-700 border-orange-200", icon: <Lock className="h-3 w-3" /> },
  unlocked:    { label: "Unlocked",    color: "bg-green-50 text-green-700 border-green-200",    icon: <Unlock className="h-3 w-3" /> },
  failed:      { label: "Failed",      color: "bg-red-50 text-red-700 border-red-200",          icon: <XCircle className="h-3 w-3" /> },
};

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.uploading;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function fmtBytes(b: number | null | undefined) {
  if (!b) return "—";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(s: number | null | undefined) {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function useAuthBlobUrl(path: string | null | undefined, token: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path || !token) { setUrl(null); return; }
    let revoked = false;
    setLoading(true);
    fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.blob() : null)
      .then(blob => {
        if (revoked || !blob) return;
        setUrl(URL.createObjectURL(blob));
      })
      .catch(() => {})
      .finally(() => { if (!revoked) setLoading(false); });
    return () => {
      revoked = true;
      setUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [path, token]);

  return { url, loading };
}

function VideoThumbnail({ id, hasThumbnail, token }: { id: number; hasThumbnail: boolean; token: string | null }) {
  const { url, loading } = useAuthBlobUrl(
    hasThumbnail ? `/api/video-projects/${id}/thumbnail` : null,
    token,
  );
  if (loading) return <div className="w-full h-28 bg-zinc-100 animate-pulse rounded-t-lg flex items-center justify-center"><Loader2 className="h-5 w-5 text-zinc-400 animate-spin" /></div>;
  if (url) return <img src={url} alt="thumbnail" className="w-full h-28 object-cover rounded-t-lg" />;
  return <div className="w-full h-28 bg-gradient-to-br from-violet-50 to-zinc-100 rounded-t-lg flex items-center justify-center"><Image className="h-8 w-8 text-zinc-300" /></div>;
}

function PreviewPlayer({ id, token, title }: { id: number; token: string | null; title: string }) {
  const { url, loading } = useAuthBlobUrl(`/api/video-projects/${id}/preview`, token);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">30-second watermarked preview of <strong>{title}</strong></p>
      {loading && <div className="flex items-center justify-center h-40 bg-zinc-50 rounded-lg"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>}
      {url && (
        <video
          src={url}
          controls
          className="w-full rounded-lg max-h-64 bg-black"
          autoPlay
        />
      )}
      {!loading && !url && <div className="flex items-center justify-center h-32 text-sm text-muted-foreground bg-zinc-50 rounded-lg">Preview unavailable</div>}
    </div>
  );
}

export default function VideoEngine() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token } = useAuth();
  const { data: me } = useGetMe();
  const isOwner   = me?.role === "owner";
  const isAdmin   = me?.role === "admin";
  const canManage = isOwner || isAdmin || me?.role === "manager";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  const [createOpen,  setCreateOpen]  = useState(false);
  const [uploadOpen,  setUploadOpen]  = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deleteId,    setDeleteId]    = useState<number | null>(null);
  const [selected,    setSelected]    = useState<VideoProject | null>(null);
  const [uploading,   setUploading]   = useState(false);

  const [createForm,  setCreateForm]  = useState({ title: "", description: "", contactId: "" });
  const [invoiceForm, setInvoiceForm] = useState({ amountCents: "", description: "", customerEmail: "" });

  const { data: contacts } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["contacts-for-video"],
    queryFn: () => fetch("/api/contacts", { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(r => r.json()),
    enabled: !!token && canManage,
  });

  const { data: projects = [] } = useListVideoProjects({}, {
    query: { queryKey: getListVideoProjectsQueryKey({}), refetchInterval: 4000 },
  });

  const createMut  = useCreateVideoProject();
  const uploadMut  = useUploadVideoFile();
  const invoiceMut = useCreateVideoInvoice();
  const unlockMut  = useUnlockVideoProject();
  const deleteMut  = useDeleteVideoProject();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListVideoProjectsQueryKey({}) });

  function handleCreate() {
    if (!createForm.title.trim()) return;
    createMut.mutate({
      data: {
        title: createForm.title,
        description: createForm.description || undefined,
        contactId: createForm.contactId ? parseInt(createForm.contactId) : undefined,
      },
    }, {
      onSuccess: (row) => {
        toast({ title: "Video project created" });
        setCreateOpen(false);
        setCreateForm({ title: "", description: "", contactId: "" });
        setSelected(row);
        invalidate();
      },
      onError: () => toast({ title: "Failed to create project", variant: "destructive" }),
    });
  }

  function handleUpload(file: File) {
    if (!selected) return;
    setUploading(true);
    uploadMut.mutate({ id: selected.id, data: { video: file } }, {
      onSuccess: (updated) => {
        toast({ title: "Uploaded — FFmpeg watermarking in progress…" });
        setUploadOpen(false);
        setSelected(updated);
        invalidate();
      },
      onError: () => toast({ title: "Upload failed", variant: "destructive" }),
      onSettled: () => setUploading(false),
    });
  }

  function handleInvoice() {
    if (!selected) return;
    const cents = parseInt(invoiceForm.amountCents);
    if (!cents || cents <= 0) return;
    invoiceMut.mutate({
      id: selected.id,
      data: { amountCents: cents, description: invoiceForm.description || undefined, customerEmail: invoiceForm.customerEmail || undefined },
    }, {
      onSuccess: (updated) => {
        toast({ title: "Stripe invoice created" });
        setInvoiceOpen(false);
        setSelected(updated);
        invalidate();
      },
      onError: () => toast({ title: "Failed to create invoice", variant: "destructive" }),
    });
  }

  function handleUnlock(id: number) {
    unlockMut.mutate({ id }, {
      onSuccess: (updated) => {
        toast({ title: "Video unlocked" });
        if (selected?.id === id) setSelected(updated);
        invalidate();
      },
      onError: () => toast({ title: "Unlock failed", variant: "destructive" }),
    });
  }

  function handleDelete(id: number) {
    deleteMut.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Deleted" });
        setDeleteId(null);
        if (selected?.id === id) setSelected(null);
        invalidate();
      },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  async function handleDownload(p: VideoProject) {
    try {
      const res = await fetch(`/api/video-projects/${p.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { toast({ title: "Download unavailable — video may be locked", variant: "destructive" }); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${p.title}.mp4`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  const pending = projects.filter(p => p.status === "processing" || p.status === "uploading");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Film className="h-6 w-6 text-violet-600" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Video Engine</h1>
            <p className="text-sm text-muted-foreground">Upload → Watermark → Invoice → Unlock</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />New Project
          </Button>
        )}
      </div>

      {/* Processing banner */}
      {pending.length > 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-yellow-600 shrink-0" />
          <span className="text-sm font-medium text-yellow-800">
            {pending.length} video{pending.length > 1 ? "s" : ""} being processed by FFmpeg — auto-refreshing…
          </span>
        </div>
      )}

      {/* Grid */}
      {projects.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <Film className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground mb-4">No video projects yet.</p>
            {canManage && <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-2" />New Project</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => {
            const live = selected?.id === p.id ? selected : p;
            return (
              <Card
                key={p.id}
                className={`cursor-pointer transition-shadow hover:shadow-md overflow-hidden ${selected?.id === p.id ? "ring-2 ring-violet-500" : ""}`}
                onClick={() => setSelected(live)}
              >
                {/* Thumbnail */}
                <VideoThumbnail id={p.id} hasThumbnail={!!p.thumbnailKey} token={token} />

                <CardHeader className="pb-2 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm line-clamp-1">{p.title}</CardTitle>
                    <StatusBadge status={p.status as Status} />
                  </div>
                  {p.description && <CardDescription className="line-clamp-1 text-xs">{p.description}</CardDescription>}
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    {p.durationSeconds && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDuration(p.durationSeconds)}</span>}
                    {p.sizeBytes && <span>{fmtBytes(p.sizeBytes)}</span>}
                  </div>

                  {p.status === "watermarked" && !p.stripeInvoiceUrl && (
                    <p className="text-xs text-orange-600 font-medium flex items-center gap-1"><Lock className="h-3 w-3" />Invoice required to unlock</p>
                  )}
                  {p.stripeInvoiceUrl && p.status !== "unlocked" && (
                    <a href={p.stripeInvoiceUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <ExternalLink className="h-3 w-3" />View Invoice
                    </a>
                  )}
                  {p.status === "unlocked" && (
                    <p className="text-xs text-green-600 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Download enabled</p>
                  )}

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {/* Upload (before processing) */}
                    {canManage && !p.originalKey && p.status === "uploading" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={e => { e.stopPropagation(); setSelected(p); setUploadOpen(true); }}>
                        <Upload className="h-3 w-3 mr-1" />Upload File
                      </Button>
                    )}
                    {/* Preview (after watermarking) */}
                    {p.previewKey && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={e => { e.stopPropagation(); setSelected(p); setPreviewOpen(true); }}>
                        <Play className="h-3 w-3 mr-1" />Preview
                      </Button>
                    )}
                    {/* Invoice */}
                    {canManage && p.status === "watermarked" && !p.stripeInvoiceUrl && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={e => { e.stopPropagation(); setSelected(p); setInvoiceOpen(true); }}>
                        <Receipt className="h-3 w-3 mr-1" />Invoice
                      </Button>
                    )}
                    {/* Admin/owner manual unlock */}
                    {(isOwner || isAdmin) && !p.downloadEnabled && p.status !== "uploading" && p.status !== "processing" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={e => { e.stopPropagation(); handleUnlock(p.id); }}>
                        <Unlock className="h-3 w-3 mr-1" />Unlock
                      </Button>
                    )}
                    {/* Download */}
                    {p.downloadEnabled && (
                      <Button size="sm" className="h-7 text-xs px-2 bg-green-600 hover:bg-green-700 text-white" onClick={e => { e.stopPropagation(); handleDownload(p); }}>
                        <Download className="h-3 w-3 mr-1" />Download
                      </Button>
                    )}
                    {/* Delete */}
                    {canManage && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive ml-auto" onClick={e => { e.stopPropagation(); setDeleteId(p.id); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Video Project</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input value={createForm.title} onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))} placeholder="Music video title…" autoFocus />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))} rows={3} placeholder="Optional description…" />
            </div>
            <div className="space-y-1">
              <Label>Assign to client (optional)</Label>
              <Select value={createForm.contactId || "none"} onValueChange={v => setCreateForm(f => ({ ...f, contactId: v === "none" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a contact…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client assigned</SelectItem>
                  {contacts?.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Assigned clients will see this in their portal.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMut.isPending || !createForm.title.trim()}>
              {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Create & Upload Next
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={v => { if (!uploading) setUploadOpen(v); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Video — {selected?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              After upload, FFmpeg automatically watermarks the video and generates a 30-second preview clip and thumbnail.
              Accepted: MP4, MOV, AVI, WebM (max 2 GB).
            </p>
            <div
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => !uploading && uploadFileInputRef.current?.click()}
            >
              {uploading
                ? <><Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-violet-600" /><p className="text-sm font-medium text-violet-700">Uploading…</p></>
                : <><Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" /><p className="text-sm font-medium">Click to select video file</p><p className="text-xs text-muted-foreground mt-1">MP4, MOV, AVI, WebM</p></>
              }
            </div>
            <input ref={uploadFileInputRef} type="file" accept="video/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Preview — {selected?.title}</DialogTitle></DialogHeader>
          {selected && previewOpen && <PreviewPlayer id={selected.id} token={token} title={selected.title} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            {selected?.downloadEnabled && (
              <Button onClick={() => { setPreviewOpen(false); if (selected) handleDownload(selected); }}>
                <Download className="h-4 w-4 mr-2" />Download Full Video
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice dialog */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Invoice — {selected?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">A Stripe invoice is created. The video stays locked until payment is confirmed via webhook.</p>
            <div className="space-y-1">
              <Label>Amount (USD cents) *</Label>
              <Input type="number" min="100" placeholder="e.g. 50000 = $500.00" value={invoiceForm.amountCents}
                onChange={e => setInvoiceForm(f => ({ ...f, amountCents: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input placeholder="Video delivery fee…" value={invoiceForm.description}
                onChange={e => setInvoiceForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Customer Email (optional)</Label>
              <Input type="email" placeholder="client@example.com" value={invoiceForm.customerEmail}
                onChange={e => setInvoiceForm(f => ({ ...f, customerEmail: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
            <Button onClick={handleInvoice} disabled={invoiceMut.isPending || !invoiceForm.amountCents}>
              {invoiceMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Receipt className="h-4 w-4 mr-2" />}
              Create Stripe Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete video project?</AlertDialogTitle>
            <AlertDialogDescription>This permanently removes the project and all associated files.</AlertDialogDescription>
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
