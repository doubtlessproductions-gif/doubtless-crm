import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

export default function PortalLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login, isAuthenticated } = usePortalAuth();

  useEffect(() => {
    if (isAuthenticated) setLocation("/portal");
  }, [isAuthenticated, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Login failed", description: data.error ?? "Invalid credentials", variant: "destructive" });
        return;
      }
      const { token } = await res.json();
      login(token);
      setLocation("/portal");
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalShell>
      <div className="w-full max-w-sm mx-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-zinc-300 text-sm font-medium">Email address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus:border-[#00e5b0]/50 focus:ring-[#00e5b0]/20 h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-zinc-300 text-sm font-medium">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-zinc-500 focus:border-[#00e5b0]/50 focus:ring-[#00e5b0]/20 h-11 pr-10"
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
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-[#00e5b0] hover:bg-[#00ccaa] text-zinc-900 font-semibold text-sm mt-2 transition-colors shadow-lg shadow-[#00e5b0]/20"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in to portal"}
          </Button>
        </form>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] px-3 py-2.5">
          <ShieldCheck className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Your connection is encrypted. By signing in you agree to our{" "}
            <a href="/privacy-policy" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">Privacy Policy</a>{" "}
            and{" "}
            <a href="/terms" className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">Terms of Service</a>.
          </p>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-600">
          Need access?{" "}
          <span className="text-zinc-500">Contact your project manager to request an invite.</span>
        </p>
      </div>
    </PortalShell>
  );
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<{ primaryColor: string; companyName: string; logoUrl?: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/theme")
      .then((r) => r.json())
      .then((d) => setTheme(d))
      .catch(() => {});
  }, []);

  const companyName = theme?.companyName ?? "Doubtless Productions";
  const logoUrl = theme?.logoUrl;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">

      {/* Subtle top accent line */}
      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-[#00e5b0]/40 to-transparent" />

      <main className="flex-1 flex flex-col items-center justify-center p-6">

        {/* Brand mark */}
        <div className="mb-8 flex flex-col items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={companyName} className="h-14 w-14 rounded-xl object-contain" />
          ) : (
            <div className="h-14 w-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <span className="text-xl font-black text-white">D</span>
            </div>
          )}
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#00e5b0]">{companyName}</p>
            <h1 className="mt-1 text-2xl font-bold text-white tracking-tight">Client Portal</h1>
            <p className="mt-1 text-sm text-zinc-500">Sign in to view your projects</p>
          </div>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 shadow-2xl backdrop-blur-sm">
          {children}
        </div>
      </main>

      <footer className="py-5 text-center text-[11px] text-zinc-700 space-x-3">
        <span>{companyName}</span>
        <span>·</span>
        <a href="/privacy-policy" className="hover:text-zinc-400 underline underline-offset-2 transition-colors">Privacy Policy</a>
        <span>·</span>
        <a href="/terms" className="hover:text-zinc-400 underline underline-offset-2 transition-colors">Terms of Service</a>
      </footer>
    </div>
  );
}
