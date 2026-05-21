import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { PortalAuthProvider } from "@/hooks/use-portal-auth";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Register from "@/pages/register";
import InviteAccept from "@/pages/invite-accept";
import Dashboard from "@/pages/dashboard";
import SidebarLayout from "@/components/layout/sidebar-layout";
import Contacts from "@/pages/contacts";
import Pipeline from "@/pages/pipeline";
import Admin from "@/pages/admin";
import Settings from "@/pages/settings";
import Messages from "@/pages/messages";
import Analytics from "@/pages/analytics";
import Templates from "@/pages/templates";
import Payments from "@/pages/payments";
import CalendarPage from "@/pages/calendar-page";
import Artists from "@/pages/artists";
import ArtistProfile from "@/pages/artist-profile";
import OneDrivePage from "@/pages/onedrive";
import OutlookPage from "@/pages/outlook";
import FormsPage from "@/pages/forms";
import IntakePage from "@/pages/intake";
import InquiryPage from "@/pages/inquiry";
import FormBuilderPage from "@/pages/form-builder";
import FormPublicPage from "@/pages/form-public";
import DeliverPublicPage from "@/pages/deliver-public";
import PortalLogin from "@/pages/portal-login";
import PortalAccept from "@/pages/portal-accept";
import PortalDashboard from "@/pages/portal-dashboard";
import ProjectPages from "@/pages/project-pages";
import ProjectPageBuilder from "@/pages/project-page-builder";
import ProjectPageView from "@/pages/project-page-view";
import ReleasesPage from "@/pages/releases";
import VideoEngine from "@/pages/video-engine";
import StudioProjects from "@/pages/studio-projects";
import ContentCalendar from "@/pages/content-calendar";
import RoyaltiesPage from "@/pages/royalties";
import ReleaseAssetsPage from "@/pages/release-assets";
import AuditLogsPage from "@/pages/audit-logs";
import AutomationsPage from "@/pages/automations";
import SubscriptionsPage from "@/pages/subscriptions";
import InvoicesPage from "@/pages/invoices";
import OutreachHub from "@/pages/outreach-hub";

const queryClient = new QueryClient();

