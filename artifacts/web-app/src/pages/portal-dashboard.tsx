import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { usePortalAuth, portalFetch } from "@/hooks/use-portal-auth";
import { PortalShell } from "./portal-login";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  ChevronDown, ChevronUp, Send, FileText, Clock, CheckCircle2,
  MessageSquare, LogOut, Film, Lock, Download, Play, Loader2,
  ExternalLink, Globe, BookOpen, Headphones, Bell, X, Receipt,
  CheckCheck, AlertCircle, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Shared types ─────────────────────────────────────────────────────────────

interface TimelineItem { date: string; label: string }

interface Project {
  id: number; title: string; status: string;
  createdAt: string; timeline: TimelineItem[]; fileCount: number;
}

interface PortalMessage {
  id: number; content: string; fileUrl: string | null;
  fileName: string | null; createdAt: string;
  isFromPortal: boolean; authorName: string;
}

interface PortalVideo {
  id: number; title: string; description: string | null;
  status: string; durationSeconds: number | null; sizeBytes: number | null;
  downloadEnabled: boolean; stripeInvoiceUrl: string | null;
  invoiceAmountCents: number | null; hasThumbnail: boolean;
  hasPreview: boolean; createdAt: string;
}

interface PortalThread {
  id: number; title: string; type: string;
  reviewFileUrl: string | null; reviewFileName: string | null;
  createdAt: string;
}

interface PortalPage {
  id: number; title: string; slug: string;
  description: string | null; status: string; updatedAt: string;
}

interface PortalInvoice {
  id: number; number: string; total: string;
  status: string; dueDate: string | null;
  sentAt: string | null; paidAt: string | null;
  viewToken: string | null; createdAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string) {
  switch (status) {
    case "Complete": return "bg-green-100 text-green-800 border-green-200";
    case "Closed":   return "bg-gray-100 text-gray-600 border-gray-200";
    case "In Progress": case "In Negotiation":
    case "Proposal Sent": case "In Discussion":
      return "bg-blue-100 text-blue-800 border-blue-200";
    default: return "bg-yellow-100 text-yellow-800 border-yellow-200";
  }
}

function statusIcon(status: string) {
  if (status === "Complete") return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  if (status === "Closed")   return <CheckCircle2 className="h-4 w-4 text-gray-400" />;
  return <Clock className="h-4 w-4 text-blue-600" />;
}

