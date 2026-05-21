import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOutreachQueue, useUpdateOutreachQueueItem, useDeleteOutreachQueueItem,
  useSendOutreachMessage, useUpdateOutreachMessage, useBulkSendOutreach,
  useListArtists, useGenerateOutreachMessage,
  useListTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate,
  getGetOutreachQueueQueryKey, getListArtistsQueryKey, getListTemplatesQueryKey,
} from "@workspace/api-client-react";
import type { OutreachQueueItem, Template, TemplateBody } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  MessageSquare, Send, FileText, Plus, Pencil, Trash, CheckCircle,
  Loader2, Mail, ExternalLink, Layers, Sparkles, X, BookOpen,
  ChevronRight, Copy, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Shared constants ──────────────────────────────────────────────────────────

const MSG_TYPE_LABELS: Record<string, string> = {
  dm:             "DM",
  email:          "Email",
  proposal:       "Proposal",
  recommendation: "Recommendation",
};

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  email:    "Email",
  proposal: "Proposal",
  sms:      "SMS",
};

const TEMPLATE_TYPE_COLORS: Record<string, string> = {
  email:    "bg-blue-50 text-blue-700 border-blue-200",
  proposal: "bg-violet-50 text-violet-700 border-violet-200",
  sms:      "bg-green-50 text-green-700 border-green-200",
};

// ── Queue tab ─────────────────────────────────────────────────────────────────

