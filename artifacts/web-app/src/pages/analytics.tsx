import {
  useGetAnalyticsPipeline,
  useGetAnalyticsRevenue,
  useGetAnalyticsActivity,
  useGetAnalyticsWinRate,
  useGetAnalyticsTeam,
  useGetAnalyticsTeamMember,
  useGetMe,
  useGetOutreachAnalytics,
  getGetAnalyticsPipelineQueryKey,
  getGetAnalyticsRevenueQueryKey,
  getGetAnalyticsActivityQueryKey,
  getGetAnalyticsWinRateQueryKey,
  getGetAnalyticsTeamQueryKey,
  getGetAnalyticsTeamMemberQueryKey,
  getGetMeQueryKey,
  type TeamMember,
} from "@workspace/api-client-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Target, Activity, DollarSign, Clock, BarChart2, Settings2, X, Users, ChevronRight, Trophy, Briefcase, Loader2, Music, FolderOpen, Zap, ArrowUpDown, ArrowUp, ArrowDown, Download, MessageSquare, Send, MailOpen } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  lead: "#6366f1",
  qualified: "#8b5cf6",
  proposal: "#a855f7",
  negotiation: "#c084fc",
  won: "#22c55e",
  lost: "#ef4444",
};

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-3 rounded-full ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface TimeAnalytics {
  totalHoursThisMonth: number;
  avgHoursPerDeal: number;
  top3MostTimeIntensive: { dealId: number | null; dealTitle: string; hours: number }[];
  top8ForChart: { dealId: number | null; dealTitle: string; hours: number }[];
  profitabilityDistribution: {
    on_track: number;
    approaching: number;
    over_budget: number;
    no_value: number;
  };
}

interface MemberRate { userId: number; name: string; role: string; targetHourlyRate: string | null }

interface TimeSettings {
  id: number;
  targetHourlyRate: string;
  currency: string;
  memberRates?: MemberRate[];
}

