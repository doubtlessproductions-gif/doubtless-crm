import { 
  useListDeals, 
  useCreateDeal, 
  useUpdateDealStage, 
  useGetDeal, 
  useAddDealNote,
  getListDealsQueryKey,
  useListContacts,
  useUpdateDeal,
  useDeleteDeal,
  useAdminListUsers,
  useGetMe,
  getGetMeQueryKey,
  useGetOutreachQueue,
  getGetOutreachQueueQueryKey,
  useListArtists,
  getListArtistsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, X, Search, Calendar, MessageSquare, Building2, UserCircle2, ArrowRight, Film, Music, Upload, Trash2, Share2, Check, Copy, Download, Lock, Clock, AlertCircle, Settings2, ChevronDown, ChevronRight, Timer, Edit2, Paperclip, Loader2, Layers, Send, Sparkles, Flag, TrendingUp, LayoutList, LayoutGrid, Filter, DollarSign, Target, Trophy } from "lucide-react";
import { DndContext, DragOverlay, closestCorners, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format, differenceInDays, parseISO, isAfter, startOfMonth, endOfMonth } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
type Stage = typeof STAGES[number];
type Priority = "low" | "medium" | "high";
type ViewMode = "kanban" | "list";

const STAGE_LABELS: Record<Stage, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Closed Won",
  lost: "Closed Lost",
};

const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };
const PRIORITY_THEME: Record<Priority, { bg: string; text: string; dot: string }> = {
  low:    { bg: "bg-zinc-100",   text: "text-zinc-500",   dot: "bg-zinc-400" },
  medium: { bg: "bg-amber-50",   text: "text-amber-700",  dot: "bg-amber-400" },
  high:   { bg: "bg-red-50",     text: "text-red-700",    dot: "bg-red-500" },
};

