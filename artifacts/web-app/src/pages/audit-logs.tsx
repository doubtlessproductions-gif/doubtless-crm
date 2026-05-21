import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Shield, Search, RefreshCw, Download } from "lucide-react";
import { format } from "date-fns";

interface AuditRow {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  entityLabel: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

function actionColor(action: string): string {
  if (action.includes("deleted") || action.includes("removed")) return "destructive";
  if (action.includes("created") || action.includes("uploaded")) return "default";
  if (action.includes("updated") || action.includes("changed")) return "secondary";
  if (action.includes("login") || action.includes("logout")) return "outline";
  return "outline";
}

function actionIcon(action: string): string {
  if (action.includes("deal")) return "💼";
  if (action.includes("contact")) return "👤";
  if (action.includes("file") || action.includes("media")) return "📁";
  if (action.includes("login")) return "🔑";
  if (action.includes("automation")) return "⚡";
  if (action.includes("subscription")) return "💳";
  if (action.includes("user")) return "👥";
  if (action.includes("project")) return "🎵";
  if (action.includes("artist")) return "🎤";
  if (action.includes("release")) return "💿";
  if (action.includes("form")) return "📝";
  if (action.includes("time")) return "⏱️";
  return "📋";
}

const ENTITY_TYPES = ["", "deal", "contact", "artist", "user", "file", "media_version", "automation", "subscription", "subscription_plan", "project", "release", "form", "time_entry"];

export default function AuditLogsPage() {
  const { token } = useAuth();
  const [search, setSearch]       = useState("");
  const [entityType, setEntityType] = useState("");
  const [offset, setOffset]       = useState(0);
  const limit = 100;

  const authH = useCallback((t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {}, []);

  const params = new URLSearchParams();
  if (search)     params.set("action", search);
  if (entityType) params.set("entityType", entityType);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const { data, isLoading, refetch, isFetching } = useQuery<{ rows: AuditRow[]; total: number }>({
    queryKey: ["audit-logs", search, entityType, offset],
    queryFn: () =>
      fetch(`/api/admin/audit-logs?${params}`, { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  function exportCSV() {
    const header = "id,timestamp,user,action,entityType,entityId,entityLabel,ip\n";
    const body = rows.map((r) =>
      [r.id, r.createdAt, r.userName ?? "", r.action, r.entityType ?? "", r.entityId ?? "", r.entityLabel ?? "", r.ipAddress ?? ""].join(",")
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "audit-log.csv"; a.click();
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-indigo-500" />
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">Audit Log</h1>
          <span className="text-sm text-muted-foreground">({total.toLocaleString()} events)</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by action…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
            className="pl-8 h-9"
          />
        </div>
        <Select value={entityType} onValueChange={(v) => { setEntityType(v === "_all" ? "" : v); setOffset(0); }}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue placeholder="All entity types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All entity types</SelectItem>
            {ENTITY_TYPES.filter(Boolean).map((t) => (
              <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
        <div className="grid grid-cols-[140px_160px_220px_160px_140px_1fr] text-xs font-medium text-muted-foreground px-4 py-2.5 border-b bg-zinc-50">
          <span>Timestamp</span>
          <span>User</span>
          <span>Action</span>
          <span>Entity</span>
          <span>IP</span>
          <span>Details</span>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground text-sm">No audit log entries yet.</div>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[140px_160px_220px_160px_140px_1fr] px-4 py-2.5 text-sm hover:bg-zinc-50 transition-colors items-start">
                <span className="text-xs text-muted-foreground font-mono">
                  {format(new Date(row.createdAt), "MM/dd HH:mm:ss")}
                </span>
                <span className="truncate text-xs font-medium">{row.userName ?? <span className="text-muted-foreground">System</span>}</span>
                <div className="flex items-center gap-1.5">
                  <span>{actionIcon(row.action)}</span>
                  <Badge variant={actionColor(row.action) as "default" | "secondary" | "destructive" | "outline"} className="text-[10px] px-1.5 py-0 font-mono">
                    {row.action}
                  </Badge>
                </div>
                <span className="text-xs text-zinc-600 truncate">
                  {row.entityLabel ? (
                    <>{row.entityType && <span className="text-muted-foreground">{row.entityType} · </span>}{row.entityLabel}</>
                  ) : (
                    <span className="text-muted-foreground">{row.entityType ?? "—"}</span>
                  )}
                </span>
                <span className="text-xs font-mono text-muted-foreground">{row.ipAddress ?? "—"}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {Object.keys(row.metadata ?? {}).length > 0
                    ? JSON.stringify(row.metadata).slice(0, 80)
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {total > limit && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
