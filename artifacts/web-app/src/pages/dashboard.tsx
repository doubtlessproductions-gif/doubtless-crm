import { useAuth } from "@/hooks/use-auth";
import {
  useGetMe,
  useGetDashboardStats,
  useGetDashboardActivity,
  useGetOutreachQueue,
  useListArtists,
  getGetMeQueryKey,
  getGetDashboardStatsQueryKey,
  getGetDashboardActivityQueryKey,
  getGetOutreachQueueQueryKey,
  getListArtistsQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import {
  DollarSign,
  TrendingUp,
  Target,
  Trello,
  UsersRound,
  Calendar,
  Activity,
  FileText,
  ArrowUpRight,
  Video,
  Plus,
  UserPlus,
  Disc,
  Music,
  Send,
  Sparkles,
  CheckCircle2,
  Clock,
  MessageSquare,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { format, parseISO } from "date-fns";

// ── Constants ──────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
};

const STAGE_COLORS: Record<string, string> = {
  lead: "#94a3b8",
  qualified: "#60a5fa",
  proposal: "#a78bfa",
  negotiation: "#34d399",
};

function fmtCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtMonth(ym: string) {
  try { return format(parseISO(`${ym}-01`), "MMM"); } catch { return ym; }
}

function getEntityIcon(entityType: string | null) {
  switch (entityType) {
    case "deal":    return <Trello      className="h-3.5 w-3.5" />;
    case "contact": return <UsersRound  className="h-3.5 w-3.5" />;
    case "invoice": return <FileText    className="h-3.5 w-3.5" />;
    case "note":    return <FileText    className="h-3.5 w-3.5" />;
    case "artist":  return <Music       className="h-3.5 w-3.5" />;
    case "outreach":return <Send        className="h-3.5 w-3.5" />;
    default:        return <Activity    className="h-3.5 w-3.5" />;
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isAuthenticated, token } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isAuthenticated) setLocation("/login");
  }, [isAuthenticated, setLocation]);

  const { data: user }     = useGetMe({
    query: { enabled: !!token, queryKey: getGetMeQueryKey() },
  });
  const { data: stats, isLoading: loadingStats } = useGetDashboardStats({
    query: { enabled: !!token, queryKey: getGetDashboardStatsQueryKey() },
  });
  const { data: activity, isLoading: loadingActivity } = useGetDashboardActivity({
    query: { enabled: !!token, queryKey: getGetDashboardActivityQueryKey() },
  });
  const { data: outreachQueue = [] } = useGetOutreachQueue({
    query: { enabled: !!token, queryKey: getGetOutreachQueueQueryKey() },
  });
  const { data: artists = [] } = useListArtists(undefined, {
    query: { enabled: !!token, queryKey: getListArtistsQueryKey() },
  });

  if (!isAuthenticated) return null;

  const revenueTrend    = stats?.revenueTrend ?? [];
  const queueDrafts     = outreachQueue.filter(m => m.status === "draft");
  const queueApproved   = outreachQueue.filter(m => m.status === "approved");
  const tierACount      = artists.filter(a => (a as any).leadTier === "A").length;

  type ExtItem = typeof outreachQueue[0] & { artistName: string };

  return (
    <div className="flex-1 p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Welcome back, <span className="font-medium text-zinc-700">{user?.name || "there"}</span>. Here's your business at a glance.
          </p>
        </div>
        <p className="text-xs text-zinc-400 hidden sm:block">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      {/* Quick Actions — 6-up */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: "New Deal",         icon: <Plus           className="h-4 w-4" />, color: "text-blue-600 bg-blue-50 hover:bg-blue-100 border-blue-100",           href: "/pipeline" },
          { label: "Add Contact",      icon: <UserPlus       className="h-4 w-4" />, color: "text-violet-600 bg-violet-50 hover:bg-violet-100 border-violet-100",     href: "/contacts" },
          { label: "Discover Artists", icon: <Sparkles       className="h-4 w-4" />, color: "text-fuchsia-600 bg-fuchsia-50 hover:bg-fuchsia-100 border-fuchsia-100", href: "/artists" },
          { label: "Draft Outreach",   icon: <Send           className="h-4 w-4" />, color: "text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border-indigo-100",     href: "/outreach" },
          { label: "New Release",      icon: <Disc           className="h-4 w-4" />, color: "text-rose-600 bg-rose-50 hover:bg-rose-100 border-rose-100",             href: "/releases" },
          { label: "Schedule Meet",    icon: <Calendar       className="h-4 w-4" />, color: "text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-100", href: "/calendar" },
        ].map(a => (
          <button key={a.label} onClick={() => setLocation(a.href)}
            className={`flex flex-col sm:flex-row items-center sm:items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-3 rounded-xl border font-medium text-xs sm:text-sm transition-colors ${a.color}`}>
            {a.icon}
            <span className="text-center sm:text-left leading-tight">{a.label}</span>
          </button>
        ))}
      </div>

      {/* KPI row 1 — CRM */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Pipeline Value"    value={stats ? fmtCurrency(stats.pipelineValue) : null}
          sub="Excluding lost deals"        icon={<DollarSign  className="h-4 w-4" />} color="blue"   loading={loadingStats} onClick={() => setLocation("/pipeline")} />
        <KpiCard title="Monthly Recurring" value={stats ? fmtCurrency(stats.mrr) : null}
          sub="Active subscriptions"        icon={<TrendingUp  className="h-4 w-4" />} color="green"  loading={loadingStats} onClick={() => setLocation("/subscriptions?status=active")} />
        <KpiCard title="Win Rate (90d)"    value={stats ? (stats.winRate !== null ? `${stats.winRate}%` : "N/A") : null}
          sub="Won vs. total closed"        icon={<Target      className="h-4 w-4" />} color="purple" loading={loadingStats} onClick={() => setLocation("/pipeline?highlight=won")} />
        <KpiCard title="Open Deals"        value={stats ? String(stats.openDeals) : null}
          sub="Active in pipeline"           icon={<Trello className="h-4 w-4" />} color="orange" loading={loadingStats} onClick={() => setLocation("/pipeline")} />
      </div>

      {/* KPI row 2 — Artist & Outreach */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Artists in Roster" value={artists.length > 0 ? String(artists.length) : null}
          sub={tierACount > 0 ? `${tierACount} Tier A prospects` : "Add artists to roster"}
          icon={<Music className="h-4 w-4" />} color="fuchsia" loading={false}
          onClick={() => setLocation("/artists")} />
        <KpiCard title="Outreach Queue"    value={String(outreachQueue.length)}
          sub={outreachQueue.length === 0 ? "No pending messages" : `${queueDrafts.length} draft · ${queueApproved.length} approved`}
          icon={<MessageSquare className="h-4 w-4" />} color="indigo" loading={false}
          onClick={() => setLocation("/outreach")} />
        <KpiCard title="Ready to Send"     value={String(queueApproved.length)}
          sub={queueApproved.length === 0 ? "Approve drafts first" : "Approved & waiting"}
          icon={<Send className="h-4 w-4" />} color="teal" loading={false}
          onClick={() => setLocation("/outreach")} />
        <KpiCard title="Drafts Pending"    value={String(queueDrafts.length)}
          sub={queueDrafts.length === 0 ? "Queue is clear" : "Awaiting review"}
          icon={<Clock className="h-4 w-4" />} color="amber" loading={false}
          onClick={() => setLocation("/outreach")} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pipeline by stage */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Open Pipeline by Stage</h2>
          {loadingStats ? (
            <div className="h-48 bg-zinc-50 rounded-lg animate-pulse" />
          ) : (stats?.pipelineByStage?.length ?? 0) === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-zinc-400 text-sm">
              <Trello className="h-8 w-8 text-zinc-200" />
              No open deals yet — <button className="text-blue-600 hover:underline text-sm" onClick={() => setLocation("/pipeline")}>create one</button>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <BarChart data={(stats?.pipelineByStage ?? []).map(s => ({ ...s, label: STAGE_LABELS[s.stage] ?? s.stage }))}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => fmtCurrency(v as number)} tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(value: number) => [fmtCurrency(value), "Value"]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e4e4e7", fontSize: "12px" }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Revenue trend */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-4">Revenue Trend (6 months)</h2>
          {loadingStats ? (
            <div className="h-48 bg-zinc-50 rounded-lg animate-pulse" />
          ) : revenueTrend.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center gap-2 text-zinc-400 text-sm">
              <TrendingUp className="h-8 w-8 text-zinc-200" />
              No closed deals yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={192}>
              <AreaChart data={revenueTrend.map(r => ({ ...r, label: fmtMonth(r.month) }))}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={v => fmtCurrency(v as number)} tick={{ fontSize: 11, fill: "#a1a1aa" }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(value: number) => [fmtCurrency(value), "Revenue"]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e4e4e7", fontSize: "12px" }} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2}
                  fill="url(#revenueGrad)" dot={{ r: 3, fill: "#10b981", strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom row: contacts + activity + outreach queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Top contacts */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">Top Contacts by Deal Value</h2>
            <button onClick={() => setLocation("/contacts")}
              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
              View all <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          <div className="divide-y divide-zinc-50">
            {loadingStats ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-center gap-3">
                  <div className="h-8 w-8 bg-zinc-100 rounded-full animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-zinc-100 rounded animate-pulse w-3/4" />
                    <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-1/2" />
                  </div>
                  <div className="h-3 bg-zinc-100 rounded animate-pulse w-14" />
                </div>
              ))
            ) : (stats?.topContacts?.length ?? 0) === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-400">No contacts yet</div>
            ) : (
              stats!.topContacts.map(c => (
                <div key={c.id} className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50/60 cursor-pointer transition-colors"
                  onClick={() => setLocation("/contacts")}>
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">{c.name}</p>
                    {c.company && <p className="text-xs text-zinc-400 truncate">{c.company}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-zinc-800">{fmtCurrency(c.totalValue)}</p>
                    <p className="text-xs text-zinc-400">{c.dealCount} deal{c.dealCount !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100">
            <h2 className="text-sm font-semibold text-zinc-700">Recent Activity</h2>
          </div>
          <div className="divide-y divide-zinc-50">
            {loadingActivity ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-5 py-3 flex items-start gap-3">
                  <div className="h-6 w-6 bg-zinc-100 rounded-full animate-pulse mt-0.5 flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-zinc-100 rounded animate-pulse" />
                    <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-2/3" />
                  </div>
                </div>
              ))
            ) : (activity?.length ?? 0) === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-400">No recent activity</div>
            ) : (
              activity!.map(item => (
                <div key={item.id} className="px-5 py-3 flex items-start gap-3 hover:bg-zinc-50/60 transition-colors">
                  <div className="h-6 w-6 rounded-full bg-zinc-100 flex items-center justify-center flex-shrink-0 mt-0.5 text-zinc-500">
                    {getEntityIcon(item.entityType ?? null)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-zinc-800 leading-snug line-clamp-2">{item.description}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {item.actorName && <span className="text-zinc-500">{item.actorName} · </span>}
                      {format(new Date(item.createdAt), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Outreach queue mini-panel */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-700">Outreach Queue</h2>
              {outreachQueue.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium">
                  {outreachQueue.length}
                </span>
              )}
            </div>
            <button onClick={() => setLocation("/outreach")}
              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
              View all <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>

          {outreachQueue.length === 0 ? (
            <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
              <Send className="h-8 w-8 text-zinc-200" />
              <p className="text-sm text-zinc-400">No messages in queue</p>
              <button onClick={() => setLocation("/outreach")}
                className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Compose outreach
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {outreachQueue.slice(0, 5).map(msg => {
                const ext = msg as ExtItem;
                const isDraft    = msg.status === "draft";
                const isApproved = msg.status === "approved";
                return (
                  <div key={msg.id}
                    className="px-4 py-3 hover:bg-zinc-50/60 cursor-pointer transition-colors"
                    onClick={() => setLocation("/outreach")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-zinc-800 truncate">{ext.artistName}</p>
                        <p className="text-xs text-zinc-400 truncate mt-0.5">
                          {msg.subject || msg.type}
                        </p>
                      </div>
                      {isDraft && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-medium shrink-0">
                          Draft
                        </span>
                      )}
                      {isApproved && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium shrink-0 flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />Ready
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {outreachQueue.length > 5 && (
                <div className="px-5 py-3 text-center">
                  <button onClick={() => setLocation("/outreach")}
                    className="text-xs text-violet-600 hover:underline">
                    +{outreachQueue.length - 5} more in queue
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Artist quick stats footer */}
          {artists.length > 0 && (
            <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50/60 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Music className="h-3.5 w-3.5 text-fuchsia-500" />
                <span><span className="font-medium text-zinc-700">{artists.length}</span> artists in roster</span>
              </div>
              <button onClick={() => setLocation("/artists")}
                className="text-xs text-violet-600 hover:underline flex items-center gap-0.5">
                Discover <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

      </div>

      {/* Upcoming events row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Upcoming calendar events */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">Upcoming Events</h2>
            <button onClick={() => setLocation("/calendar")}
              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
              View all <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          <div className="divide-y divide-zinc-50">
            {loadingStats ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="px-5 py-4 space-y-1.5">
                  <div className="h-3 bg-zinc-100 rounded animate-pulse w-4/5" />
                  <div className="h-2.5 bg-zinc-100 rounded animate-pulse w-1/2" />
                </div>
              ))
            ) : (stats?.upcomingEvents?.length ?? 0) === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-zinc-400">No upcoming events</div>
            ) : (
              stats!.upcomingEvents.map(evt => {
                const start   = new Date(evt.startTime);
                const end     = new Date(evt.endTime);
                const isToday = start.toDateString() === new Date().toDateString();
                return (
                  <div key={evt.id} className="px-5 py-4 hover:bg-zinc-50/60 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 text-center w-9">
                        <p className="text-xs font-bold text-blue-600 uppercase leading-none">{format(start, "MMM")}</p>
                        <p className="text-lg font-bold text-zinc-900 leading-none mt-0.5">{format(start, "d")}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-800 truncate">{evt.title}</p>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {isToday ? "Today, " : ""}{format(start, "h:mm a")} – {format(end, "h:mm a")}
                        </p>
                        {evt.meetLink && (
                          <a href={evt.meetLink} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:underline">
                            <Video className="h-3 w-3" /> Join Meet
                          </a>
                        )}
                      </div>
                      {isToday && (
                        <Badge className="bg-blue-50 text-blue-700 border-blue-200 border text-xs flex-shrink-0">Today</Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Artist roster snapshot */}
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-zinc-700">Artist Roster</h2>
              {tierACount > 0 && (
                <Badge variant="outline" className="text-[10px] bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200">
                  {tierACount} Tier A
                </Badge>
              )}
            </div>
            <button onClick={() => setLocation("/artists")}
              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
              Full roster <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          {artists.length === 0 ? (
            <div className="px-5 py-10 flex flex-col items-center gap-3 text-center">
              <Music className="h-8 w-8 text-zinc-200" />
              <p className="text-sm text-zinc-400">No artists in roster yet</p>
              <button onClick={() => setLocation("/artists")}
                className="text-xs text-fuchsia-600 hover:underline flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Discover artists
              </button>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {artists.slice(0, 6).map(a => {
                const tier = (a as any).leadTier as string | undefined;
                const outreachStatus = (a as any).outreachStatus as string | undefined;
                return (
                  <div key={a.id}
                    className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50/60 cursor-pointer transition-colors"
                    onClick={() => setLocation("/artists")}>
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900 truncate">{a.name}</p>
                      {a.genre && <p className="text-xs text-zinc-400 truncate">{a.genre}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {tier && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
                          tier === "A" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          tier === "B" ? "bg-blue-50 text-blue-700 border-blue-200" :
                          "bg-zinc-50 text-zinc-500 border-zinc-200"
                        }`}>
                          {tier}
                        </span>
                      )}
                      {outreachStatus && outreachStatus !== "new" && (
                        <span className="text-[10px] text-zinc-400 capitalize">{outreachStatus.replace("_", " ")}</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {artists.length > 6 && (
                <div className="px-5 py-3 text-center">
                  <button onClick={() => setLocation("/artists")}
                    className="text-xs text-violet-600 hover:underline">
                    +{artists.length - 6} more artists
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string | null;
  sub: string;
  icon: React.ReactNode;
  color: "blue" | "green" | "purple" | "amber" | "orange" | "fuchsia" | "indigo" | "teal";
  loading: boolean;
  onClick?: () => void;
}

const COLOR_MAP: Record<KpiCardProps["color"], { bg: string; text: string }> = {
  blue:    { bg: "bg-blue-50",    text: "text-blue-600" },
  green:   { bg: "bg-emerald-50", text: "text-emerald-600" },
  purple:  { bg: "bg-violet-50",  text: "text-violet-600" },
  amber:   { bg: "bg-amber-50",   text: "text-amber-600" },
  orange:  { bg: "bg-orange-50",  text: "text-orange-600" },
  fuchsia: { bg: "bg-fuchsia-50", text: "text-fuchsia-600" },
  indigo:  { bg: "bg-indigo-50",  text: "text-indigo-600" },
  teal:    { bg: "bg-teal-50",    text: "text-teal-600" },
};

function KpiCard({ title, value, sub, icon, color, loading, onClick }: KpiCardProps) {
  const c = COLOR_MAP[color];
  return (
    <div onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border border-zinc-200 p-5 flex flex-col gap-3 ${
        onClick ? "cursor-pointer hover:shadow-md hover:border-zinc-300 hover:-translate-y-0.5 transition-all duration-200" : ""
      }`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{title}</p>
        <div className={`h-9 w-9 rounded-xl ${c.bg} ${c.text} flex items-center justify-center`}>{icon}</div>
      </div>
      {loading
        ? <div className="h-8 w-24 bg-zinc-100 rounded animate-pulse" />
        : <p className="text-2xl font-bold text-zinc-900 tracking-tight">{value ?? "—"}</p>
      }
      <p className="text-xs text-zinc-400">{sub}</p>
    </div>
  );
}
