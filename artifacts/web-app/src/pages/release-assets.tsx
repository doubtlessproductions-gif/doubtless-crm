import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListReleaseAssets, useDeleteReleaseAsset, useListArtists,
  getListReleaseAssetsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Disc, Upload, Download, Trash2, Loader2, FileAudio, FileImage, FileVideo, FileText, File } from "lucide-react";
import type { ReleaseAsset } from "@workspace/api-client-react";

type AssetType = "audio_master" | "cover_art" | "music_video" | "social_clip" | "press_photo" | "lyrics_sheet" | "other";

const TYPE_CONFIG: Record<AssetType, { label: string; color: string; icon: React.ReactNode }> = {
  audio_master:  { label: "Audio Master",  color: "bg-violet-50 text-violet-700 border-violet-200", icon: <FileAudio className="h-4 w-4" /> },
  cover_art:     { label: "Cover Art",     color: "bg-pink-50 text-pink-700 border-pink-200",       icon: <FileImage className="h-4 w-4" /> },
  music_video:   { label: "Music Video",   color: "bg-blue-50 text-blue-700 border-blue-200",       icon: <FileVideo className="h-4 w-4" /> },
  social_clip:   { label: "Social Clip",   color: "bg-cyan-50 text-cyan-700 border-cyan-200",       icon: <FileVideo className="h-4 w-4" /> },
  press_photo:   { label: "Press Photo",   color: "bg-amber-50 text-amber-700 border-amber-200",    icon: <FileImage className="h-4 w-4" /> },
  lyrics_sheet:  { label: "Lyrics Sheet",  color: "bg-green-50 text-green-700 border-green-200",    icon: <FileText className="h-4 w-4" /> },
  other:         { label: "Other",         color: "bg-zinc-50 text-zinc-600 border-zinc-200",       icon: <File className="h-4 w-4" /> },
};

const ASSET_TYPES = Object.keys(TYPE_CONFIG) as AssetType[];

function fmtBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

interface Release { id: number; title: string; artistId: number | null; }

export default function ReleaseAssetsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { token } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [artistId,  setArtistId]  = useState<string>("");
  const [releaseId, setReleaseId] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteId,   setDeleteId]   = useState<number | null>(null);
  const [uploadForm, setUploadForm] = useState({ type: "audio_master" as AssetType, notes: "" });
  const [uploading,  setUploading]  = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReleaseAsset | null>(null);

  const { data: artists = [] } = useListArtists({});

  const { data: releases = [] } = useQuery<Release[]>({
    queryKey: ["releases", artistId],
    queryFn: () => fetch(`/api/releases${artistId ? `?artistId=${artistId}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()),
    enabled: !!token,
  });

  const filteredReleases = artistId ? releases.filter(r => String(r.artistId) === artistId) : releases;

  // Auto-select the first release when releases load and nothing is selected yet
  useEffect(() => {
    if (!releaseId && filteredReleases.length > 0) {
      setReleaseId(String(filteredReleases[0].id));
    }
  }, [filteredReleases, releaseId]);

  const releaseQuery = releaseId ? { releaseId: parseInt(releaseId) } : undefined;
  const { data: assets = [], isLoading: assetsLoading } = useListReleaseAssets(
    releaseQuery ?? { releaseId: 0 },
    { query: { queryKey: getListReleaseAssetsQueryKey(releaseQuery ?? { releaseId: 0 }), enabled: !!releaseId } },
  );

  const deleteMut = useDeleteReleaseAsset();

  const invalidate = () => {
    if (releaseId) qc.invalidateQueries({ queryKey: getListReleaseAssetsQueryKey({ releaseId: parseInt(releaseId) }) });
  };

  async function handleUpload(file: File) {
    if (!releaseId) return;
    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("releaseId", releaseId);
    formData.append("type", uploadForm.type);
    if (uploadForm.notes) formData.append("notes", uploadForm.notes);
    try {
      const res = await fetch("/api/release-assets", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Asset uploaded successfully" });
      setUploadOpen(false);
      setUploadForm({ type: "audio_master", notes: "" });
      invalidate();
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(asset: ReleaseAsset) {
    try {
      const res = await fetch(`/api/release-assets/${asset.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = asset.originalName;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  function handleDelete(asset: ReleaseAsset) {
    deleteMut.mutate({ id: asset.id }, {
      onSuccess: () => { toast({ title: "Asset deleted" }); setDeleteTarget(null); invalidate(); },
      onError:   () => toast({ title: "Delete failed", variant: "destructive" }),
    });
  }

  const selectedRelease = releases.find(r => String(r.id) === releaseId);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Disc className="h-6 w-6 text-violet-600" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Release Assets</h1>
            <p className="text-sm text-muted-foreground">Masters, cover art, videos, press photos and more</p>
          </div>
        </div>
        {releaseId && (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />Upload Asset
          </Button>
        )}
      </div>

      {/* Release selector */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Filter by Artist</Label>
              <Select value={artistId} onValueChange={v => { setArtistId(v); setReleaseId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="All artists" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All artists</SelectItem>
                  {artists.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Select Release *</Label>
              <Select value={releaseId} onValueChange={setReleaseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a release…" />
                </SelectTrigger>
                <SelectContent>
                  {filteredReleases.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Asset list */}
      {!releaseId ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Disc className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground">Select a release to view its assets</p>
        </div>
      ) : assetsLoading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Upload className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <p className="font-medium text-muted-foreground">No assets for <strong>{selectedRelease?.title}</strong></p>
          <p className="text-sm text-muted-foreground mt-1">Upload the first asset to get started</p>
          <Button className="mt-4" onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4 mr-2" />Upload Asset</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Group by type */}
          {ASSET_TYPES.filter(t => assets.some(a => a.type === t)).map(type => {
            const cfg = TYPE_CONFIG[type];
            const typeAssets = assets.filter(a => a.type === type);
            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-2 mt-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cfg.color}`}>
                    {cfg.icon}{cfg.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{typeAssets.length} file{typeAssets.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="space-y-1">
                  {typeAssets.map(asset => (
                    <Card key={asset.id} className="hover:shadow-sm transition-shadow">
                      <CardContent className="py-3 flex items-center gap-4">
                        <div className={`p-2 rounded-lg ${cfg.color}`}>{cfg.icon}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{asset.originalName}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtBytes(asset.sizeBytes)} · {new Date(asset.createdAt).toLocaleDateString()}
                            {asset.notes && ` · ${asset.notes}`}
                          </p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => handleDownload(asset)}>
                            <Download className="h-3.5 w-3.5 mr-1" />Download
                          </Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(asset)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={v => { if (!uploading) setUploadOpen(v); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Asset — {selectedRelease?.title}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Asset Type *</Label>
              <Select value={uploadForm.type} onValueChange={v => setUploadForm(f => ({ ...f, type: v as AssetType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_CONFIG[t].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input placeholder="e.g. Mastered by XYZ, 24-bit/48kHz…" value={uploadForm.notes}
                onChange={e => setUploadForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div
              className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              {uploading
                ? <><Loader2 className="h-7 w-7 mx-auto mb-2 animate-spin text-violet-600" /><p className="text-sm">Uploading…</p></>
                : <><Upload className="h-7 w-7 mx-auto mb-2 text-muted-foreground" /><p className="text-sm font-medium">Click to select file</p><p className="text-xs text-muted-foreground mt-1">Max 500 MB</p></>
              }
            </div>
            <input ref={fileInputRef} type="file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploading}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete asset?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.originalName}</strong> will be permanently removed from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
