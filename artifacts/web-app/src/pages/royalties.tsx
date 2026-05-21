import { useState, useEffect, useCallback } from "react";
import {
  useListRoyalties, useCreateRoyalty, useUpdateRoyalty, useDeleteRoyalty,
  useListArtists, useListContacts, getListRoyaltiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DollarSign, Plus, CheckCircle2, Clock, AlertTriangle, Loader2, TrendingUp, Trash2, Users, FileText, Send, ExternalLink, User } from "lucide-react";
import type { Royalty } from "@workspace/api-client-react";

type RoyaltyStatus = "pending" | "processing" | "paid" | "disputed";

const STATUS_CONFIG: Record<RoyaltyStatus, { label: string; color: string; icon: React.ReactNode }> = {
  pending:    { label: "Pending",    color: "bg-yellow-50 text-yellow-700 border-yellow-200",  icon: <Clock className="h-3 w-3" /> },
  processing: { label: "Processing", color: "bg-blue-50 text-blue-700 border-blue-200",        icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  paid:       { label: "Paid",       color: "bg-green-50 text-green-700 border-green-200",     icon: <CheckCircle2 className="h-3 w-3" /> },
  disputed:   { label: "Disputed",   color: "bg-red-50 text-red-700 border-red-200",           icon: <AlertTriangle className="h-3 w-3" /> },
};

const STATUSES = Object.keys(STATUS_CONFIG) as RoyaltyStatus[];

function fmt$(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dollarsToCents(v: string): number { return Math.round(parseFloat(v || "0") * 100); }
function centsToDollars(cents: number): string { return (cents / 100).toFixed(2); }

interface RoyaltySplit {
  id: number;
  royaltyId: number;
  contactId: number | null;
  name: string;
  percentage: number;
  statementSentAt: string | null;
  createdAt: string;
}

const EMPTY = {
  artistId: "", periodStart: "", periodEnd: "",
  streamCount: "0", grossDollars: "0.00", netDollars: "0.00",
  splitPct: "50", status: "pending" as RoyaltyStatus, notes: "",
};

// ── Splits sheet ──────────────────────────────────────────────────────────────

function SplitsSheet({ royalty, artists, contacts, open, onClose, token }: {
  royalty: Royalty;
  artists: { id: number; name: string }[];
  contacts: { id: number; name: string; email?: string | null }[];
  open: boolean;
  onClose: () => void;
  token: string;
}) {
  const { toast } = useToast();
  const [splits, setSplits] = useState<RoyaltySplit[]>([]);
  const [loading, setLoading] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", contactId: "", percentage: "" });
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sendDialog, setSendDialog] = useState<{ split: RoyaltySplit; email: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const artist = artists.find(a => a.id === royalty.artistId);
  const allocated = splits.reduce((s, r) => s + r.percentage, 0);
  const remaining = 100 - allocated;

  const loadSplits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/royalties/${royalty.id}/splits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSplits(await res.json());
    } finally {
      setLoading(false);
    }
  }, [royalty.id, token]);

  useEffect(() => { if (open) loadSplits(); }, [open, loadSplits]);

  // When a contact is selected, auto-fill the name
  function handleContactChange(contactId: string) {
    const c = contacts.find(c => String(c.id) === contactId);
    setAddForm(f => ({ ...f, contactId, name: c ? c.name : f.name }));
  }

  async function handleAddSplit() {
    if (!addForm.name.trim() || !addForm.percentage) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: addForm.name.trim(),
        percentage: parseInt(addForm.percentage),
      };
      if (addForm.contactId) body.contactId = parseInt(addForm.contactId);

      const res = await fetch(`/api/royalties/${royalty.id}/splits`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast({ title: "Collaborator added" });
        setAddForm({ name: "", contactId: "", percentage: "" });
        loadSplits();
      } else {
        const err = await res.json();
        toast({ title: err.error ?? "Failed to add collaborator", variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(splitId: number) {
    setDeletingId(splitId);
    try {
      const res = await fetch(`/api/royalties/${royalty.id}/splits/${splitId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { toast({ title: "Collaborator removed" }); loadSplits(); }
      else toast({ title: "Failed to remove", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  function openStatement(split: RoyaltySplit) {
    window.open(`/api/royalties/${royalty.id}/splits/${split.id}/statement`, "_blank");
  }

  function openSendDialog(split: RoyaltySplit) {
    const contact = split.contactId ? contacts.find(c => c.id === split.contactId) : null;
    setSendDialog({ split, email: contact?.email ?? "" });
  }

  async function handleSendStatement() {
    if (!sendDialog) return;
    setSendingId(sendDialog.split.id);
    try {
      const res = await fetch(`/api/royalties/${royalty.id}/splits/${sendDialog.split.id}/statement`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: sendDialog.email }),
      });
      if (res.ok) {
        toast({ title: "Statement sent", description: `Sent to ${sendDialog.email}` });
        setSendDialog(null);
        loadSplits();
      } else {
        const err = await res.json();
        toast({ title: err.error ?? "Failed to send statement", variant: "destructive" });
      }
    } finally {
      setSendingId(null);
    }
  }

  const canAdd = addForm.name.trim().length > 0
    && parseInt(addForm.percentage || "0") >= 1
    && parseInt(addForm.percentage || "0") <= remaining;

  return (
    <>
      <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-600" />
              Revenue Splits
            </SheetTitle>
          </SheetHeader>

          {/* Royalty summary */}
          <div className="bg-muted/40 rounded-lg p-4 mb-5 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Artist</span>
              <span className="font-medium">{artist?.name ?? `Artist #${royalty.artistId}`}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Period</span>
              <span className="font-medium">{royalty.periodStart} – {royalty.periodEnd}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross</span>
              <span className="font-medium">{fmt$(royalty.grossCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net</span>
              <span className="font-semibold text-emerald-700">{fmt$(royalty.netCents)}</span>
            </div>
          </div>

          {/* Allocation bar */}
          <div className="mb-5">
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted-foreground font-medium">Allocation</span>
              <span className={allocated > 100 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                {allocated}% used · <span className={remaining < 0 ? "text-destructive" : "text-emerald-700 font-semibold"}>{remaining}% remaining</span>
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${allocated > 100 ? "bg-destructive" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(allocated, 100)}%` }}
              />
            </div>
          </div>

          {/* Splits list */}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
            </div>
          ) : splits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm border border-zinc-200 rounded-lg mb-4 bg-white">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
              No collaborators yet. Add one below.
            </div>
          ) : (
            <div className="space-y-2 mb-5">
              {splits.map(split => {
                const payout = Math.round(royalty.netCents * split.percentage / 100);
                return (
                  <div key={split.id} className="border border-zinc-200 rounded-lg p-3 bg-white hover:bg-muted/20 transition-colors shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-emerald-700" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{split.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {split.percentage}% · <span className="font-semibold text-emerald-700">{fmt$(payout)}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={() => openStatement(split)}
                          title="View / Print statement"
                        >
                          <ExternalLink className="h-3 w-3" /> PDF
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 px-2 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => openSendDialog(split)}
                          title="Email statement"
                        >
                          <Send className="h-3 w-3" /> Send
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(split.id)}
                          disabled={deletingId === split.id}
                        >
                          {deletingId === split.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                    {split.statementSentAt && (
                      <div className="mt-2 flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Statement sent {new Date(split.statementSentAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Separator className="mb-4" />

          {/* Add collaborator */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Add Collaborator</p>

            <div className="space-y-1">
              <Label className="text-xs">Link to contact (optional)</Label>
              <Select value={addForm.contactId} onValueChange={handleContactChange}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Search contacts…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {contacts.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name *</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="e.g. John Doe"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Percentage *
                  {remaining < 100 && (
                    <span className="ml-1 text-muted-foreground">(max {remaining}%)</span>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    className={`h-8 text-sm pr-6 ${parseInt(addForm.percentage || "0") > remaining ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    type="number" min="1" max={remaining} placeholder="0"
                    value={addForm.percentage}
                    onChange={e => setAddForm(f => ({ ...f, percentage: e.target.value }))}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            {parseInt(addForm.percentage || "0") > remaining && remaining >= 0 && (
              <p className="text-xs text-destructive">
                Only {remaining}% remaining. Reduce percentage or remove a collaborator.
              </p>
            )}

            <Button
              className="w-full"
              size="sm"
              onClick={handleAddSplit}
              disabled={!canAdd || saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-2" />}
              Add Collaborator
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Send statement dialog */}
      <Dialog open={!!sendDialog} onOpenChange={v => { if (!v) setSendDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Send Royalty Statement
            </DialogTitle>
          </DialogHeader>
          {sendDialog && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Send a royalty statement to <strong>{sendDialog.split.name}</strong> for the period {royalty.periodStart} – {royalty.periodEnd}.
              </p>
              <div className="space-y-1">
                <Label>Recipient email *</Label>
                <Input
                  type="email"
                  placeholder="collaborator@example.com"
                  value={sendDialog.email}
                  onChange={e => setSendDialog(d => d ? { ...d, email: e.target.value } : null)}
                />
              </div>
              <div className="bg-blue-50 text-blue-700 text-xs rounded-md px-3 py-2">
                The statement will be sent via your connected Outlook account or SMTP. Make sure at least one is configured.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialog(null)}>Cancel</Button>
            <Button
              onClick={handleSendStatement}
              disabled={!sendDialog?.email || !!sendingId}
            >
              {sendingId ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Statement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RoyaltiesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [open,          setOpen]          = useState(false);
  const [editing,       setEditing]       = useState<Royalty | null>(null);
  const [filter,        setFilter]        = useState<RoyaltyStatus | "all">("all");
  const [form,          setForm]          = useState(EMPTY);
  const [deleteTarget,  setDeleteTarget]  = useState<Royalty | null>(null);
  const [splitsRoyalty, setSplitsRoyalty] = useState<Royalty | null>(null);

  const token = localStorage.getItem("crm_token") ?? "";

  const { data: artists  = [] } = useListArtists({});
  const { data: contacts = [] } = useListContacts({});
  const queryParams = filter !== "all" ? { status: filter } : {};
  const { data: royalties = [] } = useListRoyalties(queryParams, {
    query: { queryKey: getListRoyaltiesQueryKey(queryParams) },
  });

  const createMut = useCreateRoyalty();
  const updateMut = useUpdateRoyalty();
  const deleteMut = useDeleteRoyalty();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListRoyaltiesQueryKey({}) });
    STATUSES.forEach(s => qc.invalidateQueries({ queryKey: getListRoyaltiesQueryKey({ status: s }) }));
  };

  function openCreate() { setEditing(null); setForm(EMPTY); setOpen(true); }
  function openEdit(r: Royalty) {
    setEditing(r);
    setForm({
      artistId:     String(r.artistId),
      periodStart:  r.periodStart,
      periodEnd:    r.periodEnd,
      streamCount:  String(r.streamCount),
      grossDollars: centsToDollars(r.grossCents),
      netDollars:   centsToDollars(r.netCents),
      splitPct:     String(r.splitPct),
      status:       r.status as RoyaltyStatus,
      notes:        r.notes ?? "",
    });
    setOpen(true);
  }

  function handleSave() {
    const data = {
      artistId:    parseInt(form.artistId),
      periodStart: form.periodStart,
      periodEnd:   form.periodEnd,
      streamCount: parseInt(form.streamCount),
      grossCents:  dollarsToCents(form.grossDollars),
      netCents:    dollarsToCents(form.netDollars),
      splitPct:    parseInt(form.splitPct),
      status:      form.status,
      notes:       form.notes || undefined,
    };
    if (editing) {
      updateMut.mutate({ id: editing.id, data }, {
        onSuccess: () => { toast({ title: "Royalty updated" }); setOpen(false); invalidate(); },
        onError:   () => toast({ title: "Failed to update", variant: "destructive" }),
      });
    } else {
      createMut.mutate({ data }, {
        onSuccess: () => { toast({ title: "Royalty record created" }); setOpen(false); setForm(EMPTY); invalidate(); },
        onError:   () => toast({ title: "Failed to create", variant: "destructive" }),
      });
    }
  }

  function markPaid(r: Royalty) {
    updateMut.mutate({
      id: r.id,
      data: {
        artistId:    r.artistId,
        periodStart: r.periodStart,
        periodEnd:   r.periodEnd,
        streamCount: r.streamCount,
        grossCents:  r.grossCents,
        netCents:    r.netCents,
        splitPct:    r.splitPct,
        status:      "paid",
        notes:       r.notes ?? undefined,
      },
    }, {
      onSuccess: () => { toast({ title: "Marked as paid" }); invalidate(); },
      onError:   () => toast({ title: "Failed", variant: "destructive" }),
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMut.mutate({ id: deleteTarget.id }, {
      onSuccess: () => { toast({ title: "Record deleted" }); setDeleteTarget(null); invalidate(); },
      onError:   () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  }

  const totalGross = royalties.reduce((s, r) => s + r.grossCents, 0);
  const totalNet   = royalties.reduce((s, r) => s + r.netCents, 0);
  const totalPaid  = royalties.filter(r => r.status === "paid").reduce((s, r) => s + r.netCents, 0);
  const isPending  = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Royalties</h1>
            <p className="text-sm text-muted-foreground">Payout ledger per artist and release</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Record</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Gross Revenue",  value: fmt$(totalGross), color: "text-zinc-800" },
          { label: "Net Revenue",    value: fmt$(totalNet),   color: "text-blue-700" },
          { label: "Total Paid Out", value: fmt$(totalPaid),  color: "text-green-700" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(["all", ...STATUSES] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === s
                ? "bg-primary text-primary-foreground border-primary"
                : s === "all"
                  ? "bg-white border-zinc-200 hover:border-zinc-400"
                  : `${STATUS_CONFIG[s].color} opacity-80 hover:opacity-100`
            }`}>
            {s === "all" ? "All" : STATUS_CONFIG[s].label}
          </button>
        ))}
      </div>

      {/* Table */}
      {royalties.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
            <p className="text-muted-foreground">No royalty records.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30">
                <tr>
                  {["Artist", "Period", "Streams", "Gross", "Net", "Split", "Status", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {royalties.map(r => {
                  const artist = artists.find(a => a.id === r.artistId);
                  const cfg = STATUS_CONFIG[r.status as RoyaltyStatus];
                  return (
                    <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium">{artist?.name ?? `Artist #${r.artistId}`}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.periodStart} → {r.periodEnd}</td>
                      <td className="px-4 py-3">{r.streamCount.toLocaleString()}</td>
                      <td className="px-4 py-3">{fmt$(r.grossCents)}</td>
                      <td className="px-4 py-3 font-medium">{fmt$(r.netCents)}</td>
                      <td className="px-4 py-3">{r.splitPct}%</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg?.color ?? ""}`}>
                          {cfg?.icon}{cfg?.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 items-center">
                          <Button
                            size="sm" variant="ghost"
                            className="h-7 px-2 text-xs gap-1 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                            onClick={() => setSplitsRoyalty(r)}
                          >
                            <Users className="h-3 w-3" /> Splits
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openEdit(r)}>Edit</Button>
                          {r.status === "pending" && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-green-700 hover:text-green-800" onClick={() => markPaid(r)}>
                              Mark Paid
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Splits sheet */}
      {splitsRoyalty && (
        <SplitsSheet
          royalty={splitsRoyalty}
          artists={artists}
          contacts={contacts as { id: number; name: string; email?: string | null }[]}
          open={!!splitsRoyalty}
          onClose={() => setSplitsRoyalty(null)}
          token={token}
        />
      )}

      {/* Create / Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit Royalty Record" : "New Royalty Record"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Artist *</Label>
              <Select value={form.artistId} onValueChange={v => setForm(f => ({ ...f, artistId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select artist…" /></SelectTrigger>
                <SelectContent>
                  {artists.map(a => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Period Start *</Label>
                <Input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Period End *</Label>
                <Input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Streams</Label>
                <Input type="number" min="0" value={form.streamCount} onChange={e => setForm(f => ({ ...f, streamCount: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Gross ($)</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" min="0" step="0.01" className="pl-6" value={form.grossDollars} onChange={e => setForm(f => ({ ...f, grossDollars: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Net ($)</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input type="number" min="0" step="0.01" className="pl-6" value={form.netDollars} onChange={e => setForm(f => ({ ...f, netDollars: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Split %</Label>
                <Input type="number" min="0" max="100" value={form.splitPct} onChange={e => setForm(f => ({ ...f, splitPct: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as RoyaltyStatus }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={isPending || !form.artistId || !form.periodStart || !form.periodEnd}>
              {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete royalty record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the record for{" "}
              <strong>{artists.find(a => a.id === deleteTarget?.artistId)?.name ?? "this artist"}</strong>{" "}
              ({deleteTarget?.periodStart} → {deleteTarget?.periodEnd}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
