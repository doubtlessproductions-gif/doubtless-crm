import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { CreditCard, Plus, Pencil, Trash2, CheckCircle2, X, Users } from "lucide-react";
import { format } from "date-fns";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Plan {
  id: number; name: string; description: string | null; priceMonthly: string;
  priceYearly: string | null; features: string[]; isActive: boolean; stripeProductId: string | null;
}

interface ClientSub {
  id: number; contactId: number; contactName: string | null; contactEmail: string | null;
  planId: number; planName: string | null; priceMonthly: string | null;
  status: string; interval: string; currentPeriodStart: string | null;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; notes: string | null;
  createdAt: string; stripeSubscriptionId: string | null;
}

interface Contact { id: number; name: string; email: string | null; }

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active")   return "default";
  if (status === "past_due") return "destructive";
  if (status === "paused")   return "secondary";
  return "outline";
}

// ── Plan Dialog ───────────────────────────────────────────────────────────────
function PlanDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Plan | null }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const [name, setName]               = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priceMonthly, setMonthly]    = useState(initial?.priceMonthly ?? "0.00");
  const [priceYearly, setYearly]      = useState(initial?.priceYearly ?? "");
  const [featureInput, setFeatureInput] = useState("");
  const [features, setFeatures]       = useState<string[]>(initial?.features ?? []);
  const [saving, setSaving]           = useState(false);

  function addFeature() {
    const f = featureInput.trim();
    if (f && !features.includes(f)) { setFeatures([...features, f]); setFeatureInput(""); }
  }

  async function handleSave() {
    if (!name.trim() || !priceMonthly) { toast({ title: "Name and monthly price required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const url    = initial ? `/api/subscriptions/plans/${initial.id}` : "/api/subscriptions/plans";
      const method = initial ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, priceMonthly, priceYearly: priceYearly || undefined, features }),
      });
      if (!res.ok) throw new Error();
      toast({ title: initial ? "Plan updated" : "Plan created" });
      qc.invalidateQueries({ queryKey: ["sub-plans"] });
      onClose();
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial ? "Edit Plan" : "New Plan"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Plan Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Artist Essentials" className="mt-1" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's included…" rows={2} className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Monthly Price ($)</Label>
              <Input value={priceMonthly} onChange={(e) => setMonthly(e.target.value)} placeholder="99.00" type="number" step="0.01" min="0" className="mt-1" />
            </div>
            <div>
              <Label>Yearly Price ($) <span className="text-muted-foreground text-xs">optional</span></Label>
              <Input value={priceYearly} onChange={(e) => setYearly(e.target.value)} placeholder="990.00" type="number" step="0.01" min="0" className="mt-1" />
            </div>
          </div>
          <div>
            <Label>Features</Label>
            <div className="flex gap-2 mt-1">
              <Input value={featureInput} onChange={(e) => setFeatureInput(e.target.value)} placeholder="e.g. Unlimited downloads" onKeyDown={(e) => e.key === "Enter" && addFeature()} />
              <Button variant="outline" onClick={addFeature}>Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {features.map((f, i) => (
                <Badge key={i} variant="secondary" className="gap-1 pl-2 pr-1">
                  {f}
                  <button onClick={() => setFeatures(features.filter((_, idx) => idx !== i))} className="hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
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

// ── Subscribe Dialog ──────────────────────────────────────────────────────────
function SubscribeDialog({ open, onClose, plans }: { open: boolean; onClose: () => void; plans: Plan[] }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts-list"],
    queryFn: () => fetch("/api/contacts", { headers: authH(token) }).then((r) => r.json()),
    enabled: open,
    select: (data: unknown) => {
      if (Array.isArray(data)) return data;
      if (data && typeof data === "object" && "contacts" in data) return (data as { contacts: Contact[] }).contacts;
      return [];
    },
  });

  const [contactId, setContactId] = useState("");
  const [planId, setPlanId]       = useState("");
  const [interval, setInterval_]  = useState("monthly");
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);

  async function handleSave() {
    if (!contactId || !planId) { toast({ title: "Select a contact and plan", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ contactId: Number(contactId), planId: Number(planId), interval, notes: notes.trim() || undefined }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Subscription created" });
      qc.invalidateQueries({ queryKey: ["client-subs"] });
      onClose();
    } catch { toast({ title: "Failed to create subscription", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Subscription</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Client / Contact</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select contact…" /></SelectTrigger>
              <SelectContent>
                {contacts.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name} {c.email ? `(${c.email})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select plan…" /></SelectTrigger>
              <SelectContent>
                {plans.filter((p) => p.isActive).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name} — ${p.priceMonthly}/mo</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Billing Interval</Label>
            <Select value={interval} onValueChange={setInterval_}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes <span className="text-muted-foreground text-xs">optional</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes…" rows={2} className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Creating…" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SubscriptionsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};
  const search = useSearch();

  // Read ?status= URL param to pre-filter (e.g. /subscriptions?status=active)
  const statusFilter = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("status") ?? "";
  }, [search]);

  const [planDialogOpen, setPlanDialogOpen]    = useState(false);
  const [editingPlan, setEditingPlan]          = useState<Plan | null>(null);
  const [subDialogOpen, setSubDialogOpen]      = useState(false);

  const { data: plans = [], isLoading: plansLoading } = useQuery<Plan[]>({
    queryKey: ["sub-plans"],
    queryFn: () => fetch("/api/subscriptions/plans", { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
  });

  const { data: subs = [], isLoading: subsLoading } = useQuery<ClientSub[]>({
    queryKey: ["client-subs"],
    queryFn: () => fetch("/api/subscriptions", { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      fetch(`/api/subscriptions/${id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authH(token) }, body: JSON.stringify({ status }) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-subs"] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/subscriptions/${id}`, { method: "DELETE", headers: authH(token) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["client-subs"] }); toast({ title: "Subscription cancelled" }); },
  });

  const deletePlanMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/subscriptions/plans/${id}`, { method: "DELETE", headers: authH(token) }).then((r) => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sub-plans"] }); toast({ title: "Plan deactivated" }); },
  });

  const activeSubs   = subs.filter((s) => s.status === "active").length;
  const totalRevenue = subs.filter((s) => s.status === "active").reduce((acc, s) => acc + parseFloat(s.priceMonthly ?? "0"), 0);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-green-500" />
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">Subscriptions & Retainers</h1>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Active Subscriptions</p>
          <p className="text-2xl font-bold mt-1">{activeSubs}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Monthly Revenue (est.)</p>
          <p className="text-2xl font-bold mt-1">${totalRevenue.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Plans Available</p>
          <p className="text-2xl font-bold mt-1">{plans.filter((p) => p.isActive).length}</p>
        </div>
      </div>

      <Tabs defaultValue="clients">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <div className="overflow-x-auto flex-1 min-w-0">
            <TabsList className="w-max">
              <TabsTrigger value="clients" className="gap-1.5 shrink-0"><Users className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Client </span>Subscriptions</TabsTrigger>
              <TabsTrigger value="plans"   className="gap-1.5 shrink-0"><CreditCard className="h-3.5 w-3.5" /> Plans</TabsTrigger>
            </TabsList>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => setSubDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add Subscription</Button>
          </div>
        </div>

        <TabsContent value="clients" className="mt-4">
          <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
            {subsLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
            ) : subs.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <CreditCard className="h-10 w-10 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No client subscriptions yet.</p>
                <Button variant="outline" size="sm" onClick={() => setSubDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add first subscription</Button>
              </div>
            ) : (
              <div className="divide-y">
                {(statusFilter ? subs.filter((s) => s.status === statusFilter) : subs).map((sub) => (
                  <div key={sub.id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{sub.contactName ?? `Contact #${sub.contactId}`}</p>
                        <Badge variant={statusColor(sub.status)} className="text-[10px]">{sub.status}</Badge>
                        {sub.cancelAtPeriodEnd && <Badge variant="outline" className="text-[10px]">Cancels at period end</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {sub.planName} · ${sub.priceMonthly}/mo · {sub.interval}
                        {sub.currentPeriodEnd && ` · Renews ${format(new Date(sub.currentPeriodEnd), "MMM d, yyyy")}`}
                      </p>
                      {sub.notes && <p className="text-xs text-zinc-400 mt-0.5">{sub.notes}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {sub.status !== "active"    && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => statusMutation.mutate({ id: sub.id, status: "active" })}>Activate</Button>}
                      {sub.status === "active"    && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => statusMutation.mutate({ id: sub.id, status: "paused" })}>Pause</Button>}
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => cancelMutation.mutate(sub.id)}>Cancel</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="plans" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => { setEditingPlan(null); setPlanDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> New Plan
            </Button>
          </div>
          {plansLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map((plan) => (
                <div key={plan.id} className={`bg-white rounded-xl border border-zinc-200 shadow-sm p-5 space-y-3 ${!plan.isActive ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{plan.name}</h3>
                      {plan.description && <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>}
                    </div>
                    {!plan.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
                  </div>
                  <div>
                    <span className="text-2xl font-bold">${parseFloat(plan.priceMonthly).toFixed(0)}</span>
                    <span className="text-muted-foreground text-sm">/mo</span>
                    {plan.priceYearly && <p className="text-xs text-muted-foreground">${parseFloat(plan.priceYearly).toFixed(0)}/yr</p>}
                  </div>
                  {plan.features.length > 0 && (
                    <ul className="space-y-1">
                      {plan.features.map((f, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-xs text-zinc-700">
                          <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  {plan.stripeProductId && <p className="text-[10px] text-muted-foreground font-mono">Stripe: {plan.stripeProductId.slice(0, 20)}…</p>}
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => { setEditingPlan(plan); setPlanDialogOpen(true); }}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive px-2"
                      onClick={() => deletePlanMutation.mutate(plan.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <PlanDialog open={planDialogOpen} onClose={() => { setPlanDialogOpen(false); setEditingPlan(null); }} initial={editingPlan} />
      <SubscribeDialog open={subDialogOpen} onClose={() => setSubDialogOpen(false)} plans={plans} />
    </div>
  );
}