function QueueTab() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [editingItem, setEditingItem] = useState<OutreachQueueItem | null>(null);
  const [editBody,    setEditBody]    = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editEmail,   setEditEmail]   = useState("");
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
        onError:   () => toast({ title: "Failed to approve", variant: "destructive" }),
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
        onError:   () => toast({ title: "Send failed — check Outlook connection", variant: "destructive" }),
      },
    );
  }

  function handleDiscard(msgId: number) {
    discardMut.mutate(
      { msgId },
      {
        onSuccess: () => {
          toast({ title: "Discarded from queue" }); invalidate();
          setSelectedIds(s => { const n = new Set(s); n.delete(msgId); return n; });
        },
        onError: () => toast({ title: "Discard failed", variant: "destructive" }),
      },
    );
  }

  function handleBulkSend() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    bulkSendMut.mutate(
      { data: { msgIds: ids } },
      {
        onSuccess: result => {
          invalidate(); setSelectedIds(new Set());
          const s = result.sent.length, f = result.failed.length;
          if (f === 0) toast({ title: `Bulk send complete — ${s} sent` });
          else toast({ title: `${s} sent, ${f} failed`, variant: "destructive" });
        },
        onError: () => toast({ title: "Bulk send failed", variant: "destructive" }),
      },
    );
  }

  function openEdit(item: OutreachQueueItem) {
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
        onError:   () => toast({ title: "Save failed", variant: "destructive" }),
      },
    );
  }

  type ExtQueueItem = OutreachQueueItem & { artistName: string; artistGenre?: string | null; creatorName: string };

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (editingItem) {
    const ext = editingItem as ExtQueueItem;
    return (
      <div className="p-6 max-w-2xl space-y-4">
        <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => setEditingItem(null)}>
          ← Back to queue
        </button>
        <p className="text-sm font-semibold">
          Editing: {ext.artistName}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{MSG_TYPE_LABELS[editingItem.type]}</span>
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
            <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-background"
              value={editSubject} onChange={e => setEditSubject(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Recipient Email</label>
            <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-background"
              value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="recipient@example.com" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message Body</label>
            <textarea rows={10}
              className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none bg-background"
              value={editBody} onChange={e => setEditBody(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSaveEdit} disabled={updateMut.isPending}>
            {updateMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Save Changes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditingItem(null)}>Cancel</Button>
        </div>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-20">
        <MessageSquare className="h-12 w-12 text-muted-foreground/20" />
        <p className="text-base font-medium text-muted-foreground">Outreach queue is empty</p>
        <p className="text-sm text-muted-foreground/70 max-w-xs">
          Use the Compose tab to draft a message for any artist, or generate one directly from an artist's profile.
        </p>
      </div>
    );
  }

  const drafts   = queue.filter(m => m.status === "draft");
  const approved = queue.filter(m => m.status === "approved");
  const approvedIds = approved.map(m => m.id);
  const allApprovedSelected = approvedIds.length > 0 && approvedIds.every(id => selectedIds.has(id));

  const renderGroup = (title: string, items: typeof queue, badgeClass: string, isApproved = false) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {isApproved && (
            <input type="checkbox" className="h-3.5 w-3.5 rounded cursor-pointer accent-violet-600"
              checked={allApprovedSelected}
              onChange={() => {
                if (allApprovedSelected) {
                  setSelectedIds(s => { const n = new Set(s); items.forEach(m => n.delete(m.id)); return n; });
                } else {
                  setSelectedIds(s => { const n = new Set(s); items.forEach(m => n.add(m.id)); return n; });
                }
              }} title="Select all approved" />
          )}
          <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", badgeClass)}>{title}</span>
          <span className="text-xs text-muted-foreground">{items.length}</span>
        </div>
        {items.map(msg => {
          const ext = msg as ExtQueueItem;
          return (
            <div key={msg.id}
              className={cn(
                "border rounded-xl px-4 py-3 bg-card hover:bg-muted/20 transition-colors space-y-2",
                isApproved && selectedIds.has(msg.id) ? "ring-1 ring-violet-400" : "",
              )}>
              <div className="flex items-start justify-between gap-3">
                {isApproved && (
                  <input type="checkbox" className="mt-1 h-3.5 w-3.5 shrink-0 rounded cursor-pointer accent-violet-600"
                    checked={selectedIds.has(msg.id)}
                    onChange={() => setSelectedIds(s => { const n = new Set(s); n.has(msg.id) ? n.delete(msg.id) : n.add(msg.id); return n; })} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <button className="text-sm font-semibold text-violet-700 hover:underline truncate"
                      onClick={() => navigate(`/artists/${msg.artistId}`)}>
                      {ext.artistName}
                    </button>
                    {ext.artistGenre && <span className="text-xs text-muted-foreground">· {ext.artistGenre}</span>}
                  </div>
                  <p className="text-xs font-medium text-foreground truncate">{msg.subject || MSG_TYPE_LABELS[msg.type]}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{msg.body}</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 border-violet-200">
                    {MSG_TYPE_LABELS[msg.type]}
                  </Badge>
                  {msg.recipientEmail && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" />{msg.recipientEmail}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t flex-wrap">
                <span className="text-[10px] text-muted-foreground mr-auto">
                  By {ext.creatorName} · {new Date(msg.createdAt).toLocaleDateString()}
                </span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => openEdit(msg)}>
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
                {msg.status === "draft" && <span className="text-[10px] text-amber-600">Needs approval first</span>}
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive"
                  onClick={() => handleDiscard(msg.id)} disabled={discardMut.isPending}>
                  <Trash className="h-3 w-3 mr-1" />Discard
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1"
                  onClick={() => navigate(`/artists/${msg.artistId}`)}>
                  <ExternalLink className="h-3 w-3" />Artist
                </Button>
              </div>
            </div>
          );
        })}
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
          <Button size="sm"
            className="ml-auto text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
            onClick={handleBulkSend} disabled={bulkSendMut.isPending}>
            {bulkSendMut.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Send className="h-3.5 w-3.5" />}
            Send {selectedIds.size} Selected
          </Button>
        )}
      </div>
      {renderGroup("Drafts — Awaiting Approval", drafts,   "bg-amber-50 text-amber-700")}
      {renderGroup("Approved — Ready to Send",   approved, "bg-green-50 text-green-700", true)}
    </div>
  );
}

// ── Compose tab ───────────────────────────────────────────────────────────────

interface ComposeTabProps {
  preloadArtistId?: number | null;
  preloadContext?:  string | null;
  onComposed: () => void;
}

