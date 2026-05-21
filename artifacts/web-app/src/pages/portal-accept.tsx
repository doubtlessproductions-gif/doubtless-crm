import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { usePortalAuth } from "@/hooks/use-portal-auth";
import { PortalShell } from "./portal-login";

export default function PortalAccept() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { login } = usePortalAuth();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ email: string; contactName: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/accept/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json();
          setError(data.error ?? "Invalid invite link");
        } else {
          const data = await r.json();
          setInfo(data);
        }
      })
      .catch(() => setError("Something went wrong"))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/accept/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error ?? "Something went wrong", variant: "destructive" });
        return;
      }
      const { token: jwt } = await res.json();
      login(jwt);
      toast({ title: "Welcome! Your account is ready." });
      setLocation("/portal");
    } catch {
      toast({ title: "Error", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PortalShell>
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Set up your account</h1>
          {info && <p className="mt-2 text-sm text-gray-600">Welcome, {info.contactName}! Choose a password to access your portal.</p>}
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {loading ? (
            <p className="text-center text-gray-500">Validating invite link…</p>
          ) : error ? (
            <div className="text-center">
              <p className="text-red-600 mb-4">{error}</p>
              <Button variant="outline" onClick={() => setLocation("/portal/login")}>Go to Login</Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label>Email address</Label>
                <Input value={info?.email ?? ""} disabled className="bg-gray-50" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Create password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Setting up…" : "Create account & sign in"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
