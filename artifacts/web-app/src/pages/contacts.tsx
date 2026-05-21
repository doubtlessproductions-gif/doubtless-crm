import { useAuth } from "@/hooks/use-auth";
import { useListContacts, useCreateContact, useUpdateContact, useDeleteContact, getListContactsQueryKey, useGetContact, useAdminListUsers, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useCallback, useRef } from "react";
import { format } from "date-fns";
import {
  Search, Plus, Building2, Users, Mail, Phone, MoreHorizontal, Pencil, Trash2, X,
  Link2, UserCheck, UserX, Copy, ExternalLink, CheckCircle, AlertCircle, FileText,
  Trello, MessageSquare, Clock, CreditCard, Activity, ChevronDown, Filter, ArrowRight, Download, Send, ClipboardList, Upload, HardDrive,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ContactInvoicesSection } from "@/pages/invoices";

// ── CSV parser (handles quoted fields) ────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

// Normalize a header: lowercase, strip spaces/dashes/underscores
const norm = (s: string) => s.toLowerCase().replace(/[\s_\-().]+/g, "");

interface CsvRow { name: string; email: string; phone: string; company: string; organization: string; tags: string[]; notes: string; }

function parseCsv(text: string): { rows: CsvRow[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0 };
  const headers = parseCsvLine(lines[0]!).map(norm);

  // Match column index against a list of aliases (handles HubSpot, generic, etc.)
  const idx = (keys: string[]) => keys.map((k) => headers.indexOf(k)).find((i) => i !== -1) ?? -1;

  const nameIdx    = idx(["name", "fullname", "contactname", "displayname"]);
  const firstIdx   = idx(["firstname", "first", "givenname"]);
  const lastIdx    = idx(["lastname", "last", "surname", "familyname"]);
  const emailIdx   = idx(["email", "emailaddress", "email1", "workemail", "primaryemail", "emailaddress1"]);
  const phoneIdx   = idx(["phone", "phonenumber", "telephone", "phone1",
                           "mobilephonenumber", "mobile", "cell", "cellphone",
                           "worknumber", "businessphone", "directphone", "phonenumberraw"]);
  const companyIdx      = idx(["company", "companyname", "accountname", "employer"]);
  const organizationIdx = idx(["organization", "org", "institution", "affiliation", "network", "association"]);
  const tagsIdx    = idx(["tags", "labels", "keywords", "interests"]);
  const notesIdx   = idx(["notes", "description", "memo", "comments", "note"]);

  const col = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "").trim() : "");

  const rows: CsvRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);

    // Prefer dedicated "name" column; fall back to First + Last (HubSpot style)
    let name = col(cols, nameIdx);
    if (!name) {
      const first = col(cols, firstIdx);
      const last  = col(cols, lastIdx);
      name = [first, last].filter(Boolean).join(" ");
    }
    if (!name) { skipped++; continue; }

    rows.push({
      name,
      email:        col(cols, emailIdx),
      phone:        col(cols, phoneIdx),
      company:      col(cols, companyIdx),
      organization: col(cols, organizationIdx),
      tags:         tagsIdx >= 0 ? col(cols, tagsIdx).split(";").map((t) => t.trim()).filter(Boolean) : [],
      notes:        col(cols, notesIdx),
    });
  }
  return { rows, skipped };
}

// ── Import dialog ─────────────────────────────────────────────────────────────