function ComposeTab({ preloadArtistId, preloadContext, onComposed }: ComposeTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: artists = [] } = useListArtists(undefined, {
    query: { queryKey: getListArtistsQueryKey() },
  });
  const { data: templates = [] } = useListTemplates({
    query: { queryKey: getListTemplatesQueryKey() },
  });

  const [artistId,   setArtistId]   = useState<number | null>(preloadArtistId ?? null);
  const [msgType,    setMsgType]    = useState<"dm" | "email" | "proposal" | "recommendation">("email");
  const [context,    setContext]    = useState(preloadContext ?? "");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  const genMut = useGenerateOutreachMessage();

  const compatibleTemplates = useMemo(() =>
    templates.filter(t => t.type === "email" || t.type === "proposal"),
    [templates],
  );

  function applyTemplate(tpl: Template) {
    setTemplateId(tpl.id);
    setContext(prev => {
      const base = tpl.body.slice(0, 300);
      return prev ? `${prev}\n\n---\nTemplate: ${base}` : `Template context:\n${base}`;
    });
    if (tpl.type === "proposal") setMsgType("proposal");
    else setMsgType("email");
  }

  async function handleGenerate() {
    if (!artistId) { toast({ title: "Select an artist first", variant: "destructive" }); return; }
    setGenerating(true);
    genMut.mutate(
      { id: artistId, data: { type: msgType, contextNotes: context.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Draft added to queue" });
          qc.invalidateQueries({ queryKey: getGetOutreachQueueQueryKey() });
          setContext(""); setTemplateId(null);
          onComposed();
        },
        onError: () => toast({ title: "Generation failed", variant: "destructive" }),
        onSettled: () => setGenerating(false),
      },
    );
  }

  const selectedArtist = artists.find(a => a.id === artistId);

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-5 w-5 text-violet-600" />
        <h2 className="text-base font-semibold">Compose Outreach</h2>
      </div>

      {/* Artist selector */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Artist *</label>
        <Select value={artistId ? String(artistId) : ""} onValueChange={v => setArtistId(Number(v))}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Search and select an artist…" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {artists.map(a => (
              <SelectItem key={a.id} value={String(a.id)} className="text-sm">
                <span className="font-medium">{a.name}</span>
                {a.genre && <span className="ml-2 text-muted-foreground text-xs">{a.genre}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedArtist?.email && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Mail className="h-3 w-3" />{selectedArtist.email}
          </p>
        )}
      </div>

      {/* Message type */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Message Type</label>
        <div className="flex gap-2 flex-wrap">
          {(["email","dm","proposal","recommendation"] as const).map(t => (
            <button key={t}
              onClick={() => setMsgType(t)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                msgType === t
                  ? "bg-violet-600 text-white border-violet-600"
                  : "border-border text-muted-foreground hover:border-violet-300 hover:text-violet-700",
              )}>
              {MSG_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* Template picker */}
      {compatibleTemplates.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Use a Template <span className="font-normal">(optional — adds context to the AI prompt)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {compatibleTemplates.map(t => (
              <button key={t.id}
                onClick={() => applyTemplate(t)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  templateId === t.id
                    ? "bg-violet-50 border-violet-400 text-violet-700"
                    : "border-border text-muted-foreground hover:border-violet-200 hover:text-violet-600",
                )}>
                <FileText className="h-3 w-3" />
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Context / notes */}
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          Context &amp; Notes <span className="font-normal">(what to say, key points, AI hook)</span>
        </label>
        <textarea
          rows={6}
          className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none bg-background"
          placeholder="Mention the artist's recent release, streaming growth, a specific deal point, or paste an AI hook from the Discover tab…"
          value={context}
          onChange={e => setContext(e.target.value)}
        />
      </div>

      <Button
        className="w-full gap-2 bg-violet-600 hover:bg-violet-700"
        onClick={handleGenerate}
        disabled={!artistId || generating}>
        {generating
          ? <><Loader2 className="h-4 w-4 animate-spin" />Generating…</>
          : <><Sparkles className="h-4 w-4" />Generate &amp; Add to Queue</>}
      </Button>

      <p className="text-xs text-muted-foreground">
        The AI draft is saved to Queue for review and approval before sending.
      </p>
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────

interface TemplatesTabProps {
  onUseTemplate: (tpl: Template) => void;
}

function TemplatesTab({ onUseTemplate }: TemplatesTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useListTemplates({
    query: { queryKey: getListTemplatesQueryKey() },
  });

  const createMut = useCreateTemplate();
  const updateMut = useUpdateTemplate();
  const deleteMut = useDeleteTemplate();

  const [filterType, setFilterType] = useState<"all" | "email" | "proposal" | "sms">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editTpl,    setEditTpl]    = useState<Template | null>(null);
  const [form, setForm] = useState<{ title: string; type: "email" | "proposal" | "sms"; subject: string; body: string; isShared: boolean }>({
    title: "", type: "email", subject: "", body: "", isShared: true,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: getListTemplatesQueryKey() });

  const filtered = useMemo(() =>
    filterType === "all" ? templates : templates.filter(t => t.type === filterType),
    [templates, filterType],
  );

  function openCreate() {
    setEditTpl(null);
    setForm({ title: "", type: "email", subject: "", body: "", isShared: true });
    setShowCreate(true);
  }

  function openEdit(tpl: Template) {
    setEditTpl(tpl);
    setForm({
      title:    tpl.title,
      type:     (tpl.type as "email" | "proposal" | "sms"),
      subject:  tpl.subject ?? "",
      body:     tpl.body,
      isShared: tpl.isShared ?? true,
    });
    setShowCreate(true);
  }

  function handleSave() {
    const body: TemplateBody = { title: form.title, type: form.type, subject: form.subject || undefined, body: form.body, isShared: form.isShared };
    if (editTpl) {
      updateMut.mutate(
        { id: editTpl.id, data: body },
        {
          onSuccess: () => { toast({ title: "Template updated" }); invalidate(); setShowCreate(false); },
          onError:   () => toast({ title: "Update failed", variant: "destructive" }),
        },
      );
    } else {
      createMut.mutate(
        { data: body },
        {
          onSuccess: () => { toast({ title: "Template saved" }); invalidate(); setShowCreate(false); },
          onError:   () => toast({ title: "Save failed", variant: "destructive" }),
        },
      );
    }
  }

  function handleDelete(id: number) {
    deleteMut.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: "Template deleted" }); invalidate(); },
        onError:   () => toast({ title: "Delete failed", variant: "destructive" }),
      },
    );
  }

  function copyBody(body: string) {
    void navigator.clipboard.writeText(body);
    toast({ title: "Copied to clipboard" });
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1,2,3].map(i => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-violet-600" />
          <h2 className="text-base font-semibold">Message Templates</h2>
          <span className="text-xs text-muted-foreground">({templates.length} saved)</span>
        </div>
        <div className="flex items-center gap-2">
          <a href="/templates" className="text-xs text-muted-foreground hover:text-violet-700 flex items-center gap-1 transition-colors">
            <Layers className="h-3.5 w-3.5" />Full Marketing Templates
            <ChevronRight className="h-3 w-3" />
          </a>
          <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />New Template
          </Button>
        </div>
      </div>

      {/* Type filter */}
      <div className="flex gap-2">
        {(["all","email","proposal","sms"] as const).map(t => (
          <button key={t}
            onClick={() => setFilterType(t)}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-medium border transition-colors",
              filterType === t
                ? "bg-violet-600 text-white border-violet-600"
                : "border-border text-muted-foreground hover:border-violet-300",
            )}>
            {t === "all" ? "All" : TEMPLATE_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Template list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center gap-3 py-16">
          <FileText className="h-10 w-10 text-muted-foreground/20" />
          <p className="text-sm font-medium text-muted-foreground">No templates yet</p>
          <p className="text-xs text-muted-foreground/70 max-w-xs">
            Create reusable message templates for cold DMs, email pitches, and proposals.
          </p>
          <Button size="sm" variant="outline" className="gap-1.5 mt-1" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />Create your first template
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map(tpl => (
            <div key={tpl.id}
              className="border rounded-xl p-4 bg-card hover:bg-muted/20 transition-colors flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{tpl.title}</p>
                  {tpl.subject && <p className="text-xs text-muted-foreground truncate mt-0.5">{tpl.subject}</p>}
                </div>
                <Badge variant="outline"
                  className={cn("text-[10px] shrink-0", TEMPLATE_TYPE_COLORS[tpl.type] ?? "bg-zinc-50 text-zinc-600 border-zinc-200")}>
                  {TEMPLATE_TYPE_LABELS[tpl.type] ?? tpl.type}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3 flex-1">{tpl.body}</p>
              <div className="flex items-center gap-1.5 pt-1 border-t">
                <Button size="sm" variant="outline"
                  className="h-7 px-2.5 text-xs gap-1 flex-1 hover:bg-violet-50 hover:border-violet-300 hover:text-violet-700"
                  onClick={() => onUseTemplate(tpl)}>
                  <Sparkles className="h-3 w-3" />Use in Compose
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => copyBody(tpl.body)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openEdit(tpl)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => handleDelete(tpl.id)} disabled={deleteMut.isPending}>
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editTpl ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Template Title *</label>
                <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-background"
                  value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Cold Outreach Email" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <Select value={form.type} onValueChange={(v: "email" | "proposal" | "sms") => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id="shared-toggle" className="h-3.5 w-3.5 accent-violet-600"
                  checked={form.isShared} onChange={e => setForm(f => ({ ...f, isShared: e.target.checked }))} />
                <label htmlFor="shared-toggle" className="text-xs text-muted-foreground cursor-pointer">
                  Shared with team
                </label>
              </div>
            </div>
            {form.type !== "sms" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
                <input className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 bg-background"
                  value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="Subject line (optional)" />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Body <span className="font-normal">— use {"{{"}<span>variableName</span>{"}}"} for dynamic values</span>
              </label>
              <textarea rows={8}
                className="w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none bg-background font-mono text-xs"
                value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder={"Hi {{artistName}},\n\nI came across your work and wanted to reach out…"} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700"
              onClick={handleSave}
              disabled={!form.title || !form.body || createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending)
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                : null}
              {editTpl ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Research tab (streaming link discovery) ───────────────────────────────────

interface DetectedStream {
  platform: string;
  embedUrl: string | null;
  linkUrl: string;
  color: string;
}

function detectStream(rawUrl: string): DetectedStream | null {
  if (!rawUrl.trim()) return null;
  try { new URL(rawUrl); } catch { return null; }
  const u = rawUrl.trim();
  if (u.includes("open.spotify.com/artist/")) {
    const id = u.split("open.spotify.com/artist/")[1]?.split("?")[0];
    return { platform: "Spotify", embedUrl: id ? `https://open.spotify.com/embed/artist/${id}?utm_source=generator` : null, linkUrl: u, color: "#1DB954" };
  }
  if (u.includes("music.apple.com")) {
    return { platform: "Apple Music", embedUrl: u.replace("music.apple.com", "embed.music.apple.com"), linkUrl: u, color: "#FC3C44" };
  }
  if (u.includes("soundcloud.com")) {
    return { platform: "SoundCloud", embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u)}&color=%23FF5500&show_artwork=true&show_comments=false`, linkUrl: u, color: "#FF5500" };
  }
  if (u.includes("bandcamp.com")) {
    return { platform: "Bandcamp", embedUrl: null, linkUrl: u, color: "#1DA0C3" };
  }
  if (u.includes("groover.co")) {
    return { platform: "Groover", embedUrl: null, linkUrl: u, color: "#6741D9" };
  }
  if (u.includes("youtube.com") || u.includes("youtu.be")) {
    const vid = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return { platform: "YouTube", embedUrl: vid ? `https://www.youtube.com/embed/${vid[1]}` : null, linkUrl: u, color: "#FF0000" };
  }
  if (u.includes("audiomack.com")) {
    return { platform: "Audiomack", embedUrl: null, linkUrl: u, color: "#FF6728" };
  }
  if (u.includes("tidal.com")) {
    return { platform: "Tidal", embedUrl: null, linkUrl: u, color: "#000000" };
  }
  return { platform: "Link", embedUrl: null, linkUrl: u, color: "#6b7280" };
}

const RESEARCH_PLATFORMS = [
  { name: "Spotify",     color: "#1DB954", note: "Embedded player" },
  { name: "Apple Music", color: "#FC3C44", note: "Embedded player" },
  { name: "SoundCloud",  color: "#FF5500", note: "Embedded player" },
  { name: "YouTube",     color: "#FF0000", note: "Embedded video"  },
  { name: "Bandcamp",    color: "#1DA0C3", note: "Link card"       },
  { name: "Groover",     color: "#6741D9", note: "Link card"       },
  { name: "Audiomack",   color: "#FF6728", note: "Link card"       },
  { name: "Tidal",       color: "#000000", note: "Link card"       },
];

function ResearchTab() {
  const [url, setUrl]           = useState("");
  const [detected, setDetected] = useState<DetectedStream | null>(null);
  const [, navigate]            = useLocation();

  function handleLookup() {
    setDetected(detectStream(url));
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Streaming Link Lookup</h2>
        <p className="text-sm text-muted-foreground">
          Paste any streaming link — Spotify, Apple Music, Bandcamp, Groover, SoundCloud, YouTube — to research an artist in real time and add them to your roster.
        </p>
      </div>

      <div className="flex gap-2">
        <Input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLookup()}
          placeholder="https://open.spotify.com/artist/… or artist.bandcamp.com"
          className="text-sm flex-1"
        />
        <Button onClick={handleLookup} className="gap-1.5 shrink-0 bg-violet-600 hover:bg-violet-700">
          <Search className="h-4 w-4" />
          Look up
        </Button>
      </div>

      {detected && (
        <div className="rounded-2xl border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-zinc-50 dark:bg-zinc-800/50">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center rounded-full text-white font-bold text-xs w-7 h-7 shrink-0"
                style={{ backgroundColor: detected.color }}
              >
                {detected.platform.charAt(0)}
              </span>
              <span className="font-medium text-sm">{detected.platform}</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={detected.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                Open in {detected.platform} <ExternalLink className="h-3 w-3" />
              </a>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => navigate(`/artists?prefill=${encodeURIComponent(detected.linkUrl)}&platform=${encodeURIComponent(detected.platform)}`)}
              >
                <Plus className="h-3 w-3" />
                Add to CRM
              </Button>
            </div>
          </div>

          {detected.embedUrl ? (
            <iframe
              src={detected.embedUrl}
              className="w-full border-0 block"
              style={{ height: detected.platform === "SoundCloud" ? 166 : 380 }}
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title={`${detected.platform} player`}
            />
          ) : (
            <div className="px-4 py-8 flex flex-col items-center gap-3 text-center">
              <span
                className="inline-flex items-center justify-center rounded-2xl text-white font-bold text-2xl w-14 h-14"
                style={{ backgroundColor: detected.color }}
              >
                {detected.platform.charAt(0)}
              </span>
              <p className="text-sm text-muted-foreground">
                {detected.platform} doesn't support in-app embeds.
              </p>
              <a
                href={detected.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline"
              >
                Open {detected.platform} profile <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border p-4">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">Supported Platforms</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {RESEARCH_PLATFORMS.map(p => (
            <div key={p.name} className="flex items-center gap-2">
              <span
                className="inline-flex items-center justify-center rounded-full text-white font-bold text-[10px] w-6 h-6 shrink-0"
                style={{ backgroundColor: p.color }}
              >
                {p.name.charAt(0)}
              </span>
              <div>
                <p className="text-xs font-medium">{p.name}</p>
                <p className="text-[10px] text-zinc-400">{p.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutreachHub() {
  const [activeTab, setActiveTab]     = useState("queue");
  const [composeArtist, setComposeArtist] = useState<number | null>(null);
  const [composeContext, setComposeContext] = useState<string | null>(null);
  const { data: queue = [] } = useGetOutreachQueue();

  const draftsCount   = queue.filter(m => m.status === "draft").length;
  const approvedCount = queue.filter(m => m.status === "approved").length;

  function handleUseTemplate(tpl: Template) {
    setComposeContext(tpl.body);
    setActiveTab("compose");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 px-6 pt-5 pb-0 border-b">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Outreach Hub</h1>
            <p className="text-xs text-muted-foreground">Draft, approve, and send messages to artists</p>
          </div>
          {(draftsCount > 0 || approvedCount > 0) && (
            <div className="ml-auto flex items-center gap-2">
              {draftsCount > 0 && (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                  {draftsCount} draft{draftsCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {approvedCount > 0 && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                  {approvedCount} ready to send
                </Badge>
              )}
            </div>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="h-9 gap-1 bg-transparent p-0 border-0">
            <TabsTrigger value="queue"
              className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:text-violet-700 data-[state=active]:bg-transparent px-4 text-sm gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Queue
              {queue.length > 0 && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                  {queue.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="compose"
              className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:text-violet-700 data-[state=active]:bg-transparent px-4 text-sm gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Compose
            </TabsTrigger>
            <TabsTrigger value="templates"
              className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:text-violet-700 data-[state=active]:bg-transparent px-4 text-sm gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="research"
              className="h-9 rounded-none border-b-2 border-transparent data-[state=active]:border-violet-600 data-[state=active]:text-violet-700 data-[state=active]:bg-transparent px-4 text-sm gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Research
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-auto">
            <TabsContent value="queue" className="mt-0 focus-visible:ring-0">
              <QueueTab />
            </TabsContent>

            <TabsContent value="compose" className="mt-0 focus-visible:ring-0">
              <ComposeTab
                key={`${composeArtist}-${composeContext}`}
                preloadArtistId={composeArtist}
                preloadContext={composeContext}
                onComposed={() => { setActiveTab("queue"); setComposeArtist(null); setComposeContext(null); }}
              />
            </TabsContent>

            <TabsContent value="templates" className="mt-0 focus-visible:ring-0">
              <TemplatesTab onUseTemplate={handleUseTemplate} />
            </TabsContent>

            <TabsContent value="research" className="mt-0 focus-visible:ring-0">
              <ResearchTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