function TimeSection({ token, isAdmin }: { token: string | null; isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [currencyInput, setCurrencyInput] = useState("USD");
  const [memberRateDrafts, setMemberRateDrafts] = useState<Record<number, string>>({});

  const authH = (t: string | null): Record<string, string> => t ? { Authorization: `Bearer ${t}` } : {};

  const { data: timeData, isLoading: timeLoading } = useQuery<TimeAnalytics>({
    queryKey: ["analytics-time"],
    queryFn: async () => {
      const r = await fetch("/api/analytics/time", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const { data: settings } = useQuery<TimeSettings>({
    queryKey: ["time-settings"],
    queryFn: async () => {
      const r = await fetch("/api/time/settings", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (settings) {
      setRateInput(settings.targetHourlyRate);
      setCurrencyInput(settings.currency);
      const drafts: Record<number, string> = {};
      for (const mr of settings.memberRates ?? []) {
        drafts[mr.userId] = mr.targetHourlyRate ?? "";
      }
      setMemberRateDrafts(drafts);
    }
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/time/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({
            targetHourlyRate: Number(rateInput),
            currency: currencyInput,
            memberRates: (settings?.memberRates ?? []).map((mr) => ({
              userId: mr.userId,
              targetHourlyRate: memberRateDrafts[mr.userId] ? Number(memberRateDrafts[mr.userId]) : null,
            })),
          }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Time settings saved" });
      qc.invalidateQueries({ queryKey: ["time-settings"] });
      setShowSettings(false);
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const targetRate = Number(settings?.targetHourlyRate ?? 100);

  const exportCsv = () => {
    const t = token;
    const url = `/api/time?format=csv`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "time-entries.csv");
    document.body.appendChild(a);

    fetch(url, { headers: authH(t) })
      .then((r) => r.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.click();
        URL.revokeObjectURL(objUrl);
        document.body.removeChild(a);
      });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Time & Profitability</h2>
          <p className="text-sm text-muted-foreground">Hours logged and project profitability</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" /> Export CSV
          </Button>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowSettings(v => !v)} className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" /> Settings
            </Button>
          )}
        </div>
      </div>

      {showSettings && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold">Time Tracking Settings</p>
              <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-zinc-700">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-end gap-4">
              <div className="space-y-1.5">
                <Label>Target hourly rate</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    min="1"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    className="pl-7 w-32"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input value={currencyInput} onChange={(e) => setCurrencyInput(e.target.value)} className="w-20" maxLength={10} />
              </div>
              <Button onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
                {saveSettings.isPending ? "Saving…" : "Save"}
              </Button>
            </div>

            {/* Per-member rates */}
            {(settings?.memberRates?.length ?? 0) > 0 && (
              <div className="mt-5 border-t pt-4">
                <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-zinc-400" />
                  Per-Member Rates
                  <span className="text-xs font-normal text-zinc-400">(leave blank to use workspace default ${targetRate}/hr)</span>
                </p>
                <div className="space-y-2">
                  {(settings?.memberRates ?? []).map((mr) => (
                    <div key={mr.userId} className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                        {mr.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm flex-1 min-w-0 truncate">{mr.name}</span>
                      <span className="text-xs text-zinc-400 capitalize w-16 text-right shrink-0">{mr.role}</span>
                      <div className="relative shrink-0">
                        <span className="absolute left-2.5 top-2 text-zinc-400 text-xs">$</span>
                        <input
                          type="number"
                          min="0"
                          step="5"
                          placeholder={String(targetRate)}
                          value={memberRateDrafts[mr.userId] ?? ""}
                          onChange={(e) =>
                            setMemberRateDrafts((prev) => ({ ...prev, [mr.userId]: e.target.value }))
                          }
                          className="w-24 pl-6 pr-2 py-1.5 text-sm border border-zinc-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {timeLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              title="Hours This Month"
              value={`${timeData?.totalHoursThisMonth ?? 0}h`}
              sub="logged this month"
              icon={Clock}
              color="bg-indigo-500"
            />
            <StatCard
              title="Avg Hours / Deal"
              value={`${timeData?.avgHoursPerDeal ?? 0}h`}
              sub="across all deals"
              icon={Activity}
              color="bg-cyan-500"
            />
            <StatCard
              title="Target Rate"
              value={`$${targetRate}/hr`}
              sub={`in ${settings?.currency ?? "USD"}`}
              icon={DollarSign}
              color="bg-emerald-500"
            />
          </>
        )}
      </div>

      {/* Top 3 most time-intensive */}
      {!timeLoading && (timeData?.top3MostTimeIntensive?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Most Time-Intensive Deals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {timeData!.top3MostTimeIntensive.map((d, i) => (
                <div key={d.dealId ?? i} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-zinc-400 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.dealTitle}</p>
                  </div>
                  <span className="text-sm font-semibold text-indigo-600">{d.hours}h</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Profitability distribution */}
      {!timeLoading && (timeData?.top8ForChart?.length ?? 0) > 0 && (() => {
        const dist = timeData!.profitabilityDistribution;
        const chartData = [
          { label: "On Track", count: dist.on_track, fill: "#10b981" },
          { label: "Approaching", count: dist.approaching, fill: "#f59e0b" },
          { label: "Over Budget", count: dist.over_budget, fill: "#ef4444" },
          { label: "No Value", count: dist.no_value, fill: "#9ca3af" },
        ];
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Profitability Distribution</CardTitle>
              <p className="text-xs text-muted-foreground">Deals by effective rate vs target (on track ≥ target, approaching ≥ 80%, over budget &lt; 80%)</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip formatter={(v: number) => [`${v} deal${v !== 1 ? "s" : ""}`, "Count"]} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell key={entry.label} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        );
      })()}

      {/* Hours per deal bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hours by Deal (Top 8)</CardTitle>
        </CardHeader>
        <CardContent>
          {timeLoading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : (timeData?.top8ForChart?.length ?? 0) === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground italic">
              No time entries yet — log time on your deals to see this chart
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={timeData!.top8ForChart} margin={{ top: 4, right: 16, bottom: 60, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="dealTitle"
                  tick={{ fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} width={35} />
                <Tooltip formatter={(v: number) => [`${v}h`, "Hours"]} />
                <Bar dataKey="hours" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const ROLE_META: Record<string, { label: string; color: string }> = {
  owner:    { label: "Owner",    color: "bg-amber-100 text-amber-700 border-amber-200" },
  admin:    { label: "Admin",    color: "bg-purple-100 text-purple-700 border-purple-200" },
  manager:  { label: "Manager",  color: "bg-blue-100 text-blue-700 border-blue-200" },
  artist:   { label: "Artist",   color: "bg-rose-100 text-rose-700 border-rose-200" },
  engineer: { label: "Engineer", color: "bg-amber-100 text-amber-700 border-amber-200" },
  ar:       { label: "A&R",      color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  intern:   { label: "Intern",   color: "bg-zinc-100 text-zinc-600 border-zinc-200" },
};

const BAR_COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#c084fc", "#d946ef", "#ec4899"];
const CAT_COLORS: Record<string, string> = {
  recording: "#6366f1", mixing: "#22c55e", mastering: "#f59e0b",
  video: "#3b82f6", admin: "#94a3b8", other: "#d1d5db",
};

function QuotaBar({ label, value, quota, progress, fmt }: {
  label: string; value: number; quota: number | null; progress: number | null; fmt: (v: number) => string;
}) {
  if (quota == null || quota === 0) return null;
  const capped = Math.min(progress ?? 0, 100);
  const color = (progress ?? 0) >= 100 ? "bg-green-500" : (progress ?? 0) >= 75 ? "bg-amber-400" : (progress ?? 0) >= 40 ? "bg-blue-400" : "bg-zinc-300";
  const textColor = (progress ?? 0) >= 100 ? "text-green-700" : (progress ?? 0) >= 75 ? "text-amber-700" : "text-zinc-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">{label}</span>
        <span className={cn("font-semibold tabular-nums", textColor)}>
          {fmt(value)} / {fmt(quota)} <span className="font-normal text-zinc-400">({progress ?? 0}%)</span>
        </span>
      </div>
      <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${capped}%` }} />
      </div>
    </div>
  );
}

function MemberDrawer({ userId, onClose, workspaceRate }: { userId: number | null; onClose: () => void; workspaceRate: number }) {
  const { data, isLoading } = useGetAnalyticsTeamMember(
    userId ?? 0,
    { query: { queryKey: getGetAnalyticsTeamMemberQueryKey(userId ?? 0), enabled: userId != null } },
  );

  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(v);

  const hasQuotas = data && (
    data.quotaDealsMonth != null || data.quotaRevenueMonth != null ||
    data.quotaHoursMonth != null || data.quotaArtistsMonth != null ||
    data.quotaProjectsMonth != null
  );

  return (
    <Sheet open={userId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        {isLoading || !data ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 pb-8">
            {/* Header */}
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center text-base font-bold text-indigo-700 shrink-0">
                  {data.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-lg leading-tight">{data.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge className={cn("text-xs border", ROLE_META[data.role]?.color ?? "bg-zinc-100 text-zinc-600 border-zinc-200")}>
                      {ROLE_META[data.role]?.label ?? data.role}
                    </Badge>
                    <span className={cn("text-xs font-semibold tabular-nums",
                      data.winRate >= 60 ? "text-green-600"
                        : data.winRate >= 30 ? "text-amber-600" : "text-zinc-400"
                    )}>
                      {data.winRate}% win rate
                    </span>
                  </div>
                </div>
              </SheetTitle>
            </SheetHeader>

            {/* Periodized deals KPIs */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Deals Closed</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "This Month",   value: data.dealsClosedMonth },
                  { label: "This Quarter", value: data.dealsClosedQuarter },
                  { label: "All Time",     value: data.dealsClosedAllTime },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue KPIs */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Revenue Closed</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "This Month", value: fmtCurrency(data.revenueClosedMonth) },
                  { label: "All Time",   value: fmtCurrency(data.revenueClosedAllTime) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Artists & Projects */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">A&R / Projects</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Artists Signed",  value: data.artistsSignedAllTime,  sub: `${data.artistsSignedMonth} this month` },
                  { label: "Projects Booked", value: data.projectsBookedAllTime, sub: `${data.projectsBookedMonth} this month` },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold mt-0.5">{value}</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">{sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rate & Hours */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <p className="text-[10px] text-muted-foreground mb-0.5">Effective Rate</p>
                <p className="text-xl font-bold">${data.effectiveRate}/hr</p>
                {data.targetHourlyRate == null && (
                  <p className="text-[10px] text-zinc-400">workspace default</p>
                )}
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white px-3 py-3">
                <p className="text-[10px] text-muted-foreground mb-0.5">Hours This Month</p>
                <p className="text-xl font-bold">{data.hoursThisMonth}h</p>
                {data.targetHoursMonth != null && (
                  <p className="text-[10px] text-zinc-400">target: {data.targetHoursMonth}h</p>
                )}
              </div>
            </div>

            {/* Quota progress bars */}
            {hasQuotas && (
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-indigo-500" /> Monthly Quota Progress
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <QuotaBar
                    label="Deals Closed"
                    value={data.dealsClosedMonth}
                    quota={data.quotaDealsMonth ?? null}
                    progress={data.quotaDealsProgress ?? null}
                    fmt={(v) => String(v)}
                  />
                  <QuotaBar
                    label="Revenue"
                    value={data.revenueClosedMonth}
                    quota={data.quotaRevenueMonth ?? null}
                    progress={data.quotaRevenueProgress ?? null}
                    fmt={fmtCurrency}
                  />
                  <QuotaBar
                    label="Hours Logged"
                    value={data.hoursThisMonth}
                    quota={data.quotaHoursMonth ?? null}
                    progress={data.quotaHoursProgress ?? null}
                    fmt={(v) => `${v}h`}
                  />
                  <QuotaBar
                    label="Artists Signed"
                    value={data.artistsSignedMonth}
                    quota={data.quotaArtistsMonth ?? null}
                    progress={data.quotaArtistsProgress ?? null}
                    fmt={(v) => String(v)}
                  />
                  <QuotaBar
                    label="Projects Booked"
                    value={data.projectsBookedMonth}
                    quota={data.quotaProjectsMonth ?? null}
                    progress={data.quotaProjectsProgress ?? null}
                    fmt={(v) => String(v)}
                  />
                  <QuotaBar
                    label="Templates Sent"
                    value={data.templatesSentMonth}
                    quota={data.quotaTemplatesMonth ?? null}
                    progress={data.quotaTemplatesProgress ?? null}
                    fmt={(v) => String(v)}
                  />
                  <QuotaBar
                    label="Form Submissions"
                    value={data.formSubmissionsMonth}
                    quota={data.quotaFormsMonth ?? null}
                    progress={data.quotaFormsProgress ?? null}
                    fmt={(v) => String(v)}
                  />
                </CardContent>
              </Card>
            )}

            {/* Monthly hours chart */}
            {data.monthlyHours.length > 0 && (
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">Hours per Month (6 months)</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={data.monthlyHours} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(m) => m.slice(5)} />
                      <YAxis tick={{ fontSize: 10 }} width={28} />
                      <Tooltip formatter={(v: number) => [`${v}h`, "Hours"]} />
                      <Bar dataKey="hours" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Category breakdown */}
            {data.categoryBreakdown.length > 0 && (
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">Time by Category</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data.categoryBreakdown.sort((a, b) => b.hours - a.hours).map((c, i) => {
                      const max = Math.max(...data.categoryBreakdown.map((x) => x.hours));
                      return (
                        <div key={c.category} className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500 w-20 capitalize shrink-0">{c.category}</span>
                          <div className="flex-1 bg-zinc-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${max > 0 ? (c.hours / max) * 100 : 0}%`, backgroundColor: CAT_COLORS[c.category] ?? BAR_COLORS[i % BAR_COLORS.length] }}
                            />
                          </div>
                          <span className="text-xs font-medium text-zinc-700 w-10 text-right shrink-0">{c.hours}h</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent deals */}
            {data.recentDeals.length > 0 && (
              <Card>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm">Recent Deals</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-zinc-100">
                    {data.recentDeals.map((d) => (
                      <div key={d.id} className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Briefcase className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                          <span className="text-sm truncate">{d.title}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium",
                            d.stage === "won" ? "bg-green-100 text-green-700"
                              : d.stage === "lost" ? "bg-red-100 text-red-700"
                              : "bg-zinc-100 text-zinc-600"
                          )}>{d.stage}</span>
                          {d.value > 0 && <span className="text-xs font-semibold text-zinc-700">{fmtCurrency(d.value)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function QuotaCell({ value, progress, quota, fmt }: { value: number; progress: number | null; quota: number | null; fmt: (v: number) => string }) {
  if (progress == null) {
    return <span className="font-semibold">{fmt(value)}</span>;
  }
  const capped = Math.min(progress, 100);
  const color = progress >= 100 ? "bg-green-500" : progress >= 75 ? "bg-amber-400" : progress >= 40 ? "bg-blue-400" : "bg-zinc-300";
  const textColor = progress >= 100 ? "text-green-700" : progress >= 75 ? "text-amber-700" : "text-zinc-600";
  return (
    <div className="flex flex-col items-center gap-0.5 min-w-[64px]">
      <span className="font-semibold text-sm">{fmt(value)}</span>
      <div className="w-full bg-zinc-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${capped}%` }} />
      </div>
      <span className={`text-[10px] font-medium ${textColor}`}>{progress}%</span>
    </div>
  );
}

function ActivityBreakdown({ deals, notes, contacts }: { deals: number; notes: number; contacts: number }) {
  const total = deals + notes + contacts;
  if (total === 0) return <span className="text-xs text-zinc-300">—</span>;
  return (
    <div className="flex flex-col items-center gap-0.5 text-[10px] leading-tight" title={`${total} actions this week`}>
      <div className="flex gap-1.5">
        {deals    > 0 && <span className="text-indigo-500 font-semibold">{deals}d</span>}
        {notes    > 0 && <span className="text-amber-500  font-semibold">{notes}n</span>}
        {contacts > 0 && <span className="text-green-500  font-semibold">{contacts}c</span>}
      </div>
      <span className="text-zinc-400">{total} total</span>
    </div>
  );
}

function TeamPerformanceSection({ token }: { token: string | null }) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<keyof TeamMember>("dealsClosedMonth");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: teamData, isLoading } = useGetAnalyticsTeam({
    query: { queryKey: getGetAnalyticsTeamQueryKey(), enabled: !!token },
  });
  const { data: settings } = useQuery({
    queryKey: ["time-settings"],
    queryFn: async () => {
      const r = await fetch("/api/time/settings", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ targetHourlyRate: string; currency: string }>;
    },
    enabled: !!token,
  });
  const workspaceRate = Number(settings?.targetHourlyRate ?? 100);

  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(v);

  function handleSort(key: keyof TeamMember) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const sorted = [...(teamData?.members ?? [])].sort((a, b) => {
    const av = Number((a as unknown as Record<string, unknown>)[sortKey] ?? 0);
    const bv = Number((b as unknown as Record<string, unknown>)[sortKey] ?? 0);
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const SortTh = ({ k, label, icon: Icon }: { k: keyof TeamMember; label: string; icon?: React.ElementType }) => (
    <TableHead
      className="cursor-pointer select-none hover:bg-zinc-100 text-center whitespace-nowrap"
      onClick={() => handleSort(k)}
    >
      <span className="flex items-center justify-center gap-1">
        {Icon && <Icon className="h-3 w-3 text-zinc-400" />}
        {label}
        {sortKey === k && <span className="text-[10px]">{sortDir === "desc" ? "↓" : "↑"}</span>}
      </span>
    </TableHead>
  );

  // Company-wide KPI summary
  const members = teamData?.members ?? [];
  const totalArtistsSigned  = members.reduce((a, m) => a + (m.artistsSigned ?? 0), 0);
  const totalProjectsBooked = members.reduce((a, m) => a + (m.projectsBooked ?? 0), 0);
  const avgWinRate = members.length > 0 ? Math.round(members.reduce((a, m) => a + m.winRate, 0) / members.length) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" /> Team Performance
          </h2>
          <p className="text-sm text-muted-foreground">Click a member to see their individual analytics</p>
        </div>
      </div>

      {/* Company-wide KPI stat cards */}
      {!isLoading && members.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard title="Artists Signed" value={totalArtistsSigned} sub="all time" icon={Music} color="bg-emerald-500" />
          <StatCard title="Projects Booked" value={totalProjectsBooked} sub="all time" icon={FolderOpen} color="bg-violet-500" />
          <StatCard title="Team Win Rate" value={`${avgWinRate}%`} sub="avg across team" icon={Target} color="bg-amber-500" />
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-xl" />
      ) : (sorted.length === 0) ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground italic border border-zinc-200 rounded-xl bg-white">
          No team members found
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-auto shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="font-semibold">Member</TableHead>
                <TableHead className="font-semibold">Role</TableHead>
                <SortTh k="dealsClosedMonth" label="Deals/Mo" icon={Briefcase} />
                <SortTh k="dealsClosedQuarter" label="Deals/Qtr" />
                <SortTh k="revenueClosedMonth" label="Rev/Mo" icon={DollarSign} />
                <SortTh k="openDeals" label="Open" />
                <SortTh k="pipelineValue" label="Pipeline $" icon={DollarSign} />
                <SortTh k="artistsSigned" label="Artists" icon={Music} />
                <SortTh k="projectsBooked" label="Projects" icon={FolderOpen} />
                <SortTh k="hoursThisMonth" label="Hours" icon={Clock} />
                <SortTh k="winRate" label="Win %" />
                <TableHead className="text-center font-semibold whitespace-nowrap">
                  <span className="flex items-center justify-center gap-1">
                    <Zap className="h-3 w-3 text-zinc-400" /> Activity
                  </span>
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((m, rank) => (
                <TableRow
                  key={m.userId}
                  className="cursor-pointer hover:bg-zinc-50 transition-colors"
                  onClick={() => setSelectedUserId(m.userId)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {rank === 0 && <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                      <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm">{m.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={cn("text-xs border", ROLE_META[m.role]?.color ?? "bg-zinc-100 text-zinc-600 border-zinc-200")}>
                      {ROLE_META[m.role]?.label ?? m.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <QuotaCell value={m.dealsClosedMonth} progress={m.quotaDealsProgress ?? null} quota={m.quotaDealsMonth ?? null} fmt={(v) => String(v)} />
                  </TableCell>
                  <TableCell className="text-center text-zinc-600 text-sm">{m.dealsClosedQuarter}</TableCell>
                  <TableCell className="text-center">
                    <QuotaCell value={m.revenueClosedMonth} progress={m.quotaRevenueProgress ?? null} quota={m.quotaRevenueMonth ?? null} fmt={fmtCurrency} />
                  </TableCell>
                  <TableCell className="text-center text-zinc-600 text-sm">{m.openDeals}</TableCell>
                  <TableCell className="text-center text-zinc-600 text-sm">{fmtCurrency(m.pipelineValue)}</TableCell>
                  <TableCell className="text-center">
                    <QuotaCell
                      value={m.artistsSigned ?? 0}
                      progress={m.quotaArtistsProgress ?? null}
                      quota={m.quotaArtistsMonth ?? null}
                      fmt={(v) => String(v)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <QuotaCell
                      value={m.projectsBooked ?? 0}
                      progress={m.quotaProjectsProgress ?? null}
                      quota={m.quotaProjectsMonth ?? null}
                      fmt={(v) => String(v)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <QuotaCell value={m.hoursThisMonth} progress={m.quotaHoursProgress ?? null} quota={m.quotaHoursMonth ?? null} fmt={(v) => `${v}h`} />
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={cn("text-sm font-semibold",
                      m.winRate >= 60 ? "text-green-600" : m.winRate >= 30 ? "text-amber-600" : "text-zinc-400"
                    )}>{m.winRate}%</span>
                  </TableCell>
                  <TableCell className="text-center">
                    <ActivityBreakdown
                      deals={m.activityDealsThisWeek ?? 0}
                      notes={m.activityNotesThisWeek ?? 0}
                      contacts={m.activityContactsThisWeek ?? 0}
                    />
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="h-4 w-4 text-zinc-400" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {sorted.some((m) => m.targetHourlyRate == null) && (
            <p className="text-xs text-zinc-400 px-4 py-2 border-t">* Using workspace default rate (${workspaceRate}/hr)</p>
          )}
        </div>
      )}

      <MemberDrawer userId={selectedUserId} onClose={() => setSelectedUserId(null)} workspaceRate={workspaceRate} />
    </div>
  );
}

const CATEGORIES = ["recording", "mixing", "mastering", "video", "admin", "other"] as const;
type SortKey = "date" | "dealTitle" | "userName" | "durationMinutes" | "category";

interface TimeEntry {
  id: number;
  dealId: number | null;
  userId: number;
  userName: string | null;
  userRate: string | null;
  dealTitle: string | null;
  contactName: string | null;
  date: string;
  durationMinutes: number;
  category: string;
  description: string | null;
}

interface DealOption { id: number; title: string }
interface StaffOption { userId: number; name: string }

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: "asc" | "desc" }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3.5 w-3.5 text-zinc-300 ml-1 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3.5 w-3.5 text-indigo-500 ml-1 inline" />
    : <ArrowDown className="h-3.5 w-3.5 text-indigo-500 ml-1 inline" />;
}

// ── Outreach Analytics section ────────────────────────────────────────────────

const OUTREACH_TYPE_COLORS: Record<string, string> = {
  dm:             "#6366f1",
  email:          "#8b5cf6",
  proposal:       "#a78bfa",
  recommendation: "#c4b5fd",
};

const OUTREACH_STATUS_CHART_COLORS: Record<string, string> = {
  draft:    "#e4e4e7",
  approved: "#93c5fd",
  sent:     "#a78bfa",
  replied:  "#6ee7b7",
};

function OutreachSection() {
  const { data, isLoading } = useGetOutreachAnalytics();

  const statusData = data
    ? Object.entries(data.byStatus).map(([status, count]) => ({ status, count }))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-violet-600" />
        <h3 className="font-semibold text-base">Outreach Performance</h3>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {isLoading ? (
          [1,2,3,4].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)
        ) : (
          <>
            <Card className="bg-gradient-to-br from-violet-50 to-white border-violet-100">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Total Generated</p>
                <p className="text-2xl font-bold text-violet-700">{data?.totalGenerated ?? 0}</p>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-100">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Sent</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold text-blue-700">{data?.totalSent ?? 0}</p>
                  <Send className="h-3.5 w-3.5 text-blue-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-green-50 to-white border-green-100">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Replies</p>
                <div className="flex items-baseline gap-1">
                  <p className="text-2xl font-bold text-green-700">{data?.totalReplied ?? 0}</p>
                  <MailOpen className="h-3.5 w-3.5 text-green-400" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gradient-to-br from-emerald-50 to-white border-emerald-100">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">Response Rate</p>
                <p className="text-2xl font-bold text-emerald-700">{data?.responseRate ?? 0}%</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Messages by Status</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <div className="h-40 bg-muted animate-pulse rounded" /> : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={statusData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4,4,0,0]}>
                    {statusData.map(entry => (
                      <Cell key={entry.status} fill={OUTREACH_STATUS_CHART_COLORS[entry.status] ?? "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* By type */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Messages by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <div className="h-40 bg-muted animate-pulse rounded" /> : (
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data?.byType ?? []} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="type" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4,4,0,0]}>
                    {(data?.byType ?? []).map(entry => (
                      <Cell key={entry.type} fill={OUTREACH_TYPE_COLORS[entry.type] ?? "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team outreach table */}
      {(data?.byMember?.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Team Outreach Activity</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team Member</TableHead>
                  <TableHead className="text-right">Generated</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                  <TableHead className="text-right">Response Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.byMember ?? []).map(m => (
                  <TableRow key={m.userId}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-right">{m.generated}</TableCell>
                    <TableCell className="text-right">{m.sent}</TableCell>
                    <TableCell className="text-right">{m.replied}</TableCell>
                    <TableCell className="text-right">
                      <span className={`font-semibold ${m.responseRate >= 50 ? "text-green-600" : m.responseRate >= 20 ? "text-blue-600" : "text-muted-foreground"}`}>
                        {m.responseRate}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* By genre */}
        {(data?.byGenre?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top Genres Targeted</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <div className="h-32 bg-muted animate-pulse rounded" /> : (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={data?.byGenre ?? []} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 64 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="genre" tick={{ fontSize: 11 }} width={60} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}

        {/* By region */}
        {(data?.byRegion?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top Regions Targeted</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <div className="h-32 bg-muted animate-pulse rounded" /> : (
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={data?.byRegion ?? []} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 64 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="region" tick={{ fontSize: 11 }} width={60} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[0,4,4,0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function TimeLogSection({ token }: { token: string | null }) {
  const authH = (t: string | null): Record<string, string> =>
    t ? { Authorization: `Bearer ${t}` } : {};

  const { toast } = useToast();

  const [searchText, setSearchText] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [staffId, setStaffId] = useState("all");
  const [category, setCategory] = useState("all");
  const [dealId, setDealId] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: settings } = useQuery<{ memberRates: StaffOption[] }>({
    queryKey: ["time-settings"],
    queryFn: async () => {
      const r = await fetch("/api/time/settings", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const { data: deals } = useQuery<DealOption[]>({
    queryKey: ["deals-list-for-timelog"],
    queryFn: async () => {
      const r = await fetch("/api/deals", { headers: authH(token) });
      if (!r.ok) throw new Error("Failed");
      const data = await r.json();
      const arr: { id: number; title: string }[] = Array.isArray(data) ? data : data.deals ?? [];
      return arr.map((d) => ({ id: d.id, title: d.title }));
    },
    enabled: !!token,
  });

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (fromDate) p.set("from", fromDate);
    if (toDate) p.set("to", toDate);
    if (staffId !== "all") p.set("userId", staffId);
    if (category !== "all") p.set("category", category);
    if (dealId !== "all") p.set("dealId", dealId);
    return p.toString();
  }, [fromDate, toDate, staffId, category, dealId]);

  const { data: entries, isLoading } = useQuery<TimeEntry[]>({
    queryKey: ["time-log-all", queryParams],
    queryFn: async () => {
      const r = await fetch(`/api/time${queryParams ? `?${queryParams}` : ""}`, {
        headers: authH(token),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  const filtered = useMemo(() => {
    if (!entries) return [];
    if (!searchText.trim()) return entries;
    const q = searchText.toLowerCase();
    return entries.filter((e) =>
      (e.dealTitle ?? "").toLowerCase().includes(q) ||
      (e.contactName ?? "").toLowerCase().includes(q) ||
      (e.userName ?? "").toLowerCase().includes(q) ||
      (e.description ?? "").toLowerCase().includes(q) ||
      e.category.toLowerCase().includes(q)
    );
  }, [entries, searchText]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.date.localeCompare(b.date);
      else if (sortKey === "dealTitle") cmp = (a.dealTitle ?? "").localeCompare(b.dealTitle ?? "");
      else if (sortKey === "userName") cmp = (a.userName ?? "").localeCompare(b.userName ?? "");
      else if (sortKey === "durationMinutes") cmp = a.durationMinutes - b.durationMinutes;
      else if (sortKey === "category") cmp = a.category.localeCompare(b.category);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const totalHours = useMemo(
    () => filtered.reduce((acc, e) => acc + e.durationMinutes, 0) / 60,
    [filtered],
  );

  const toggleSort = (col: SortKey) => {
    if (col === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(col); setSortDir("desc"); }
  };

  const exportCsv = () => {
    const csvParams = new URLSearchParams(queryParams);
    csvParams.set("format", "csv");
    const url = `/api/time?${csvParams.toString()}`;
    fetch(url, { headers: authH(token) })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "time-entries.csv";
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
      })
      .catch(() => {
        toast({ title: "Export failed", description: "Could not download CSV. Please try again.", variant: "destructive" });
      });
  };

  const clearFilters = () => {
    setSearchText(""); setFromDate(""); setToDate(""); setStaffId("all"); setCategory("all"); setDealId("all");
  };
  const hasFilters = searchText || fromDate || toDate || staffId !== "all" || category !== "all" || dealId !== "all";

  const staffList: StaffOption[] = settings?.memberRates ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold">Time Log</h2>
          <p className="text-sm text-muted-foreground">All time entries across every deal</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv} className="gap-1.5">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Deal, client, staff, notes…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="h-8 text-sm pr-7"
                />
                {searchText && (
                  <button
                    onClick={() => setSearchText("")}
                    className="absolute right-2 top-1.5 text-zinc-400 hover:text-zinc-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 text-sm w-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 text-sm w-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Staff</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue placeholder="All staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All staff</SelectItem>
                  {staffList.map((s) => (
                    <SelectItem key={s.userId} value={String(s.userId)}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-sm w-36">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Deal</Label>
              <Select value={dealId} onValueChange={setDealId}>
                <SelectTrigger className="h-8 text-sm w-44">
                  <SelectValue placeholder="All deals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All deals</SelectItem>
                  {(deals ?? []).map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasFilters && (
              <Button size="sm" variant="ghost" onClick={clearFilters} className="h-8 gap-1 text-xs">
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary row */}
      {!isLoading && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
          <span><span className="font-semibold text-foreground">{sorted.length}</span> entries</span>
          <span><span className="font-semibold text-foreground">{totalHours.toFixed(1)}h</span> total</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("date")}>
                  Date <SortIcon col="date" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("dealTitle")}>
                  Deal <SortIcon col="dealTitle" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("category")}>
                  Category <SortIcon col="category" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort("userName")}>
                  Staff <SortIcon col="userName" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead className="cursor-pointer select-none text-right whitespace-nowrap" onClick={() => toggleSort("durationMinutes")}>
                  Hours <SortIcon col="durationMinutes" sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground italic text-sm">
                    No time entries found{hasFilters ? " for the selected filters" : " — log time on your deals to get started"}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm">{e.date}</TableCell>
                    <TableCell className="max-w-[160px] truncate text-sm" title={e.dealTitle ?? "—"}>
                      {e.dealTitle ?? <span className="text-zinc-400">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[120px] truncate text-sm text-muted-foreground" title={e.contactName ?? ""}>
                      {e.contactName ?? <span className="text-zinc-300">—</span>}
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium capitalize",
                        e.category === "recording" && "bg-indigo-100 text-indigo-700",
                        e.category === "mixing" && "bg-green-100 text-green-700",
                        e.category === "mastering" && "bg-amber-100 text-amber-700",
                        e.category === "video" && "bg-blue-100 text-blue-700",
                        e.category === "admin" && "bg-slate-100 text-slate-600",
                        e.category === "other" && "bg-zinc-100 text-zinc-600",
                      )}>
                        {e.category}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{e.userName ?? <span className="text-zinc-400">—</span>}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium">
                      {(e.durationMinutes / 60).toFixed(2)}h
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={e.description ?? ""}>
                      {e.description ?? ""}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

export default function Analytics() {
  const { token } = useAuth();
  const { data: pipeline, isLoading: pipelineLoading } = useGetAnalyticsPipeline({
    query: { queryKey: getGetAnalyticsPipelineQueryKey() },
  });
  const { data: revenue, isLoading: revenueLoading } = useGetAnalyticsRevenue({
    query: { queryKey: getGetAnalyticsRevenueQueryKey() },
  });
  const { data: activity, isLoading: activityLoading } = useGetAnalyticsActivity({
    query: { queryKey: getGetAnalyticsActivityQueryKey() },
  });
  const { data: winRate, isLoading: winRateLoading } = useGetAnalyticsWinRate({
    query: { queryKey: getGetAnalyticsWinRateQueryKey() },
  });
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });

  const isAdmin = me?.role === "admin";

  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact" }).format(v);

  const totalPipeline = pipeline?.filter((s) => !["won", "lost"].includes(s.stage)).reduce((a, s) => a + s.value, 0) ?? 0;

  return (
    <div className="p-6 space-y-6 overflow-auto flex-1">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Analytics</h1>
        <p className="text-sm text-zinc-500 mt-1">Pipeline health, revenue trends, and team activity</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timelog">Time Log</TabsTrigger>
        </TabsList>

        <TabsContent value="timelog" className="mt-4">
          <TimeLogSection token={token} />
        </TabsContent>

        <TabsContent value="overview" className="mt-4 space-y-6">

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {winRateLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              title="Win Rate"
              value={`${winRate?.winRate ?? 0}%`}
              sub={`${winRate?.won ?? 0} won / ${winRate?.lost ?? 0} lost`}
              icon={Target}
              color="bg-green-500"
            />
            <StatCard
              title="Open Deals"
              value={winRate?.openDeals ?? 0}
              sub="in pipeline"
              icon={TrendingUp}
              color="bg-blue-500"
            />
            <StatCard
              title="Pipeline Value"
              value={fmtCurrency(totalPipeline)}
              sub="active stages"
              icon={DollarSign}
              color="bg-violet-500"
            />
            <StatCard
              title="Total Closed"
              value={winRate?.totalClosed ?? 0}
              sub="won + lost"
              icon={Activity}
              color="bg-orange-500"
            />
          </>
        )}
      </div>

      {/* Revenue + Activity charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue area chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Revenue Trends</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueLoading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={revenue ?? []} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="pipeline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="won" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} width={60} />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmtCurrency(v), name === "pipelineValue" ? "Pipeline" : "Won"]}
                  />
                  <Area type="monotone" dataKey="pipelineValue" stroke="#6366f1" fill="url(#pipeline)" strokeWidth={2} />
                  <Area type="monotone" dataKey="wonValue" stroke="#22c55e" fill="url(#won)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Activity line chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Activity (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {activityLoading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={activity ?? []} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(d) => d.slice(5)}
                    interval={6}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                  <Tooltip labelFormatter={(d) => `Date: ${d}`} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline funnel bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pipeline Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          {pipelineLoading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pipeline ?? []} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrency(v)} width={60} />
                <Tooltip
                  formatter={(v: number, name: string) =>
                    name === "count" ? [v, "Deals"] : [fmtCurrency(v), "Value"]
                  }
                />
                <Bar yAxisId="left" dataKey="count" name="count" radius={[4, 4, 0, 0]}>
                  {(pipeline ?? []).map((entry) => (
                    <Cell key={entry.stage} fill={STAGE_COLORS[entry.stage] ?? "#6366f1"} />
                  ))}
                </Bar>
                <Bar yAxisId="right" dataKey="value" name="value" fill="#c4b5fd" opacity={0.5} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Time & Profitability section */}
      <div className="border-t border-zinc-200 pt-6">
        <TimeSection token={token} isAdmin={isAdmin} />
      </div>

      {/* Team Performance section */}
      <div className="border-t border-zinc-200 pt-6">
        <TeamPerformanceSection token={token} />
      </div>

      {/* Outreach Analytics section */}
      <div className="border-t border-zinc-200 pt-6">
        <OutreachSection />
      </div>

        </TabsContent>
      </Tabs>
    </div>
  );
}
