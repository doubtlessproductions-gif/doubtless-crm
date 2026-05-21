import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Link2, ExternalLink, Trash2, Copy, CreditCard,
  Download, CheckCircle2,
} from "lucide-react";

const CURRENCIES = ["usd", "eur", "gbp", "cad", "aud"];

const HUBSPOT_LINKS = [
  { title: "Video Distro Payment Link", amount: 0,   description: "Video Distribution" },
  { title: "Mastering",                 amount: 100, description: "Mastering service" },
  { title: "Distro Subscription",       amount: 10,  description: "Monthly distribution subscription" },
  { title: "5 Hour Recording Session",  amount: 450, description: "5-hour studio recording session" },
  { title: "Camera Rental (1Day)",      amount: 50,  description: "1-day camera gear rental" },
  { title: "Studio Rental 2",          amount: 200, description: "Studio rental" },
  { title: "Studio Rental",            amount: 200, description: "Studio rental" },
  { title: "New EP",                   amount: 250, description: "New EP project" },
];

interface PaymentLink {
  id: number;
  dealId?: number | null;
  title: string;
  amount: number;
  currency: string;
  stripePaymentLinkId?: string | null;
  stripeUrl?: string | null;
  status: string;
  description?: string | null;
  source?: string;
  createdBy: number;
  createdAt: string;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount);
}