interface DealTemplate {
  id: number;
  name: string;
  description: string | null;
  defaultValue: string | null;
  defaultStage: string;
  deliverableTypes: string[];
  estimatedHours: number | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

const dealSchema = z.object({
  title: z.string().min(1, "Title is required"),
  value: z.coerce.number().optional(),
  stage: z.enum(STAGES),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  expectedCloseDate: z.string().optional().or(z.literal("")),
  contactId: z.coerce.number().optional(),
  notes: z.string().optional().or(z.literal("")),
  templateId: z.number().int().optional(),
});

type DealFormValues = z.infer<typeof dealSchema>;

interface DealDeliverablePlan {
  id: number;
  dealId: number;
  deliverableType: string;
  templateId: number | null;
  isCompleted: boolean;
  completedAt: string | null;
  createdAt: string;
}

export default function Pipeline() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const search = useSearch();
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const canDeleteDeals = me?.role === "owner" || me?.role === "admin" || me?.role === "manager" || me?.permissions?.["deals:delete"] === true;

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [defaultStage, setDefaultStage] = useState<Stage>("lead");
  const [viewingDeal, setViewingDeal] = useState<number | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedDealIds, setSelectedDealIds] = useState<Set<number>>(new Set());
  const [bulkStage, setBulkStage] = useState<Stage>("lead");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkAssignUserId, setBulkAssignUserId] = useState<string>("none");
  const [exportStage, setExportStage] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const { token } = useAuth();
  const authH: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<DealTemplate | null>(null);
  const [pendingCardDeleteId, setPendingCardDeleteId] = useState<number | null>(null);

  const deleteCardDeal = useDeleteDeal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        toast({ title: "Deal deleted" });
        setPendingCardDeleteId(null);
      },
      onError: () => toast({ title: "Failed to delete deal", variant: "destructive" }),
    },
  });

  const { data: dealTemplates = [], refetch: refetchDealTemplates } = useQuery<DealTemplate[]>({
    queryKey: ["deal-templates"],
    queryFn: () => fetch("/api/deal-templates", { headers: authH }).then(r => r.ok ? r.json() : []),
  });

  const [, setLocation] = useLocation();
  const { data: usersList = [] } = useAdminListUsers();
  const { data: outreachQueue = [] } = useGetOutreachQueue({
    query: { queryKey: getGetOutreachQueueQueryKey() },
  });
  const { data: artists = [] } = useListArtists(undefined, {
    query: { queryKey: getListArtistsQueryKey() },
  });

  const queueDrafts   = outreachQueue.filter(m => m.status === "draft");
  const queueApproved = outreachQueue.filter(m => m.status === "approved");

  const toggleDeal = (id: number) => {
    setSelectedDealIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exportDeals = () => {
    const url = `/api/deals/export.csv${exportStage !== "all" ? `?stage=${exportStage}` : ""}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "deals.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const bulkDealAction = async (action: "stage" | "assign" | "delete", extra?: { stage?: string; userId?: number | null }) => {
    if (selectedDealIds.size === 0) return;
    if (action === "delete" && !canDeleteDeals) return;
    if (action === "delete" && !window.confirm(`Delete ${selectedDealIds.size} deal(s)? This cannot be undone.`)) return;
    setBulkLoading(true);
    try {
      if (action === "assign") {
        const assignRes = await fetch("/api/deals/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ids: [...selectedDealIds], action: "assign", userId: extra?.userId }),
        });
        if (!assignRes.ok) { const { error } = await assignRes.json().catch(() => ({ error: "Request failed" })); throw new Error(error); }
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        setSelectedDealIds(new Set());
        setBulkAssignUserId("none");
        toast({ title: "Deals assigned" });
        setBulkLoading(false);
        return;
      }
      await fetch("/api/deals/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [...selectedDealIds], action, ...extra }),
      });
      queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
      setSelectedDealIds(new Set());
      toast({ title: "Bulk action complete" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  // Read ?highlight= param from URL (e.g. /pipeline?highlight=won)
  const highlightStage = useMemo(() => {
    const params = new URLSearchParams(search);
    const h = params.get("highlight") as Stage | null;
    return STAGES.includes(h as Stage) ? (h as Stage) : null;
  }, [search]);

  // Scroll to highlighted column on mount
  const highlightRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [highlightStage]);
  
  const { data: deals, isLoading } = useListDeals(undefined, {
    query: { queryKey: getListDealsQueryKey() },
  });

  const { data: contacts } = useListContacts();

  const createDeal = useCreateDeal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        setIsCreateModalOpen(false);
        form.reset();
        toast({ title: "Deal created successfully" });
      }
    }
  });

  const updateStage = useUpdateDealStage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
      }
    }
  });

  const form = useForm<DealFormValues>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      title: "",
      value: undefined,
      stage: "lead",
      priority: "medium",
      expectedCloseDate: "",
      notes: ""
    }
  });

  const applyTemplate = (tmpl: DealTemplate) => {
    setSelectedTemplate(tmpl);
    const delivNotes = tmpl.deliverableTypes.length > 0
      ? `Expected deliverables:\n${tmpl.deliverableTypes.map(t => `- ${t}`).join("\n")}${tmpl.estimatedHours ? `\n\nEstimated hours: ${tmpl.estimatedHours}h` : ""}`
      : "";
    form.setValue("title", tmpl.name);
    if (tmpl.defaultValue) form.setValue("value", Number(tmpl.defaultValue));
    form.setValue("stage", tmpl.defaultStage as Stage);
    if (delivNotes) form.setValue("notes", delivNotes);
    form.setValue("templateId", tmpl.id);
  };

  const openCreateModal = (stage: Stage = "lead") => {
    setDefaultStage(stage);
    setSelectedTemplate(null);
    form.reset({ title: "", value: undefined, stage, priority: "medium", expectedCloseDate: "", notes: "", templateId: undefined });
    setIsCreateModalOpen(true);
  };

  const onSubmit = (values: DealFormValues) => {
    createDeal.mutate({ data: values });
  };

  const columns = useMemo(() => {
    const cols: Record<Stage, any[]> = {
      lead: [], qualified: [], proposal: [], negotiation: [], won: [], lost: []
    };
    if (deals) {
      deals.forEach(deal => {
        if (cols[deal.stage as Stage]) {
          cols[deal.stage as Stage].push(deal);
        }
      });
    }
    return cols;
  }, [deals]);

  // Pipeline metrics
  const metrics = useMemo(() => {
    if (!deals) return null;
    const active = deals.filter(d => d.stage !== "won" && d.stage !== "lost");
    const won = deals.filter(d => d.stage === "won");
    const closed = deals.filter(d => d.stage === "won" || d.stage === "lost");
    const pipelineValue = active.reduce((s, d) => s + (d.value || 0), 0);
    const wonValue = won.reduce((s, d) => s + (d.value || 0), 0);
    const winRate = closed.length > 0 ? Math.round((won.length / closed.length) * 100) : null;
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);
    const closingThisMonth = active.filter(d => {
      if (!d.expectedCloseDate) return false;
      const dt = parseISO(d.expectedCloseDate);
      return dt >= monthStart && dt <= monthEnd;
    });
    const closingValue = closingThisMonth.reduce((s, d) => s + (d.value || 0), 0);
    return { active: active.length, pipelineValue, wonValue, winRate, closingThisMonth: closingThisMonth.length, closingValue };
  }, [deals]);

  // Filtered deals (search + assignee + priority filters)
  const filteredDeals = useMemo(() => {
    if (!deals) return [];
    const q = searchQuery.toLowerCase();
    return deals.filter(deal => {
      if (q && !deal.title.toLowerCase().includes(q) && !(deal.contactName ?? "").toLowerCase().includes(q)) return false;
      if (filterAssignee !== "all" && String(deal.assignedTo ?? "none") !== filterAssignee) return false;
      if (filterPriority !== "all" && deal.priority !== filterPriority) return false;
      return true;
    });
  }, [deals, searchQuery, filterAssignee, filterPriority]);

  const filteredColumns = useMemo(() => {
    const cols: Record<Stage, any[]> = {
      lead: [], qualified: [], proposal: [], negotiation: [], won: [], lost: []
    };
    filteredDeals.forEach(deal => {
      if (cols[deal.stage as Stage]) cols[deal.stage as Stage].push(deal);
    });
    return cols;
  }, [filteredDeals]);

  const hasActiveFilters = searchQuery !== "" || filterAssignee !== "all" || filterPriority !== "all";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over) return;

    const dealId = Number(active.id);
    const overId = over.id;
    
    let targetStage: Stage | null = null;
    if (STAGES.includes(overId as Stage)) {
      targetStage = overId as Stage;
    } else {
      const targetDeal = deals?.find(d => d.id === Number(overId));
      if (targetDeal) targetStage = targetDeal.stage as Stage;
    }

    if (targetStage) {
      const activeDeal = deals?.find(d => d.id === dealId);
      if (activeDeal && activeDeal.stage !== targetStage) {
        updateStage.mutate({ id: dealId, data: { stage: targetStage } });
      }
    }
  };

  return (
    <div className="flex-1 p-6 h-full flex flex-col overflow-hidden bg-zinc-50/50">
      {/* Header row */}
      <div className="mb-4 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage your deals across stages.
            {artists.length > 0 && (
              <span className="ml-2 text-zinc-400">
                · <button className="text-fuchsia-600 hover:underline" onClick={() => setLocation("/artists")}>
                  {artists.length} artists in roster
                </button>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={exportStage} onValueChange={setExportStage}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All stages</SelectItem>
              {STAGES.map(s => <SelectItem key={s} value={s} className="text-xs">{STAGE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportDeals} className="gap-1.5">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button
            variant={isSelectMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => { setIsSelectMode(v => !v); setSelectedDealIds(new Set()); }}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" /> {isSelectMode ? "Cancel Select" : "Select"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)} className="gap-1.5">
            <Layers className="h-4 w-4" /> Templates
          </Button>
          <Button onClick={() => openCreateModal("lead")}>
            <Plus className="h-4 w-4 mr-2" /> New Deal
          </Button>
        </div>
      </div>

      {/* Pipeline metrics bar */}
      {metrics && (
        <div className="mb-4 shrink-0 grid grid-cols-4 gap-3">
          <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <Target className="h-4 w-4 text-blue-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Active Deals</div>
              <div className="text-xl font-bold text-zinc-900">{metrics.active}</div>
            </div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
              <DollarSign className="h-4 w-4 text-violet-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Pipeline Value</div>
              <div className="text-xl font-bold text-zinc-900">${metrics.pipelineValue.toLocaleString()}</div>
            </div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
              <Calendar className="h-4 w-4 text-amber-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Closing This Month</div>
              <div className="text-xl font-bold text-zinc-900">
                {metrics.closingThisMonth}
                {metrics.closingValue > 0 && (
                  <span className="text-sm font-medium text-zinc-500 ml-1.5">${metrics.closingValue.toLocaleString()}</span>
                )}
              </div>
            </div>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
              <Trophy className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-zinc-500">Win Rate</div>
              <div className="text-xl font-bold text-zinc-900">
                {metrics.winRate !== null ? `${metrics.winRate}%` : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Outreach + artist status bar */}
      {(outreachQueue.length > 0 || artists.length > 0) && (
        <div className="mb-3 shrink-0 flex items-center gap-3 flex-wrap">
          {outreachQueue.length > 0 && (
            <button
              onClick={() => setLocation("/outreach")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-xs font-medium hover:bg-violet-100 transition-colors"
            >
              <Send className="h-3.5 w-3.5" />
              <span>
                {queueApproved.length > 0 && (
                  <span className="font-semibold text-emerald-700">{queueApproved.length} ready to send</span>
                )}
                {queueApproved.length > 0 && queueDrafts.length > 0 && <span className="mx-1 text-violet-400">·</span>}
                {queueDrafts.length > 0 && (
                  <span>{queueDrafts.length} draft{queueDrafts.length !== 1 ? "s" : ""} pending</span>
                )}
              </span>
              <span className="text-violet-400">→ Outreach Hub</span>
            </button>
          )}
          {artists.length > 0 && (
            <button
              onClick={() => setLocation("/artists")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 text-xs font-medium hover:bg-fuchsia-100 transition-colors"
            >
              <Music className="h-3.5 w-3.5" />
              {artists.length} artist{artists.length !== 1 ? "s" : ""} in roster
              <span className="text-fuchsia-400">→ Roster</span>
            </button>
          )}
          {outreachQueue.length === 0 && artists.length > 0 && (
            <button
              onClick={() => setLocation("/outreach")}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-500 text-xs hover:bg-zinc-100 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Draft outreach for an artist
            </button>
          )}
        </div>
      )}

      {/* Search + filter + view toggle row */}
      <div className="mb-3 shrink-0 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search deals…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-zinc-900/20"
          />
        </div>
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All assignees</SelectItem>
            <SelectItem value="none" className="text-xs">Unassigned</SelectItem>
            {(usersList as { id: number; name: string }[]).map(u => (
              <SelectItem key={u.id} value={String(u.id)} className="text-xs">{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All priorities</SelectItem>
            <SelectItem value="high" className="text-xs">🔴 High</SelectItem>
            <SelectItem value="medium" className="text-xs">🟡 Medium</SelectItem>
            <SelectItem value="low" className="text-xs">⚪ Low</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <button
            onClick={() => { setSearchQuery(""); setFilterAssignee("all"); setFilterPriority("all"); }}
            className="text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1 px-2 py-1.5 border border-dashed border-zinc-300 rounded-lg hover:bg-zinc-50"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("kanban")}
            className={`p-1.5 rounded-md transition-colors ${viewMode === "kanban" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
            title="Kanban view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-md transition-colors ${viewMode === "list" ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
            title="List view"
          >
            <LayoutList className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto pb-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">Loading pipeline...</div>
        ) : viewMode === "list" ? (
          <PipelineListView
            deals={filteredDeals}
            onViewDeal={(id) => setViewingDeal(id)}
            isSelectMode={isSelectMode}
            selectedDealIds={selectedDealIds}
            onToggleDeal={toggleDeal}
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 h-full min-w-max px-1">
              {STAGES.map(stage => (
                <Column
                  key={stage}
                  stage={stage}
                  deals={filteredColumns[stage]}
                  onAddDeal={() => openCreateModal(stage)}
                  onViewDeal={(id) => { if (!isSelectMode) setViewingDeal(id); }}
                  highlighted={highlightStage === stage}
                  ref={highlightStage === stage ? highlightRef : null}
                  isSelectMode={isSelectMode}
                  selectedDealIds={selectedDealIds}
                  onToggleDeal={toggleDeal}
                  canDeleteDeal={canDeleteDeals}
                  onDeleteDeal={(id) => setPendingCardDeleteId(id)}
                />
              ))}
            </div>
          </DndContext>
        )}
      </div>

      {isSelectMode && selectedDealIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-zinc-900 text-white rounded-xl shadow-xl px-4 py-3 text-sm flex-wrap justify-center max-w-2xl">
          <span className="font-medium text-zinc-300 shrink-0">{selectedDealIds.size} selected</span>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <Select value={bulkStage} onValueChange={(v) => setBulkStage(v as Stage)}>
            <SelectTrigger className="h-8 w-36 bg-zinc-800 border-zinc-700 text-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGES.map(s => <SelectItem key={s} value={s} className="text-xs">{STAGE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={() => bulkDealAction("stage", { stage: bulkStage })}
            disabled={bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >Move</button>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <Select value={bulkAssignUserId} onValueChange={setBulkAssignUserId}>
            <SelectTrigger className="h-8 w-36 bg-zinc-800 border-zinc-700 text-white text-xs">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs">Unassigned</SelectItem>
              {(usersList as { id: number; name: string }[]).map(u => (
                <SelectItem key={u.id} value={String(u.id)} className="text-xs">{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => bulkDealAction("assign", { userId: bulkAssignUserId === "none" ? null : Number(bulkAssignUserId) })}
            disabled={bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >Assign</button>
          <div className="w-px h-4 bg-zinc-700 mx-1 shrink-0" />
          <button
            onClick={() => bulkDealAction("delete")}
            disabled={bulkLoading}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >Delete</button>
          <button onClick={() => setSelectedDealIds(new Set())} className="ml-1 text-zinc-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Create Deal Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-zinc-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-zinc-100 shrink-0">
              <h2 className="text-lg font-semibold">New Deal</h2>
              <Button variant="ghost" size="icon" onClick={() => setIsCreateModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="p-6 overflow-y-auto">
              {dealTemplates.length > 0 && (
                <div className="mb-4 p-3 bg-violet-50 border border-violet-100 rounded-xl">
                  <p className="text-xs font-semibold text-violet-700 mb-2 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" /> Use a template
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {dealTemplates.map(tmpl => (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => applyTemplate(tmpl)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          selectedTemplate?.id === tmpl.id
                            ? "bg-violet-600 text-white border-violet-600"
                            : "bg-white text-violet-700 border-violet-200 hover:border-violet-400"
                        }`}
                      >
                        {tmpl.name}
                      </button>
                    ))}
                  </div>
                  {selectedTemplate && (
                    <p className="text-xs text-violet-500 mt-2">
                      Template applied — fields pre-filled. Adjust as needed.
                    </p>
                  )}
                </div>
              )}
              <form id="deal-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Deal Title *</Label>
                  <Input id="title" {...form.register("title")} placeholder="e.g. Artist Distribution Deal" />
                  {form.formState.errors.title && <p className="text-sm text-red-500">{form.formState.errors.title.message}</p>}
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="value">Value ($)</Label>
                    <Input id="value" type="number" {...form.register("value")} placeholder="10000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stage">Stage</Label>
                    <Select 
                      defaultValue={defaultStage}
                      onValueChange={(val) => form.setValue("stage", val as Stage)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select stage" />
                      </SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => (
                          <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select
                      defaultValue="medium"
                      onValueChange={(val) => form.setValue("priority", val as Priority)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Priority" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">🔴 High</SelectItem>
                        <SelectItem value="medium">🟡 Medium</SelectItem>
                        <SelectItem value="low">⚪ Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expectedCloseDate">Expected Close</Label>
                    <Input id="expectedCloseDate" type="date" {...form.register("expectedCloseDate")} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactId">Contact</Label>
                  <Select onValueChange={(val) => form.setValue("contactId", Number(val))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a contact" />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts?.map(c => (
                        <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" className="h-24" {...form.register("notes")} />
                </div>
              </form>
            </div>

            <div className="p-6 border-t border-zinc-100 bg-zinc-50 shrink-0 flex justify-end gap-3 rounded-b-xl">
              <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
              <Button type="submit" form="deal-form" disabled={createDeal.isPending}>
                {createDeal.isPending ? "Creating..." : "Create Deal"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View Deal Panel */}
      {viewingDeal && (
        <DealDetailPanel id={viewingDeal} onClose={() => setViewingDeal(null)} />
      )}

      {/* Card-level delete confirmation */}
      <AlertDialog open={pendingCardDeleteId !== null} onOpenChange={(open) => { if (!open) setPendingCardDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete deal?</AlertDialogTitle>
            <AlertDialogDescription>
              This deal and all its notes, deliverables, and time entries will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingCardDeleteId && deleteCardDeal.mutate({ id: pendingCardDeleteId })}
              disabled={deleteCardDeal.isPending}
            >
              {deleteCardDeal.isPending ? "Deleting…" : "Delete deal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Templates Manager */}
      {templatesOpen && (
        <DealTemplatesModal
          templates={dealTemplates}
          token={token}
          onClose={() => setTemplatesOpen(false)}
          onRefresh={() => void refetchDealTemplates()}
        />
      )}
    </div>
  );
}

const Column = React.forwardRef<HTMLDivElement, { stage: Stage; deals: any[]; onAddDeal: () => void; onViewDeal: (id: number) => void; highlighted?: boolean; isSelectMode?: boolean; selectedDealIds?: Set<number>; onToggleDeal?: (id: number) => void; canDeleteDeal?: boolean; onDeleteDeal?: (id: number) => void }>(
  function Column({ stage, deals, onAddDeal, onViewDeal, highlighted = false, isSelectMode, selectedDealIds, onToggleDeal, canDeleteDeal, onDeleteDeal }, ref) {
  const totalValue = deals.reduce((sum, d) => sum + (d.value || 0), 0);
  
  const STAGE_THEME: Record<Stage, { header: string; count: string; amount: string; bg: string; border: string; accent: string }> = {
    lead:        { header: "bg-slate-100 border-slate-200 text-slate-800",       count: "bg-slate-200 text-slate-600",       amount: "text-slate-500",    bg: "bg-slate-50/80",    border: "border-slate-200",    accent: "border-t-[3px] border-t-slate-400" },
    qualified:   { header: "bg-blue-50 border-blue-200 text-blue-900",           count: "bg-blue-100 text-blue-700",          amount: "text-blue-600",     bg: "bg-blue-50/50",     border: "border-blue-200",     accent: "border-t-[3px] border-t-blue-500" },
    proposal:    { header: "bg-violet-50 border-violet-200 text-violet-900",     count: "bg-violet-100 text-violet-700",      amount: "text-violet-600",   bg: "bg-violet-50/50",   border: "border-violet-200",   accent: "border-t-[3px] border-t-violet-500" },
    negotiation: { header: "bg-amber-50 border-amber-200 text-amber-900",        count: "bg-amber-100 text-amber-700",        amount: "text-amber-600",    bg: "bg-amber-50/50",    border: "border-amber-200",    accent: "border-t-[3px] border-t-amber-500" },
    won:         { header: "bg-emerald-50 border-emerald-200 text-emerald-900",  count: "bg-emerald-100 text-emerald-700",    amount: "text-emerald-700",  bg: "bg-emerald-50/50",  border: "border-emerald-200",  accent: "border-t-[3px] border-t-emerald-500" },
    lost:        { header: "bg-red-50 border-red-200 text-red-900",              count: "bg-red-100 text-red-700",            amount: "text-red-600",      bg: "bg-red-50/40",      border: "border-red-200",      accent: "border-t-[3px] border-t-red-400" },
  };

  const theme = STAGE_THEME[stage];
  const headerClass = theme.header;
  const countClass = theme.count;
  const amountClass = theme.amount;

  const { setNodeRef } = useSortable({ id: stage });

  return (
    <div
      ref={ref}
      className={`flex flex-col w-80 shrink-0 h-full rounded-xl overflow-hidden border ${theme.accent} ${theme.bg} ${highlighted ? "border-indigo-400 ring-2 ring-indigo-300 ring-offset-1" : theme.border}`}
    >
      <div className={`p-4 border-b flex flex-col gap-1.5 shrink-0 ${headerClass}`}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm uppercase tracking-wider">{STAGE_LABELS[stage]}</h3>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${countClass}`}>
            {deals.length}
          </span>
        </div>
        <div className={`text-sm font-semibold ${amountClass}`}>
          ${totalValue.toLocaleString()}
        </div>
      </div>
      
      <div ref={setNodeRef} className="flex-1 p-3 overflow-y-auto flex flex-col gap-3 min-h-[150px] relative">
        <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map(deal => (
            <DealCard
              key={deal.id}
              deal={deal}
              onClick={() => onViewDeal(deal.id)}
              isSelectMode={isSelectMode}
              isSelected={selectedDealIds?.has(deal.id) ?? false}
              onToggle={() => onToggleDeal?.(deal.id)}
              canDelete={canDeleteDeal}
              onDelete={() => onDeleteDeal?.(deal.id)}
            />
          ))}
        </SortableContext>
        
        <Button 
          variant="ghost" 
          onClick={onAddDeal}
          className="w-full text-zinc-500 hover:bg-zinc-200/50 justify-start mt-2 border-dashed border border-transparent hover:border-zinc-300"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Deal
        </Button>
      </div>
    </div>
  );
});

function CloseDateBadge({ dateStr }: { dateStr: string | null | undefined }) {
  if (!dateStr) return null;
  const dt = parseISO(dateStr);
  const today = new Date();
  const days = differenceInDays(dt, today);
  let cls = "text-zinc-400";
  let label = format(dt, "MMM d");
  if (days < 0) { cls = "text-red-600 font-medium"; label = `${Math.abs(days)}d overdue`; }
  else if (days === 0) { cls = "text-red-600 font-medium"; label = "Due today"; }
  else if (days <= 7) { cls = "text-amber-600 font-medium"; label = `${days}d left`; }
  else if (days <= 30) { cls = "text-zinc-600"; label = format(dt, "MMM d"); }
  return (
    <span className={`flex items-center gap-0.5 ${cls}`}>
      <Calendar className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | undefined }) {
  const p = (priority ?? "medium") as Priority;
  const theme = PRIORITY_THEME[p] ?? PRIORITY_THEME.medium;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${theme.bg} ${theme.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      {PRIORITY_LABELS[p]}
    </span>
  );
}

function DealCard({ deal, onClick, isSelectMode, isSelected, onToggle, canDelete, onDelete }: { deal: any; onClick: () => void; isSelectMode?: boolean; isSelected?: boolean; onToggle?: () => void; canDelete?: boolean; onDelete?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 1,
  };

  const handleClick = () => {
    if (isSelectMode) { onToggle?.(); return; }
    onClick();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...(isSelectMode ? {} : listeners)}
      onClick={handleClick}
      className={`relative bg-white p-4 rounded-lg shadow-sm border ${
        isSelected ? "border-blue-400 ring-2 ring-blue-200 bg-blue-50/30"
          : isDragging ? "border-blue-400 shadow-md"
          : "border-zinc-200 hover:border-zinc-300"
      } ${isSelectMode ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"} group transition-colors`}
    >
      {isSelectMode && (
        <div className={`absolute top-2 right-2 h-5 w-5 rounded border-2 flex items-center justify-center ${isSelected ? "bg-blue-500 border-blue-500" : "border-zinc-300 bg-white"}`}>
          {isSelected && <Check className="h-3 w-3 text-white" />}
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="font-medium text-zinc-900 line-clamp-2 flex-1 pr-1">{deal.title}</div>
        <div className="flex items-center gap-1 shrink-0">
          {canDelete && !isSelectMode && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-300 hover:text-red-500 p-0.5 rounded"
              title="Delete deal"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {!isSelectMode && <PriorityBadge priority={deal.priority} />}
        </div>
      </div>
      <div className="text-lg font-bold text-zinc-800 mb-2">
        {deal.value ? `$${Number(deal.value).toLocaleString()}` : '-'}
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="truncate flex items-center">
          {deal.contactName ? (
            <>
              <UserCircle2 className="h-3 w-3 mr-1 shrink-0" />
              {deal.contactName}
            </>
          ) : "No contact"}
        </span>
        {deal.assignedToName && (
          <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-medium shrink-0 ml-2" title={deal.assignedToName}>
            {deal.assignedToName.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      {deal.expectedCloseDate && (
        <div className="mt-2 pt-2 border-t border-zinc-100">
          <CloseDateBadge dateStr={deal.expectedCloseDate} />
        </div>
      )}
    </div>
  );
}

// ── PipelineListView ─────────────────────────────────────────────────────────

function PipelineListView({
  deals,
  onViewDeal,
  isSelectMode,
  selectedDealIds,
  onToggleDeal,
}: {
  deals: any[];
  onViewDeal: (id: number) => void;
  isSelectMode?: boolean;
  selectedDealIds?: Set<number>;
  onToggleDeal?: (id: number) => void;
}) {
  const STAGE_DOT: Record<Stage, string> = {
    lead: "bg-slate-400",
    qualified: "bg-blue-500",
    proposal: "bg-violet-500",
    negotiation: "bg-amber-500",
    won: "bg-emerald-500",
    lost: "bg-red-400",
  };

  if (deals.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-400 text-sm italic">
        No deals match the current filters.
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 bg-zinc-50">
            {isSelectMode && <th className="w-8 px-4 py-3" />}
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">Deal</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">Stage</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">Priority</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 uppercase tracking-wide">Value</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">Contact</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">Close Date</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide">Assigned</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {deals.map(deal => {
            const isSelected = selectedDealIds?.has(deal.id) ?? false;
            return (
              <tr
                key={deal.id}
                onClick={() => isSelectMode ? onToggleDeal?.(deal.id) : onViewDeal(deal.id)}
                className={`cursor-pointer transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-zinc-50"}`}
              >
                {isSelectMode && (
                  <td className="px-4 py-3">
                    <div className={`h-4 w-4 rounded border-2 flex items-center justify-center ${isSelected ? "bg-blue-500 border-blue-500" : "border-zinc-300"}`}>
                      {isSelected && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                  </td>
                )}
                <td className="px-4 py-3 font-medium text-zinc-900 max-w-[220px] truncate">{deal.title}</td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
                    <span className={`h-2 w-2 rounded-full ${STAGE_DOT[deal.stage as Stage] ?? "bg-zinc-400"}`} />
                    {STAGE_LABELS[deal.stage as Stage] ?? deal.stage}
                  </span>
                </td>
                <td className="px-4 py-3"><PriorityBadge priority={deal.priority} /></td>
                <td className="px-4 py-3 text-right font-semibold text-zinc-800">
                  {deal.value ? `$${Number(deal.value).toLocaleString()}` : <span className="text-zinc-400 font-normal">—</span>}
                </td>
                <td className="px-4 py-3 text-zinc-600 max-w-[140px] truncate">{deal.contactName ?? <span className="text-zinc-400">—</span>}</td>
                <td className="px-4 py-3 text-xs"><CloseDateBadge dateStr={deal.expectedCloseDate} /></td>
                <td className="px-4 py-3">
                  {deal.assignedToName ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-semibold shrink-0">
                        {deal.assignedToName.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-xs text-zinc-600 truncate max-w-[80px]">{deal.assignedToName}</span>
                    </div>
                  ) : <span className="text-zinc-400 text-xs">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Deliverables helpers ──────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const ALLOWED_MIME = [
  "video/mp4", "video/quicktime", "video/x-msvideo", "video/webm",
  "audio/mpeg", "audio/wav", "audio/aac", "audio/ogg", "audio/flac", "audio/x-flac",
];

function statusBadge(status: string) {
  if (status === "approved") return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" variant="outline">Approved</Badge>;
  if (status === "shared") return <Badge className="bg-blue-100 text-blue-700 border-blue-200" variant="outline">Shared</Badge>;
  return <Badge className="bg-zinc-100 text-zinc-600 border-zinc-200" variant="outline">Uploaded</Badge>;
}

function isVideoMime(m: string) { return m.startsWith("video/"); }

// ── DeliverableCard ───────────────────────────────────────────────────────────

interface DeliverableComment {
  id: number;
  authorName: string;
  authorEmail: string | null;
  timestampSeconds: number | null;
  body: string;
  createdAt: string;
}

function DeliverableCard({
  d,
  dealId,
  onDelete,
  onStatusChange,
  onShareConfig,
  deleting,
}: {
  d: any;
  dealId: number;
  onDelete: (id: number) => void;
  onStatusChange: (id: number, status: string) => void;
  onShareConfig: (id: number, pw: string | null, exp: string | null) => void;
  deleting: boolean;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [comments, setComments] = useState<DeliverableComment[] | null>(null);
  const [loadingComments, setLoadingComments] = useState(false);
  const [settingPw, setSettingPw] = useState(d.sharePassword === "••••••••" ? "••••••••" : "");
  const [settingExp, setSettingExp] = useState(d.expiresAt ? d.expiresAt.slice(0, 16) : "");
  const [savingSettings, setSavingSettings] = useState(false);
  const [sharing, setSharing] = useState(false);

  function formatTs(s: number) {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  const copyLink = () => {
    navigator.clipboard.writeText(d.shareUrl).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  };

  const loadComments = async () => {
    if (comments !== null) return;
    setLoadingComments(true);
    try {
      const r = await fetch(`${BASE}/api/deliverables/${d.id}/comments`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setComments(await r.json());
      else setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const toggleComments = () => {
    if (!showComments) loadComments();
    setShowComments(prev => !prev);
  };

  // First-time share: POST to generate token + transition to "shared"
  const handleShare = async () => {
    setSharing(true);
    try {
      const r = await fetch(`${BASE}/api/deals/${dealId}/deliverables/${d.id}/share`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sharePassword: settingPw && settingPw !== "••••••••" ? settingPw : null,
          expiresAt: settingExp ? new Date(settingExp).toISOString() : null,
        }),
      });
      if (r.ok) {
        onShareConfig(d.id, settingPw || null, settingExp || null);
        setShowSettings(false);
      } else {
        toast({ title: "Failed to share", variant: "destructive" });
      }
    } finally {
      setSharing(false);
    }
  };

  // Update existing share config: PATCH password/expiry
  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const body: Record<string, any> = {};
      if (settingPw !== "••••••••") body.sharePassword = settingPw || null;
      body.expiresAt = settingExp ? new Date(settingExp).toISOString() : null;
      const r = await fetch(`${BASE}/api/deliverables/${d.id}/share`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        onShareConfig(d.id, settingPw || null, settingExp || null);
        setShowSettings(false);
      }
    } finally {
      setSavingSettings(false);
    }
  };

  const isExpired = !!d.expired;
  const commentCount = comments?.length ?? null;

  return (
    <div className={`bg-white border rounded-xl shadow-sm ${isExpired ? "border-amber-200 bg-amber-50/30" : "border-zinc-200"}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5 bg-violet-50 border border-violet-100 rounded-lg p-2">
            {isVideoMime(d.mimeType)
              ? <Film className="h-4 w-4 text-violet-500" />
              : <Music className="h-4 w-4 text-violet-500" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-zinc-900 truncate">{d.originalName}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{formatBytes(d.sizeBytes)} · {format(new Date(d.createdAt), "MMM d, yyyy")}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {statusBadge(d.status)}
              {isExpired && (
                <Badge className="bg-amber-100 text-amber-700 border-amber-200" variant="outline">
                  <AlertCircle className="h-3 w-3 mr-1" />Expired
                </Badge>
              )}
              {d.sharePassword && (
                <Badge className="bg-zinc-100 text-zinc-500 border-zinc-200" variant="outline">
                  <Lock className="h-3 w-3 mr-1" />Protected
                </Badge>
              )}
              {!isExpired && d.status !== "approved" && (
                <button
                  onClick={() => onStatusChange(d.id, d.status === "uploaded" ? "shared" : "approved")}
                  className="text-xs text-zinc-500 hover:text-zinc-800 underline"
                >
                  Mark as {d.status === "uploaded" ? "Shared" : "Approved"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-100">
          {d.shareUrl ? (
            <div className="flex-1 bg-zinc-50 rounded-lg px-3 py-1.5 text-xs text-zinc-600 font-mono truncate border border-zinc-200">
              {d.shareUrl}
            </div>
          ) : (
            <div className="flex-1 text-xs text-zinc-400 italic px-1">Not yet shared — click Share to generate a link</div>
          )}
          {d.shareUrl ? (
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" title="Copy link" onClick={copyLink}>
              {copiedId ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8"
            title="Share settings"
            onClick={() => setShowSettings(v => !v)}
          >
            <Settings2 className={`h-4 w-4 ${showSettings ? "text-violet-500" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8"
            title="View comments"
            onClick={toggleComments}
          >
            <MessageSquare className={`h-4 w-4 ${showComments ? "text-violet-500" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
            title="Delete"
            onClick={() => onDelete(d.id)}
            disabled={deleting}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Share settings panel */}
      {showSettings && (
        <div className="border-t border-zinc-100 px-4 py-3 bg-zinc-50/60 rounded-b-xl space-y-3">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">Share Settings</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Password</label>
              <input
                type="password"
                placeholder="Set a password (optional)"
                value={settingPw === "••••••••" ? "" : settingPw}
                onChange={e => setSettingPw(e.target.value)}
                className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Expires at</label>
              <input
                type="datetime-local"
                value={settingExp}
                onChange={e => setSettingExp(e.target.value)}
                className="w-full text-xs border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {d.shareUrl ? (
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white text-xs" onClick={saveSettings} disabled={savingSettings}>
                {savingSettings ? "Saving…" : "Save"}
              </Button>
            ) : (
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white text-xs" onClick={handleShare} disabled={sharing}>
                {sharing ? "Sharing…" : "Share & Generate Link"}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowSettings(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Comments panel */}
      {showComments && (
        <div className="border-t border-zinc-100 px-4 py-3 space-y-2 rounded-b-xl">
          <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wide flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
            Client Comments {commentCount !== null && `(${commentCount})`}
          </p>
          {loadingComments ? (
            <p className="text-xs text-zinc-400 italic">Loading…</p>
          ) : !comments || comments.length === 0 ? (
            <p className="text-xs text-zinc-400 italic">No comments yet.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {comments.map(c => (
                <div key={c.id} className={`rounded-lg p-3 text-xs ${c.body.startsWith("✓ Approved") ? "bg-emerald-50 border border-emerald-100" : "bg-zinc-50 border border-zinc-200"}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-zinc-800">{c.authorName}</span>
                    <div className="flex items-center gap-1 text-zinc-400">
                      {c.timestampSeconds !== null && (
                        <span className="font-mono text-violet-600 bg-violet-50 px-1.5 rounded">
                          {formatTs(c.timestampSeconds)}
                        </span>
                      )}
                      <span>{format(new Date(c.createdAt), "MMM d, HH:mm")}</span>
                    </div>
                  </div>
                  <p className="text-zinc-600 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DeliverablesTab ───────────────────────────────────────────────────────────

function DeliverablesTab({ dealId }: { dealId: number }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingPlanId, setTogglingPlanId] = useState<number | null>(null);

  const { data: deliverablePlans = [], refetch: refetchPlans } = useQuery<DealDeliverablePlan[]>({
    queryKey: ["deliverable-plans", dealId],
    queryFn: async (): Promise<DealDeliverablePlan[]> => {
      if (!token) return [];
      const r = await fetch(`${BASE}/api/deals/${dealId}/plans`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok ? (r.json() as Promise<DealDeliverablePlan[]>) : [];
    },
    enabled: !!token,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const togglePlan = async (planId: number, isCompleted: boolean) => {
    setTogglingPlanId(planId);
    try {
      const r = await fetch(`${BASE}/api/deals/plans/${planId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted }),
      });
      if (r.ok) await refetchPlans();
    } finally {
      setTogglingPlanId(null);
    }
  };

  const { data: deliverables, refetch } = useQuery<any[]>({
    queryKey: ["deliverables", dealId],
    queryFn: async () => {
      if (!token) throw new Error("Not authenticated");
      const r = await fetch(`${BASE}/api/deals/${dealId}/deliverables`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load deliverables");
      return r.json();
    },
    enabled: !!token,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const r = await fetch(`${BASE}/api/deliverables/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        toast({ title: e.error || "Delete failed", variant: "destructive" });
        return;
      }
      await refetch();
      toast({ title: "Deliverable deleted" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleStatusChange = async (id: number, status: string) => {
    const r = await fetch(`${BASE}/api/deliverables/${id}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (r.ok) { await refetch(); toast({ title: "Status updated" }); }
  };

  const handleShareConfig = async () => {
    await refetch();
    toast({ title: "Share settings saved" });
  };

  const handleFileSelect = useCallback(async (file: File) => {
    if (!ALLOWED_MIME.includes(file.type)) {
      toast({ title: "Only video and audio files are supported", variant: "destructive" });
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast({ title: "File must be under 500 MB", variant: "destructive" });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Step 1: server validates MIME/size and returns a presigned upload URL
      const urlRes = await fetch(`${BASE}/api/deals/${dealId}/deliverables/request-upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.ok) {
        const e = await urlRes.json().catch(() => ({}));
        throw new Error(e.error || "Could not get upload URL");
      }
      const { uploadURL, storageKey } = await urlRes.json();
      if (!uploadURL) throw new Error("No upload URL returned");

      // Step 2: upload file directly to GCS via presigned URL
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      // Step 3: confirm upload and save deliverable record
      const saveRes = await fetch(`${BASE}/api/deals/${dealId}/deliverables`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          storageKey,
        }),
      });
      if (!saveRes.ok) {
        const e = await saveRes.json().catch(() => ({}));
        throw new Error(e.error || "Failed to save deliverable record");
      }

      await refetch();
      toast({ title: "File uploaded successfully" });
    } catch (err: any) {
      toast({ title: err.message || "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [dealId, toast, refetch]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  return (
    <div className="p-4 flex flex-col gap-4">

      {/* Planned deliverables from template */}
      {deliverablePlans.length > 0 && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
          <h4 className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5" /> Planned Deliverables
          </h4>
          <div className="flex flex-col gap-2">
            {deliverablePlans.map((plan) => (
              <div key={plan.id} className="flex items-center gap-2.5">
                <button
                  disabled={togglingPlanId === plan.id}
                  onClick={() => togglePlan(plan.id, !plan.isCompleted)}
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                    plan.isCompleted
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "border-violet-300 bg-white hover:border-violet-500"
                  }`}
                >
                  {plan.isCompleted && <Check className="h-2.5 w-2.5" />}
                </button>
                <span className={`text-sm flex-1 ${plan.isCompleted ? "line-through text-zinc-400" : "text-zinc-700"}`}>
                  {plan.deliverableType}
                </span>
                {plan.isCompleted && plan.completedAt && (
                  <span className="text-xs text-zinc-400">{format(new Date(plan.completedAt), "MMM d")}</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-violet-500 mt-3">
            {deliverablePlans.filter((p) => p.isCompleted).length} / {deliverablePlans.length} completed
          </p>
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          uploading ? "border-blue-300 bg-blue-50" : "border-zinc-300 hover:border-zinc-400 bg-zinc-50 hover:bg-zinc-100"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_MIME.join(",")}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
        />
        {uploading ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-blue-700">Uploading… {uploadProgress}%</div>
            <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : (
          <>
            <Upload className="h-7 w-7 text-zinc-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-zinc-700">Drop video or audio here, or click to browse</p>
            <p className="text-xs text-zinc-500 mt-1">MP4, MOV, AVI, WebM, MP3, WAV, AAC, FLAC — up to 500 MB</p>
          </>
        )}
      </div>

      {/* Deliverable list */}
      {deliverables && deliverables.length > 0 ? (
        <div className="flex flex-col gap-3">
          {deliverables.map((d: any) => (
            <DeliverableCard
              key={d.id}
              d={d}
              dealId={dealId}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
              onShareConfig={handleShareConfig}
              deleting={deletingId === d.id}
            />
          ))}
        </div>
      ) : (
        <div className="text-center text-zinc-500 py-6 text-sm italic">
          No deliverables yet. Upload a video or audio file above.
        </div>
      )}
    </div>
  );
}

// ── DealDetailPanel ───────────────────────────────────────────────────────────

// ── TimeLogTab ────────────────────────────────────────────────────────────────

const TIME_CATEGORIES = ["recording", "mixing", "mastering", "video", "admin", "other"] as const;
type TimeCategory = typeof TIME_CATEGORIES[number];

const CATEGORY_LABELS: Record<TimeCategory, string> = {
  recording: "Recording",
  mixing: "Mixing",
  mastering: "Mastering",
  video: "Video",
  admin: "Admin",
  other: "Other",
};

interface TimeEntryRow {
  id: number;
  dealId: number | null;
  userId: number;
  userName: string | null;
  date: string;
  durationMinutes: number;
  category: TimeCategory;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TimeLogData {
  entries: TimeEntryRow[];
  settings: { targetHourlyRate: string; currency: string };
}

function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function TimeLogTab({ dealId, dealValue }: { dealId: number; dealValue: number | null }) {
  const { toast } = useToast();
  const { token } = useAuth();
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const { data: users } = useAdminListUsers();

  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};
  const isPrivileged = me?.role === "admin" || me?.role === "manager";

  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [deleteTimeId, setDeleteTimeId] = useState<number | null>(null);

  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formHours, setFormHours] = useState("1");
  const [formMinutes, setFormMinutes] = useState("0");
  const [formCategory, setFormCategory] = useState<TimeCategory>("other");
  const [formDescription, setFormDescription] = useState("");
  const [formUserId, setFormUserId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data, refetch, isLoading } = useQuery<TimeLogData>({
    queryKey: ["time-entries", dealId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/deals/${dealId}/time`, { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const openCreate = () => {
    setEditingEntry(null);
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormHours("1");
    setFormMinutes("0");
    setFormCategory("other");
    setFormDescription("");
    setFormUserId(me?.id ? String(me.id) : "");
    setShowForm(true);
  };

  const openEdit = (entry: TimeEntryRow) => {
    setEditingEntry(entry);
    setFormDate(entry.date);
    setFormHours(String(Math.floor(entry.durationMinutes / 60)));
    setFormMinutes(String(entry.durationMinutes % 60));
    setFormCategory(entry.category);
    setFormDescription(entry.description ?? "");
    setFormUserId(String(entry.userId));
    setShowForm(true);
  };

  const handleSave = async () => {
    const hours = parseInt(formHours) || 0;
    const mins = parseInt(formMinutes) || 0;
    const durationMinutes = hours * 60 + mins;
    if (durationMinutes <= 0) { toast({ title: "Duration must be greater than 0", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const body = {
        date: formDate,
        durationMinutes,
        category: formCategory,
        description: formDescription || null,
        userId: formUserId ? Number(formUserId) : undefined,
      };

      let r: Response;
      if (editingEntry) {
        r = await fetch(`${BASE}/api/time/${editingEntry.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authH(token) },
          body: JSON.stringify(body),
        });
      } else {
        r = await fetch(`${BASE}/api/deals/${dealId}/time`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authH(token) },
          body: JSON.stringify(body),
        });
      }

      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }

      await refetch();
      toast({ title: editingEntry ? "Time entry updated" : "Time logged" });
      setShowForm(false);
    } catch (err: any) {
      toast({ title: err.message || "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const r = await fetch(`${BASE}/api/time/${id}`, {
      method: "DELETE",
      headers: authH(token),
    });
    if (r.ok) {
      await refetch();
      toast({ title: "Entry deleted" });
    } else {
      toast({ title: "Delete failed", variant: "destructive" });
    }
    setDeleteTimeId(null);
  };

  const entries = data?.entries ?? [];
  const settings = data?.settings;
  const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  const totalHours = totalMinutes / 60;
  const targetRate = Number(settings?.targetHourlyRate ?? 100);
  const effectiveRate = totalHours > 0 && dealValue ? dealValue / totalHours : null;

  let rateColor = "text-emerald-600";
  let rateLabel = "On track";
  if (effectiveRate !== null) {
    if (effectiveRate < targetRate * 0.5) { rateColor = "text-red-600"; rateLabel = "Over budget"; }
    else if (effectiveRate < targetRate * 0.8) { rateColor = "text-amber-600"; rateLabel = "Approaching limit"; }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Log Time Button */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-700">Time Entries</p>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Log Time
        </Button>
      </div>

      {/* Log time form */}
      {showForm && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-zinc-800">{editingEntry ? "Edit Entry" : "Log Time"}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Date</label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Category</label>
              <select
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value as TimeCategory)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {TIME_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Hours</label>
              <input
                type="number"
                min="0"
                max="24"
                value={formHours}
                onChange={(e) => setFormHours(e.target.value)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-500">Minutes</label>
              <input
                type="number"
                min="0"
                max="59"
                value={formMinutes}
                onChange={(e) => setFormMinutes(e.target.value)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Staff member</label>
            {isPrivileged && users ? (
              <select
                value={formUserId}
                onChange={(e) => setFormUserId(e.target.value)}
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            ) : (
              <div className="w-full text-sm border border-zinc-100 rounded-lg px-3 py-2 bg-zinc-50 text-zinc-600">
                {me?.name ?? "You"} <span className="text-zinc-400 text-xs">(defaults to you)</span>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Description (optional)</label>
            <textarea
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={2}
              placeholder="What was done?"
              className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editingEntry ? "Update" : "Log Time"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Entries list */}
      {isLoading ? (
        <div className="text-center py-6 text-sm text-zinc-400">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-sm text-zinc-400 italic">
          No time entries yet. Click "Log Time" to add the first one.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const canEdit = entry.userId === me?.id || isPrivileged;
            return (
              <div key={entry.id} className="bg-white border border-zinc-200 rounded-lg px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {fmtDuration(entry.durationMinutes)}
                    </span>
                    <span className="text-xs text-zinc-500 capitalize">{CATEGORY_LABELS[entry.category]}</span>
                    <span className="text-xs text-zinc-400">{entry.date}</span>
                    {entry.userName && <span className="text-xs text-zinc-400">· {entry.userName}</span>}
                  </div>
                  {entry.description && (
                    <p className="text-xs text-zinc-600 mt-1 line-clamp-2">{entry.description}</p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => openEdit(entry)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTimeId(entry.id)}
                      className="p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: totals + profitability */}
      {entries.length > 0 && (
        <div className="border-t border-zinc-200 pt-3 mt-1 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Total logged</span>
            <span className="font-semibold">{fmtDuration(totalMinutes)}</span>
          </div>
          {dealValue && effectiveRate !== null ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Effective rate</span>
                <span className={`font-semibold ${rateColor}`}>${effectiveRate.toFixed(0)}/hr</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Target rate</span>
                <span className="text-zinc-600">${targetRate}/hr</span>
              </div>
              {/* Profitability bar */}
              <div>
                <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                  <span>Profitability</span>
                  <span className={rateColor}>{rateLabel}</span>
                </div>
                <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      effectiveRate >= targetRate ? "bg-emerald-500" :
                      effectiveRate >= targetRate * 0.8 ? "bg-amber-400" : "bg-red-400"
                    }`}
                    style={{ width: `${Math.min(100, (effectiveRate / targetRate) * 100)}%` }}
                  />
                </div>
              </div>
            </>
          ) : dealValue === null ? (
            <p className="text-xs text-zinc-400 italic">Set a deal value to see profitability</p>
          ) : null}
        </div>
      )}

      <AlertDialog open={deleteTimeId !== null} onOpenChange={open => { if (!open) setDeleteTimeId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete time entry?</AlertDialogTitle>
            <AlertDialogDescription>This entry will be permanently removed from this deal's log.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTimeId && handleDelete(deleteTimeId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── DealDetailPanel ───────────────────────────────────────────────────────────

function isNoteVideo(name: string) {
  return /\.(mp4|mov|webm|avi|mkv|mpeg?)$/i.test(name);
}

function DealDetailPanel({ id, onClose }: { id: number, onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { token } = useAuth();
  const { data: deal, isLoading } = useGetDeal(id);
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const isAdmin = me?.role === "owner" || me?.role === "admin" || me?.role === "manager" || me?.permissions?.["deals:delete"] === true;

  const deleteDeal = useDeleteDeal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDealsQueryKey() });
        toast({ title: "Deal deleted" });
        onClose();
      },
      onError: () => toast({ title: "Failed to delete deal", variant: "destructive" }),
    },
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const [activeTab, setActiveTab] = useState<"activity" | "deliverables" | "time">("activity");
  const [noteContent, setNoteContent] = useState("");
  const [pendingNoteFile, setPendingNoteFile] = useState<File | null>(null);
  const [noteUploading, setNoteUploading] = useState(false);
  const noteFileInputRef = useRef<HTMLInputElement>(null);

  const addNote = useAddDealNote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/deals", id] });
        setNoteContent("");
        setPendingNoteFile(null);
        toast({ title: "Note added" });
      }
    }
  });

  const handleAddNote = async () => {
    if (!noteContent.trim() && !pendingNoteFile) return;
    let fileUrl: string | undefined;
    let fileName: string | undefined;
    if (pendingNoteFile) {
      setNoteUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", pendingNoteFile);
        const r = await fetch(`${BASE}/api/files/upload`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
        if (!r.ok) throw new Error("Upload failed");
        const data = await r.json() as { url: string; name: string };
        fileUrl = data.url;
        fileName = data.name;
      } catch {
        toast({ title: "File upload failed", variant: "destructive" });
        setNoteUploading(false);
        return;
      }
      setNoteUploading(false);
    }
    addNote.mutate({ id, data: { content: noteContent, fileUrl, fileName } as Parameters<typeof addNote.mutate>[0]["data"] });
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white shadow-2xl border-l border-zinc-200 z-40 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between p-6 border-b border-zinc-100 shrink-0">
        <h2 className="text-lg font-semibold">Deal Details</h2>
        <div className="flex items-center gap-1">
          {isAdmin && !isLoading && deal && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
              title="Delete deal"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading || !deal ? (
          <div className="text-center text-zinc-500 py-8">Loading details...</div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Deal meta */}
            <div className="p-6 space-y-6 shrink-0">
              <div>
                <Badge variant="outline" className="mb-3 uppercase tracking-wider text-xs">
                  {STAGE_LABELS[deal.stage as Stage] || deal.stage}
                </Badge>
                <h3 className="text-2xl font-bold text-zinc-900">{deal.title}</h3>
                <div className="text-xl font-medium text-zinc-600 mt-2">
                  {deal.value ? `$${deal.value.toLocaleString()}` : 'No value set'}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-2">
                <PriorityBadge priority={deal.priority} />
                {deal.expectedCloseDate && <CloseDateBadge dateStr={deal.expectedCloseDate} />}
              </div>

              <div className="grid grid-cols-2 gap-4 py-4 border-y border-zinc-100">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Contact</div>
                  <div className="font-medium text-sm flex items-center">
                    <UserCircle2 className="h-4 w-4 mr-1.5 text-zinc-400" />
                    {deal.contactName || "None"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Assigned To</div>
                  <div className="font-medium text-sm">
                    {deal.assignedToName || "Unassigned"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Priority</div>
                  <div className="font-medium text-sm">
                    <PriorityBadge priority={deal.priority} />
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Expected Close</div>
                  <div className="font-medium text-sm text-zinc-700">
                    {deal.expectedCloseDate
                      ? format(parseISO(deal.expectedCloseDate), "MMM d, yyyy")
                      : <span className="text-zinc-400 font-normal">Not set</span>}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Created</div>
                  <div className="font-medium text-sm">
                    {format(new Date(deal.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
              </div>

              {deal.notes && (
                <div>
                  <h4 className="font-medium text-sm text-zinc-900 mb-2">Deal Notes</h4>
                  <div className="bg-zinc-50 p-4 rounded-lg text-sm text-zinc-700 whitespace-pre-wrap border border-zinc-200">
                    {deal.notes}
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex-1 bg-zinc-50 border-t border-zinc-200 flex flex-col">
              <div className="flex border-b border-zinc-200 bg-white shrink-0">
                <button
                  onClick={() => setActiveTab("activity")}
                  className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    activeTab === "activity"
                      ? "border-b-2 border-zinc-900 text-zinc-900"
                      : "text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Activity
                </button>
                <button
                  onClick={() => setActiveTab("deliverables")}
                  className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    activeTab === "deliverables"
                      ? "border-b-2 border-violet-600 text-violet-700"
                      : "text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  <Film className="h-3.5 w-3.5" /> Deliverables
                </button>
                <button
                  onClick={() => setActiveTab("time")}
                  className={`flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
                    activeTab === "time"
                      ? "border-b-2 border-indigo-600 text-indigo-700"
                      : "text-zinc-500 hover:text-zinc-700"
                  }`}
                >
                  <Clock className="h-3.5 w-3.5" /> Time Log
                </button>
              </div>

              {activeTab === "activity" && (
                <>
                  <div className="p-4 bg-white border-b border-zinc-200 shrink-0 space-y-2">
                    {pendingNoteFile && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 rounded-lg text-sm border border-zinc-200">
                        {isNoteVideo(pendingNoteFile.name) || pendingNoteFile.type.startsWith("video/") ? (
                          <Film className="h-4 w-4 text-blue-500 shrink-0" />
                        ) : (
                          <Upload className="h-4 w-4 text-zinc-400 shrink-0" />
                        )}
                        <span className="truncate flex-1 text-xs text-zinc-700">{pendingNoteFile.name}</span>
                        <button onClick={() => setPendingNoteFile(null)} className="text-zinc-400 hover:text-zinc-700">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        ref={noteFileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*,.pdf,.doc,.docx,.txt,audio/*,video/*,.mp4,.mov,.webm,.avi,.mkv"
                        onChange={(e) => setPendingNoteFile(e.target.files?.[0] ?? null)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 shrink-0 text-zinc-400 hover:text-zinc-700"
                        onClick={() => noteFileInputRef.current?.click()}
                        title="Attach file or video"
                      >
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Input 
                        placeholder={pendingNoteFile ? "Add a caption (optional)…" : "Add a note or attach a video…"}
                        value={noteContent}
                        onChange={(e) => setNoteContent(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddNote();
                          }
                        }}
                      />
                      <Button 
                        onClick={handleAddNote} 
                        disabled={(!noteContent.trim() && !pendingNoteFile) || addNote.isPending || noteUploading}
                        size="icon"
                      >
                        {noteUploading || addNote.isPending
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <ArrowRight className="h-4 w-4" />
                        }
                      </Button>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-4 flex-1 overflow-y-auto">
                    {deal.dealNotes && deal.dealNotes.length > 0 ? (
                      deal.dealNotes.map((note: any) => (
                        <div key={note.id} className="bg-white rounded-lg border border-zinc-200 shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-4 pt-3 pb-2">
                            <span className="font-medium text-sm text-zinc-900">{note.authorName}</span>
                            <span className="text-xs text-zinc-400">{format(new Date(note.createdAt), "MMM d, HH:mm")}</span>
                          </div>
                          {note.content && (
                            <p className="text-sm text-zinc-700 whitespace-pre-wrap px-4 pb-3">{note.content}</p>
                          )}
                          {note.fileUrl && note.fileName && (
                            isNoteVideo(note.fileName) ? (
                              <div className="border-t border-zinc-100 bg-black">
                                <video
                                  src={note.fileUrl}
                                  controls
                                  preload="metadata"
                                  className="w-full max-h-56"
                                />
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900">
                                  <Film className="h-3 w-3 text-zinc-400 shrink-0" />
                                  <span className="text-xs text-zinc-300 truncate flex-1">{note.fileName}</span>
                                  <a href={note.fileUrl} download={note.fileName} target="_blank" rel="noreferrer"
                                    className="text-zinc-400 hover:text-white p-1">
                                    <Download className="h-3 w-3" />
                                  </a>
                                </div>
                              </div>
                            ) : (
                              <div className="border-t border-zinc-100 flex items-center gap-2 px-4 py-2 bg-zinc-50">
                                <Upload className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                                <span className="text-xs text-zinc-600 truncate flex-1">{note.fileName}</span>
                                <a href={note.fileUrl} download={note.fileName} target="_blank" rel="noreferrer"
                                  className="text-zinc-400 hover:text-zinc-700 p-1">
                                  <Download className="h-3 w-3" />
                                </a>
                              </div>
                            )
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center text-zinc-500 py-8 text-sm italic">
                        No notes yet. Add one above.
                      </div>
                    )}
                  </div>
                </>
              )}

              {activeTab === "deliverables" && (
                <div className="flex-1 overflow-y-auto">
                  <DeliverablesTab dealId={id} />
                </div>
              )}

              {activeTab === "time" && (
                <div className="flex-1 overflow-y-auto">
                  <TimeLogTab dealId={id} dealValue={deal.value ? Number(deal.value) : null} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete deal?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deal?.title}</strong> and all its notes, deliverables, and time entries will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteDeal.mutate({ id })}
              disabled={deleteDeal.isPending}
            >
              {deleteDeal.isPending ? "Deleting…" : "Delete deal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Deal Templates Modal ───────────────────────────────────────────────────────

const TEMPLATE_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;

interface DealTemplatesModalProps {
  templates: DealTemplate[];
  token: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

function DealTemplatesModal({ templates, token, onClose, onRefresh }: DealTemplatesModalProps) {
  const { toast } = useToast();
  const authH: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const EMPTY_FORM = { name: "", description: "", defaultValue: "", defaultStage: "lead", deliverableTypes: "", estimatedHours: "" };
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<DealTemplate | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(t: DealTemplate) {
    setEditing(t);
    setForm({
      name:             t.name,
      description:      t.description ?? "",
      defaultValue:     t.defaultValue ?? "",
      defaultStage:     t.defaultStage,
      deliverableTypes: t.deliverableTypes.join(", "),
      estimatedHours:   t.estimatedHours != null ? String(t.estimatedHours) : "",
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name:             form.name.trim(),
        description:      form.description.trim() || null,
        defaultValue:     form.defaultValue ? Number(form.defaultValue) : null,
        defaultStage:     form.defaultStage,
        deliverableTypes: form.deliverableTypes.split(",").map(s => s.trim()).filter(Boolean),
        estimatedHours:   form.estimatedHours ? Number(form.estimatedHours) : null,
      };
      const url  = editing ? `/api/deal-templates/${editing.id}` : "/api/deal-templates";
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
      const r = await fetch(`/api/deal-templates/${id}`, { method: "DELETE", headers: authH });
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
            <Layers className="h-5 w-5 text-violet-600" />
            <h2 className="text-lg font-semibold">Deal Templates</h2>
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
            <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-violet-800">{editing ? "Edit Template" : "New Template"}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-zinc-700">Template Name *</label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard Mix Package" className="h-9" />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-zinc-700">Description</label>
                  <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What's included…" className="h-9" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700">Default Value ($)</label>
                  <Input type="number" value={form.defaultValue} onChange={e => setForm(f => ({ ...f, defaultValue: e.target.value }))} placeholder="5000" className="h-9" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700">Default Stage</label>
                  <Select value={form.defaultStage} onValueChange={v => setForm(f => ({ ...f, defaultStage: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_STAGES.map(s => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-zinc-700">Expected Deliverables (comma-separated)</label>
                  <Input value={form.deliverableTypes} onChange={e => setForm(f => ({ ...f, deliverableTypes: e.target.value }))} placeholder="Mix, Master, Stems, Artwork" className="h-9" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700">Estimated Hours</label>
                  <Input type="number" value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))} placeholder="20" className="h-9" />
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
              <p className="text-zinc-500 text-sm">No templates yet.</p>
              <p className="text-zinc-400 text-xs mt-1">Create one to speed up deal creation.</p>
            </div>
          )}

          {templates.map(t => (
            <div key={t.id} className="rounded-xl border border-zinc-200 bg-white p-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{t.name}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">{STAGE_LABELS[t.defaultStage as Stage] ?? t.defaultStage}</span>
                  {t.defaultValue && <span className="text-xs text-emerald-700 font-medium">${Number(t.defaultValue).toLocaleString()}</span>}
                  {t.estimatedHours && <span className="text-xs text-zinc-500">{t.estimatedHours}h est.</span>}
                </div>
                {t.description && <p className="text-xs text-zinc-500 mt-1">{t.description}</p>}
                {t.deliverableTypes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.deliverableTypes.map(d => (
                      <span key={d} className="text-xs px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-100">{d}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => openEdit(t)}>
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
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
