import { useState } from "react";
import {
  useListProjects, useCreateProject, useUpdateProject, useDeleteProject,
  useListContacts,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Briefcase, Plus, Pencil, Trash2, Loader2, CalendarDays, DollarSign, GitBranch, Upload, Check, X, Clock, ChevronDown, Layers } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Project } from "@workspace/api-client-react";

interface ProjectTemplate {
  id: number;
  name: string;
  description: string | null;
  defaultStatus: string;
  mediaVersionCategories: string[];
  estimatedHours: number | null;
}

type ProjectStatus = "planning" | "in_progress" | "mixing" | "mastering" | "delivered" | "archived";

const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string }> = {
  planning:   { label: "Planning",   color: "bg-zinc-100 text-zinc-700 border-zinc-200" },
  in_progress:{ label: "In Progress",color: "bg-blue-50 text-blue-700 border-blue-200" },
  mixing:     { label: "Mixing",     color: "bg-purple-50 text-purple-700 border-purple-200" },
  mastering:  { label: "Mastering",  color: "bg-violet-50 text-violet-700 border-violet-200" },
  delivered:  { label: "Delivered",  color: "bg-green-50 text-green-700 border-green-200" },
  archived:   { label: "Archived",   color: "bg-gray-50 text-gray-500 border-gray-200" },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as ProjectStatus[];

const EMPTY = { title: "", description: "", status: "planning" as ProjectStatus, deadline: "", budgetCents: "", contactId: "", templateId: 0 };

function fmt$(cents: number | null | undefined) {
  if (!cents) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

// ── Version Status Badge ───────────────────────────────────────────────────────
const VER_STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending:    { label: "Pending",    cls: "bg-amber-50 text-amber-700 border-amber-200",   icon: <Clock className="h-3 w-3" /> },
  approved:   { label: "Approved",   cls: "bg-green-50 text-green-700 border-green-200",   icon: <Check className="h-3 w-3" /> },
  rejected:   { label: "Rejected",   cls: "bg-red-50 text-red-700 border-red-200",         icon: <X className="h-3 w-3" /> },
  superseded: { label: "Superseded", cls: "bg-zinc-100 text-zinc-500 border-zinc-200",     icon: <ChevronDown className="h-3 w-3" /> },
};

interface MediaVersion {
  id: number;
  entityType: string;
  entityId: number;
  label: string;
  versionNumber: number;
  category: string;
  storageKey: string | null;
  fileName: string | null;
  notes: string | null;
  status: string;
  uploadedBy: number;
  uploaderName?: string;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
}

// ── Media Versions Sheet ───────────────────────────────────────────────────────
function MediaVersionsSheet({ project, open, onClose }: { project: Project | null; open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const [showUpload, setShowUpload] = useState(false);
  const [label, setLabel]           = useState("");
  const [category, setCategory]     = useState("mix");
  const [fileUrl, setFileUrl]       = useState("");
  const [notes, setNotes]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [actionId, setActionId]     = useState<number | null>(null);

  const { data: versions = [], refetch, isLoading } = useQuery<MediaVersion[]>({
    queryKey: ["media-versions", project?.id],
    queryFn: () =>
      fetch(`/api/media-versions?entityType=studio_project&entityId=${project!.id}`, { headers: authH(token) })
        .then(r => r.ok ? r.json() : []),
    enabled: !!project && open,
  });

  async function handleUpload() {
    if (!label.trim() || !project) return;
    setSaving(true);
    try {
      const res = await fetch("/api/media-versions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ entityType: "studio_project", entityId: project.id, label, category, storageKey: fileUrl || null, notes: notes || null }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: "Version uploaded" });
      setLabel(""); setCategory("mix"); setFileUrl(""); setNotes(""); setShowUpload(false);
      void refetch();
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: number, status: string) {
    setActionId(id);
    try {
      const res = await fetch(`/api/media-versions/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: `Version ${status}` });
      void refetch();
      qc.invalidateQueries({ queryKey: ["media-versions", project?.id] });
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    } finally {
      setActionId(null);
    }
  }

  async function addNote(id: number, n: string) {
    if (!n.trim()) return;
    try {
      await fetch(`/api/media-versions/${id}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ notes: n }),
      });
      void refetch();
    } catch { /* silent */ }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-violet-600" />
            Versions — {project?.title}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Upload toggle */}
          <Button size="sm" variant={showUpload ? "secondary" : "default"} onClick={() => setShowUpload(v => !v)}>
            <Upload className="h-4 w-4 mr-2" />Upload New Version
          </Button>

          {showUpload && (
            <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50 p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Label *</Label>
                  <Input className="h-8 text-sm" placeholder="v1 Mix, Master Rev 2…" value={label} onChange={e => setLabel(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mix">Mix</SelectItem>
                      <SelectItem value="master">Master</SelectItem>
                      <SelectItem value="video">Video</SelectItem>
                      <SelectItem value="artwork">Artwork</SelectItem>
                      <SelectItem value="stems">Stems</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">File URL (optional)</Label>
                <Input className="h-8 text-sm" placeholder="https://…" value={fileUrl} onChange={e => setFileUrl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea className="text-sm" rows={2} placeholder="Revision notes…" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => setShowUpload(false)}>Cancel</Button>
                <Button size="sm" onClick={handleUpload} disabled={saving || !label.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Upload
                </Button>
              </div>
            </div>
          )}

          {/* Version list */}
          {isLoading && (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          )}

          {!isLoading && versions.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <GitBranch className="h-10 w-10 mx-auto mb-3 text-zinc-200" />
              No versions uploaded yet.
            </div>
          )}

          {versions.map(v => {
            const s = VER_STATUS[v.status] ?? VER_STATUS.pending;
            return (
              <div key={v.id} className="rounded-xl border border-zinc-200 bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{v.label}</p>
                    <p className="text-xs text-zinc-400">v{v.versionNumber} · {v.category} · {new Date(v.createdAt).toLocaleDateString()}</p>
                  </div>
                  <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${s.cls}`}>
                    {s.icon}{s.label}
                  </span>
                </div>

                {v.storageKey && (
                  <a href={v.storageKey} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline truncate block">
                    {v.fileName ?? v.storageKey}
                  </a>
                )}

                {v.notes && <p className="text-xs text-zinc-500 bg-zinc-50 rounded p-2">{v.notes}</p>}

                {v.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                      disabled={actionId === v.id}
                      onClick={() => setStatus(v.id, "approved")}>
                      <Check className="h-3 w-3" />Approve
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                      disabled={actionId === v.id}
                      onClick={() => setStatus(v.id, "rejected")}>
                      <X className="h-3 w-3" />Reject
                    </Button>
                    <NotePopover versionId={v.id} currentNotes={v.notes} onSave={(n) => addNote(v.id, n)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Simple inline note adder
function NotePopover({ versionId, currentNotes, onSave }: { versionId: number; currentNotes: string | null; onSave: (n: string) => void }) {
  const [open, setOpen] = useState(false);
  const [val, setVal]   = useState(currentNotes ?? "");
  void versionId;
  if (!open) return (
    <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-500" onClick={() => setOpen(true)}>
      + Note
    </Button>
  );
  return (
    <div className="flex gap-1 flex-1">
      <Input className="h-7 text-xs" placeholder="Add note…" value={val} onChange={e => setVal(e.target.value)} />
      <Button size="sm" className="h-7 text-xs px-2" onClick={() => { onSave(val); setOpen(false); }}>Save</Button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function StudioProjects() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: contacts = [] } = useListContacts();

  const { token } = useAuth();
  const authH: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const [open,            setOpen]            = useState(false);
  const [editing,         setEditing]         = useState<Project | null>(null);
  const [deleteId,        setDeleteId]        = useState<number | null>(null);
  const [filter,          setFilter]          = useState<ProjectStatus | "all">("all");
  const [form,            setForm]            = useState(EMPTY);
  const [versionsFor,     setVersionsFor]     = useState<Project | null>(null);
  const [templatesOpen,   setTemplatesOpen]   = useState(false);
  const [selectedTmpl,    setSelectedTmpl]    = useState<ProjectTemplate | null>(null);

  const { data: projectTemplates = [], refetch: refetchProjTemplates } = useQuery<ProjectTemplate[]>({
    queryKey: ["project-templates"],
    queryFn: async () => {
      const r = await fetch("/api/project-templates", { headers: authH });
      return r.ok ? (r.json() as Promise<ProjectTemplate[]>) : [];
    },
  });

  const { data: projects = [] } = useListProjects(
    filter !== "all" ? { status: filter } : {},
    { query: { queryKey: getListProjectsQueryKey(filter !== "all" ? { status: filter } : {}) } },
  );

  const createMut = useCreateProject();
  const updateMut = useUpdateProject();
  const deleteMut = useDeleteProject();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey({}) });
    ALL_STATUSES.forEach(s => qc.invalidateQueries({ queryKey: getListProjectsQueryKey({ status: s }) }));
  };

  function applyProjTemplate(t: ProjectTemplate) {
    setSelectedTmpl(t);
    setForm(f => ({
      ...f,
      title: f.title || t.name,
      status: (t.defaultStatus as ProjectStatus) ?? f.status,
      description: t.description ?? f.description,
      templateId: t.id,
    }));
  }

  function openCreate() { setEditing(null); setForm(EMPTY); setSelectedTmpl(null); setOpen(true); }
  function openEdit(p: Project) {
    setEditing(p);
    setSelectedTmpl(null);
    setForm({
      title:       p.title,
      description: p.description ?? "",
      status:      p.status as ProjectStatus,
      deadline:    p.deadline ?? "",
      budgetCents: p.budgetCents ? String(p.budgetCents) : "",
      contactId:   p.contactId ? String(p.contactId) : "",
      templateId:  0,
    });
    setOpen(true);
  }

  function handleSave() {
    if (!form.title.trim()) return;
    const baseData = {
      title:       form.title,
      description: form.description || undefined,
      status:      form.status,
      deadline:    form.deadline || undefined,
      budgetCents: form.budgetCents ? parseInt(form.budgetCents) : undefined,
      contactId:   form.contactId ? parseInt(form.contactId) : null,
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, data: baseData }, {
        onSuccess: () => { toast({ title: "Project updated" }); setOpen(false); invalidate(); },
        onError:   () => toast({ title: "Failed to update", variant: "destructive" }),
      });
    } else {
      const body: Record<string, unknown> = { ...baseData };
      if (form.templateId) body.templateId = form.templateId;
      fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify(body),
      }).then(async r => {
        if (r.ok) {
          toast({ title: "Project created" });
          setOpen(false); setForm(EMPTY); setSelectedTmpl(null); invalidate();
        } else {
          toast({ title: "Failed to create", variant: "destructive" });
        }
      }).catch(() => toast({ title: "Failed to create", variant: "destructive" }));
    }
  }

  function handleDelete(id: number) {
    deleteMut.mutate({ id }, {
      onSuccess: () => { toast({ title: "Deleted" }); setDeleteId(null); invalidate(); },
      onError:   () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  }

  const isPending = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Briefcase className="h-6 w-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Studio Projects</h1>
            <p className="text-sm text-muted-foreground">Production tracking from planning to delivery</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)} className="gap-1.5">
            <Layers className="h-4 w-4" /> Templates
          </Button>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />New Project</Button>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {(["all", ...ALL_STATUSES] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === s
                ? "bg-primary text-primary-foreground border-primary"
                : s === "all"
                  ? "bg-white border-zinc-200 hover:border-zinc-400"
                  : `${STATUS_CONFIG[s].color} opacity-80 hover:opacity-100`
            }`}
          >
            {s === "all" ? "All" : STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>

      {/* Cards */}
      {projects.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground">No projects{filter !== "all" ? ` with status "${STATUS_CONFIG[filter as ProjectStatus].label}"` : ""}.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map(p => {
            const cfg = STATUS_CONFIG[p.status as ProjectStatus] ?? STATUS_CONFIG.planning;
            return (
              <Card key={p.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{p.title}</CardTitle>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  {p.description && <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>}
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {p.deadline && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />{p.deadline}</span>}
                    {p.budgetCents && <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" />{fmt$(p.budgetCents)}</span>}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                      <Pencil className="h-3 w-3 mr-1" />Edit
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1 text-violet-600 border-violet-200 hover:bg-violet-50"
                      onClick={() => setVersionsFor(p)}>
                      <GitBranch className="h-3 w-3" />Versions
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ml-auto"
                      onClick={() => setDeleteId(p.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Edit Project" : "New Project"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editing && projectTemplates.length > 0 && (
              <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl">
                <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" /> Use a template
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {projectTemplates.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyProjTemplate(t)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        selectedTmpl?.id === t.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-blue-700 border-blue-200 hover:border-blue-400"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {selectedTmpl && <p className="text-xs text-blue-500 mt-2">Template applied — adjust as needed.</p>}
              </div>
            )}
            <div className="space-y-1">
              <Label>Title *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Project name…" />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as ProjectStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_STATUSES.map(s => (
                      <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Deadline</Label>
                <Input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Budget (cents, e.g. 100000 = $1,000)</Label>
              <Input type="number" value={form.budgetCents} onChange={e => setForm(f => ({ ...f, budgetCents: e.target.value }))} placeholder="100000" />
            </div>
            <div className="space-y-1">
              <Label>Assign to client (optional)</Label>
              <Select value={form.contactId || "none"} onValueChange={v => setForm(f => ({ ...f, contactId: v === "none" ? "" : v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="No client assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No client assigned</SelectItem>
                  {contacts.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}{c.company ? ` — ${c.company}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Assigned clients will see this in their portal.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending || !form.title.trim()}>
              {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && handleDelete(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Media Versions Sheet */}
      <MediaVersionsSheet
        project={versionsFor}
        open={versionsFor !== null}
        onClose={() => setVersionsFor(null)}
      />

      {/* Project Templates Manager */}
      {templatesOpen && (
        <ProjectTemplatesModal
          templates={projectTemplates}
          token={token}
          onClose={() => setTemplatesOpen(false)}
          onRefresh={() => void refetchProjTemplates()}
        />
      )}
    </div>
  );
}

// ── Project Templates Modal ────────────────────────────────────────────────────

const ALL_PROJ_STATUSES = ["planning", "in_progress", "mixing", "mastering", "delivered", "archived"] as const;
const PROJ_STATUS_LABELS: Record<string, string> = {
  planning: "Planning", in_progress: "In Progress", mixing: "Mixing",
  mastering: "Mastering", delivered: "Delivered", archived: "Archived",
};

interface ProjectTemplatesModalProps {
  templates: ProjectTemplate[];
  token: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

function ProjectTemplatesModal({ templates, token, onClose, onRefresh }: ProjectTemplatesModalProps) {
  const { toast } = useToast();
  const authH: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const EMPTY_FORM = { name: "", description: "", defaultStatus: "planning", mediaVersionCategories: "", estimatedHours: "" };
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<ProjectTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(t: ProjectTemplate) {
    setEditing(t);
    setForm({
      name:                   t.name,
      description:            t.description ?? "",
      defaultStatus:          t.defaultStatus,
      mediaVersionCategories: t.mediaVersionCategories.join(", "),
      estimatedHours:         t.estimatedHours != null ? String(t.estimatedHours) : "",
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name:                   form.name.trim(),
        description:            form.description.trim() || null,
        defaultStatus:          form.defaultStatus,
        mediaVersionCategories: form.mediaVersionCategories.split(",").map(s => s.trim()).filter(Boolean),
        estimatedHours:         form.estimatedHours ? Number(form.estimatedHours) : null,
      };
      const url    = editing ? `/api/project-templates/${editing.id}` : "/api/project-templates";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...authH }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Failed");
      toast({ title: editing ? "Template updated" : "Template created" });
      setShowForm(false); setEditing(null); setForm(EMPTY_FORM);
      onRefresh();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const r = await fetch(`/api/project-templates/${id}`, { method: "DELETE", headers: authH });
      if (!r.ok) throw new Error("Failed");
      toast({ title: "Template deleted" });
      onRefresh();
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-zinc-900/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-6 border-b border-zinc-100 shrink-0">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Project Templates</h2>
            <span className="text-xs text-zinc-400 ml-1">{templates.length} template{templates.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex gap-2">
            {!showForm && (
              <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />New Template</Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {showForm && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-blue-800">{editing ? "Edit Template" : "New Template"}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-zinc-700">Template Name *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Album Production" className="h-9" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-zinc-700">Description</label>
                  <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What's included…" className="h-9" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700">Default Status</label>
                  <Select value={form.defaultStatus} onValueChange={v => setForm(f => ({ ...f, defaultStatus: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ALL_PROJ_STATUSES.map(s => <SelectItem key={s} value={s}>{PROJ_STATUS_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700">Estimated Hours</label>
                  <Input type="number" value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))} placeholder="40" className="h-9" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-zinc-700">Media Version Categories (comma-separated)</label>
                  <Input value={form.mediaVersionCategories} onChange={e => setForm(f => ({ ...f, mediaVersionCategories: e.target.value }))} placeholder="mix, master, stems, instrumental" className="h-9" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY_FORM); }}>Cancel</Button>
                <Button size="sm" onClick={handleSave} disabled={saving || !form.name.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  {editing ? "Save changes" : "Create template"}
                </Button>
              </div>
            </div>
          )}

          {templates.length === 0 && !showForm && (
            <div className="text-center py-12">
              <Layers className="h-10 w-10 mx-auto mb-3 text-zinc-200" />
              <p className="text-zinc-500 text-sm">No project templates yet.</p>
              <p className="text-zinc-400 text-xs mt-1">Create one to pre-fill new project dialogs.</p>
            </div>
          )}

          {templates.map(t => (
            <div key={t.id} className="rounded-xl border border-zinc-200 bg-white p-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{t.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">{PROJ_STATUS_LABELS[t.defaultStatus] ?? t.defaultStatus}</span>
                  {t.estimatedHours && <span className="text-xs text-zinc-500">{t.estimatedHours}h est.</span>}
                </div>
                {t.description && <p className="text-xs text-zinc-500 mt-1">{t.description}</p>}
                {t.mediaVersionCategories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.mediaVersionCategories.map(c => (
                      <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100">{c}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                  disabled={deletingId === t.id}
                  onClick={() => handleDelete(t.id)}>
                  {deletingId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