function SourceBadge({ source }: { source?: string }) {
  if (source === "hubspot") return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">HubSpot</span>
  );
  if (source === "manual") return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600">Manual</span>
  );
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">Stripe</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    expired: "bg-zinc-100 text-zinc-500",
    completed: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? "bg-zinc-100 text-zinc-500"}`}>
      {status}
    </span>
  );
}

function linkDomain(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

export default function Payments() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [stripeOpen, setStripeOpen] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const [stripeForm, setStripeForm] = useState({ title: "", amount: "", currency: "usd" });
  const [extForm, setExtForm] = useState({ title: "", amount: "", currency: "usd", url: "", description: "", source: "manual" as "manual" | "hubspot" });
  const [filter, setFilter] = useState<"all" | "stripe" | "hubspot" | "manual">("all");

  function authH(): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }

  const { data: links = [], isLoading } = useQuery<PaymentLink[]>({
    queryKey: ["payment-links"],
    queryFn: async () => {
      const r = await fetch("/api/payments", { headers: authH() });
      if (!r.ok) return [];
      const data: unknown = await r.json();
      return Array.isArray(data) ? (data as PaymentLink[]) : [];
    },
    enabled: !!token,
  });

  const createStripe = useMutation({
    mutationFn: async (data: { title: string; amount: number; currency: string }) => {
      const r = await fetch("/api/payments", { method: "POST", headers: authH(), body: JSON.stringify(data) });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-links"] }); setStripeOpen(false); setStripeForm({ title: "", amount: "", currency: "usd" }); toast({ title: "Payment link created" }); },
    onError: () => toast({ title: "Failed to create payment link", variant: "destructive" }),
  });

  const createExternal = useMutation({
    mutationFn: async (data: typeof extForm) => {
      const body = { title: data.title, amount: parseFloat(data.amount), currency: data.currency, url: data.url || null, description: data.description || null, source: data.source };
      const r = await fetch("/api/payments/import-external", { method: "POST", headers: authH(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-links"] }); setExternalOpen(false); setExtForm({ title: "", amount: "", currency: "usd", url: "", description: "", source: "manual" }); toast({ title: "External link added" }); },
    onError: () => toast({ title: "Failed to add link", variant: "destructive" }),
  });

  const importHubspot = useMutation({
    mutationFn: async () => {
      for (const l of HUBSPOT_LINKS) {
        await fetch("/api/payments/import-external", {
          method: "POST", headers: authH(),
          body: JSON.stringify({ title: l.title, amount: l.amount, currency: "usd", source: "hubspot", description: l.description }),
        });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-links"] }); toast({ title: `Imported ${HUBSPOT_LINKS.length} HubSpot payment links` }); },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const deleteLink = useMutation({
    mutationFn: async (id: number) => { await fetch(`/api/payments/${id}`, { method: "DELETE", headers: authH() }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payment-links"] }); toast({ title: "Deleted" }); },
  });

  const handleCopy = (url: string) => { navigator.clipboard.writeText(url); toast({ title: "Link copied" }); };

  const alreadyImported = links.some((l) => l.source === "hubspot");
  const filtered = filter === "all" ? links : links.filter((l) => (l.source ?? "stripe") === filter);
  const hasLinks = links.length > 0;
  const totalValue = links.reduce((a, l) => a + l.amount, 0);

  return (
    <div className="p-6 space-y-6 flex-1 overflow-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Payment Links</h1>
          <p className="text-muted-foreground text-sm">Stripe, HubSpot, and manual payment links</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!alreadyImported && (
            <Button
              variant="outline"
              onClick={() => importHubspot.mutate()}
              disabled={importHubspot.isPending}
              className="gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50"
            >
              <Download className="h-4 w-4" />
              {importHubspot.isPending ? "Importing..." : "Import HubSpot Links (8)"}
            </Button>
          )}
          {alreadyImported && (
            <span className="flex items-center gap-1.5 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-1.5">
              <CheckCircle2 className="h-4 w-4" /> HubSpot links imported
            </span>
          )}
          <Button variant="outline" onClick={() => setExternalOpen(true)} className="gap-1.5">
            <Link2 className="h-4 w-4" /> Add External Link
          </Button>
          <Button onClick={() => setStripeOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New via Stripe
          </Button>
        </div>
      </div>

      {/* Stats */}
      {hasLinks && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Links",  value: links.length },
            { label: "HubSpot",      value: links.filter((l) => l.source === "hubspot").length },
            { label: "Stripe Live",  value: links.filter((l) => l.stripePaymentLinkId).length },
            { label: "Total Value",  value: formatCurrency(totalValue, "usd") },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      {hasLinks && (
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <div className="overflow-x-auto">
            <TabsList className="w-max min-w-full">
              <TabsTrigger value="all" className="shrink-0">All ({links.length})</TabsTrigger>
              <TabsTrigger value="hubspot" className="shrink-0">HubSpot ({links.filter((l) => l.source === "hubspot").length})</TabsTrigger>
              <TabsTrigger value="stripe" className="shrink-0">Stripe ({links.filter((l) => (l.source ?? "stripe") === "stripe").length})</TabsTrigger>
              <TabsTrigger value="manual" className="shrink-0">Manual ({links.filter((l) => l.source === "manual").length})</TabsTrigger>
            </TabsList>
          </div>
        </Tabs>
      )}

      {/* Links list */}
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : !hasLinks ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">No payment links yet</h3>
          <p className="text-muted-foreground text-sm mb-4">Import your HubSpot links or create a new Stripe link.</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => importHubspot.mutate()} disabled={importHubspot.isPending} className="gap-1.5 border-orange-300 text-orange-700 hover:bg-orange-50">
              <Download className="h-4 w-4" /> Import HubSpot Links
            </Button>
            <Button onClick={() => setStripeOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New via Stripe
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground border border-zinc-200 rounded-lg bg-white shadow-sm">No links in this category</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((link) => (
            <PaymentLinkRow
              key={link.id}
              link={link}
              onDelete={() => deleteLink.mutate(link.id)}
              onCopy={() => link.stripeUrl && handleCopy(link.stripeUrl)}
            />
          ))}
        </div>
      )}

      {/* Stripe create dialog */}
      <Dialog open={stripeOpen} onOpenChange={setStripeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Stripe Payment Link</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={stripeForm.title} onChange={(e) => setStripeForm({ ...stripeForm, title: e.target.value })} placeholder="Mastering Session" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount ($)</Label>
                <Input type="number" min="0.01" step="0.01" value={stripeForm.amount} onChange={(e) => setStripeForm({ ...stripeForm, amount: e.target.value })} placeholder="100.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={stripeForm.currency} onChange={(e) => setStripeForm({ ...stripeForm, currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStripeOpen(false)}>Cancel</Button>
              <Button onClick={() => createStripe.mutate({ title: stripeForm.title, amount: parseFloat(stripeForm.amount), currency: stripeForm.currency })} disabled={createStripe.isPending}>
                {createStripe.isPending ? "Creating..." : "Create via Stripe"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* External link dialog */}
      <Dialog open={externalOpen} onOpenChange={setExternalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add External Payment Link</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">Add a HubSpot, PayPal, or any external payment link manually.</p>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={extForm.title} onChange={(e) => setExtForm({ ...extForm, title: e.target.value })} placeholder="Recording Session" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount ($)</Label>
                <Input type="number" min="0" step="0.01" value={extForm.amount} onChange={(e) => setExtForm({ ...extForm, amount: e.target.value })} placeholder="450.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm" value={extForm.source} onChange={(e) => setExtForm({ ...extForm, source: e.target.value as "manual" | "hubspot" })}>
                  <option value="hubspot">HubSpot</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Payment URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input value={extForm.url} onChange={(e) => setExtForm({ ...extForm, url: e.target.value })} placeholder="https://app-na2.hubspot.com/payment-links/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={extForm.description} onChange={(e) => setExtForm({ ...extForm, description: e.target.value })} rows={2} placeholder="Notes about this link..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setExternalOpen(false)}>Cancel</Button>
              <Button onClick={() => createExternal.mutate(extForm)} disabled={createExternal.isPending || !extForm.title || !extForm.amount}>
                {createExternal.isPending ? "Adding..." : "Add Link"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentLinkRow({ link, onDelete, onCopy }: { link: PaymentLink; onDelete: () => void; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-4 p-4 bg-white border border-zinc-200 rounded-xl shadow-sm hover:shadow-md transition-shadow group">
      <div className={`p-2 rounded-lg ${link.source === "hubspot" ? "bg-orange-100" : "bg-primary/10"}`}>
        <Link2 className={`h-5 w-5 ${link.source === "hubspot" ? "text-orange-600" : "text-primary"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <p className="font-medium text-sm truncate">{link.title}</p>
          <SourceBadge source={link.source} />
          <StatusBadge status={link.status} />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-primary">{formatCurrency(link.amount, link.currency)}</span>
          {link.stripeUrl ? (
            <a href={link.stripeUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
              {linkDomain(link.stripeUrl)} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-xs text-muted-foreground italic">No URL — paste link to activate</span>
          )}
          {link.description && <span className="text-xs text-muted-foreground truncate max-w-[160px]">{link.description}</span>}
        </div>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {link.stripeUrl && (
          <>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCopy} title="Copy link"><Copy className="h-4 w-4" /></Button>
            <a href={link.stripeUrl} target="_blank" rel="noreferrer">
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Open link"><ExternalLink className="h-4 w-4" /></Button>
            </a>
          </>
        )}
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDelete} title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground shrink-0">{new Date(link.createdAt).toLocaleDateString()}</p>
    </div>
  );
}