function fmtDuration(s: number | null | undefined) {
  if (!s) return null;
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtCents(cents: number | null | undefined) {
  if (!cents) return null;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

// ── Blob URL hook for portal-authenticated media ──────────────────────────────

function usePortalBlobUrl(path: string | null, token: string | null) {
  const [url, setUrl]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path || !token) { setUrl(null); return; }
    let revoked = false;
    setLoading(true);
    portalFetch(path, token)
      .then((r) => r.ok ? r.blob() : null)
      .then((blob) => {
        if (revoked || !blob) return;
        setUrl(URL.createObjectURL(blob));
      })
      .catch(() => {})
      .finally(() => { if (!revoked) setLoading(false); });
    return () => {
      revoked = true;
      setUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [path, token]);

  return { url, loading };
}

// ── Inline message thread widget (shared by projects + threads tabs) ──────────
function ThreadMessages({
  fetchPath, postPath, token,
}: {
  fetchPath: string; postPath: string; token: string | null;
}) {
  const [messages, setMessages] = useState<PortalMessage[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [text, setText]         = useState("");
  const [sending, setSending]   = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    portalFetch(fetchPath, token)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setMessages(Array.isArray(data) ? data : data.messages ?? []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [fetchPath, token]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await portalFetch(postPath, token, {
        method: "POST",
        body: JSON.stringify({ content: text.trim() }),
      });
      if (res.ok) {
        const msg = await res.json();
        setMessages((prev) => [...(prev ?? []), msg]);
        setText("");
      } else {
        toast({ title: "Failed to send message", variant: "destructive" });
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-400 italic">Loading messages…</p>;

  return (
    <div>
      <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
        {(messages ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 italic">No messages yet. Send one below!</p>
        ) : (
          (messages ?? []).map((msg) => (
            <div key={msg.id} className={`flex ${msg.isFromPortal ? "justify-end" : "justify-start"}`}>
              <div className={cn(
                "max-w-[80%] rounded-lg px-4 py-2.5 text-sm shadow-sm",
                msg.isFromPortal ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-800",
              )}>
                {msg.fileUrl ? (
                  <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer"
                    className={`flex items-center gap-1.5 underline ${msg.isFromPortal ? "text-indigo-100" : "text-indigo-600"}`}>
                    <FileText className="h-3.5 w-3.5" />{msg.fileName ?? "File"}
                  </a>
                ) : (
                  <p>{msg.content}</p>
                )}
                <p className={`text-xs mt-1 ${msg.isFromPortal ? "text-indigo-200" : "text-gray-400"}`}>
                  {msg.authorName} · {format(new Date(msg.createdAt), "MMM d, h:mm a")}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="Send a message to the team…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={sending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

// ── Project card (deals) ─────────────────────────────────────────────────────
function ProjectCard({ project, token }: { project: Project; token: string | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div
        className="p-6 flex items-start justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3">
          {statusIcon(project.status)}
          <div>
            <h3 className="font-semibold text-gray-900">{project.title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Started {format(new Date(project.createdAt), "MMMM d, yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`border ${statusColor(project.status)}`}>{project.status}</Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          <div className="p-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4" /> Project Timeline
            </h4>
            {project.timeline.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No events yet.</p>
            ) : (
              <ol className="relative border-l border-gray-200 ml-3 space-y-4">
                {project.timeline.map((item, i) => (
                  <li key={i} className="ml-4">
                    <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white" />
                    <p className="text-sm font-medium text-gray-800">{item.label}</p>
                    <time className="text-xs text-gray-400">{format(new Date(item.date), "MMM d, yyyy")}</time>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="p-6">
            <h4 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4" /> Messages
            </h4>
            <ThreadMessages
              fetchPath={`/api/portal/projects/${project.id}/messages`}
              postPath={`/api/portal/projects/${project.id}/messages`}
              token={token}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Video card ───────────────────────────────────────────────────────────────
function VideoCard({ video, token }: { video: PortalVideo; token: string | null }) {
  const [showPreview, setShowPreview] = useState(false);
  const { url: previewUrl, loading: previewLoading } = usePortalBlobUrl(
    showPreview && video.hasPreview ? `/api/portal/videos/${video.id}/preview` : null,
    token,
  );

  const isLocked     = !video.downloadEnabled;
  const isProcessing = video.status === "processing" || video.status === "uploading";

  async function handleDownload() {
    if (!token) return;
    const res = await portalFetch(`/api/portal/videos/${video.id}/download`, token);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${video.title}.mp4`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-start gap-3">
            <div className={cn(
              "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
              isProcessing ? "bg-yellow-50" : isLocked ? "bg-orange-50" : "bg-green-50",
            )}>
              {isProcessing
                ? <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
                : isLocked
                ? <Lock className="h-4 w-4 text-orange-500" />
                : <CheckCircle2 className="h-4 w-4 text-green-600" />}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{video.title}</h3>
              {video.description && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{video.description}</p>}
            </div>
          </div>
          <span className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full border shrink-0",
            isProcessing ? "bg-yellow-50 text-yellow-700 border-yellow-200"
              : isLocked ? "bg-orange-50 text-orange-700 border-orange-200"
              : "bg-green-50 text-green-700 border-green-200",
          )}>
            {isProcessing ? "Processing…" : isLocked ? "Awaiting Payment" : "Unlocked"}
          </span>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-gray-400 ml-12 mb-3">
          {fmtDuration(video.durationSeconds) && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDuration(video.durationSeconds)}</span>}
          <span>{format(new Date(video.createdAt), "MMM d, yyyy")}</span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 ml-12">
          {video.hasPreview && !isProcessing && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowPreview((v) => !v)}>
              <Play className="h-3 w-3 mr-1" />{showPreview ? "Hide Preview" : "Watch Preview"}
            </Button>
          )}
          {!isLocked && (
            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={handleDownload}>
              <Download className="h-3 w-3 mr-1" />Download
            </Button>
          )}
          {isLocked && video.stripeInvoiceUrl && (
            <a href={video.stripeInvoiceUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50">
                <ExternalLink className="h-3 w-3 mr-1" />Pay Invoice {fmtCents(video.invoiceAmountCents) ? `(${fmtCents(video.invoiceAmountCents)})` : ""}
              </Button>
            </a>
          )}
          {isLocked && !video.stripeInvoiceUrl && !isProcessing && (
            <p className="text-xs text-gray-400 flex items-center gap-1 self-center">
              <Lock className="h-3 w-3" /> Your team will send an invoice to unlock this video
            </p>
          )}
        </div>
      </div>

      {/* Preview player */}
      {showPreview && (
        <div className="border-t border-gray-100 p-5 bg-black">
          {previewLoading && (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
          {previewUrl && (
            <video src={previewUrl} controls autoPlay className="w-full rounded-lg max-h-72" />
          )}
          <p className="text-xs text-gray-400 mt-2 text-center">30-second watermarked preview</p>
        </div>
      )}
    </div>
  );
}

// ── Thread card (direct assignments) ─────────────────────────────────────────
function ThreadCard({ thread, token }: { thread: PortalThread; token: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const isReview = thread.type === "review";

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div
        className="p-5 flex items-start justify-between cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
            isReview ? "bg-violet-50" : "bg-blue-50",
          )}>
            {isReview
              ? <Headphones className="h-4 w-4 text-violet-600" />
              : <MessageSquare className="h-4 w-4 text-blue-600" />}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{thread.title}</h3>
            {isReview && thread.reviewFileName && (
              <p className="text-xs text-violet-600 mt-0.5 flex items-center gap-1">
                <Headphones className="h-3 w-3" /> {thread.reviewFileName}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">
              {format(new Date(thread.createdAt), "MMMM d, yyyy")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {isReview ? "Song Review" : "General"}
          </Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-5">
          {isReview && thread.reviewFileUrl && thread.reviewFileName && (
            <div className="mb-4 p-3 bg-violet-50 rounded-lg border border-violet-100">
              <p className="text-xs font-medium text-violet-700 mb-2 flex items-center gap-1">
                <Headphones className="h-3.5 w-3.5" /> Reference File
              </p>
              <audio controls src={thread.reviewFileUrl} className="w-full h-8" />
            </div>
          )}
          <ThreadMessages
            fetchPath={`/api/portal/threads/${thread.id}/messages`}
            postPath={`/api/portal/threads/${thread.id}/messages`}
            token={token}
          />
        </div>
      )}
    </div>
  );
}

// ── Invoice card ─────────────────────────────────────────────────────────────
function InvoiceCard({ invoice, token }: { invoice: PortalInvoice; token: string | null }) {
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested]   = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const { toast } = useToast();

  const statusMeta: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    draft:   { label: "Draft",   cls: "bg-gray-100 text-gray-600 border-gray-200",    icon: <FileText className="h-3.5 w-3.5 text-gray-400" /> },
    sent:    { label: "Sent",    cls: "bg-blue-100 text-blue-700 border-blue-200",    icon: <Clock className="h-3.5 w-3.5 text-blue-500" /> },
    paid:    { label: "Paid",    cls: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> },
    overdue: { label: "Overdue", cls: "bg-red-100 text-red-700 border-red-200",       icon: <AlertCircle className="h-3.5 w-3.5 text-red-500" /> },
  };
  const meta = statusMeta[invoice.status] ?? statusMeta["sent"]!;

  async function handleDownload() {
    if (!token) return;
    setDownloading(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoice.id}/pdf`, token);
      if (!res.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${invoice.number}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  }

  async function handlePaymentRequest() {
    if (!token || requested) return;
    setRequesting(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoice.id}/payment-request`, token, { method: "POST" });
      if (res.ok) {
        setRequested(true);
        toast({ title: "Confirmation sent", description: "Your team has been notified." });
      } else {
        toast({ title: "Request failed", variant: "destructive" });
      }
    } finally {
      setRequesting(false);
    }
  }

  async function handlePayNow() {
    if (!token) return;
    setCheckingOut(true);
    try {
      const res = await portalFetch(`/api/portal/invoices/${invoice.id}/checkout-session`, token, { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { checkoutUrl: string | null };
        if (data.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          toast({ title: "Payment unavailable", description: "No checkout URL was returned. Please contact support.", variant: "destructive" });
        }
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error: string };
        toast({ title: "Payment unavailable", description: err.error ?? "Could not start checkout. Please try again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Payment failed", description: "Could not connect to payment service.", variant: "destructive" });
    } finally {
      setCheckingOut(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
            invoice.status === "paid" ? "bg-green-50" : invoice.status === "overdue" ? "bg-red-50" : "bg-blue-50",
          )}>
            <Receipt className={cn("h-4 w-4", invoice.status === "paid" ? "text-green-600" : invoice.status === "overdue" ? "text-red-500" : "text-blue-600")} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900">{invoice.number}</h3>
              <Badge className={`border text-xs ${meta.cls}`}>{meta.label}</Badge>
            </div>
            <p className="text-lg font-bold text-gray-900 mt-1">${Number(invoice.total).toFixed(2)}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-400">
              <span>Issued {format(new Date(invoice.createdAt), "MMM d, yyyy")}</span>
              {invoice.dueDate && (
                <span className={cn(invoice.status === "overdue" && "text-red-500 font-medium")}>
                  Due {format(new Date(invoice.dueDate), "MMM d, yyyy")}
                </span>
              )}
              {invoice.paidAt && (
                <span className="text-green-600">Paid {format(new Date(invoice.paidAt), "MMM d, yyyy")}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4 ml-12">
        {invoice.viewToken && (
          <a href={`/api/invoices/view/${invoice.viewToken}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
              <ExternalLink className="h-3 w-3" /> View Invoice
            </Button>
          </a>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Download PDF
        </Button>
        {invoice.status !== "paid" && (
          <>
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handlePayNow}
              disabled={checkingOut}
            >
              {checkingOut ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />}
              {checkingOut ? "Redirecting…" : "Pay Now"}
            </Button>
            <Button
              size="sm"
              variant={requested ? "outline" : "ghost"}
              className={cn("h-7 text-xs gap-1.5 text-gray-500", requested && "border-green-300 text-green-700")}
              onClick={handlePaymentRequest}
              disabled={requesting || requested}
            >
              {requesting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCheck className="h-3 w-3" />
              )}
              {requested ? "Confirmation Sent" : "I've Paid Manually"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Page card ────────────────────────────────────────────────────────────────
function PageCard({ page }: { page: PortalPage }) {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <BookOpen className="h-4 w-4 text-emerald-600" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{page.title}</h3>
          {page.description && <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{page.description}</p>}
          <p className="text-xs text-gray-400 mt-1">
            Updated {format(new Date(page.updatedAt), "MMM d, yyyy")}
          </p>
        </div>
      </div>
      <a href={`${BASE}/p/${page.slug}`} target="_blank" rel="noreferrer" className="shrink-0">
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5">
          <Globe className="h-3.5 w-3.5" /> View Page
        </Button>
      </a>
    </div>
  );
}

// ── Tab bar ──────────────────────────────────────────────────────────────────
type Tab = "projects" | "videos" | "messages" | "pages" | "invoices";

function TabBar({ active, onChange, counts }: {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: Record<Tab, number>;
}) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "projects",  label: "Projects",  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    { id: "videos",    label: "Videos",    icon: <Film className="h-3.5 w-3.5" /> },
    { id: "messages",  label: "Messages",  icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "pages",     label: "Pages",     icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "invoices",  label: "Invoices",  icon: <Receipt className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex border-b border-gray-200 mb-6">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px",
            active === tab.id
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
          )}
        >
          {tab.icon}
          {tab.label}
          {counts[tab.id] > 0 && (
            <span className={cn(
              "ml-1 text-xs rounded-full px-1.5 py-0.5 font-medium",
              active === tab.id ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600",
            )}>
              {counts[tab.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main portal dashboard ────────────────────────────────────────────────────
export default function PortalDashboard() {
  const { token, isAuthenticated, logout } = usePortalAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useState<Tab>("projects");

  const [me,            setMe]            = useState<{ email: string; contact: { name: string; company?: string | null } } | null>(null);
  const [projects,      setProjects]      = useState<Project[]>([]);
  const [videos,        setVideos]        = useState<PortalVideo[]>([]);
  const [threads,       setThreads]       = useState<PortalThread[]>([]);
  const [pages,         setPages]         = useState<PortalPage[]>([]);
  const [invoices,      setInvoices]      = useState<PortalInvoice[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [notifications, setNotifications] = useState<Array<{ id: number; type: string; title: string; body: string | null; read: boolean; createdAt: string }>>([]);
  const [showNotifs,    setShowNotifs]    = useState(false);
  const { toast } = useToast();
  const paymentHandledRef = useRef(false);

  const refreshInvoices = useCallback(() => {
    if (!token) return;
    portalFetch("/api/portal/invoices", token)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setInvoices(Array.isArray(data) ? data : []));
  }, [token]);

  useEffect(() => {
    if (!isAuthenticated) { setLocation("/portal/login"); return; }

    Promise.all([
      portalFetch("/api/portal/me",            token).then((r) => r.ok ? r.json() : null),
      portalFetch("/api/portal/projects",      token).then((r) => r.ok ? r.json() : []),
      portalFetch("/api/portal/videos",        token).then((r) => r.ok ? r.json() : []),
      portalFetch("/api/portal/threads",       token).then((r) => r.ok ? r.json() : []),
      portalFetch("/api/portal/pages",         token).then((r) => r.ok ? r.json() : []),
      portalFetch("/api/portal/notifications", token).then((r) => r.ok ? r.json() : []),
      portalFetch("/api/portal/invoices",      token).then((r) => r.ok ? r.json() : []),
    ]).then(([meData, projectsData, videosData, threadsData, pagesData, notifsData, invoicesData]) => {
      setMe(meData);
      setProjects(Array.isArray(projectsData)  ? projectsData  : []);
      setVideos(Array.isArray(videosData)      ? videosData    : []);
      setThreads(Array.isArray(threadsData)    ? threadsData   : []);
      setPages(Array.isArray(pagesData)        ? pagesData     : []);
      setNotifications(Array.isArray(notifsData) ? notifsData  : []);
      setInvoices(Array.isArray(invoicesData)  ? invoicesData  : []);
    }).catch(() => logout()).finally(() => setLoading(false));
  }, [isAuthenticated, token, setLocation, logout]);

  useEffect(() => {
    if (!search || paymentHandledRef.current) return;
    const params = new URLSearchParams(search);
    const payment = params.get("payment");
    if (!payment) return;
    paymentHandledRef.current = true;

    let pollInterval: ReturnType<typeof setInterval> | undefined;

    if (payment === "success") {
      setActiveTab("invoices");
      toast({ title: "Payment received!", description: "Your invoice has been paid. It may take a moment to reflect." });
      window.history.replaceState({}, "", window.location.pathname);
      // Poll up to 5 times (3 s apart) waiting for the webhook to flip the invoice to "paid".
      let attempts = 0;
      const maxAttempts = 5;
      pollInterval = setInterval(() => {
        attempts++;
        refreshInvoices();
        if (attempts >= maxAttempts) clearInterval(pollInterval);
      }, 3000);
    } else if (payment === "cancelled") {
      setActiveTab("invoices");
      toast({ title: "Payment cancelled", description: "Your payment was not completed.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => { if (pollInterval !== undefined) clearInterval(pollInterval); };
  }, [search, toast, refreshInvoices]);

  // Auto-navigate to first non-empty tab if projects tab is empty
  useEffect(() => {
    if (loading) return;
    if (projects.length === 0 && videos.length > 0) setActiveTab("videos");
    else if (projects.length === 0 && threads.length > 0) setActiveTab("messages");
    else if (projects.length === 0 && pages.length > 0) setActiveTab("pages");
    else if (projects.length === 0 && invoices.length > 0) setActiveTab("invoices");
  }, [loading, projects.length, videos.length, threads.length, pages.length, invoices.length]);

  if (!isAuthenticated) return null;

  const counts: Record<Tab, number> = {
    projects: projects.length,
    videos:   videos.length,
    messages: threads.length,
    pages:    pages.length,
    invoices: invoices.length,
  };

  const totalItems = projects.length + videos.length + threads.length + pages.length + invoices.length;
  const firstName = me?.contact.name?.split(" ")[0] ?? null;

  return (
    <PortalShell>
      <div className="w-full max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            {me && (
              <>
                <h2 className="text-xl font-bold text-gray-900">
                  {firstName ? `Welcome back, ${firstName}` : "Your Portal"}
                </h2>
                {me.contact.company && (
                  <p className="text-sm text-gray-500">{me.contact.company}</p>
                )}
              </>
            )}
          </div>
            <div className="flex items-center gap-1">
            {/* Notification bell */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="relative text-gray-500 h-8 w-8 p-0"
                onClick={() => {
                  setShowNotifs((v) => !v);
                  if (!showNotifs && notifications.some((n) => !n.read)) {
                    portalFetch("/api/portal/notifications/read", token, { method: "PUT" }).then(() => {
                      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
                    });
                  }
                }}
              >
                <Bell className="h-4 w-4" />
                {notifications.some((n) => !n.read) && (
                  <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-red-500" />
                )}
              </Button>

              {showNotifs && (
                <div className="absolute right-0 top-9 z-50 w-80 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                    <span className="text-sm font-semibold text-gray-800">Notifications</span>
                    <button onClick={() => setShowNotifs(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
                    {notifications.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No notifications yet</p>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className={cn("px-4 py-3 text-sm", !n.read && "bg-indigo-50/60")}>
                          <p className="font-medium text-gray-800">{n.title}</p>
                          {n.body && <p className="text-gray-500 text-xs mt-0.5">{n.body}</p>}
                          <p className="text-[11px] text-gray-400 mt-1">{format(new Date(n.createdAt), "MMM d, h:mm a")}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={logout} className="text-gray-500">
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading your portal…</div>
        ) : totalItems === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <p className="text-gray-500 font-medium">Nothing here yet</p>
            <p className="text-sm text-gray-400 mt-1">Your team will add projects, videos, and updates soon.</p>
          </div>
        ) : (
          <>
            <TabBar active={activeTab} onChange={setActiveTab} counts={counts} />

            {/* Projects tab */}
            {activeTab === "projects" && (
              <div className="space-y-4">
                {projects.length === 0 ? (
                  <p className="text-center text-gray-400 py-10">No projects yet.</p>
                ) : (
                  projects.map((p) => <ProjectCard key={p.id} project={p} token={token} />)
                )}
              </div>
            )}

            {/* Videos tab */}
            {activeTab === "videos" && (
              <div className="space-y-4">
                {videos.length === 0 ? (
                  <p className="text-center text-gray-400 py-10">No videos shared with you yet.</p>
                ) : (
                  videos.map((v) => <VideoCard key={v.id} video={v} token={token} />)
                )}
              </div>
            )}

            {/* Messages tab */}
            {activeTab === "messages" && (
              <div className="space-y-4">
                {threads.length === 0 ? (
                  <p className="text-center text-gray-400 py-10">No message threads yet.</p>
                ) : (
                  threads.map((t) => <ThreadCard key={t.id} thread={t} token={token} />)
                )}
              </div>
            )}

            {/* Pages tab */}
            {activeTab === "pages" && (
              <div className="space-y-4">
                {pages.length === 0 ? (
                  <p className="text-center text-gray-400 py-10">No pages shared with you yet.</p>
                ) : (
                  pages.map((p) => <PageCard key={p.id} page={p} />)
                )}
              </div>
            )}

            {/* Invoices tab */}
            {activeTab === "invoices" && (
              <div className="space-y-4">
                {invoices.length === 0 ? (
                  <p className="text-center text-gray-400 py-10">No invoices yet.</p>
                ) : (
                  invoices.map((inv) => <InvoiceCard key={inv.id} invoice={inv} token={token} />)
                )}
              </div>
            )}
          </>
        )}
      </div>
    </PortalShell>
  );
}
