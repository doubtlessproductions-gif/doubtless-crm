import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Zap, Plus, Trash2, ChevronRight, Play, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Condition { field: string; operator: string; value: string; }
interface Action    { type: string; config: Record<string, string>; }
interface Automation {
  id: number; name: string; description: string | null; trigger: string;
  triggerConfig: Record<string, unknown>; conditions: Condition[]; actions: Action[];
  enabled: boolean; runCount: number; lastRunAt: string | null; createdAt: string;
  updatedAt: string; creatorName: string | null;
}
interface AutomationRun {
  id: number; automationId: number; trigger: string; actionsRun: number;
  status: string; error: string | null; createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TRIGGERS = [
  { value: "deal.created",          label: "Deal Created" },
  { value: "deal.stage_changed",    label: "Deal Stage Changed" },
  { value: "deal.updated",          label: "Deal Updated" },
  { value: "contact.created",       label: "Contact Created" },
  { value: "invoice.paid",          label: "Invoice Paid" },
  { value: "form.submitted",        label: "Form Submitted" },
  { value: "release.scheduled",     label: "Release Scheduled" },
  { value: "project.status_changed",label: "Project Status Changed" },
  { value: "project.created",       label: "Project Created" },
];

const OPERATORS = [
  { value: "equals",      label: "equals" },
  { value: "not_equals",  label: "does not equal" },
  { value: "contains",    label: "contains" },
  { value: "gt",          label: "greater than" },
  { value: "lt",          label: "less than" },
  { value: "is_set",      label: "is set" },
  { value: "is_empty",    label: "is empty" },
];

const ACTIONS = [
  { value: "add_note",         label: "Add Note to Deal" },
  { value: "update_stage",     label: "Update Deal Stage" },
  { value: "create_activity",  label: "Create Activity Log" },
  { value: "add_tag",          label: "Add Tag to Contact" },
  { value: "send_email",       label: "Send Email Notification" },
  { value: "send_notification",label: "Send In-App Notification" },
];

const DEAL_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"];

function ActionConfigFields({ action, onChange }: { action: Action; onChange: (c: Record<string, string>) => void }) {
  const c = action.config;
  switch (action.type) {
    case "add_note": return (
      <div>
        <Label className="text-xs mb-1">Note Content</Label>
        <Textarea value={c.content ?? ""} onChange={(e) => onChange({ ...c, content: e.target.value })} placeholder="Note to add…" rows={2} />
      </div>
    );
    case "update_stage": return (
      <div>
        <Label className="text-xs mb-1">New Stage</Label>
        <Select value={c.stage ?? ""} onValueChange={(v) => onChange({ ...c, stage: v })}>
          <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
          <SelectContent>{DEAL_STAGES.map((s) => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    );
    case "create_activity": return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs mb-1">Activity Type</Label>
          <Input value={c.activityType ?? ""} onChange={(e) => onChange({ ...c, activityType: e.target.value })} placeholder="e.g. follow_up" />
        </div>
        <div>
          <Label className="text-xs mb-1">Description</Label>
          <Input value={c.description ?? ""} onChange={(e) => onChange({ ...c, description: e.target.value })} placeholder="Activity description…" />
        </div>
      </div>
    );
    case "add_tag": return (
      <div>
        <Label className="text-xs mb-1">Tag</Label>
        <Input value={c.tag ?? ""} onChange={(e) => onChange({ ...c, tag: e.target.value })} placeholder="e.g. vip" />
      </div>
    );
    case "send_email": return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs mb-1">Subject</Label>
          <Input value={c.subject ?? ""} onChange={(e) => onChange({ ...c, subject: e.target.value })} placeholder="Email subject…" />
        </div>
        <div>
          <Label className="text-xs mb-1">Body</Label>
          <Textarea value={c.body ?? ""} onChange={(e) => onChange({ ...c, body: e.target.value })} placeholder="Email body…" rows={2} />
        </div>
      </div>
    );
    case "send_notification": return (
      <div className="space-y-2">
        <div>
          <Label className="text-xs mb-1">Title</Label>
          <Input value={c.title ?? ""} onChange={(e) => onChange({ ...c, title: e.target.value })} placeholder="Notification title…" />
        </div>
        <div>
          <Label className="text-xs mb-1">Body</Label>
          <Input value={c.body ?? ""} onChange={(e) => onChange({ ...c, body: e.target.value })} placeholder="Notification message…" />
        </div>
      </div>
    );
    default: return null;
  }
}

// ── Builder Dialog ────────────────────────────────────────────────────────────

function AutomationDialog({
  open, onClose, initial,
}: { open: boolean; onClose: () => void; initial?: Automation | null }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const [name, setName]               = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [trigger, setTrigger]         = useState(initial?.trigger ?? "");
  const [conditions, setConditions]   = useState<Condition[]>(initial?.conditions ?? []);
  const [actions, setActions]         = useState<Action[]>(initial?.actions ?? [{ type: "", config: {} }]);
  const [saving, setSaving]           = useState(false);

  function addCondition() { setConditions([...conditions, { field: "", operator: "equals", value: "" }]); }
  function removeCondition(i: number) { setConditions(conditions.filter((_, idx) => idx !== i)); }
  function updateCondition(i: number, patch: Partial<Condition>) {
    setConditions(conditions.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  }

  function addAction() { setActions([...actions, { type: "", config: {} }]); }
  function removeAction(i: number) { setActions(actions.filter((_, idx) => idx !== i)); }
  function updateAction(i: number, patch: Partial<Action>) {
    setActions(actions.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  }

  async function handleSave() {
    if (!name.trim() || !trigger || actions.every((a) => !a.type)) {
      toast({ title: "Name, trigger, and at least one action required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const url    = initial ? `/api/automations/${initial.id}` : "/api/automations";
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, trigger, conditions, actions: actions.filter((a) => a.type) }),
      });
      if (!res.ok) throw new Error();
      toast({ title: initial ? "Automation updated" : "Automation created" });
      qc.invalidateQueries({ queryKey: ["automations"] });
      onClose();
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Automation" : "New Automation"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Notify on deal won" className="mt-1" />
            </div>
            <div className="col-span-2">
              <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this automation do?" className="mt-1" />
            </div>
          </div>

          <Separator />

          <div>
            <Label className="flex items-center gap-1.5 mb-2"><Zap className="h-3.5 w-3.5 text-yellow-500" /> Trigger</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger><SelectValue placeholder="When this happens…" /></SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm">Conditions <span className="text-xs text-muted-foreground font-normal">(all must match)</span></Label>
              <Button variant="outline" size="sm" onClick={addCondition} className="h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {conditions.length === 0 && (
              <p className="text-xs text-muted-foreground py-2">No conditions — automation runs on every trigger.</p>
            )}
            {conditions.map((c, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <Input value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })} placeholder="Field (e.g. deal.stage)" className="h-8 text-sm flex-1" />
                <Select value={c.operator} onValueChange={(v) => updateCondition(i, { operator: v })}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERATORS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input value={c.value} onChange={(e) => updateCondition(i, { value: e.target.value })} placeholder="Value" className="h-8 text-sm w-32" />
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeCondition(i)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm">Actions <span className="text-xs text-muted-foreground font-normal">(run in order)</span></Label>
              <Button variant="outline" size="sm" onClick={addAction} className="h-7 text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {actions.map((a, i) => (
              <div key={i} className="border border-zinc-200 rounded-lg p-3 mb-2 bg-zinc-50 space-y-2">
                <div className="flex gap-2 items-center">
                  <div className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 text-xs flex items-center justify-center font-bold shrink-0">{i + 1}</div>
                  <Select value={a.type} onValueChange={(v) => updateAction(i, { type: v, config: {} })}>
                    <SelectTrigger className="h-8 text-sm flex-1"><SelectValue placeholder="Choose action…" /></SelectTrigger>
                    <SelectContent>{ACTIONS.map((ac) => <SelectItem key={ac.value} value={ac.value}>{ac.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeAction(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                {a.type && <ActionConfigFields action={a} onChange={(c) => updateAction(i, { config: c })} />}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : initial ? "Update" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Run History ───────────────────────────────────────────────────────────────

function RunHistoryDialog({ open, onClose, automation }: { open: boolean; onClose: () => void; automation: Automation }) {
  const { token } = useAuth();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};
  const { data: runs = [], isLoading } = useQuery<AutomationRun[]>({
    queryKey: ["automation-runs", automation.id],
    queryFn: () => fetch(`/api/automations/${automation.id}/runs`, { headers: authH(token) }).then((r) => r.json()),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run History — {automation.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          : runs.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No runs yet.</div>
          : (
            <div className="space-y-1.5">
              {runs.map((run) => (
                <div key={run.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-50 border text-sm">
                  {run.status === "success"  && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                  {run.status === "partial"  && <AlertCircle  className="h-4 w-4 text-yellow-500 shrink-0" />}
                  {run.status === "failed"   && <XCircle      className="h-4 w-4 text-red-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs">{format(new Date(run.createdAt), "MMM d, HH:mm:ss")}</p>
                    <p className="text-xs text-muted-foreground">{run.actionsRun} action{run.actionsRun !== 1 ? "s" : ""} ran · trigger: {run.trigger}</p>
                    {run.error && <p className="text-xs text-red-600 mt-0.5">{run.error}</p>}
                  </div>
                  <Badge variant={run.status === "success" ? "default" : run.status === "partial" ? "secondary" : "destructive"} className="text-[10px]">
                    {run.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AutomationsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing]         = useState<Automation | null>(null);
  const [viewRuns, setViewRuns]       = useState<Automation | null>(null);

  const { data: automations = [], isLoading } = useQuery<Automation[]>({
    queryKey: ["automations"],
    queryFn: () => fetch("/api/automations", { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
    staleTime: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/automations/${id}/toggle`, { method: "PATCH", headers: authH(token) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/automations/${id}`, { method: "DELETE", headers: authH(token) }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations"] });
      toast({ title: "Automation deleted" });
    },
  });

  function openNew()             { setEditing(null); setBuilderOpen(true); }
  function openEdit(a: Automation) { setEditing(a);  setBuilderOpen(true); }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-yellow-500" />
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">Automations</h1>
          <span className="text-sm text-muted-foreground">({automations.length} total)</span>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New Automation
        </Button>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : automations.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Zap className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-muted-foreground text-sm">No automations yet. Create your first IF/THEN rule.</p>
            <Button onClick={openNew} variant="outline" size="sm"><Plus className="h-4 w-4 mr-1" /> Create automation</Button>
          </div>
        ) : (
          <div className="divide-y">
            {automations.map((auto) => {
              const trigger = TRIGGERS.find((t) => t.value === auto.trigger);
              return (
                <div key={auto.id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 transition-colors">
                  <Switch
                    checked={auto.enabled}
                    onCheckedChange={() => toggleMutation.mutate(auto.id)}
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{auto.name}</p>
                      {!auto.enabled && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
                    </div>
                    {auto.description && <p className="text-xs text-muted-foreground mt-0.5">{auto.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Zap className="h-3 w-3 text-yellow-400" />
                        {trigger?.label ?? auto.trigger}
                      </span>
                      <ChevronRight className="h-3 w-3" />
                      <span>{auto.actions.length} action{auto.actions.length !== 1 ? "s" : ""}</span>
                      {auto.conditions.length > 0 && <span>· {auto.conditions.length} condition{auto.conditions.length !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs text-muted-foreground space-y-0.5">
                    <div className="flex items-center gap-1 justify-end">
                      <Play className="h-3 w-3" /> {auto.runCount.toLocaleString()} runs
                    </div>
                    {auto.lastRunAt && (
                      <div className="flex items-center gap-1 justify-end">
                        <Clock className="h-3 w-3" /> {format(new Date(auto.lastRunAt), "MMM d, HH:mm")}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setViewRuns(auto)}>History</Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => openEdit(auto)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => deleteMutation.mutate(auto.id)}>Delete</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AutomationDialog
        open={builderOpen}
        onClose={() => { setBuilderOpen(false); setEditing(null); }}
        initial={editing}
      />
      {viewRuns && (
        <RunHistoryDialog open={!!viewRuns} onClose={() => setViewRuns(null)} automation={viewRuns} />
      )}
    </div>
  );
}
