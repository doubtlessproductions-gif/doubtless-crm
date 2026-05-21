import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLogin } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link } from "wouter";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Users, Building2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const BRAND = "#00e5b0";

const loginSchema = z.object({
  email:    z.string().email("Please enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});
type LoginFormValues = z.infer<typeof loginSchema>;

const SOCIAL_ERROR_MESSAGES: Record<string, string> = {
  no_account:             "No staff account found matching that email address. Ask your admin to create one first.",
  oauth_failed:           "Authentication failed. Please try again.",
  cancelled:              "Sign in was cancelled.",
  no_email:               "Could not retrieve your email address from that provider.",
  tiktok_no_email:        "TikTok doesn't share email addresses — please sign in with Google, Meta, or LinkedIn instead.",
  server_error:           "A server error occurred. Please try again.",
  provider_not_configured:"That sign-in method hasn't been set up yet. Contact your admin.",
};

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MetaIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.84a8.27 8.27 0 004.84 1.54V6.92a4.85 4.85 0 01-1.07-.23z"/>
    </svg>
  );
}

const SOCIAL_PROVIDERS = [
  { id: "google",   label: "Google",   Icon: GoogleIcon,   color: "border-zinc-700 hover:border-zinc-500" },
  { id: "meta",     label: "Meta",     Icon: MetaIcon,     color: "border-zinc-700 hover:border-zinc-500" },
  { id: "linkedin", label: "LinkedIn", Icon: LinkedInIcon, color: "border-zinc-700 hover:border-zinc-500" },
  { id: "tiktok",   label: "TikTok",   Icon: TikTokIcon,   color: "border-zinc-700 hover:border-zinc-500" },
] as const;

function PrivacyNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 mt-2">
      <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" style={{ color: BRAND }} />
      <p className="text-xs text-zinc-400 leading-relaxed">
        By signing in you confirm you are an authorised user of this system. Your
        credentials are encrypted in transit and your session data is never shared
        with third parties. See our{" "}
        <a href="/privacy-policy" className="underline underline-offset-2 hover:text-zinc-200 transition-colors text-zinc-300">
          Privacy Policy
        </a>{" "}
        and{" "}
        <a href="/terms" className="underline underline-offset-2 hover:text-zinc-200 transition-colors text-zinc-300">
          Terms of Service
        </a>{" "}
        for details on how we handle your information.
      </p>
    </div>
  );
}