function ImportContactsDialog({
  open, onClose, token, onImported,
}: { open: boolean; onClose: () => void; token: string | null; onImported: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const reset = () => { setRows([]); setSkipped(0); setFileName(""); setDone(null); };

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      const text = raw.replace(/^\uFEFF/, ""); // strip Excel BOM
      const { rows: r, skipped: s } = parseCsv(text);
      setRows(r); setSkipped(s); setDone(null);
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!token || rows.length === 0) return;
    setLoading(true);
    try {
      const payload = rows.map((r) => ({
        name:         r.name,
        email:        r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) ? r.email : null,
        phone:        r.phone        || null,
        company:      r.company      || null,
        organization: r.organization || null,
        tags:         r.tags,
        notes:        r.notes        || null,
      }));
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contacts: payload }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Import failed", variant: "destructive" }); return; }
      setDone(data.imported);
      onImported();
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { reset(); onClose(); };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-blue-600" /> Import Contacts
          </DialogTitle>
        </DialogHeader>

        {done !== null ? (
          <div className="py-8 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="h-10 w-10 text-green-500" />
            <p className="text-lg font-semibold text-zinc-900">Import complete</p>
            <p className="text-sm text-zinc-500">{done} contact{done !== 1 ? "s" : ""} imported successfully.</p>
            <Button onClick={handleClose} className="mt-2">Done</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-4">
            <div
              className="relative border-2 border-dashed border-zinc-200 rounded-xl p-10 text-center hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              {/* Invisible full-cover input — reliable in all iframe/browser contexts */}
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,.txt"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
              <Upload className="h-8 w-8 text-zinc-300 mx-auto mb-3 pointer-events-none" />
              <p className="font-medium text-zinc-700 pointer-events-none">Drop your CSV here, or click to browse</p>
              <p className="text-xs text-zinc-400 mt-1 pointer-events-none">Works with HubSpot exports and standard CSVs</p>
              <p className="text-xs text-zinc-400 mt-0.5 pointer-events-none">Max 1,000 rows.</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
              <p className="font-medium text-zinc-700 mb-1">Expected CSV format</p>
              <p className="font-mono text-[11px] bg-white border rounded px-2 py-1.5 select-all">
                name,email,phone,company,tags,notes<br />
                "Jane Smith","jane@example.com","555-0100","Acme Records","vip;artist",""
              </p>
              <p>Column headers are case-insensitive. Only <span className="font-medium">name</span> is required.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-zinc-800">{fileName}</p>
                <p className="text-sm text-zinc-500">
                  <span className="text-green-600 font-medium">{rows.length} valid row{rows.length !== 1 ? "s" : ""}</span>
                  {skipped > 0 && <span className="text-amber-600 ml-2">· {skipped} skipped (no name)</span>}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={reset}>
                <X className="h-3.5 w-3.5" /> Change file
              </Button>
            </div>

            <div className="border border-zinc-200 rounded-lg overflow-hidden shadow-sm">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b">
                  <tr>
                    {["Name", "Email", "Phone", "Company", "Tags"].map((h) => (
                      <th key={h} className="text-left px-3 py-2 font-medium text-zinc-500 uppercase tracking-wide text-[10px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-zinc-50">
                      <td className="px-3 py-2 font-medium text-zinc-800">{r.name}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.email || "—"}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.phone || "—"}</td>
                      <td className="px-3 py-2 text-zinc-500">{r.company || "—"}</td>
                      <td className="px-3 py-2">
                        {r.tags.map((t, j) => <span key={j} className="inline-block bg-zinc-100 text-zinc-600 rounded px-1.5 py-0.5 mr-1 text-[10px]">{t}</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && (
                <p className="text-center text-xs text-zinc-400 py-2 bg-zinc-50 border-t">
                  … and {rows.length - 8} more row{rows.length - 8 !== 1 ? "s" : ""}
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button className="flex-1 gap-2" onClick={handleImport} disabled={loading}>
                {loading ? <><Upload className="h-4 w-4 animate-bounce" /> Importing…</> : <><Upload className="h-4 w-4" /> Import {rows.length} Contact{rows.length !== 1 ? "s" : ""}</>}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const contactSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  company: z.string().optional().or(z.literal("")),
  organization: z.string().optional().or(z.literal("")),
  tags: z.string().optional(),
  notes: z.string().optional().or(z.literal("")),
});

type ContactFormValues = z.infer<typeof contactSchema>;

export default function Contacts() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<number | null>(null);
  const [viewingContact, setViewingContact] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: contacts, isLoading } = useListContacts(
    { search: debouncedSearch || undefined },
    { query: { queryKey: getListContactsQueryKey({ search: debouncedSearch || undefined }) } }
  );

  const createContact = useCreateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setIsModalOpen(false);
        form.reset();
        toast({ title: "Contact created" });
      },
    }
  });

  const updateContact = useUpdateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setIsModalOpen(false);
        setEditingContact(null);
        form.reset();
        toast({ title: "Contact updated" });
      },
    }
  });

  const deleteContact = useDeleteContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Contact deleted" });
      }
    }
  });

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: "", email: "", phone: "", company: "", organization: "", tags: "", notes: "" }
  });

  const openCreateModal = () => {
    form.reset({ name: "", email: "", phone: "", company: "", organization: "", tags: "", notes: "" });
    setEditingContact(null);
    setIsModalOpen(true);
  };

  const openEditModal = (contact: any) => {
    form.reset({
      name: contact.name,
      email: contact.email || "",
      phone: contact.phone || "",
      company: contact.company || "",
      organization: contact.organization || "",
      tags: contact.tags?.join(", ") || "",
      notes: contact.notes || "",
    });
    setEditingContact(contact.id);
    setIsModalOpen(true);
  };

  const onSubmit = (values: ContactFormValues) => {
    const data = {
      ...values,
      tags: values.tags ? values.tags.split(",").map(t => t.trim()).filter(Boolean) : []
    };
    if (editingContact) {
      updateContact.mutate({ id: editingContact, data });
    } else {
      createContact.mutate({ data });
    }
  };

  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const canDelete = me?.role === "owner" || me?.role === "admin" || me?.permissions?.["contacts:delete"] === true;

  const handleDelete = (id: number) => {
    if (!canDelete) return;
    if (confirm("Are you sure you want to delete this contact?")) {
      deleteContact.mutate({ id });
    }
  };

  const { token } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkAssignUserId, setBulkAssignUserId] = useState<string>("none");
  const [importOpen, setImportOpen] = useState(false);

  const { data: usersList = [] } = useAdminListUsers();

  const exportCsv = () => {
    const url = `/api/contacts/export.csv${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ""}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "contacts.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  const bulkAction = async (action: "tag" | "untag" | "delete" | "assign", tag?: string, assignedTo?: number | null) => {
    if (selectedIds.size === 0) return;
    if (action === "delete" && !canDelete) return;
    if (action === "delete" && !confirm(`Delete ${selectedIds.size} contact(s)?`)) return;
    setBulkLoading(true);
    try {
      const res = await fetch("/api/contacts/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids: [...selectedIds], action, tag, assignedTo }),
      });
      if (!res.ok) { const { error } = await res.json().catch(() => ({ error: "Request failed" })); throw new Error(error); }
      queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
      setSelectedIds(new Set());
      setBulkTag("");
      setBulkAssignUserId("none");
      toast({ title: "Bulk action complete" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Bulk action failed", variant: "destructive" });
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-zinc-500">Manage your customer relationships.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-1.5">
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            New Contact
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden flex flex-col h-[calc(100vh-200px)]">
        <div className="p-4 border-b border-zinc-100 shrink-0">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <Input
              placeholder="Search contacts..."
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setTimeout(() => setDebouncedSearch(e.target.value), 300);
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="rounded border-zinc-300 cursor-pointer"
                    checked={!!(contacts?.length && contacts.every(c => selectedIds.has(c.id)))}
                    onChange={(e) => setSelectedIds(e.target.checked ? new Set((contacts ?? []).map(c => c.id)) : new Set())}
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company / Organization</TableHead>
                <TableHead>Contact Info</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-zinc-500">Loading contacts...</TableCell></TableRow>
              ) : contacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-zinc-500">
                    No contacts found. {search && "Try a different search."}
                  </TableCell>
                </TableRow>
              ) : (
                contacts?.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className={`cursor-pointer hover:bg-zinc-50 ${selectedIds.has(contact.id) ? "bg-blue-50/50" : ""}`}
                    onClick={() => setViewingContact(contact.id)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-zinc-300 cursor-pointer"
                        checked={selectedIds.has(contact.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(contact.id); else next.delete(contact.id);
                          setSelectedIds(next);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-medium text-zinc-900">{contact.name}</TableCell>
                    <TableCell>
                      {contact.company && (
                        <div className="flex items-center text-sm text-zinc-600">
                          <Building2 className="h-3 w-3 mr-1 text-zinc-400" />
                          {contact.company}
                        </div>
                      )}
                      {(contact as any).organization && (
                        <div className="flex items-center text-xs text-zinc-400 mt-0.5">
                          <Users className="h-3 w-3 mr-1 text-zinc-300" />
                          {(contact as any).organization}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {contact.email && (
                          <div className="flex items-center text-sm text-zinc-600">
                            <Mail className="h-3 w-3 mr-1 text-zinc-400" />{contact.email}
                          </div>
                        )}
                        {contact.phone && (
                          <div className="flex items-center text-sm text-zinc-600">
                            <Phone className="h-3 w-3 mr-1 text-zinc-400" />{contact.phone}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {contact.tags?.map((tag, i) => (
                          <Badge key={i} variant="secondary" className="font-normal bg-zinc-100 text-zinc-700">{tag}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditModal(contact)}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          {canDelete && (
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(contact.id)}>
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-zinc-900 text-white rounded-xl shadow-xl px-4 py-3 text-sm flex-wrap justify-center max-w-2xl">
          <span className="font-medium text-zinc-300 shrink-0">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
          <input
            type="text"
            placeholder="Tag name…"
            value={bulkTag}
            onChange={(e) => setBulkTag(e.target.value)}
            className="bg-zinc-800 text-white text-xs rounded-lg px-2.5 py-1.5 w-28 outline-none border border-zinc-700 placeholder:text-zinc-500"
          />
          <button
            onClick={() => { if (bulkTag) bulkAction("tag", bulkTag); }}
            disabled={!bulkTag || bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >+ Tag</button>
          <button
            onClick={() => { if (bulkTag) bulkAction("untag", bulkTag); }}
            disabled={!bulkTag || bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >− Untag</button>
          <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
          <select
            value={bulkAssignUserId}
            onChange={(e) => setBulkAssignUserId(e.target.value)}
            className="bg-zinc-800 text-white text-xs rounded-lg px-2 py-1.5 outline-none border border-zinc-700 shrink-0"
          >
            <option value="none">Unassigned</option>
            {(usersList as { id: number; name: string }[]).map(u => (
              <option key={u.id} value={String(u.id)}>{u.name}</option>
            ))}
          </select>
          <button
            onClick={() => bulkAction("assign", undefined, bulkAssignUserId === "none" ? null : Number(bulkAssignUserId))}
            disabled={bulkLoading}
            className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >Assign</button>
          <div className="w-px h-4 bg-zinc-700 mx-0.5 shrink-0" />
          <button
            onClick={() => bulkAction("delete")}
            disabled={bulkLoading}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
          >Delete</button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-1 text-zinc-400 hover:text-white shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <ImportContactsDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        token={token}
        onImported={() => queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() })}
      />

      {/* Form Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-zinc-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-6 border-b border-zinc-100 shrink-0">
              <h2 className="text-lg font-semibold">{editingContact ? "Edit Contact" : "New Contact"}</h2>
              <Button variant="ghost" size="icon" onClick={() => setIsModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="contact-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input id="name" {...form.register("name")} />
                  {form.formState.errors.name && <p className="text-sm text-red-500">{form.formState.errors.name.message}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" {...form.register("email")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" {...form.register("phone")} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="company">Company</Label>
                    <Input id="company" placeholder="e.g. Warner Music" {...form.register("company")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="organization">Organization</Label>
                    <Input id="organization" placeholder="e.g. NARAS, SAG-AFTRA" {...form.register("organization")} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tags">Tags (comma separated)</Label>
                  <Input id="tags" placeholder="Customer, VIP, Lead" {...form.register("tags")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" className="h-24" {...form.register("notes")} />
                </div>
              </form>
            </div>
            <div className="p-6 border-t border-zinc-100 bg-zinc-50 shrink-0 flex justify-end gap-3 rounded-b-xl">
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button type="submit" form="contact-form" disabled={createContact.isPending || updateContact.isPending}>
                {editingContact ? "Save Changes" : "Create Contact"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewingContact && (
        <ContactDetailPanel id={viewingContact} onClose={() => setViewingContact(null)} />
      )}
    </div>
  );
}

// ─── Portal Section ────────────────────────────────────────────────────────────

interface PortalUser {
  lastLoginAt?: string | null;
  inviteAcceptedAt?: string | null;
}

interface PortalStatus {
  status: "none" | "pending" | "active" | "deactivated";
  inviteUrl?: string | null;
  portalUser?: PortalUser | null;
}

function usePortalStatus(contactId: number, authToken: string | null) {
  const [portalStatus, setPortalStatus] = useState<PortalStatus | null>(null);
  const [working, setWorking] = useState(false);
  const { toast } = useToast();

  const loadStatus = useCallback(async () => {
    if (!authToken) return;
    const res = await fetch(`/api/portal/status/${contactId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (res.ok) setPortalStatus(await res.json());
  }, [contactId, authToken]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const invite = async (contactEmail: string | null | undefined) => {
    if (!contactEmail) { toast({ title: "Contact has no email address", variant: "destructive" }); return; }
    setWorking(true);
    try {
      const res = await fetch("/api/portal/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ contactId }),
      });
      if (res.ok) {
        await loadStatus();
        toast({ title: "Invite link generated" });
      } else {
        const d = await res.json();
        toast({ title: d.error ?? "Failed to generate invite", variant: "destructive" });
      }
    } finally { setWorking(false); }
  };

  const toggleActive = async (isActive: boolean) => {
    setWorking(true);
    try {
      const res = await fetch(`/api/portal/deactivate/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) { await loadStatus(); toast({ title: isActive ? "Portal access restored" : "Portal access deactivated" }); }
    } finally { setWorking(false); }
  };

  const copyLink = (inviteUrl?: string | null) => {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
      toast({ title: "Invite link copied!" });
    }
  };

  return { portalStatus, working, invite, toggleActive, copyLink };
}

function PortalStatusBadge({ status }: { status: PortalStatus["status"] }) {
  if (status === "none") return <Badge variant="outline" className="text-zinc-400">Not Invited</Badge>;
  if (status === "pending") return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 border">Pending</Badge>;
  if (status === "active") return <Badge className="bg-green-100 text-green-800 border-green-200 border"><UserCheck className="h-3 w-3 mr-1" />Active</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200 border"><UserX className="h-3 w-3 mr-1" />Deactivated</Badge>;
}

function PortalAccessCard({
  contactId,
  contactEmail,
  authToken,
  dealCount,
}: {
  contactId: number;
  contactEmail: string | null | undefined;
  authToken: string | null;
  dealCount: number;
}) {
  const { portalStatus, working, invite, toggleActive, copyLink } = usePortalStatus(contactId, authToken);

  if (!portalStatus) {
    return (
      <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50 animate-pulse">
        <div className="h-4 bg-zinc-200 rounded w-1/3 mb-2" />
        <div className="h-3 bg-zinc-200 rounded w-1/2" />
      </div>
    );
  }

  const { status, inviteUrl, portalUser } = portalStatus;

  return (
    <div className="border border-zinc-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-700 flex items-center gap-1.5">
          <UserCheck className="h-4 w-4 text-zinc-400" />
          Portal Access
        </span>
        <PortalStatusBadge status={status} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500">
        <div>
          <span className="block text-zinc-400 uppercase tracking-wide font-medium text-[10px] mb-0.5">Last Login</span>
          <span className="text-zinc-700 font-medium">
            {portalUser?.lastLoginAt
              ? format(new Date(portalUser.lastLoginAt), "MMM d, yyyy")
              : "—"}
          </span>
        </div>
        <div>
          <span className="block text-zinc-400 uppercase tracking-wide font-medium text-[10px] mb-0.5">Deals</span>
          <span className="text-zinc-700 font-medium">{dealCount}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1 border-t border-zinc-100">
        {status === "none" && (
          <Button size="sm" className="w-full" onClick={() => invite(contactEmail)} disabled={working}>
            <Link2 className="h-3.5 w-3.5 mr-2" /> Invite to Portal
          </Button>
        )}
        {(status === "pending" || status === "deactivated") && (
          <Button size="sm" className="w-full" onClick={() => invite(contactEmail)} disabled={working}>
            <Link2 className="h-3.5 w-3.5 mr-2" />
            {status === "pending" ? "Resend Invite" : "Re-invite to Portal"}
          </Button>
        )}
        {(status === "pending" || status === "active") && inviteUrl && (
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => copyLink(inviteUrl)}>
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Invite Link
          </Button>
        )}
        {status === "active" && (
          <Button size="sm" variant="outline" className="w-full text-red-600 hover:text-red-700 border-red-200" onClick={() => toggleActive(false)} disabled={working}>
            <UserX className="h-3.5 w-3.5 mr-1.5" /> Deactivate Portal Access
          </Button>
        )}
        {status === "deactivated" && (
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => toggleActive(true)} disabled={working}>
            Restore Portal Access
          </Button>
        )}
      </div>
    </div>
  );
}

function PortalSection({ contactId, contactEmail, authToken }: { contactId: number; contactEmail: string | null | undefined; authToken: string | null }) {
  const { portalStatus, working, invite, toggleActive, copyLink } = usePortalStatus(contactId, authToken);

  if (!portalStatus) return <div className="text-sm text-zinc-400">Loading portal status…</div>;

  const { status, inviteUrl, portalUser } = portalStatus;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-600">Status:</span>
        <PortalStatusBadge status={status} />
      </div>
      {portalUser?.lastLoginAt && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-600">Last login:</span>
          <span className="text-zinc-700">{format(new Date(portalUser.lastLoginAt), "MMM d, yyyy")}</span>
        </div>
      )}
      {status === "none" && (
        <Button size="sm" className="w-full" onClick={() => invite(contactEmail)} disabled={working}>
          <Link2 className="h-3.5 w-3.5 mr-2" /> Invite to Portal
        </Button>
      )}
      {(status === "pending" || status === "active") && inviteUrl && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => copyLink(inviteUrl)}>
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Invite Link
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href={inviteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
          </Button>
        </div>
      )}
      {status === "pending" && (
        <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => invite(contactEmail)} disabled={working}>
          Regenerate Invite Link
        </Button>
      )}
      {status === "active" && (
        <Button size="sm" variant="outline" className="w-full text-red-600 hover:text-red-700 border-red-200" onClick={() => toggleActive(false)} disabled={working}>
          <UserX className="h-3.5 w-3.5 mr-1.5" /> Deactivate Portal Access
        </Button>
      )}
      {status === "deactivated" && (
        <div className="space-y-2">
          <Button size="sm" className="w-full" onClick={() => invite(contactEmail)} disabled={working}>
            <Link2 className="h-3.5 w-3.5 mr-2" /> Re-invite to Portal
          </Button>
          <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => toggleActive(true)} disabled={working}>
            Restore Portal Access
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Emails Section ────────────────────────────────────────────────────────────

interface EmailSendRecord {
  id: number;
  templateId: number | null;
  templateTitle: string | null;
  toEmail: string;
  subject: string | null;
  status: string;
  error: string | null;
  sentAt: string;
}

function EmailsSection({ contactId, authToken }: { contactId: number; authToken: string | null }) {
  const [emails, setEmails] = useState<EmailSendRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authToken) return;
    setLoading(true);
    fetch(`/api/templates/sends/history?contactId=${contactId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((r) => r.json())
      .then((data) => setEmails(Array.isArray(data) ? data : []))
      .catch(() => setEmails([]))
      .finally(() => setLoading(false));
  }, [contactId, authToken]);

  if (loading) return <p className="text-sm text-zinc-400 py-2">Loading email history…</p>;
  if (!emails.length) return <p className="text-sm text-zinc-500 italic">No emails sent to this contact yet.</p>;

  return (
    <div className="space-y-2">
      {emails.map((e) => (
        <div key={e.id} className="border border-zinc-200 rounded-lg p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{e.subject ?? "(no subject)"}</div>
              {e.templateTitle && <div className="text-xs text-zinc-400">Template: {e.templateTitle}</div>}
            </div>
            {e.status === "sent" ? (
              <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
            ) : (
              <span title={e.error ?? "Failed"}>
                <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
              </span>
            )}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            {format(new Date(e.sentAt), "MMM d, yyyy 'at' h:mm a")}
          </div>
          {e.status === "failed" && e.error && (
            <div className="text-xs text-red-500 mt-1 truncate">{e.error}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Linked Outlook Emails Panel ───────────────────────────────────────────────

interface EmailLinkRecord {
  id: number;
  messageSubject: string | null;
  messageSenderName: string | null;
  messageSenderEmail: string | null;
  messageDate: string | null;
}

function LinkedEmailsPanel({ entityType, entityId, authToken }: {
  entityType: string; entityId: number; authToken: string | null;
}) {
  const [removing, setRemoving] = useState<number | null>(null);
  const { data: links = [], isLoading, refetch } = useQuery<EmailLinkRecord[]>({
    queryKey: ["outlook-links", entityType, entityId],
    queryFn: () =>
      fetch(`/api/outlook/linked/${entityType}/${entityId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      }).then((r) => (r.ok ? r.json() : [])),
    enabled: !!authToken,
    staleTime: 30_000,
  });

  const unlink = async (linkId: number) => {
    setRemoving(linkId);
    await fetch(`/api/outlook/links/${linkId}`, {
      method: "DELETE",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    }).catch(() => {});
    void refetch();
    setRemoving(null);
  };

  if (isLoading) return <p className="text-sm text-zinc-400 py-2">Loading linked emails…</p>;
  if (!links.length)
    return (
      <p className="text-sm text-zinc-400 italic">
        No Outlook emails linked yet. Open the Outlook page, select an email, and use &ldquo;Link to…&rdquo;.
      </p>
    );

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-start gap-2 p-3 rounded-lg border border-blue-100 bg-blue-50/40 text-sm"
        >
          <Mail className="h-3.5 w-3.5 text-[#0078d4] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{link.messageSubject ?? "(no subject)"}</p>
            <p className="text-xs text-zinc-500">
              {link.messageSenderName || link.messageSenderEmail || "Unknown sender"}
              {link.messageDate &&
                ` · ${new Date(link.messageDate).toLocaleDateString()}`}
            </p>
          </div>
          <button
            onClick={() => unlink(link.id)}
            disabled={removing === link.id}
            className="text-zinc-300 hover:text-red-400 transition-colors shrink-0 mt-0.5"
            aria-label="Unlink email"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Linked OneDrive Files Panel ───────────────────────────────────────────────

interface FileLinkRecord {
  id: number;
  fileId: string;
  fileName: string | null;
  fileWebUrl: string | null;
  fileMimeType: string | null;
  entityType: string;
  entityId: number;
}

function LinkedFilesPanel({ entityType, entityId, authToken }: {
  entityType: string; entityId: number; authToken: string | null;
}) {
  const [removing, setRemoving] = useState<number | null>(null);
  const { data: links = [], isLoading, refetch } = useQuery<FileLinkRecord[]>({
    queryKey: ["onedrive-linked", entityType, entityId],
    queryFn: () =>
      fetch(`/api/onedrive/linked/${entityType}/${entityId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      }).then((r) => (r.ok ? r.json() : [])),
    enabled: !!authToken,
    staleTime: 30_000,
  });

  const unlink = async (linkId: number) => {
    setRemoving(linkId);
    await fetch(`/api/onedrive/file-links/${linkId}`, {
      method: "DELETE",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    }).catch(() => {});
    void refetch();
    setRemoving(null);
  };

  if (isLoading) return <p className="text-sm text-zinc-400 py-2">Loading linked files…</p>;
  if (!links.length)
    return (
      <p className="text-sm text-zinc-400 italic">
        No OneDrive files linked yet. Open OneDrive, select a file, and use &ldquo;Link to CRM record&rdquo;.
      </p>
    );

  return (
    <div className="space-y-2">
      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-start gap-2 p-3 rounded-lg border border-zinc-100 bg-zinc-50 text-sm"
        >
          <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{link.fileName ?? "(unnamed file)"}</p>
            {link.fileWebUrl && (
              <a href={link.fileWebUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#0078d4] hover:underline truncate block">
                Open in OneDrive
              </a>
            )}
          </div>
          <button
            onClick={() => void unlink(link.id)}
            disabled={removing === link.id}
            className="text-zinc-300 hover:text-red-400 transition-colors shrink-0 mt-0.5"
            aria-label="Unlink file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Activity Timeline Section ─────────────────────────────────────────────────

interface TimelineItem {
  key: string;
  type: string;
  description: string;
  actorName: string | null;
  timestamp: string;
  meta: Record<string, unknown>;
}

interface TimelineResponse {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: TimelineItem[];
}

const TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "deal", label: "Deals" },
  { value: "stage_change", label: "Stage Changes" },
  { value: "note", label: "Notes" },
  { value: "email", label: "Emails" },
  { value: "message", label: "Messages" },
  { value: "form", label: "Forms" },
  { value: "time", label: "Time" },
  { value: "invoice", label: "Invoices" },
  { value: "subscription", label: "Subscriptions" },
];

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; bg: string; color: string }> = {
  deal:         { icon: <Trello className="h-3.5 w-3.5" />,        bg: "bg-blue-100",    color: "text-blue-600" },
  stage_change: { icon: <ArrowRight className="h-3.5 w-3.5" />,    bg: "bg-indigo-100",  color: "text-indigo-600" },
  note:         { icon: <FileText className="h-3.5 w-3.5" />,      bg: "bg-amber-100",   color: "text-amber-600" },
  email:        { icon: <Mail className="h-3.5 w-3.5" />,          bg: "bg-violet-100",  color: "text-violet-600" },
  message:      { icon: <MessageSquare className="h-3.5 w-3.5" />, bg: "bg-sky-100",     color: "text-sky-600" },
  form:         { icon: <FileText className="h-3.5 w-3.5" />,      bg: "bg-pink-100",    color: "text-pink-600" },
  time:         { icon: <Clock className="h-3.5 w-3.5" />,         bg: "bg-orange-100",  color: "text-orange-600" },
  invoice:      { icon: <CreditCard className="h-3.5 w-3.5" />,    bg: "bg-green-100",   color: "text-green-600" },
  subscription: { icon: <Activity className="h-3.5 w-3.5" />,      bg: "bg-emerald-100", color: "text-emerald-600" },
};

function ActivityTimeline({ contactId, authToken }: { contactId: number; authToken: string | null }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const offsetRef = useRef(0);
  const PAGE = 20;

  const fetchPage = useCallback(async (offset: number, filter: string, replace: boolean) => {
    if (!authToken) return;
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE) });
    if (filter) params.set("type", filter);
    const res = await fetch(`/api/contacts/${contactId}/timeline?${params}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return;
    const data: TimelineResponse = await res.json();
    setTotal(data.total);
    setItems((prev) => replace ? data.items : [...prev, ...data.items]);
    offsetRef.current = offset + data.items.length;
  }, [contactId, authToken]);

  useEffect(() => {
    setLoading(true);
    offsetRef.current = 0;
    fetchPage(0, typeFilter, true).finally(() => setLoading(false));
  }, [typeFilter, fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    await fetchPage(offsetRef.current, typeFilter, false);
    setLoadingMore(false);
  };

  const hasMore = items.length < total;

  return (
    <div className="space-y-3">
      {/* Type filter pills */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTypeFilter(f.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              typeFilter === f.value
                ? "bg-zinc-800 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="space-y-3 pt-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="h-7 w-7 rounded-full bg-zinc-100 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5 pt-1">
                <div className="h-3 bg-zinc-100 rounded animate-pulse" />
                <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-400">
          No activity{typeFilter ? ` of type "${typeFilter}"` : ""} for this contact.
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-3.5 top-0 bottom-0 w-px bg-zinc-100" />
          <div className="space-y-0">
            {items.map((item, idx) => {
              const cfg = TYPE_CONFIG[item.type] ?? { icon: <Activity className="h-3.5 w-3.5" />, bg: "bg-zinc-100", color: "text-zinc-600" };
              const isLast = idx === items.length - 1;
              return (
                <div key={item.key} className={`flex gap-3 ${isLast ? "" : "pb-4"}`}>
                  <div className={`relative z-10 h-7 w-7 rounded-full ${cfg.bg} ${cfg.color} flex items-center justify-center flex-shrink-0`}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-xs text-zinc-800 leading-snug">{item.description}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {item.actorName && <span className="text-zinc-500 font-medium">{item.actorName} · </span>}
                      {format(new Date(item.timestamp), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-700 flex items-center justify-center gap-1 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50"
        >
          {loadingMore ? (
            "Loading…"
          ) : (
            <><ChevronDown className="h-3.5 w-3.5" /> Load more ({total - items.length} remaining)</>
          )}
        </button>
      )}

      {!loading && items.length > 0 && (
        <p className="text-center text-xs text-zinc-400">Showing {items.length} of {total} events</p>
      )}
    </div>
  );
}

// ─── Send Form to Contact Dialog ──────────────────────────────────────────────

interface PublishedForm { id: number; name: string; slug: string; fields: unknown[]; }

function SendFormToContactDialog({
  contactId, contactName, contactEmail, token, onClose,
}: {
  contactId: number; contactName: string; contactEmail: string | null;
  token: string | null; onClose: () => void;
}) {
  const { toast } = useToast();
  const [forms, setForms] = useState<PublishedForm[]>([]);
  const [formSearch, setFormSearch] = useState("");
  const [selectedForm, setSelectedForm] = useState<PublishedForm | null>(null);
  const [personalNote, setPersonalNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch("/api/custom-forms", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d: (PublishedForm & { status: string })[]) => setForms(Array.isArray(d) ? d.filter((f) => f.status === "published") : []))
      .catch(() => {});
  }, [token]);

  const filtered = forms.filter((f) => f.name.toLowerCase().includes(formSearch.toLowerCase())).slice(0, 10);

  const isContract = (f: PublishedForm) =>
    (f.fields as { type: string }[]).some((field) =>
      ["signature", "contract_text", "legal_agreement"].includes(field.type),
    );

  const handleSend = async () => {
    if (!selectedForm || !token) return;
    setSending(true);
    try {
      const res = await fetch(`/api/custom-forms/${selectedForm.id}/send-to-contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contactId, personalNote: personalNote.trim() || undefined }),
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
      toast({ title: `Sent to ${data.sentTo}`, description: `"${selectedForm.name}" link delivered` });
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {!contactEmail && (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
          This contact has no email address. Add one before sending.
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Choose a form or contract</label>
        {selectedForm ? (
          <div className="flex items-center justify-between border rounded-lg px-3 py-2 bg-blue-50 border-blue-200">
            <div>
              <div className="flex items-center gap-1.5">
                {isContract(selectedForm)
                  ? <FileText className="h-3.5 w-3.5 text-violet-600" />
                  : <ClipboardList className="h-3.5 w-3.5 text-blue-600" />}
                <span className="font-medium text-sm">{selectedForm.name}</span>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{isContract(selectedForm) ? "Contract" : "Form"} · /f/{selectedForm.slug}</div>
            </div>
            <button onClick={() => setSelectedForm(null)} className="text-zinc-400 hover:text-zinc-700">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="Search published forms and contracts…"
              value={formSearch}
              onChange={(e) => setFormSearch(e.target.value)}
              autoFocus
            />
            <div className="border rounded-lg divide-y max-h-48 overflow-y-auto bg-white shadow-sm">
              {filtered.length === 0 ? (
                <p className="text-sm text-zinc-500 p-3 text-center">
                  {forms.length === 0 ? "No published forms yet" : "No forms match your search"}
                </p>
              ) : filtered.map((f) => (
                <button
                  key={f.id}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-zinc-50 transition-colors flex items-center gap-2"
                  onClick={() => { setSelectedForm(f); setFormSearch(""); }}
                >
                  {isContract(f)
                    ? <FileText className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                    : <ClipboardList className="h-3.5 w-3.5 text-blue-500 shrink-0" />}
                  <div className="min-w-0">
                    <div className="font-medium truncate">{f.name}</div>
                    <div className="text-xs text-zinc-400">{isContract(f) ? "Contract" : "Form"}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium">Personal Note <span className="text-zinc-400 font-normal">(optional)</span></label>
        <Textarea
          placeholder={`Add a message for ${contactName}…`}
          rows={3}
          value={personalNote}
          onChange={(e) => setPersonalNote(e.target.value)}
          className="text-sm resize-none"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
        <Button
          className="flex-1 gap-2"
          disabled={!selectedForm || !contactEmail || sending}
          onClick={handleSend}
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? "Sending…" : "Send Link"}
        </Button>
      </div>
    </div>
  );
}

// ─── Contact Detail Panel ──────────────────────────────────────────────────────

function ContactDetailPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: contact, isLoading } = useGetContact(id);
  const { token } = useAuth();
  const [sendFormOpen, setSendFormOpen] = useState(false);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data: linkedArtist } = useQuery<{
    id: number; name: string; genre: string | null; imageUrl: string | null; labelStatus: string | null;
  } | null>({
    queryKey: ["contact-linked-artist", id],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/contacts/${id}/artist`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) return null;
      return res.json();
    },
    enabled: !!token,
    retry: false,
    staleTime: 60_000,
  });

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-white shadow-2xl border-l border-zinc-200 z-40 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="flex items-center justify-between p-6 border-b border-zinc-100 shrink-0">
        <h2 className="text-lg font-semibold">Contact Details</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading || !contact ? (
          <div className="text-center text-zinc-500 py-8">Loading details...</div>
        ) : (
          <div className="space-y-5">
            <div>
              <h3 className="text-2xl font-bold text-zinc-900">{contact.name}</h3>
              {contact.company && (
                <p className="text-zinc-600 mt-1 flex items-center">
                  <Building2 className="h-4 w-4 mr-2" />{contact.company}
                </p>
              )}
              {(contact as any).organization && (
                <p className="text-zinc-500 mt-0.5 flex items-center text-sm">
                  <Users className="h-3.5 w-3.5 mr-2" />{(contact as any).organization}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {contact.tags?.map((tag, i) => (
                <Badge key={i} variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-blue-100">
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Linked artist badge */}
            {linkedArtist && (
              <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-xl border border-violet-100">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {linkedArtist.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-wide">Linked Artist</p>
                  <p className="text-sm font-semibold text-zinc-900 truncate">{linkedArtist.name}</p>
                  {linkedArtist.genre && <p className="text-xs text-zinc-500">{linkedArtist.genre}</p>}
                </div>
                <a
                  href={`/artists/${linkedArtist.id}`}
                  className="text-xs text-violet-600 hover:underline flex items-center gap-1 shrink-0"
                  onClick={onClose}
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            <div className="space-y-3 bg-zinc-50 p-4 rounded-lg border border-zinc-100">
              {contact.email && (
                <div className="flex items-center text-sm text-zinc-700">
                  <Mail className="h-4 w-4 mr-3 text-zinc-400" />
                  <a href={`mailto:${contact.email}`} className="hover:text-blue-600">{contact.email}</a>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-center text-sm text-zinc-700">
                  <Phone className="h-4 w-4 mr-3 text-zinc-400" />
                  <a href={`tel:${contact.phone}`} className="hover:text-blue-600">{contact.phone}</a>
                </div>
              )}
              <div className="pt-1 border-t border-zinc-200">
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2 text-blue-700 border-blue-200 hover:bg-blue-50 hover:border-blue-300"
                  onClick={() => setSendFormOpen(true)}
                >
                  <Send className="h-3.5 w-3.5" />
                  Send Form or Contract
                </Button>
              </div>
            </div>

            {/* Send Form dialog */}
            <Dialog open={sendFormOpen} onOpenChange={(o) => { if (!o) setSendFormOpen(false); }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-blue-600" />
                    Send to {contact.name}
                  </DialogTitle>
                </DialogHeader>
                <SendFormToContactDialog
                  contactId={contact.id}
                  contactName={contact.name}
                  contactEmail={contact.email ?? null}
                  token={token}
                  onClose={() => setSendFormOpen(false)}
                />
              </DialogContent>
            </Dialog>

            {contact.notes && (
              <div>
                <h4 className="font-medium text-sm text-zinc-900 mb-2">Notes</h4>
                <div className="bg-amber-50 text-amber-900 p-4 rounded-lg text-sm border border-amber-100 whitespace-pre-wrap">
                  {contact.notes}
                </div>
              </div>
            )}

            <PortalAccessCard
              contactId={contact.id}
              contactEmail={contact.email}
              authToken={token}
              dealCount={contact.deals?.length ?? 0}
            />

            <Tabs defaultValue="activity" className="w-full">
              <div className="overflow-x-auto">
                <TabsList className="w-full grid grid-cols-6 text-xs min-w-[300px]">
                  <TabsTrigger value="activity" className="text-xs px-1">
                    Activity
                  </TabsTrigger>
                  <TabsTrigger value="deals" className="text-xs px-1">
                    Deals <Badge variant="outline" className="ml-1 text-xs hidden sm:inline-flex">{contact.deals?.length || 0}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="emails" className="text-xs px-1">Emails</TabsTrigger>
                  <TabsTrigger value="files" className="text-xs px-1">
                    <HardDrive className="h-3 w-3 mr-0.5" />Files
                  </TabsTrigger>
                  <TabsTrigger value="billing" className="text-xs px-1">
                    <FileText className="h-3 w-3 mr-0.5" />Billing
                  </TabsTrigger>
                  <TabsTrigger value="portal" className="text-xs px-1">Portal</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="activity" className="mt-3">
                <ActivityTimeline contactId={contact.id} authToken={token} />
              </TabsContent>

              <TabsContent value="deals" className="mt-3 space-y-2">
                {contact.deals?.length ? (
                  contact.deals.map(deal => (
                    <div key={deal.id} className="border border-zinc-200 rounded-lg p-3 hover:border-blue-300 transition-colors">
                      <div className="font-medium text-sm">{deal.title}</div>
                      <div className="flex items-center justify-between mt-2">
                        <Badge variant="secondary" className="text-xs uppercase font-medium tracking-wider">
                          {deal.stage}
                        </Badge>
                        <span className="text-sm font-medium text-zinc-600">
                          {deal.value ? `$${Number(deal.value).toLocaleString()}` : '-'}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-500 italic">No deals linked to this contact.</p>
                )}
              </TabsContent>

              <TabsContent value="emails" className="mt-3 space-y-5">
                <EmailsSection contactId={contact.id} authToken={token} />
                <div>
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Mail className="h-3 w-3 text-[#0078d4]" /> Linked Outlook Emails
                  </p>
                  <LinkedEmailsPanel entityType="contact" entityId={contact.id} authToken={token} />
                </div>
              </TabsContent>

              <TabsContent value="files" className="mt-3">
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <HardDrive className="h-3 w-3 text-[#0078d4]" /> Linked OneDrive Files
                </p>
                <LinkedFilesPanel entityType="contact" entityId={contact.id} authToken={token} />
              </TabsContent>

              <TabsContent value="billing" className="mt-3">
                <ContactInvoicesSection contactId={contact.id} authToken={token} />
              </TabsContent>

              <TabsContent value="portal" className="mt-3">
                <PortalSection contactId={contact.id} contactEmail={contact.email} authToken={token} />
              </TabsContent>
            </Tabs>

            <div className="text-xs text-zinc-400 pt-2 border-t border-zinc-100">
              Added {format(new Date(contact.createdAt), "MMM d, yyyy")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
