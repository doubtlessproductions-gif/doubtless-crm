import { useAuth } from "@/hooks/use-auth";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetMe, useGetTheme, getGetMeQueryKey, getGetThemeQueryKey } from "@workspace/api-client-react";
import {
  LayoutDashboard, Users, Trello, Settings, Shield, LogOut,
  MessageSquare, BarChart2, FileText, CreditCard, Calendar, Music, Search,
  Mail, HardDrive, ClipboardList, Globe, Disc,
  Film, Briefcase, CalendarDays, DollarSign, Sun, Moon,
  Zap, BookLock, RefreshCw, Bell, X, Check, AlertCircle,
  TrendingUp, MessageCircle, FileInput, ArrowRight, Upload, UserCircle, Menu,
  Send, FolderOpen,
} from "lucide-react";
import { useEffect, useState, useCallback, useRef } from "react";
import { getAppSocket } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import CommandPalette from "@/components/command-palette";

const ALL_LINKS = [
  // ── Core CRM ───────────────────────────────────────────────────────────────
  { key: "dashboard",        href: "/dashboard",        label: "Dashboard",       icon: LayoutDashboard },
  { key: "pipeline",         href: "/pipeline",         label: "Pipeline",        icon: Trello },
  { key: "contacts",         href: "/contacts",         label: "Contacts",        icon: Users },
  // ── Artists ────────────────────────────────────────────────────────────────
  { key: "artists",          href: "/artists",          label: "Artists",         icon: Music },
  { key: "outreach",         href: "/outreach",         label: "Outreach",        icon: Send },
  // ── Communication ──────────────────────────────────────────────────────────
  { key: "messages",         href: "/messages",         label: "Messages",        icon: MessageSquare },
  { key: "calendar",         href: "/calendar",         label: "Calendar",        icon: Calendar },
  { key: "outlook",          href: "/outlook",          label: "Outlook",         icon: Mail },
  // ── Releases & Content ─────────────────────────────────────────────────────
  { key: "releases",         href: "/releases",         label: "Releases",        icon: Disc },
  { key: "content-calendar", href: "/content-calendar", label: "Content",         icon: CalendarDays },
  { key: "templates",        href: "/templates",        label: "Marketing",       icon: FileText },
  { key: "forms",            href: "/forms",            label: "Forms",           icon: ClipboardList },
  { key: "pages",            href: "/pages",            label: "Pages",           icon: Globe },
  { key: "video-engine",     href: "/video-engine",     label: "Video Engine",    icon: Film },
  // ── Finance ────────────────────────────────────────────────────────────────
  { key: "payments",         href: "/payments",         label: "Payments",        icon: CreditCard },
  { key: "invoices",         href: "/invoices",         label: "Invoices",        icon: FileText },
  { key: "royalties",        href: "/royalties",        label: "Royalties",       icon: DollarSign },
  { key: "subscriptions",    href: "/subscriptions",    label: "Retainers",       icon: RefreshCw },
  // ── Studio ─────────────────────────────────────────────────────────────────
  { key: "studio-projects",  href: "/studio-projects",  label: "Projects",        icon: Briefcase },
  { key: "release-assets",   href: "/release-assets",   label: "Assets",          icon: FolderOpen },
  // ── Storage ────────────────────────────────────────────────────────────────
  { key: "onedrive",         href: "/onedrive",         label: "OneDrive",        icon: HardDrive },
  // ── Analytics & Admin ──────────────────────────────────────────────────────
  { key: "analytics",        href: "/analytics",        label: "Analytics",       icon: BarChart2 },
  { key: "automations",      href: "/automations",      label: "Automations",     icon: Zap },
  { key: "audit-logs",       href: "/audit-logs",       label: "Audit Log",       icon: BookLock },
  { key: "settings",         href: "/settings",         label: "Settings",        icon: Settings },
  // ── Aliases (tab-key permission variants; deduplicated by href) ────────────
  { key: "deals",            href: "/pipeline",         label: "Deals",           icon: Trello },
  { key: "marketing",        href: "/templates",        label: "Marketing",       icon: FileText },
  { key: "time",             href: "/analytics",        label: "Time",            icon: BarChart2 },
  { key: "deliverables",     href: "/pages",            label: "Deliverables",    icon: Globe },
] as const;

// ── Notification types ────────────────────────────────────────────────────────

interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  linkHref: string;
  isRead: boolean;
  createdAt: string;
}