// ── Helpers ────────────────────────────────────────────────────────────────
function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function loadGoogleFont(family: string) {
  if (!family || family === "system-ui" || family === "sans-serif") return;
  const id = `gfont-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

interface ThemeResponse {
  primaryColor: string;
  accentColor: string;
  sidebarConfig?: { font?: string; borderRadius?: string; navStyle?: string } | null;
}

// ── Color Mode ─────────────────────────────────────────────────────────────
// Reads preference from localStorage on mount and applies the dark class.
// Syncs from server when the user session resolves (via sidebar-layout).
function ColorModeApplier() {
  useEffect(() => {
    const stored = localStorage.getItem("colorMode") ?? "light";
    if (stored === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    const density = localStorage.getItem("density") ?? "comfortable";
    if (density === "compact") {
      document.documentElement.setAttribute("data-density", "compact");
    } else {
      document.documentElement.removeAttribute("data-density");
    }
  }, []);
  return null;
}

function ThemeApplier() {
  const { data: theme } = useQuery<ThemeResponse>({
    queryKey: ["theme"],
    queryFn: () => fetch("/api/theme").then((r) => r.json()),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    const extras = theme.sidebarConfig ?? {};

    // Font family
    const font = extras.font ?? "Inter";
    loadGoogleFont(font);
    root.style.setProperty(
      "--app-font-sans",
      font === "system-ui" ? "system-ui, sans-serif" : `"${font}", sans-serif`,
    );

    // Border radius
    const radius = extras.borderRadius ?? "0.5rem";
    root.style.setProperty("--radius", radius);

    // Accent → --primary (shadcn buttons, rings, etc.)
    const accent = theme.accentColor ?? "#4f46e5";
    if (/^#[0-9A-Fa-f]{6}$/.test(accent)) {
      const [h, s, l] = hexToHsl(accent);
      root.style.setProperty("--primary", `${h} ${s}% ${l}%`);
      root.style.setProperty("--ring", `${h} ${s}% ${l}%`);
      // Foreground: dark text on bright accent, white on dark
      const isLight = l > 55;
      root.style.setProperty("--primary-foreground", isLight ? "0 0% 5%" : "0 0% 100%");
    }
  }, [theme]);

  return null;
}

function AuthenticatedRoutes() {
  return (
    <SidebarLayout>
      <Switch>
        <Route path="/dashboard"          component={Dashboard} />
        <Route path="/contacts"           component={Contacts} />
        <Route path="/pipeline"           component={Pipeline} />
        <Route path="/admin"              component={Admin} />
        <Route path="/settings"           component={Settings} />
        <Route path="/messages"           component={Messages} />
        <Route path="/analytics"          component={Analytics} />
        <Route path="/templates"          component={Templates} />
        <Route path="/payments"           component={Payments} />
        <Route path="/calendar"           component={CalendarPage} />
        <Route path="/artists"            component={Artists} />
        <Route path="/artists/:id"        component={ArtistProfile} />
        <Route path="/onedrive"           component={OneDrivePage} />
        <Route path="/outlook"            component={OutlookPage} />
        <Route path="/forms"              component={FormsPage} />
        <Route path="/forms/builder"      component={FormBuilderPage} />
        <Route path="/forms/builder/:id"  component={FormBuilderPage} />
        <Route path="/releases"           component={ReleasesPage} />
        <Route path="/pages"              component={ProjectPages} />
        <Route path="/pages/builder"      component={ProjectPageBuilder} />
        <Route path="/pages/builder/:id"  component={ProjectPageBuilder} />
        <Route path="/video-engine"       component={VideoEngine} />
        <Route path="/studio-projects"    component={StudioProjects} />
        <Route path="/content-calendar"   component={ContentCalendar} />
        <Route path="/royalties"          component={RoyaltiesPage} />
        <Route path="/release-assets"     component={ReleaseAssetsPage} />
        <Route path="/audit-logs"          component={AuditLogsPage} />
        <Route path="/automations"         component={AutomationsPage} />
        <Route path="/subscriptions"       component={SubscriptionsPage} />
        <Route path="/invoices"            component={InvoicesPage} />
        <Route path="/outreach"            component={OutreachHub} />
        <Route component={NotFound} />
      </Switch>
    </SidebarLayout>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/"                      component={Login} />
      <Route path="/login"                 component={Login} />
      <Route path="/register"              component={Register} />
      <Route path="/invite/:token"         component={InviteAccept} />
      <Route path="/portal/login"          component={PortalLogin} />
      <Route path="/portal/accept/:token"  component={PortalAccept} />
      <Route path="/portal"                component={PortalDashboard} />
      <Route path="/p/:slug"               component={ProjectPageView} />
      <Route path="/intake"                component={IntakePage} />
      <Route path="/inquiry"               component={InquiryPage} />
      <Route path="/f/:slug"               component={FormPublicPage} />
      <Route path="/deliver/:token"        component={DeliverPublicPage} />

      {/* Authenticated routes */}
      <Route path="/dashboard"             component={AuthenticatedRoutes} />
      <Route path="/contacts"              component={AuthenticatedRoutes} />
      <Route path="/pipeline"              component={AuthenticatedRoutes} />
      <Route path="/admin"                 component={AuthenticatedRoutes} />
      <Route path="/settings"              component={AuthenticatedRoutes} />
      <Route path="/messages"              component={AuthenticatedRoutes} />
      <Route path="/analytics"             component={AuthenticatedRoutes} />
      <Route path="/templates"             component={AuthenticatedRoutes} />
      <Route path="/payments"              component={AuthenticatedRoutes} />
      <Route path="/calendar"              component={AuthenticatedRoutes} />
      <Route path="/artists"              component={AuthenticatedRoutes} />
      <Route path="/artists/:id"          component={AuthenticatedRoutes} />
      <Route path="/onedrive"              component={AuthenticatedRoutes} />
      <Route path="/outlook"               component={AuthenticatedRoutes} />
      <Route path="/forms"                 component={AuthenticatedRoutes} />
      <Route path="/forms/builder"         component={AuthenticatedRoutes} />
      <Route path="/forms/builder/:id"     component={AuthenticatedRoutes} />
      <Route path="/releases"              component={AuthenticatedRoutes} />
      <Route path="/pages"                 component={AuthenticatedRoutes} />
      <Route path="/pages/builder"         component={AuthenticatedRoutes} />
      <Route path="/pages/builder/:id"     component={AuthenticatedRoutes} />
      <Route path="/video-engine"           component={AuthenticatedRoutes} />
      <Route path="/studio-projects"        component={AuthenticatedRoutes} />
      <Route path="/content-calendar"       component={AuthenticatedRoutes} />
      <Route path="/royalties"              component={AuthenticatedRoutes} />
      <Route path="/release-assets"         component={AuthenticatedRoutes} />
      <Route path="/audit-logs"             component={AuthenticatedRoutes} />
      <Route path="/automations"            component={AuthenticatedRoutes} />
      <Route path="/subscriptions"          component={AuthenticatedRoutes} />
      <Route path="/invoices"               component={AuthenticatedRoutes} />
      <Route path="/outreach"               component={AuthenticatedRoutes} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ColorModeApplier />
      <ThemeApplier />
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <PortalAuthProvider>
              <Router />
            </PortalAuthProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
