import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useValidateInvite, useAcceptInvite, getValidateInviteQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Activity, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = { admin: "Admin", manager: "Manager", artist: "Artist", engineer: "Engineer", ar: "A&R", intern: "Intern" };

// ── Password strength meter (same logic as register page) ────────────────────
function getStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak",        color: "bg-red-500"    };
  if (score <= 2) return { score, label: "Fair",        color: "bg-orange-400" };
  if (score <= 3) return { score, label: "Good",        color: "bg-yellow-400" };
  if (score <= 4) return { score, label: "Strong",      color: "bg-blue-500"   };
  return             { score, label: "Very strong",  color: "bg-green-500"  };
}

function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label, color } = getStrength(password);
  if (!password) return null;
  const pct = Math.round((score / 5) * 100);
  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={cn("text-xs font-medium", {
        "text-red-500":    score <= 1,
        "text-orange-500": score === 2,
        "text-yellow-600": score === 3,
        "text-blue-600":   score === 4,
        "text-green-600":  score === 5,
      })}>
        {label}
      </p>
    </div>
  );
}

export default function InviteAccept() {
  const [, params] = useRoute<{ token: string }>("/invite/:token");
  const token = params?.token ?? "";
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const {
    data: inviteInfo,
    isPending: isValidating,
    isError: isTokenError,
    error: tokenError,
  } = useValidateInvite(token, {
    query: {
      queryKey: getValidateInviteQueryKey(token),
      enabled: !!token,
      retry: false,
    },
  });

  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  const acceptMutation = useAcceptInvite({
    mutation: {
      onSuccess: (data) => {
        login(data.token);
        toast({ title: "Welcome aboard!", description: "Your account has been created." });
        setLocation("/dashboard");
      },
      onError: (err) => {
        toast({ title: err.message || "Failed to create account", variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim())          { toast({ title: "Please enter your name", variant: "destructive" }); return; }
    if (password.length < 8)   { toast({ title: "Password must be at least 8 characters", variant: "destructive" }); return; }
    if (password !== confirm)  { toast({ title: "Passwords do not match", variant: "destructive" }); return; }
    if (!agreed) {
      toast({ title: "Please accept the Privacy Policy and Terms of Service to continue", variant: "destructive" });
      return;
    }
    acceptMutation.mutate({ token, data: { name, password } });
  };

  const errorStatus = tokenError?.status;
  const errorMessage = tokenError?.message ?? "";
  const errorKind = isTokenError
    ? errorStatus === 404
      ? "invalid"
      : errorMessage.toLowerCase().includes("used")
      ? "used"
      : "expired"
    : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 py-12 px-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-lg border border-zinc-100 space-y-6">
        <div className="flex flex-col items-center">
          <div className="h-12 w-12 bg-blue-600 rounded-xl flex items-center justify-center mb-4">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-900 tracking-tight">You're invited!</h2>
          <p className="mt-1 text-sm text-zinc-500">Doubtless Productions CRM</p>
        </div>

        {/* Loading */}
        {isValidating && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
            <p className="text-sm text-zinc-500">Validating your invite…</p>
          </div>
        )}

        {/* Error states */}
        {errorKind && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-5 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-sm font-medium text-red-700">
              {errorKind === "used"    && "This invite has already been used."}
              {errorKind === "expired" && "This invite has expired."}
              {errorKind === "invalid" && "This invite link is invalid."}
            </p>
            <p className="text-xs text-zinc-500">Please ask your team admin for a new invite link.</p>
          </div>
        )}

        {/* Valid invite — show form */}
        {inviteInfo && (
          <>
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Email</span>
                <span className="font-medium text-zinc-800">{inviteInfo.email}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Role</span>
                <span className="font-medium text-zinc-800">{ROLE_LABELS[inviteInfo.role] ?? inviteInfo.role}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name" className="text-sm text-zinc-700">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-zinc-50 border-zinc-200"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="password" className="text-sm text-zinc-700">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-zinc-50 border-zinc-200 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <PasswordStrengthBar password={password} />
              </div>

              <div className="space-y-1">
                <Label htmlFor="confirm" className="text-sm text-zinc-700">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    placeholder="Re-enter password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={cn(
                      "bg-zinc-50 border-zinc-200 pr-10",
                      confirm && password !== confirm && "border-red-300 focus-visible:ring-red-400",
                    )}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {confirm && password !== confirm && (
                  <p className="text-xs text-red-500">Passwords do not match.</p>
                )}
              </div>

              {/* Privacy + Terms consent */}
              <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                <Checkbox
                  id="agreed"
                  checked={agreed}
                  onCheckedChange={(v) => setAgreed(!!v)}
                  className="mt-0.5 shrink-0"
                />
                <label htmlFor="agreed" className="text-sm text-zinc-700 leading-snug cursor-pointer select-none">
                  I have read and agree to the{" "}
                  <a href="/privacy-policy" className="font-medium text-blue-600 hover:underline">
                    Privacy Policy
                  </a>{" "}
                  and{" "}
                  <a href="/terms" className="font-medium text-blue-600 hover:underline">
                    Terms of Service
                  </a>
                  . My data is encrypted and never shared with third parties.
                </label>
              </div>

              {/* Data processing notice */}
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
                <ShieldCheck className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-600 leading-relaxed">
                  Your name and email are used solely to create and manage your account.
                  Passwords are stored using one-way hashing and are never accessible to anyone.
                </p>
              </div>

              <Button
                type="submit"
                disabled={acceptMutation.isPending}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white h-11 font-medium"
              >
                {acceptMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating account…</>
                  : <><CheckCircle2 className="h-4 w-4 mr-2" />Create My Account</>}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