const NOTIF_ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  deal_stage:      TrendingUp,
  deal_created:    TrendingUp,
  message:         MessageCircle,
  portal_message:  UserCircle,
  form_submission: FileInput,
  subscription:    RefreshCw,
  automation:      Zap,
  deliverable:     Upload,
  outlook_expired: Mail,
};

const NOTIF_COLOR_MAP: Record<string, string> = {
  deal_stage:      "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
  deal_created:    "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400",
  message:         "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  portal_message:  "bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-400",
  form_submission: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400",
  subscription:    "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
  automation:      "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400",
  deliverable:     "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
  outlook_expired: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
};

function NotifTypeIcon({ type }: { type: string }) {
  const Icon = NOTIF_ICON_MAP[type] ?? AlertCircle;
  const color = NOTIF_COLOR_MAP[type] ?? "bg-muted text-muted-foreground";
  return (
    <span className={cn("flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center", color)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Notification Center ────────────────────────────────────────────────────────
function NotificationCenter({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setNotifications(await res.json() as AppNotification[]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // Real-time push via shared socket singleton
  useEffect(() => {
    const sock = getAppSocket(token);
    if (!sock) return;
    const handler = (notif: AppNotification) => {
      setNotifications((prev) => [notif, ...prev].slice(0, 50));
    };
    sock.on("notification:new", handler);
    return () => { sock.off("notification:new", handler); };
  }, [token]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function markAllRead() {
    if (!token) return;
    await fetch("/api/notifications/read", { method: "PUT", headers: { Authorization: `Bearer ${token}` } });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  async function dismiss(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    if (!token) return;
    await fetch(`/api/notifications/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  function handleClickNotif(n: AppNotification) {
    if (!n.isRead) setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, isRead: true } : x));
    setOpen(false);

    if (n.type === "outlook_expired") {
      void (async () => {
        try {
          const r = await fetch("/api/auth/microsoft/url", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!r.ok) {
            setLocation(n.linkHref);
            return;
          }
          const { url } = (await r.json()) as { url: string };
          const popup = window.open(url, "microsoft-oauth", "width=520,height=640,scrollbars=yes,noreferrer");

          function onMessage(evt: MessageEvent) {
            const d = evt.data as { type?: string; success?: boolean; message?: string };
            if (d?.type !== "microsoft-oauth") return;
            window.removeEventListener("message", onMessage);
            if (d.success) {
              if (token) {
                fetch(`/api/notifications/${n.id}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {});
              }
              setNotifications((prev) => prev.filter((x) => x.id !== n.id));
              toast({ title: "Microsoft Outlook reconnected!" });
            } else {
              toast({
                title: "Outlook sign-in failed",
                description: d.message ?? "Please try again from Settings → Integrations.",
                variant: "destructive",
              });
            }
          }
          window.addEventListener("message", onMessage);

          const poll = setInterval(() => {
            if (!popup || popup.closed) {
              clearInterval(poll);
              window.removeEventListener("message", onMessage);
            }
          }, 1000);
        } catch {
          toast({
            title: "Could not start Microsoft sign-in",
            description: "Go to Settings → Integrations to reconnect manually.",
            variant: "destructive",
          });
          setLocation(n.linkHref);
        }
      })();
      return;
    }

    setLocation(n.linkHref);
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        title="Notifications"
        aria-label="Open notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 text-[9px] font-bold flex items-center justify-center bg-red-500 text-white rounded-full leading-none pointer-events-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-out panel — opens upward and to the right of the button */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden max-h-[480px] bg-background border border-border">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30 shrink-0">
            <span className="text-sm font-semibold text-foreground flex items-center gap-2">
              Notifications
              {unreadCount > 0 && (
                <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                  title="Mark all as read"
                >
                  <Check className="h-3 w-3" />
                  All read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            )}
            {!loading && notifications.length === 0 && (
              <div className="p-8 flex flex-col items-center gap-3 text-muted-foreground">
                <Bell className="h-9 w-9 opacity-20" />
                <p className="text-sm">All caught up — no notifications</p>
              </div>
            )}
            {!loading && notifications.length > 0 && (() => {
              const todayStart = new Date();
              todayStart.setHours(0, 0, 0, 0);
              const todayItems  = notifications.filter((n) => new Date(n.createdAt) >= todayStart);
              const earlierItems = notifications.filter((n) => new Date(n.createdAt) < todayStart);

              function renderNotif(n: AppNotification) {
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "group flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 cursor-pointer transition-colors",
                      n.isRead
                        ? "hover:bg-muted/40"
                        : "bg-blue-50/80 dark:bg-blue-950/25 hover:bg-blue-100/60 dark:hover:bg-blue-900/25",
                    )}
                    onClick={() => handleClickNotif(n)}
                  >
                    <NotifTypeIcon type={n.type} />
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <p className={cn(
                        "text-[12.5px] leading-snug break-words",
                        n.isRead ? "text-foreground" : "font-semibold text-foreground",
                      )}>
                        {n.title}
                      </p>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5 line-clamp-3 leading-snug break-words">
                        {n.body}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10.5px] text-muted-foreground/60">{relativeTime(n.createdAt)}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleClickNotif(n); }}
                          className="flex items-center gap-0.5 text-[10.5px] text-primary/70 hover:text-primary transition-colors font-medium"
                          title="Go to"
                        >
                          Go to <ArrowRight className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={(e) => dismiss(e, n.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-all flex-shrink-0 mt-0.5"
                      title="Dismiss"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              }

              return (
                <>
                  {todayItems.length > 0 && (
                    <>
                      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/20 border-b border-border">
                        Today
                      </div>
                      {todayItems.map(renderNotif)}
                    </>
                  )}
                  {earlierItems.length > 0 && (
                    <>
                      <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 bg-muted/20 border-b border-border">
                        Earlier
                      </div>
                      {earlierItems.map(renderNotif)}
                    </>
                  )}
                </>
              );
            })()}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/20 shrink-0 flex justify-center">
              <button
                onClick={() => { setOpen(false); setLocation("/settings"); }}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Notification settings →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dark Mode Toggle ────────────────────────────────────────────────────────
function DarkModeToggle({ token }: { token: string | null }) {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false
  );

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("colorMode", next ? "dark" : "light");
    if (token) {
      fetch("/api/users/me/color-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ colorMode: next ? "dark" : "light" }),
      }).catch(() => {});
    }
  }

  return (
    <button
      onClick={toggle}
      className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ── Main Layout ───────────────────────────────────────────────────────────────
export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token, logout } = useAuth();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) setLocation("/login");
  }, [isAuthenticated, setLocation]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Close mobile sidebar on navigation
  useEffect(() => { setSidebarOpen(false); }, [location]);

  const { data: user, isError: meIsError, error: meError } = useGetMe({
    query: {
      enabled: !!token,
      queryKey: getGetMeQueryKey(),
      retry: (failureCount, error) => {
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 2;
      },
    },
  });

  useEffect(() => {
    if (meIsError && (meError as { status?: number })?.status === 401) logout();
  }, [meIsError, meError, logout]);

  useEffect(() => {
    const cm = user?.colorMode;
    if (!cm) return;
    localStorage.setItem("colorMode", cm);
    if (cm === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [user?.colorMode]);

  // Real-time tab permission sync via shared socket singleton
  useEffect(() => {
    const sock = getAppSocket(token);
    if (!sock) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    };
    sock.on("tabs:updated", handler);
    return () => { sock.off("tabs:updated", handler); };
  }, [token, queryClient]);

  const { data: theme } = useGetTheme({ query: { enabled: !!token, queryKey: getGetThemeQueryKey() } });

  const { data: rolePermsData } = useQuery<Record<string, string[]>>({
    queryKey: ["rolePermissions"],
    queryFn: () => fetch("/api/admin/role-permissions", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json().then((d: { permissions: Record<string, string[]> }) => d.permissions ?? {}) : {}),
    enabled: !!token && !!user,
    staleTime: 60_000,
  });

  const { data: outlookUnread } = useQuery<{ count: number; connected: boolean }>({
    queryKey: ["outlook-unread"],
    queryFn: () =>
      fetch("/api/outlook/unread-count", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : { count: 0, connected: false }),
    enabled: !!token,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const outlookUnreadCount = outlookUnread?.count ?? 0;

  if (!isAuthenticated) return null;

  const isOwner    = user?.role === "owner";
  const isAdmin    = user?.role === "admin";
  const userRole   = user?.role ?? "";
  const allowedTabs = user?.allowedTabs;
  const rolePerms  = rolePermsData ?? {};

  const seenHrefs = new Set<string>();
  const links = [
    ...ALL_LINKS.filter((link) => {
      if (isOwner) return true;
      if (link.key === "audit-logs") return false;
      if (rolePerms[link.key] && !rolePerms[link.key].includes(userRole)) return false;
      if (allowedTabs && !allowedTabs.includes(link.key)) return false;
      return true;
    }),
    ...(isAdmin || isOwner ? [{ key: "admin", href: "/admin", label: "Admin", icon: Shield }] : []),
  ].filter((link) => {
    if (seenHrefs.has(link.href)) return false;
    seenHrefs.add(link.href);
    return true;
  }) as Array<{ key: string; href: string; label: string; icon: React.FC<{ className?: string }> }>;

  const extras = (theme?.sidebarConfig ?? {}) as { navStyle?: string; font?: string };
  const navStyle = extras.navStyle ?? "filled";
  const accentColor = theme?.accentColor ?? "#00e5b0";
  const sidebarBg = theme?.primaryColor || "var(--sidebar)";

  const navLinks = links.map((link) => {
    const isActive = location.startsWith(link.href);
    const Icon = link.icon;
    const activeClass =
      navStyle === "outlined" ? "border border-white/30 text-white" :
      navStyle === "minimal"  ? "text-white" :
      "bg-white/15 text-white";
    const activeStyle = navStyle === "minimal" && isActive
      ? { borderLeft: `2px solid ${accentColor}`, paddingLeft: "10px" }
      : {};
    return (
      <Link key={link.key} href={link.href}>
        <div
          className={cn(
            "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer group",
            isActive ? activeClass : "text-white/70 hover:bg-white/10 hover:text-white",
          )}
          style={activeStyle}
        >
          <Icon className={cn("flex-shrink-0 h-4 w-4 mr-2.5", isActive ? "text-white" : "text-white/70 group-hover:text-white")} />
          <span className="flex-1 truncate">{link.label}</span>
          {link.key === "outlook" && outlookUnreadCount > 0 && (
            <span className="ml-auto min-w-[18px] h-[18px] px-1 text-[10px] font-bold flex items-center justify-center bg-red-500 text-white rounded-full leading-none shrink-0">
              {outlookUnreadCount > 99 ? "99+" : outlookUnreadCount}
            </span>
          )}
        </div>
      </Link>
    );
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* ── Mobile backdrop ───────────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-200 shrink-0 border-r border-white/5 dark:border-white/[0.06]",
          "md:relative md:w-56 md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ backgroundColor: sidebarBg, color: "white" }}
      >
        {/* Logo / company name */}
        <div className="h-14 flex items-center px-4 border-b border-white/10 shrink-0">
          {theme?.logoUrl && <img src={theme.logoUrl} alt="Logo" className="h-7 w-7 mr-2 rounded" />}
          <span className="font-semibold text-base tracking-tight truncate flex-1">
            {theme?.companyName || "Doubtless Productions"}
          </span>
          {/* Close button — mobile only */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 rounded text-white/60 hover:text-white hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-2 pt-3 pb-1 shrink-0">
          <button
            onClick={() => { setPaletteOpen(true); setSidebarOpen(false); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 transition-colors text-white/70 hover:text-white text-sm"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left text-xs">Search...</span>
            <kbd className="text-[10px] bg-white/10 rounded px-1 py-0.5 hidden sm:block">⌘K</kbd>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {navLinks}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-white/10 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-white truncate">{user?.name || "Loading..."}</span>
              <span className="text-xs text-white/70 capitalize">{user?.role || "User"}</span>
            </div>
            <div className="flex items-center gap-1">
              <NotificationCenter token={token} />
              <DarkModeToggle token={token} />
              <button
                onClick={logout}
                className="p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Logout"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Mobile top bar */}
        <div
          className="h-12 flex items-center gap-3 px-4 border-b border-white/10 shrink-0 md:hidden"
          style={{ backgroundColor: sidebarBg, color: "white" }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          {theme?.logoUrl && <img src={theme.logoUrl} alt="Logo" className="h-6 w-6 rounded" />}
          <span className="font-semibold text-sm tracking-tight truncate flex-1">
            {theme?.companyName || "Doubtless Productions"}
          </span>
          <button
            onClick={() => setPaletteOpen(true)}
            className="p-1.5 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
          <NotificationCenter token={token} />
          <DarkModeToggle token={token} />
        </div>

        <main className="flex-1 overflow-auto flex flex-col bg-zinc-50/40 dark:bg-transparent">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
