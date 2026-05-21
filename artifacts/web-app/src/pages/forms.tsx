import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useListDeals, getListDealsQueryKey } from "@workspace/api-client-react";
import {
  ClipboardList, FileText, CheckCircle2, RefreshCw,
  ExternalLink, Copy, User, Briefcase, DollarSign, MessageSquare,
  Plus, Globe, Lock, Trash2, Edit, BarChart2, Layers, Clock, Download, Send, X as XIcon,
} from "lucide-react";
import { useListContacts } from "@workspace/api-client-react";

const SERVICE_TYPES = ["Artist roster", "Live show", "Merch", "Mixing", "Recording", "Video"] as const;

interface Submission {
  id: number;
  formType: "contact_intake" | "staff_invoice" | "general_inquiry";
  status: "new" | "reviewed" | "processed";
  submitterName: string | null;
  submitterEmail: string | null;
  serviceType: string | null;
  invoiceAmount: string | null;
  notes: string | null;
  submittedAt: string;
  contactId: number | null;
  dealId: number | null;
  data: Record<string, unknown>;
}

interface CustomForm {
  id: number;
  name: string;
  description?: string;
  slug: string;
  fields: unknown[];
  status: "draft" | "published" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface CustomFormSubmission {
  id: number;
  formId: number;
  data: Record<string, unknown>;
  submitterName: string | null;
  submitterEmail: string | null;
  submittedAt: string;
}

const invoiceSchema = z.object({
  staffRequested: z.string().min(1, "Required"),
  serviceType: z.enum(SERVICE_TYPES, { required_error: "Required" }),
  date: z.string().min(1, "Required"),
  hoursWorked: z.coerce.number().min(0).optional(),
  invoicePrice: z.coerce.number().positive("Must be positive"),
  paymentType: z.array(z.string()).min(1, "Select at least one"),
  otherInfo: z.string().optional(),
});
type InvoiceValues = z.infer<typeof invoiceSchema>;

function authH(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const STATUS_CONFIG = {
  new:       { label: "New",       color: "bg-blue-100 text-blue-700" },
  reviewed:  { label: "Reviewed",  color: "bg-amber-100 text-amber-700" },
  processed: { label: "Processed", color: "bg-green-100 text-green-700" },
};

const FORM_TYPE_CONFIG = {
  contact_intake:  { label: "Intake",  icon: User,         color: "bg-violet-100 text-violet-600" },
  staff_invoice:   { label: "Invoice", icon: Briefcase,    color: "bg-blue-100 text-blue-600" },
  general_inquiry: { label: "Inquiry", icon: MessageSquare,color: "bg-teal-100 text-teal-600" },
};

// ── Staff Invoice Form ────────────────────────────────────────────────────────
function StaffInvoiceForm({ token }: { token: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [submitted, setSubmitted] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string>("none");
  const [timeHintMinutes, setTimeHintMinutes] = useState<number | null>(null);

  const { data: deals } = useListDeals(undefined, { query: { queryKey: getListDealsQueryKey() } });

  const { register, handleSubmit, control, watch, setValue, reset, formState: { errors } } = useForm<InvoiceValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { paymentType: [] },
  });

  const paymentTypes = watch("paymentType");

  useEffect(() => {
    if (!selectedDealId || selectedDealId === "none" || !token) { setTimeHintMinutes(null); return; }
    fetch(`/api/deals/${selectedDealId}/time`, { headers: authH(token) })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.entries) { setTimeHintMinutes(null); return; }
        const total = (data.entries as { durationMinutes: number }[]).reduce((sum, e) => sum + e.durationMinutes, 0);
        setTimeHintMinutes(total);
        if (total > 0) {
          setValue("hoursWorked", Math.round((total / 60) * 100) / 100);
        }
      })
      .catch(() => setTimeHintMinutes(null));
  }, [selectedDealId, token, setValue]);

  function togglePaymentType(type: string) {
    const current = paymentTypes ?? [];
    setValue("paymentType", current.includes(type) ? current.filter((t) => t !== type) : [...current, type]);
  }

  const submit = useMutation({
    mutationFn: async (data: InvoiceValues) => {
      const r = await fetch("/api/forms/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Submission failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Invoice submitted — deal created in pipeline" });
      qc.invalidateQueries({ queryKey: ["form-submissions"] });
      reset();
      setSelectedDealId("none");
      setTimeHintMinutes(null);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    },
    onError: () => toast({ title: "Failed to submit", variant: "destructive" }),
  });

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-xl border p-6 shadow-sm">
        {submitted && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Invoice submitted and deal created!
          </div>
        )}
        <form onSubmit={handleSubmit((v) => submit.mutate(v))} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Staff member requested</Label>
            <Input {...register("staffRequested")} placeholder="Name of staff member" />
            {errors.staffRequested && <p className="text-xs text-red-500">{errors.staffRequested.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Service type</Label>
            <Controller control={control} name="serviceType" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select service..." /></SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            {errors.serviceType && <p className="text-xs text-red-500">{errors.serviceType.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" {...register("date")} />
          </div>

          {/* Deal link for hours pre-fill */}
          <div className="space-y-1.5">
            <Label>Link to deal (optional)</Label>
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger><SelectValue placeholder="Select a deal to pre-fill hours..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No deal —</SelectItem>
                {(deals ?? []).map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label>Hours worked</Label>
              {timeHintMinutes !== null && timeHintMinutes > 0 && (
                <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Pre-filled from time log
                </span>
              )}
            </div>
            <Input type="number" step="0.01" min="0" {...register("hoursWorked")} placeholder="e.g. 8.5" />
            {timeHintMinutes !== null && timeHintMinutes === 0 && (
              <p className="text-xs text-zinc-400">No time entries found for this deal yet</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Invoice price</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
              <Input type="number" step="0.01" min="0" {...register("invoicePrice")} placeholder="0.00" className="pl-7" />
            </div>
            {errors.invoicePrice && <p className="text-xs text-red-500">{errors.invoicePrice.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Payment type</Label>
            <div className="space-y-1.5">
              {["one time", "Recurring", "Installment", "Other"].map((type) => (
                <label key={type} className="flex items-center gap-2.5 cursor-pointer text-sm">
                  <input type="checkbox" className="rounded" checked={(paymentTypes ?? []).includes(type)} onChange={() => togglePaymentType(type)} />
                  {type}
                </label>
              ))}
            </div>
            {errors.paymentType && <p className="text-xs text-red-500">{errors.paymentType.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Other Information</Label>
            <Textarea {...register("otherInfo")} placeholder="Any additional notes..." rows={3} />
          </div>
          <Button type="submit" className="w-full" disabled={submit.isPending}>
            {submit.isPending ? "Submitting..." : "Submit Invoice"}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ── Built-in Submissions Table ────────────────────────────────────────────────
function SubmissionsTable({ token }: { token: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Submission | null>(null);
  const [selectedSubIds, setSelectedSubIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const exportCsv = () => {
    fetch("/api/forms/submissions/export.csv", { headers: authH(token) })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "form-submissions.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const bulkStatus = async (status: "new" | "reviewed" | "processed") => {
    if (selectedSubIds.size === 0) return;
    setBulkLoading(true);
    try {
      await fetch("/api/forms/submissions/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ ids: [...selectedSubIds], status }),
      });
      qc.invalidateQueries({ queryKey: ["form-submissions"] });
      setSelectedSubIds(new Set());
      toast({ title: "Status updated" });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  const { data: submissions = [], isFetching, refetch } = useQuery<Submission[]>({
    queryKey: ["form-submissions"],
    queryFn: async () => {
      const r = await fetch("/api/forms/submissions", { headers: authH(token) });
      return r.json();
    },
    enabled: !!token,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await fetch(`/api/forms/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error("Update failed");
    },
    onSuccess: () => { toast({ title: "Status updated" }); qc.invalidateQueries({ queryKey: ["form-submissions"] }); setSelected(null); },
  });

  const newCount = submissions.filter((s) => s.status === "new").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-medium text-sm text-muted-foreground">Built-in form submissions</h3>
          {newCount > 0 && <Badge className="bg-blue-600 h-5 text-xs">{newCount} new</Badge>}
          {selectedSubIds.size > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-500">{selectedSubIds.size} selected — mark as:</span>
              {(["new", "reviewed", "processed"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => bulkStatus(s)}
                  disabled={bulkLoading}
                  className={`text-xs px-2 py-0.5 rounded-full font-medium transition-colors disabled:opacity-50 ${STATUS_CONFIG[s].color} hover:opacity-80`}
                >{STATUS_CONFIG[s].label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>
      {submissions.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-zinc-200 rounded-lg bg-white shadow-sm">
          <ClipboardList className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
          No submissions yet
        </div>
      ) : (
        <div className="border border-zinc-200 rounded-lg bg-white overflow-hidden shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2 bg-muted/20 border-b text-xs text-zinc-500">
            <input
              type="checkbox"
              className="rounded border-zinc-300 cursor-pointer"
              checked={submissions.length > 0 && submissions.every(s => selectedSubIds.has(s.id))}
              onChange={(e) => setSelectedSubIds(e.target.checked ? new Set(submissions.map(s => s.id)) : new Set())}
            />
            <span>Select all</span>
          </div>
          <div className="divide-y">
          {submissions.map((sub) => {
            const cfg = FORM_TYPE_CONFIG[sub.formType] ?? FORM_TYPE_CONFIG.general_inquiry;
            const Icon = cfg.icon;
            return (
              <div key={sub.id} className={`flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors ${selectedSubIds.has(sub.id) ? "bg-blue-50/30" : ""}`}>
                <input
                  type="checkbox"
                  className="rounded border-zinc-300 cursor-pointer shrink-0"
                  checked={selectedSubIds.has(sub.id)}
                  onChange={(e) => {
                    const next = new Set(selectedSubIds);
                    if (e.target.checked) next.add(sub.id); else next.delete(sub.id);
                    setSelectedSubIds(next);
                  }}
                />
                <button onClick={() => setSelected(sub)} className="flex-1 text-left flex items-center gap-4">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color.split(" ")[0]}`}>
                    <Icon className={`h-4 w-4 ${cfg.color.split(" ")[1]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{sub.submitterName ?? "Unknown"}</p>
                      <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{cfg.label}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {sub.submitterEmail ?? sub.serviceType ?? "—"}
                      {sub.invoiceAmount ? ` · $${parseFloat(sub.invoiceAmount).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_CONFIG[sub.status].color}`}>
                      {STATUS_CONFIG[sub.status].label}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(sub.submittedAt).toLocaleDateString()}</span>
                  </div>
                </button>
              </div>
            );
          })}
          </div>
        </div>
      )}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        {selected && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {(() => { const Icon = (FORM_TYPE_CONFIG[selected.formType] ?? FORM_TYPE_CONFIG.general_inquiry).icon; return <Icon className="h-4 w-4" />; })()}
                {selected.submitterName ?? "Submission"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CONFIG[selected.status].color}`}>{STATUS_CONFIG[selected.status].label}</span>
                {selected.contactId && <a href="/contacts" className="text-xs text-blue-600 hover:underline flex items-center gap-1"><User className="h-3 w-3" /> View contact #{selected.contactId}</a>}
                {selected.dealId && <a href="/pipeline" className="text-xs text-blue-600 hover:underline flex items-center gap-1"><ExternalLink className="h-3 w-3" /> View deal #{selected.dealId}</a>}
              </div>
              <div className="space-y-2 text-sm border border-zinc-200 rounded-lg p-4 bg-muted/30">
                {Object.entries(selected.data).map(([key, val]) => val ? (
                  <div key={key} className="flex gap-3">
                    <span className="text-muted-foreground capitalize min-w-[120px] shrink-0">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                    <span className="font-medium">{Array.isArray(val) ? (val as string[]).join(", ") : String(val)}</span>
                  </div>
                ) : null)}
                <div className="flex gap-3 pt-1 border-t">
                  <span className="text-muted-foreground min-w-[120px] shrink-0">submitted at</span>
                  <span className="font-medium">{new Date(selected.submittedAt).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">Mark as:</span>
                {(["new", "reviewed", "processed"] as const).map((s) => (
                  <Button key={s} size="sm" variant={selected.status === s ? "default" : "outline"} className="h-7 text-xs capitalize"
                    onClick={() => updateStatus.mutate({ id: selected.id, status: s })}
                    disabled={updateStatus.isPending || selected.status === s}>{s}</Button>
                ))}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

// ── Send Form to Contact dialog ───────────────────────────────────────────────
interface SendFormDialogProps {
  formId: number;
  formName: string;
  token: string | null;
  onClose: () => void;
}

function SendFormDialog({ formId, formName, token, onClose }: SendFormDialogProps) {
  const { toast } = useToast();
  const { data: contacts = [] } = useListContacts({});
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<{ id: number; name: string; email?: string | null } | null>(null);
  const [personalNote, setPersonalNote] = useState("");
  const [sending, setSending] = useState(false);

  const filtered = (contacts as { id: number; name: string; email?: string | null }[])
    .filter((c) => {
      const q = contactSearch.toLowerCase();
      return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q);
    })
    .slice(0, 12);

  const handleSend = async () => {
    if (!selectedContact || !token) return;
    setSending(true);
    try {
      const res = await fetch(`/api/custom-forms/${formId}/send-to-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contactId: selectedContact.id, personalNote: personalNote.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "NO_SMTP") {
          toast({ title: "SMTP not configured", description: "Go to Settings → Email to set up your mail server.", variant: "destructive" });
        } else {
          toast({ title: data.error ?? "Send failed", variant: "destructive" });
        }
        return;
      }
      toast({ title: `Sent to ${data.sentTo}`, description: `"${formName}" link delivered` });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">Send to Contact</label>
        {selectedContact ? (
          <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-blue-50 border-blue-200">
            <div>
              <div className="font-medium text-sm">{selectedContact.name}</div>
              {selectedContact.email && <div className="text-xs text-zinc-500">{selectedContact.email}</div>}
            </div>
            <button onClick={() => setSelectedContact(null)} className="text-zinc-400 hover:text-zinc-700">
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="Search contacts by name or email…"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              autoFocus
            />
            {contactSearch && (
              <div className="border rounded-lg divide-y max-h-40 overflow-y-auto bg-white shadow-sm">
                {filtered.length === 0
                  ? <p className="text-sm text-zinc-500 p-3 text-center">No contacts found</p>
                  : filtered.map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-zinc-50 transition-colors"
                      onClick={() => { setSelectedContact(c); setContactSearch(""); }}
                    >
                      <div className="font-medium">{c.name}</div>
                      {c.email && <div className="text-xs text-zinc-400">{c.email}</div>}
                    </button>
                  ))
                }
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Personal Note <span className="text-zinc-400 font-normal">(optional)</span></label>
        <textarea
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          placeholder="Add a short personal message for the recipient…"
          rows={3}
          value={personalNote}
          onChange={(e) => setPersonalNote(e.target.value)}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onClose}
          className="flex-1 border border-zinc-200 rounded-lg py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSend}
          disabled={!selectedContact || sending}
          className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? "Sending…" : "Send Link"}
        </button>
      </div>
    </div>
  );
}

// ── Custom Forms list + submissions ───────────────────────────────────────────
function CustomFormsTab({ token }: { token: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const canDelete = me?.role === "owner" || me?.role === "admin" || me?.permissions?.["forms:delete"] === true;
  const [viewSubs, setViewSubs] = useState<CustomForm | null>(null);
  const [sendForm, setSendForm] = useState<CustomForm | null>(null);

  const { data: forms = [], isLoading, refetch, isFetching } = useQuery<CustomForm[]>({
    queryKey: ["custom-forms"],
    queryFn: async () => {
      const r = await fetch("/api/custom-forms", { headers: authH(token) });
      return r.json();
    },
    enabled: !!token,
  });

  const { data: submissions = [] } = useQuery<CustomFormSubmission[]>({
    queryKey: ["custom-form-submissions", viewSubs?.id],
    queryFn: async () => {
      const r = await fetch(`/api/custom-forms/${viewSubs!.id}/submissions`, { headers: authH(token) });
      return r.json();
    },
    enabled: !!viewSubs && !!token,
  });

  const togglePublish = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/custom-forms/${id}/publish`, { method: "POST", headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<CustomForm>;
    },
    onSuccess: (form) => {
      toast({ title: form.status === "published" ? "Form published!" : "Form unpublished" });
      qc.invalidateQueries({ queryKey: ["custom-forms"] });
    },
    onError: () => toast({ title: "Action failed", variant: "destructive" }),
  });

  const deleteForm = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/custom-forms/${id}`, { method: "DELETE", headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { toast({ title: "Form deleted" }); qc.invalidateQueries({ queryKey: ["custom-forms"] }); },
    onError: () => toast({ title: "Delete failed", variant: "destructive" }),
  });

  const [deleteFormId, setDeleteFormId] = useState<number | null>(null);
  const deleteFormName = forms.find(f => f.id === deleteFormId)?.name ?? "";

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Custom forms</h3>
          <Badge variant="outline" className="text-xs">{forms.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => navigate("/forms/builder")}>
            <Plus className="h-3.5 w-3.5" /> New form
          </Button>
        </div>
      </div>

      {forms.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-zinc-200 rounded-xl bg-white">
          <Layers className="h-10 w-10 mx-auto mb-3 text-zinc-200" />
          <p className="text-sm font-medium text-zinc-500 mb-1">No custom forms yet</p>
          <p className="text-xs text-zinc-400 mb-4">Create forms with dropdowns, checkboxes, radio buttons and more</p>
          <Button size="sm" className="gap-1.5" onClick={() => navigate("/forms/builder")}>
            <Plus className="h-3.5 w-3.5" /> Create your first form
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((form) => {
            const publicUrl = `${window.location.origin}/f/${form.slug}`;
            return (
              <div key={form.id} className="bg-white rounded-xl border border-zinc-200 shadow-sm px-5 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{form.name}</p>
                    <Badge variant="outline" className={`text-[10px] px-1.5 gap-1 shrink-0 ${form.status === "published" ? "border-green-300 bg-green-50 text-green-700" : "text-zinc-400"}`}>
                      {form.status === "published" ? <><Globe className="h-2.5 w-2.5" />Live</> : <><Lock className="h-2.5 w-2.5" />Draft</>}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-400">
                    /f/{form.slug} · {form.fields.length} field{form.fields.length !== 1 ? "s" : ""} · Updated {new Date(form.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-zinc-500"
                    onClick={() => setViewSubs(viewSubs?.id === form.id ? null : form)}>
                    <BarChart2 className="h-3.5 w-3.5" /> Responses
                  </Button>
                  {form.status === "published" && (
                    <button onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "Link copied" }); }}
                      className="h-7 w-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Copy link">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {form.status === "published" && (
                    <a href={publicUrl} target="_blank" rel="noopener noreferrer"
                      className="h-7 w-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100" title="Open form">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {form.status === "published" && (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                      onClick={() => setSendForm(form)} title="Send to contact">
                      <Send className="h-3.5 w-3.5" /> Send
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-zinc-500"
                    onClick={() => navigate(`/forms/builder/${form.id}`)}>
                    <Edit className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className={`h-7 text-xs px-2 ${form.status === "published" ? "text-amber-600 border-amber-200 hover:bg-amber-50" : "text-green-700 border-green-200 hover:bg-green-50"}`}
                    onClick={() => togglePublish.mutate(form.id)} disabled={togglePublish.isPending}>
                    {form.status === "published" ? "Unpublish" : "Publish"}
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-zinc-300 hover:text-red-500 hover:bg-red-50"
                      onClick={() => setDeleteFormId(form.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Submissions panel */}
      {viewSubs && (
        <div className="mt-6 bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{viewSubs.name} — Responses</p>
              <p className="text-xs text-zinc-400">{submissions.length} submission{submissions.length !== 1 ? "s" : ""}</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setViewSubs(null)} className="text-xs text-zinc-400">Close</Button>
          </div>
          {submissions.length === 0 ? (
            <div className="text-center py-8 text-sm text-zinc-400">No responses yet</div>
          ) : (
            <div className="divide-y">
              {submissions.map((sub) => (
                <div key={sub.id} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-medium">{sub.submitterName ?? sub.submitterEmail ?? `Submission #${sub.id}`}</p>
                    <span className="text-xs text-zinc-400">{new Date(sub.submittedAt).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    {Object.entries(sub.data).filter(([k]) => k !== "_hp").map(([k, v]) => v ? (
                      <div key={k} className="text-xs text-zinc-500">
                        <span className="text-zinc-400">{k}:</span>{" "}
                        <span className="font-medium text-zinc-700">{Array.isArray(v) ? (v as string[]).join(", ") : String(v)}</span>
                      </div>
                    ) : null)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Send to Contact dialog */}
      <Dialog open={!!sendForm} onOpenChange={(o) => { if (!o) setSendForm(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-600" />
              Send "{sendForm?.name}"
            </DialogTitle>
          </DialogHeader>
          {sendForm && (
            <SendFormDialog
              formId={sendForm.id}
              formName={sendForm.name}
              token={token}
              onClose={() => setSendForm(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteFormId !== null} onOpenChange={open => { if (!open) setDeleteFormId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete form?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteFormName}</strong> and all its submissions will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFormId && deleteForm.mutate(deleteFormId)}
              disabled={deleteForm.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FormsPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const intakeUrl = `${window.location.origin}/intake`;
  const inquiryUrl = `${window.location.origin}/inquiry`;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-white px-6 py-4 flex items-center justify-between shrink-0 flex-wrap gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-5 w-5 text-violet-600" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Forms</h1>
            <p className="text-xs text-muted-foreground">Client intake, inquiry, staff invoices & custom forms</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(intakeUrl); toast({ title: "Intake link copied" }); }} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" /> Copy intake link
          </Button>
          <a href="/intake" target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" /> Intake form
            </Button>
          </a>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(inquiryUrl); toast({ title: "Inquiry link copied" }); }} className="gap-1.5">
            <Copy className="h-3.5 w-3.5" /> Copy inquiry link
          </Button>
          <a href="/inquiry" target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" /> Inquiry form
            </Button>
          </a>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="custom">
          <div className="overflow-x-auto mb-5">
            <TabsList className="w-max min-w-full">
              <TabsTrigger value="custom" className="gap-1.5 shrink-0">
                <Layers className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Custom </span>Forms
              </TabsTrigger>
              <TabsTrigger value="submissions" className="gap-1.5 shrink-0">
                <FileText className="h-3.5 w-3.5" /> Submissions
              </TabsTrigger>
              <TabsTrigger value="invoice" className="gap-1.5 shrink-0">
                <DollarSign className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Staff </span>Invoice
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="custom">
            <CustomFormsTab token={token} />
          </TabsContent>
          <TabsContent value="submissions">
            <SubmissionsTable token={token} />
          </TabsContent>
          <TabsContent value="invoice">
            <StaffInvoiceForm token={token} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