export default function Login() {
  const { login: authenticate, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState<"team" | "client">("team");
  const [showPassword, setShowPassword] = useState(false);
  const [enabledProviders, setEnabledProviders] = useState<string[]>([]);
  const [microsoftConfigured, setMicrosoftConfigured] = useState(false);

  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const error = params.get("error");

    if (token) {
      authenticate(token);
      toast({ title: "Welcome back", description: "You have successfully signed in." });
      window.history.replaceState({}, "", "/login");
      setLocation("/dashboard");
    } else if (error) {
      toast({
        variant: "destructive",
        title: "Sign in failed",
        description: SOCIAL_ERROR_MESSAGES[error] ?? "Authentication failed. Please try again.",
      });
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  useEffect(() => {
    fetch("/api/auth/social/providers")
      .then((r) => r.json())
      .then((d: { providers: string[] }) => setEnabledProviders(d.providers))
      .catch(() => {});
    fetch("/api/auth/microsoft/configured")
      .then((r) => r.json())
      .then((d: { configured: boolean }) => setMicrosoftConfigured(d.configured))
      .catch(() => {});
  }, []);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          authenticate(res.token);
          toast({ title: "Welcome back", description: "You have successfully signed in." });
          setLocation("/dashboard");
        },
        onError: (err) => {
          toast({ variant: "destructive", title: "Sign in failed", description: err.message || "Please check your credentials and try again." });
        },
      }
    );
  };

  const openAuthPopup = (url: string, messageType: string) => {
    const popup = window.open(url, messageType, "width=520,height=640,scrollbars=yes,noreferrer");

    const onMessage = (evt: MessageEvent) => {
      const d = evt.data as { type?: string; success?: boolean; token?: string; message?: string };
      if (d?.type !== messageType) return;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      if (d.success && d.token) {
        authenticate(d.token);
        toast({ title: "Welcome back", description: "You have successfully signed in." });
        setLocation("/dashboard");
      } else {
        const errKey = d.message ?? "oauth_failed";
        toast({
          variant: "destructive",
          title: "Sign in failed",
          description: SOCIAL_ERROR_MESSAGES[errKey] ?? errKey,
        });
      }
    };

    window.addEventListener("message", onMessage);

    const poll = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        window.removeEventListener("message", onMessage);
      }
    }, 1000);
  };

  const handleSocialLogin = (provider: string) => {
    openAuthPopup(`/api/auth/social/${provider}`, `social-login-${provider}`);
  };

  const handleMicrosoftLogin = () => {
    openAuthPopup("/api/auth/microsoft/login", "microsoft-login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-4 sm:py-12 px-4" style={{ background: "#09090b" }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-3xl"
          style={{ background: BRAND }} />
      </div>

      <div className="relative max-w-md w-full space-y-4 sm:space-y-6 rounded-2xl border p-5 sm:p-8"
        style={{ background: "#18181b", borderColor: "#27272a" }}>

        <div className="flex flex-col items-center">
          <img
            src="/logo-transparent.png"
            alt="Doubtless Productions"
            className="h-20 w-20 sm:h-28 sm:w-28 object-contain mb-2 drop-shadow-lg"
          />
          <h2 className="text-2xl font-bold text-white tracking-tight">Sign in to your account</h2>
          <p className="mt-1 text-sm font-medium" style={{ color: BRAND }}>Doubtless Productions CRM</p>
        </div>

        <div className="flex rounded-xl border p-1 gap-1" style={{ background: "#09090b", borderColor: "#27272a" }}>
          <button
            type="button"
            onClick={() => setMode("team")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "team" ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-300",
            )}
            style={mode === "team" ? { background: BRAND } : {}}
          >
            <Users className="h-4 w-4" />
            Team Member
          </button>
          <button
            type="button"
            onClick={() => setMode("client")}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
              mode === "client" ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-300",
            )}
            style={mode === "client" ? { background: BRAND } : {}}
          >
            <Building2 className="h-4 w-4" />
            Client Portal
          </button>
        </div>

        {mode === "team" && (
          <div className="space-y-5">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-zinc-300">Email address</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-email"
                          placeholder="you@example.com"
                          type="email"
                          autoComplete="email"
                          className="text-white placeholder:text-zinc-600 border-white/10 focus-visible:ring-1"
                          style={{ background: "#09090b", "--tw-ring-color": BRAND } as React.CSSProperties}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-zinc-300">Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            data-testid="input-password"
                            placeholder="••••••••"
                            type={showPassword ? "text" : "password"}
                            autoComplete="current-password"
                            className="text-white placeholder:text-zinc-600 border-white/10 focus-visible:ring-1 pr-10"
                            style={{ background: "#09090b", "--tw-ring-color": BRAND } as React.CSSProperties}
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((p) => !p)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                            aria-label={showPassword ? "Hide password" : "Show password"}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  data-testid="button-submit-login"
                  className="w-full font-semibold h-11 text-zinc-900 hover:opacity-90 transition-opacity"
                  style={{ background: BRAND }}
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? "Signing in..." : "Sign in"}
                </Button>
                <PrivacyNotice />
              </form>
            </Form>

            {(enabledProviders.length > 0 || microsoftConfigured) && (
              <div className="space-y-3">
                <div className="relative flex items-center gap-3">
                  <div className="flex-1 h-px" style={{ background: "#27272a" }} />
                  <span className="text-xs text-zinc-500 shrink-0">or continue with</span>
                  <div className="flex-1 h-px" style={{ background: "#27272a" }} />
                </div>
                <div className={cn(
                  "grid gap-2",
                  (enabledProviders.length + (microsoftConfigured ? 1 : 0)) === 1 ? "grid-cols-1" :
                  (enabledProviders.length + (microsoftConfigured ? 1 : 0)) === 2 ? "grid-cols-2" :
                  (enabledProviders.length + (microsoftConfigured ? 1 : 0)) === 3 ? "grid-cols-3" : "grid-cols-2"
                )}>
                  {microsoftConfigured && (
                    <button
                      type="button"
                      onClick={handleMicrosoftLogin}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg border py-2.5 px-3 text-sm font-medium text-zinc-300 transition-all",
                        "hover:bg-white/5 border-zinc-700 hover:border-zinc-500",
                      )}
                      style={{ background: "#09090b" }}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 21 21" aria-hidden="true">
                        <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                        <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                        <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                        <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                      </svg>
                      <span>Microsoft</span>
                    </button>
                  )}
                  {SOCIAL_PROVIDERS.filter((p) => enabledProviders.includes(p.id)).map(({ id, label, Icon, color }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSocialLogin(id)}
                      className={cn(
                        "flex items-center justify-center gap-2 rounded-lg border py-2.5 px-3 text-sm font-medium text-zinc-300 transition-all",
                        "hover:bg-white/5",
                        color,
                      )}
                      style={{ background: "#09090b" }}
                    >
                      <Icon />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {mode === "client" && (
          <div className="rounded-xl border p-5 space-y-4 text-center" style={{ borderColor: "#27272a", background: "#09090b" }}>
            <Building2 className="h-10 w-10 mx-auto opacity-30" style={{ color: BRAND }} />
            <div>
              <p className="text-sm font-medium text-white">Client Portal Access</p>
              <p className="text-xs text-zinc-400 mt-1">
                Access your shared files, proposals, deliverables, and project updates through the dedicated client portal.
              </p>
            </div>
            <Link href="/portal/login">
              <Button className="w-full font-semibold h-10 text-zinc-900 hover:opacity-90 transition-opacity"
                style={{ background: BRAND }}>
                Go to Client Portal
              </Button>
            </Link>
            <p className="text-xs text-zinc-500">
              Need access? Ask your team contact to send you an invite.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
