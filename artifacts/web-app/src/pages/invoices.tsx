import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus, Trash2, Download, Send, CheckCircle, AlertCircle,
  FileText, Search, X, Pencil, DollarSign, Clock, MoreHorizontal, Briefcase, Loader2,
  Link, Copy, ExternalLink, Eye, LayoutTemplate, ChevronDown,
} from "lucide-react";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  useListContacts,
  useListInvoiceEmailTemplates,
  useCreateInvoiceEmailTemplate,
  useUpdateInvoiceEmailTemplate,
  useDeleteInvoiceEmailTemplate,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface Invoice {
  id: number;
  number: string;
  contactId: number;
  contactName: string | null;
  contactEmail: string | null;
  dealId: number | null;
  lineItems?: LineItem[];
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  status: "draft" | "sent" | "paid" | "overdue";
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  viewedAt: string | null;
  notes: string | null;
  paymentTerms: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  draft:   { label: "Draft",   className: "bg-zinc-100 text-zinc-600 border-zinc-200" },
  sent:    { label: "Sent",    className: "bg-blue-100 text-blue-700 border-blue-200" },
  paid:    { label: "Paid",    className: "bg-green-100 text-green-700 border-green-200" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-700 border-red-200" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  return <Badge className={`${cfg.className} border font-medium`}>{cfg.label}</Badge>;
}

// ── Line item row ─────────────────────────────────────────────────────────────

function LineItemRow({
  item, idx, onChange, onRemove,
}: {
  item: LineItem; idx: number;
  onChange: (idx: number, field: keyof LineItem, val: string | number) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <div className="col-span-5">
        <Input
          placeholder="Description"
          value={item.description}
          onChange={(e) => onChange(idx, "description", e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number" min="0" step="0.01"
          placeholder="Qty"
          value={item.quantity}
          onChange={(e) => onChange(idx, "quantity", parseFloat(e.target.value) || 0)}
          className="h-8 text-sm"
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number" min="0" step="0.01"
          placeholder="Rate"
          value={item.rate}
          onChange={(e) => onChange(idx, "rate", parseFloat(e.target.value) || 0)}
          className="h-8 text-sm"
        />
      </div>
      <div className="col-span-2 text-right text-sm font-medium text-zinc-700 pr-1">
        ${(item.quantity * item.rate).toFixed(2)}
      </div>
      <div className="col-span-1 flex justify-end">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400 hover:text-red-500" onClick={() => onRemove(idx)}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Invoice builder form ──────────────────────────────────────────────────────

const BLANK_ITEM: LineItem = { description: "", quantity: 1, rate: 0, amount: 0 };

interface FormState {
  contactId: number | null;
  dealId: number | null;
  lineItems: LineItem[];
  taxRate: number;
  dueDate: string;
  notes: string;
  paymentTerms: string;
}

const BLANK_FORM: FormState = {
  contactId: null, dealId: null,
  lineItems: [{ ...BLANK_ITEM }],
  taxRate: 0, dueDate: "", notes: "", paymentTerms: "",
};

interface Deal { id: number; title: string; }
interface TimeEntryRaw { id: number; dealId: number | null; date: string; durationMinutes: number; category: string; description: string | null; }

function InvoiceForm({
  initial, contacts, onSubmit, onCancel, loading, authToken,
}: {
  initial?: FormState;
  contacts: { id: number; name: string; email?: string | null }[];
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
  loading: boolean;
  authToken: string | null;
}) {
  const [form, setForm] = useState<FormState>(initial ?? BLANK_FORM);
  const [contactSearch, setContactSearch] = useState("");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [dealSearch, setDealSearch] = useState("");
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    if (!authToken) return;
    fetch("/api/deals", { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => r.json())
      .then((d) => setDeals(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [authToken]);

  const filteredDeals = useMemo(() => {
    const q = dealSearch.toLowerCase();
    return deals.filter((d) => d.title.toLowerCase().includes(q)).slice(0, 12);
  }, [deals, dealSearch]);

  const importFromDeal = async (dealId: number) => {
    if (!authToken) return;
    setImportLoading(true);
    try {
      const r = await fetch(`/api/invoices/deal/${dealId}/time-entries`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!r.ok) return;
      const entries: TimeEntryRaw[] = await r.json();
      const newItems: LineItem[] = entries.map((e) => ({
        description: `${e.category.charAt(0).toUpperCase() + e.category.slice(1)} – ${format(new Date(e.date), "MMM d, yyyy")}${e.description ? `: ${e.description}` : ""}`,
        quantity: +(e.durationMinutes / 60).toFixed(2),
        rate: 0,
        amount: 0,
      }));
      setForm((f) => ({
        ...f,
        dealId,
        lineItems: [...f.lineItems.filter((li) => li.description.trim()), ...newItems],
      }));
      setImportOpen(false);
      setDealSearch("");
    } finally {
      setImportLoading(false);
    }
  };

  const filteredContacts = useMemo(() => {
    const q = contactSearch.toLowerCase();
    return contacts.filter((c) =>
      c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q),
    ).slice(0, 15);
  }, [contacts, contactSearch]);

  const selectedContact = contacts.find((c) => c.id === form.contactId);

  const updateItem = (idx: number, field: keyof LineItem, val: string | number) => {
    setForm((prev) => {
      const items = prev.lineItems.map((li, i) => {
        if (i !== idx) return li;
        const updated = { ...li, [field]: val };
        updated.amount = +(updated.quantity * updated.rate).toFixed(2);
        return updated;
      });
      return { ...prev, lineItems: items };
    });
  };

  const removeItem = (idx: number) =>
    setForm((prev) => ({ ...prev, lineItems: prev.lineItems.filter((_, i) => i !== idx) }));

  const addItem = () =>
    setForm((prev) => ({ ...prev, lineItems: [...prev.lineItems, { ...BLANK_ITEM }] }));

  const subtotal = form.lineItems.reduce((s, li) => s + li.quantity * li.rate, 0);
  const taxAmount = +(subtotal * form.taxRate / 100).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);

  return (
    <div className="space-y-5">
      {/* Contact picker */}
      <div className="space-y-1.5">
        <Label>Bill To (Contact) *</Label>
        {selectedContact ? (
          <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-blue-50 border-blue-200">
            <div>
              <div className="font-medium text-sm">{selectedContact.name}</div>
              {selectedContact.email && <div className="text-xs text-zinc-500">{selectedContact.email}</div>}
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setForm((f) => ({ ...f, contactId: null }))}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <Input
              placeholder="Search contacts…"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              className="h-8 text-sm"
            />
            {contactSearch && (
              <div className="border border-zinc-200 rounded-lg divide-y max-h-36 overflow-y-auto shadow-sm bg-white">
                {filteredContacts.length === 0
                  ? <p className="text-sm text-zinc-500 p-3 text-center">No contacts found</p>
                  : filteredContacts.map((c) => (
                    <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                      onClick={() => { setForm((f) => ({ ...f, contactId: c.id })); setContactSearch(""); }}>
                      <div className="font-medium">{c.name}</div>
                      {c.email && <div className="text-xs text-zinc-500">{c.email}</div>}
                    </button>
                  ))
                }
              </div>
            )}
          </div>
        )}
      </div>

      {/* Due date + terms */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Due Date</Label>
          <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label>Payment Terms</Label>
          <Input placeholder="e.g. Net 30" value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))} className="h-8 text-sm" />
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="grid grid-cols-12 gap-2 text-xs font-medium text-zinc-500 uppercase tracking-wide px-0.5 flex-1">
            <div className="col-span-5">Description</div>
            <div className="col-span-2">Qty (hrs)</div>
            <div className="col-span-2">Rate ($)</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-1" />
          </div>
        </div>
        {form.lineItems.map((item, idx) => (
          <LineItemRow key={idx} item={item} idx={idx} onChange={updateItem} onRemove={removeItem} />
        ))}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs border-dashed" onClick={addItem}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Line Item
          </Button>
          {deals.length > 0 && (
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50" onClick={() => setImportOpen(true)}>
              <Briefcase className="h-3.5 w-3.5" /> Import from Deal
            </Button>
          )}
        </div>
      </div>

      {/* Deal time-entry import panel */}
      {importOpen && (
        <div className="border border-violet-200 rounded-lg p-3 bg-violet-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-violet-800">Import time entries from a deal</p>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setImportOpen(false); setDealSearch(""); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Input
            placeholder="Search deals…"
            value={dealSearch}
            onChange={(e) => setDealSearch(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <div className="border border-zinc-200 rounded-lg divide-y bg-white max-h-36 overflow-y-auto shadow-sm">
            {filteredDeals.length === 0
              ? <p className="text-sm text-zinc-500 p-3 text-center">No deals found</p>
              : filteredDeals.map((d) => (
                <button
                  key={d.id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-violet-50 flex items-center justify-between"
                  disabled={importLoading}
                  onClick={() => importFromDeal(d.id)}
                >
                  <span className="font-medium">{d.title}</span>
                  {importLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />}
                </button>
              ))
            }
          </div>
          <p className="text-xs text-zinc-500">Time entries will be added as line items (qty = hours). Set the rate for each item after importing.</p>
        </div>
      )}

      {/* Tax rate + totals */}
      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div className="space-y-1.5 w-32">
          <Label>Tax Rate (%)</Label>
          <Input
            type="number" min="0" max="100" step="0.01"
            value={form.taxRate}
            onChange={(e) => setForm((f) => ({ ...f, taxRate: parseFloat(e.target.value) || 0 }))}
            className="h-8 text-sm"
          />
        </div>
        <div className="text-right space-y-1 text-sm min-w-40">
          <div className="flex justify-between gap-8"><span className="text-zinc-500">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
          {form.taxRate > 0 && <div className="flex justify-between gap-8"><span className="text-zinc-500">Tax ({form.taxRate}%)</span><span>${taxAmount.toFixed(2)}</span></div>}
          <div className="flex justify-between gap-8 font-semibold text-base border-t pt-1">
            <span>Total</span><span>${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label>Notes / Payment Instructions</Label>
        <Textarea
          placeholder="Bank details, instructions, thank-you message…"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="h-20 text-sm resize-none"
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button
          className="flex-1"
          disabled={loading || !form.contactId || form.lineItems.length === 0}
          onClick={() => onSubmit(form)}
        >
          {loading ? "Saving…" : "Save Invoice"}
        </Button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [sendDialog, setSendDialog] = useState<{
    invoice: Invoice;
    viewUrl: string;
    contactEmail: string | null;
    smtpConfigured: boolean;
    outlookConnected: boolean;
    outlookEmail: string | null;
    companyName: string;
  } | null>(null);
  const [sendDialogLoading, setSendDialogLoading] = useState(false);
  const [sendDialogFetching, setSendDialogFetching] = useState(false);
  const [sendDialogSent, setSendDialogSent] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sendSubject, setSendSubject] = useState("");
  const [sendMessage, setSendMessage] = useState("");

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState<{ name: string; subject: string; body: string }>({ name: "", subject: "", body: "" });
  const [editingTemplate, setEditingTemplate] = useState<{ id: number; name: string; subject: string; body: string } | null>(null);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);

  const { data: emailTemplates = [], refetch: refetchTemplates } = useListInvoiceEmailTemplates();
  const createTemplate = useCreateInvoiceEmailTemplate();
  const updateTemplate = useUpdateInvoiceEmailTemplate();
  const deleteTemplate = useDeleteInvoiceEmailTemplate();

  const { data: contacts = [] } = useListContacts({});

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/invoices", { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setInvoices(await res.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter !== "all") rows = rows.filter((i) => i.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (i) =>
          i.number.toLowerCase().includes(q) ||
          (i.contactName ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [invoices, statusFilter, search]);

  const stats = useMemo(() => ({
    total:   invoices.length,
    draft:   invoices.filter((i) => i.status === "draft").length,
    sent:    invoices.filter((i) => i.status === "sent").length,
    paid:    invoices.filter((i) => i.status === "paid").length,
    overdue: invoices.filter((i) => i.status === "overdue").length,
    totalRevenue: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0),
    outstanding:  invoices.filter((i) => ["sent", "overdue"].includes(i.status)).reduce((s, i) => s + Number(i.total), 0),
  }), [invoices]);

  const handleCreate = async (form: FormState) => {
    setFormLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contactId:    form.contactId,
          dealId:       form.dealId ?? null,
          lineItems:    form.lineItems,
          taxRate:      form.taxRate,
          dueDate:      form.dueDate || null,
          notes:        form.notes || null,
          paymentTerms: form.paymentTerms || null,
        }),
      });
      if (!res.ok) { toast({ title: "Failed to create invoice", variant: "destructive" }); return; }
      toast({ title: "Invoice created" });
      setBuilderOpen(false);
      await load();
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdate = async (form: FormState) => {
    if (!editInvoice) return;
    setFormLoading(true);
    try {
      const res = await fetch(`/api/invoices/${editInvoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          contactId:    form.contactId,
          dealId:       form.dealId ?? null,
          lineItems:    form.lineItems,
          taxRate:      form.taxRate,
          dueDate:      form.dueDate || null,
          notes:        form.notes || null,
          paymentTerms: form.paymentTerms || null,
        }),
      });
      if (!res.ok) { toast({ title: "Failed to update invoice", variant: "destructive" }); return; }
      toast({ title: "Invoice updated" });
      setEditInvoice(null);
      await load();
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this invoice?")) return;
    await fetch(`/api/invoices/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    toast({ title: "Invoice deleted" });
    await load();
  };

  const handleMarkPaid = async (id: number) => {
    const res = await fetch(`/api/invoices/${id}/mark-paid`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) { toast({ title: "Marked as paid" }); await load(); }
  };

  const openSendDialog = async (inv: Invoice) => {
    setSendDialogFetching(true);
    setSendDialogSent(false);
    setLinkCopied(false);
    setSendSubject("");
    setSendMessage("");
    try {
      const res = await fetch(`/api/invoices/${inv.id}/view-link`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { toast({ title: "Failed to load invoice link", variant: "destructive" }); return; }
      const data = await res.json();
      const companyName: string = data.companyName ?? "My Company";
      setSendDialog({
        invoice: inv,
        viewUrl: data.viewUrl,
        contactEmail: data.contactEmail,
        smtpConfigured: data.smtpConfigured,
        outlookConnected: data.outlookConnected ?? false,
        outlookEmail: data.outlookEmail ?? null,
        companyName,
      });
      setSendSubject(`Invoice ${inv.number} from ${companyName}`);
    } finally {
      setSendDialogFetching(false);
    }
  };

  const handleSendEmail = async () => {
    if (!sendDialog) return;
    setSendDialogLoading(true);
    try {
      const body: Record<string, string> = {};
      if (sendSubject.trim()) body["subject"] = sendSubject.trim();
      if (sendMessage.trim()) body["message"] = sendMessage.trim();
      const res = await fetch(`/api/invoices/${sendDialog.invoice.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Send failed", variant: "destructive" });
      } else {
        setSendDialogSent(true);
        await load();
      }
    } finally {
      setSendDialogLoading(false);
    }
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: "", subject: "", body: "" });
    setTemplateFormOpen(true);
  };

  const openEditTemplate = (t: { id: number; name: string; subject: string; body: string }) => {
    setEditingTemplate(t);
    setTemplateForm({ name: t.name, subject: t.subject, body: t.body });
    setTemplateFormOpen(true);
  };

  const handleSaveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.subject.trim() || !templateForm.body.trim()) {
      toast({ title: "Name, subject, and body are all required", variant: "destructive" }); return;
    }
    setTemplateSaving(true);
    try {
      if (editingTemplate) {
        await updateTemplate.mutateAsync({ id: editingTemplate.id, data: templateForm });
        toast({ title: "Template updated" });
      } else {
        await createTemplate.mutateAsync({ data: templateForm });
        toast({ title: "Template saved" });
      }
      await refetchTemplates();
      setTemplateFormOpen(false);
    } catch {
      toast({ title: "Failed to save template", variant: "destructive" });
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!confirm("Delete this template?")) return;
    try {
      await deleteTemplate.mutateAsync({ id });
      toast({ title: "Template deleted" });
      await refetchTemplates();
    } catch {
      toast({ title: "Failed to delete template", variant: "destructive" });
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  const handleDownload = (id: number, number: string) => {
    const a = document.createElement("a");
    a.href = `/api/invoices/${id}/pdf`;
    a.setAttribute("Authorization", `Bearer ${token}`);
    // Use fetch to get with auth header
    fetch(`/api/invoices/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `${number}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => toast({ title: "PDF generation failed", variant: "destructive" }));
  };

  const openEdit = async (inv: Invoice) => {
    // Fetch full details with lineItems
    const res = await fetch(`/api/invoices/${inv.id}`, { headers: { Authorization: `Bearer ${token}` } });
    const full: Invoice = await res.json();
    setEditInvoice(full);
  };

  const editFormInitial = useMemo((): FormState | undefined => {
    if (!editInvoice) return undefined;
    return {
      contactId:    editInvoice.contactId,
      dealId:       editInvoice.dealId,
      lineItems:    (editInvoice.lineItems ?? []).map((li) => ({ ...li })),
      taxRate:      Number(editInvoice.taxRate),
      dueDate:      editInvoice.dueDate ?? "",
      notes:        editInvoice.notes ?? "",
      paymentTerms: editInvoice.paymentTerms ?? "",
    };
  }, [editInvoice]);

  return (
    <div className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Create, send, and track client invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
            <LayoutTemplate className="h-4 w-4 mr-2" /> Email Templates
          </Button>
          <Button onClick={() => setBuilderOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Revenue Collected</div>
          <div className="text-2xl font-bold mt-1.5 text-green-600">${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Outstanding</div>
          <div className="text-2xl font-bold mt-1.5 text-blue-600">${stats.outstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Overdue</div>
          <div className={`text-2xl font-bold mt-1.5 ${stats.overdue > 0 ? "text-red-600" : "text-zinc-400"}`}>{stats.overdue}</div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Invoices</div>
          <div className="text-2xl font-bold mt-1.5 text-zinc-900">{stats.total}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input placeholder="Search invoices…" className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Invoice table */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead>Invoice #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-zinc-400">Loading invoices…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <FileText className="h-8 w-8 text-zinc-300 mx-auto mb-2" />
                  <p className="text-zinc-500">{search || statusFilter !== "all" ? "No invoices match the filters." : "No invoices yet. Create your first one."}</p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-zinc-50">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-zinc-400" />
                      <span className="font-mono font-medium text-sm">{inv.number}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{inv.contactName ?? "—"}</div>
                    {inv.contactEmail && <div className="text-xs text-zinc-400">{inv.contactEmail}</div>}
                  </TableCell>
                  <TableCell className="font-semibold">${Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={inv.status} />
                      {inv.viewedAt && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                          <Eye className="h-3 w-3" />
                          Viewed {format(new Date(inv.viewedAt), "MMM d")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600">
                    {inv.dueDate ? (
                      <span className={inv.status === "overdue" ? "text-red-600 font-medium" : ""}>
                        {format(new Date(inv.dueDate), "MMM d, yyyy")}
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500">
                    {format(new Date(inv.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(inv)}>
                          <Pencil className="h-4 w-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDownload(inv.id, inv.number)}>
                          <Download className="h-4 w-4 mr-2" /> Download PDF
                        </DropdownMenuItem>
                        {inv.status !== "paid" && (
                          <DropdownMenuItem onClick={() => openSendDialog(inv)} disabled={sendDialogFetching}>
                            <Send className="h-4 w-4 mr-2" />
                            Send to Client
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={async () => {
                            const res = await fetch(`/api/invoices/${inv.id}/view-link`, { headers: { Authorization: `Bearer ${token}` } });
                            if (!res.ok) { toast({ title: "Failed to get link", variant: "destructive" }); return; }
                            const { viewUrl } = await res.json();
                            navigator.clipboard.writeText(viewUrl).then(() => toast({ title: "Link copied to clipboard" }));
                          }}
                        >
                          <Link className="h-4 w-4 mr-2" />
                          Copy Public Link
                        </DropdownMenuItem>
                        {["sent", "overdue"].includes(inv.status) && (
                          <DropdownMenuItem onClick={() => handleMarkPaid(inv.id)} className="text-green-700">
                            <CheckCircle className="h-4 w-4 mr-2" /> Mark as Paid
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleDelete(inv.id)} className="text-red-600">
                          <Trash2 className="h-4 w-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* New invoice dialog */}
      <Dialog open={builderOpen} onOpenChange={setBuilderOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> New Invoice</DialogTitle>
          </DialogHeader>
          <InvoiceForm
            contacts={contacts as { id: number; name: string; email?: string | null }[]}
            onSubmit={handleCreate}
            onCancel={() => setBuilderOpen(false)}
            loading={formLoading}
            authToken={token}
          />
        </DialogContent>
      </Dialog>

      {/* Edit invoice dialog */}
      <Dialog open={!!editInvoice} onOpenChange={(o) => { if (!o) setEditInvoice(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit {editInvoice?.number}</DialogTitle>
          </DialogHeader>
          {editInvoice && editFormInitial && (
            <InvoiceForm
              initial={editFormInitial}
              contacts={contacts as { id: number; name: string; email?: string | null }[]}
              onSubmit={handleUpdate}
              onCancel={() => setEditInvoice(null)}
              loading={formLoading}
              authToken={token}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Send invoice dialog */}
      <Dialog open={!!sendDialog} onOpenChange={(o) => { if (!o) { setSendDialog(null); setSendDialogSent(false); setLinkCopied(false); setSendSubject(""); setSendMessage(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Send Invoice {sendDialog?.invoice.number}
            </DialogTitle>
          </DialogHeader>
          {sendDialog && (
            <div className="space-y-4 pt-1">
              {/* Recipient */}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">To</p>
                {sendDialog.contactEmail ? (
                  <p className="text-sm font-medium text-zinc-800">{sendDialog.contactEmail}</p>
                ) : (
                  <Alert variant="destructive" className="py-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>This contact has no email address. Add one before sending.</AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Sender identity */}
              {(sendDialog.outlookConnected || sendDialog.smtpConfigured) && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">From</p>
                  <p className="text-sm text-zinc-700">
                    {sendDialog.outlookConnected
                      ? <span className="font-medium">{sendDialog.outlookEmail ?? "Your Outlook account"}</span>
                      : <span className="text-zinc-500">Your SMTP account</span>
                    }
                  </p>
                </div>
              )}

              {/* Customise subject & message */}
              {(sendDialog.outlookConnected || sendDialog.smtpConfigured) && !sendDialogSent && (
                <div className="space-y-3">
                  {/* Template picker */}
                  {emailTemplates.length > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Message</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 text-violet-700 border-violet-200 hover:bg-violet-50">
                            <LayoutTemplate className="h-3.5 w-3.5" />
                            Use template
                            <ChevronDown className="h-3 w-3 opacity-60" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {emailTemplates.map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              onClick={() => { setSendSubject(t.subject); setSendMessage(t.body); }}
                              className="flex-col items-start gap-0.5"
                            >
                              <span className="font-medium text-sm">{t.name}</span>
                              <span className="text-xs text-zinc-400 truncate w-full">{t.subject}</span>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setTemplatesOpen(true)} className="text-xs text-zinc-500">
                            <LayoutTemplate className="h-3.5 w-3.5 mr-1.5" /> Manage templates…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Subject</Label>
                    <Input
                      placeholder={`Invoice ${sendDialog.invoice.number} from ${sendDialog.companyName}`}
                      value={sendSubject}
                      onChange={(e) => setSendSubject(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Personal Note <span className="normal-case font-normal text-zinc-400">(optional — prepended to the standard invoice email)</span></Label>
                    <Textarea
                      placeholder="Add a personal note to include at the top of the email…"
                      value={sendMessage}
                      onChange={(e) => setSendMessage(e.target.value)}
                      className="text-sm min-h-[80px] resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Public link */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Public Invoice Link</p>
                <div className="flex items-center gap-2 border border-zinc-200 rounded-lg px-3 py-2 bg-zinc-50">
                  <span className="text-xs text-zinc-600 truncate flex-1 font-mono">{sendDialog.viewUrl}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copyLink(sendDialog.viewUrl)} title="Copy link">
                    {linkCopied ? <CheckCircle className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-zinc-500" />}
                  </Button>
                  <a href={sendDialog.viewUrl} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Open in new tab">
                      <ExternalLink className="h-4 w-4 text-zinc-500" />
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-zinc-400">Anyone with this link can view the invoice without signing in.</p>
              </div>

              {/* Client view status */}
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${sendDialog.invoice.viewedAt ? "bg-emerald-50 border border-emerald-200" : "bg-zinc-50 border border-zinc-200"}`}>
                <Eye className={`h-4 w-4 shrink-0 ${sendDialog.invoice.viewedAt ? "text-emerald-600" : "text-zinc-400"}`} />
                {sendDialog.invoice.viewedAt ? (
                  <span className="text-emerald-700 font-medium">
                    Opened by client on {format(new Date(sendDialog.invoice.viewedAt), "MMM d, yyyy 'at' h:mm a")}
                  </span>
                ) : (
                  <span className="text-zinc-500">Not yet opened by client</span>
                )}
              </div>

              {/* Send / status section */}
              {sendDialogSent ? (
                <Alert className="border-green-200 bg-green-50 py-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700 font-medium">
                    Invoice emailed to {sendDialog.contactEmail}
                  </AlertDescription>
                </Alert>
              ) : (sendDialog.outlookConnected || sendDialog.smtpConfigured) ? (
                <Button
                  className="w-full"
                  disabled={sendDialogLoading || !sendDialog.contactEmail || sendDialog.invoice.status === "paid"}
                  onClick={handleSendEmail}
                >
                  {sendDialogLoading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending…</>
                    : <><Send className="h-4 w-4 mr-2" /> Send Email to Client</>
                  }
                </Button>
              ) : (
                <Alert className="border-amber-200 bg-amber-50 py-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-700">
                    <span className="font-medium">No email sender configured.</span> Share the link above manually, or{" "}
                    <button className="underline font-medium" onClick={() => { setSendDialog(null); navigate("/settings"); }}>
                      connect Outlook or configure SMTP in Settings
                    </button>.
                  </AlertDescription>
                </Alert>
              )}

              {/* Download PDF */}
              <Button variant="outline" className="w-full" onClick={() => handleDownload(sendDialog.invoice.id, sendDialog.invoice.number)}>
                <Download className="h-4 w-4 mr-2" /> Download PDF
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Email Templates management dialog */}
      <Dialog open={templatesOpen} onOpenChange={(o) => { if (!o) { setTemplatesOpen(false); setTemplateFormOpen(false); } }}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" /> Invoice Email Templates
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {!templateFormOpen ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-zinc-500">Saved templates you can load when sending an invoice.</p>
                  <Button size="sm" onClick={openNewTemplate}>
                    <Plus className="h-4 w-4 mr-1.5" /> New Template
                  </Button>
                </div>
                {emailTemplates.length === 0 ? (
                  <div className="text-center py-8 text-zinc-400">
                    <LayoutTemplate className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No templates yet. Create your first one.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {emailTemplates.map((t) => (
                      <div key={t.id} className="border border-zinc-200 rounded-lg p-3 hover:border-zinc-300 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-zinc-900">{t.name}</div>
                            <div className="text-xs text-zinc-500 mt-0.5 truncate">Subject: {t.subject}</div>
                            <div className="text-xs text-zinc-400 mt-1 line-clamp-2">{t.body}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTemplate(t)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => handleDeleteTemplate(t.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setTemplateFormOpen(false)}>
                    ← Back
                  </Button>
                  <h3 className="text-sm font-semibold">{editingTemplate ? "Edit Template" : "New Template"}</h3>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Template Name</Label>
                  <Input
                    placeholder="e.g. Friendly reminder, Final notice…"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Subject</Label>
                  <Input
                    placeholder="e.g. Invoice due — friendly reminder"
                    value={templateForm.subject}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, subject: e.target.value }))}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Body</Label>
                  <Textarea
                    placeholder="Write the message body…"
                    value={templateForm.body}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, body: e.target.value }))}
                    className="text-sm min-h-[140px] resize-none"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setTemplateFormOpen(false)}>Cancel</Button>
                  <Button className="flex-1" disabled={templateSaving} onClick={handleSaveTemplate}>
                    {templateSaving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save Template"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Contact billing section (exported for contacts.tsx) ───────────────────────

interface ContactInvoiceRow {
  id: number;
  number: string;
  total: string;
  status: string;
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export function ContactInvoicesSection({ contactId, authToken }: { contactId: number; authToken: string | null }) {
  const [invoices, setInvoices] = useState<ContactInvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authToken) return;
    setLoading(true);
    fetch(`/api/invoices/contact/${contactId}`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => r.json())
      .then((d) => setInvoices(Array.isArray(d) ? d : []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, [contactId, authToken]);

  if (loading) return <p className="text-sm text-zinc-400 py-2">Loading invoices…</p>;
  if (!invoices.length) return <p className="text-sm text-zinc-500 italic">No invoices for this contact yet.</p>;

  return (
    <div className="space-y-2">
      {invoices.map((inv) => (
        <div key={inv.id} className="border border-zinc-200 rounded-lg p-3 text-sm hover:border-blue-200 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-medium text-zinc-800">{inv.number}</span>
            <StatusBadge status={inv.status} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="font-semibold text-zinc-900">${Number(inv.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            {inv.dueDate && (
              <span className={`text-xs ${inv.status === "overdue" ? "text-red-500 font-medium" : "text-zinc-400"}`}>
                Due {format(new Date(inv.dueDate), "MMM d, yyyy")}
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Created {format(new Date(inv.createdAt), "MMM d, yyyy")}
            {inv.paidAt && <span className="text-green-600 ml-2">· Paid {format(new Date(inv.paidAt), "MMM d")}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
