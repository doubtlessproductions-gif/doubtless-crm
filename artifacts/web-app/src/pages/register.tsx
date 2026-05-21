import { useAuth } from "@/hooks/use-auth";
import { useRegister } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, Link } from "wouter";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Activity, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const registerSchema = z.object({
  name:     z.string().min(2, "Name must be at least 2 characters."),
  email:    z.string().email("Please enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters long."),
  agreed:   z.boolean().refine((v) => v === true, {
    message: "You must accept the Privacy Policy and Terms of Service to continue.",
  }),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

// ── Password strength meter ───────────────────────────────────────────────────
function getStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Weak",   color: "bg-red-500"    };
  if (score <= 2) return { score, label: "Fair",   color: "bg-orange-400" };
  if (score <= 3) return { score, label: "Good",   color: "bg-yellow-400" };
  if (score <= 4) return { score, label: "Strong", color: "bg-blue-500"   };
  return             { score, label: "Very strong", color: "bg-green-500" };
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

export default function Register() {
  const { login: authenticate, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", agreed: false },
  });

  const password = form.watch("password");

  const registerMutation = useRegister();

  const onSubmit = (data: RegisterFormValues) => {
    registerMutation.mutate(
      { data: { name: data.name, email: data.email, password: data.password } },
      {
        onSuccess: (res) => {
          authenticate(res.token);
          toast({ title: "Account created", description: "Welcome to the platform." });
          setLocation("/dashboard");
        },
        onError: (err) => {
          toast({
            variant: "destructive",
            title: "Registration failed",
            description: err.message || "An error occurred during registration.",
          });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-xl shadow-lg border border-zinc-100">
        <div className="flex flex-col items-center">
          <div className="h-12 w-12 bg-blue-600 rounded-lg flex items-center justify-center mb-4">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-2 text-center text-3xl font-extrabold text-zinc-900 tracking-tight">
            Create an account
          </h2>
          <p className="mt-2 text-center text-sm text-zinc-600">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500 transition-colors">
              Sign in
            </Link>
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 mt-8">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-700">Full Name</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-name"
                      placeholder="Jane Doe"
                      autoComplete="name"
                      className="bg-zinc-50 border-zinc-200 focus-visible:ring-blue-600"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-700">Email address</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-email"
                      placeholder="you@example.com"
                      type="email"
                      autoComplete="email"
                      className="bg-zinc-50 border-zinc-200 focus-visible:ring-blue-600"
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
                  <FormLabel className="text-zinc-700">Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        data-testid="input-password"
                        placeholder="Min. 8 characters"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        className="bg-zinc-50 border-zinc-200 focus-visible:ring-blue-600 pr-10"
                        {...field}
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
                  </FormControl>
                  <PasswordStrengthBar password={password} />
                  <p className="text-xs text-zinc-400 mt-1">
                    Use 8+ characters with a mix of uppercase, numbers, or symbols.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Privacy & Terms consent */}
            <FormField
              control={form.control}
              name="agreed"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3">
                    <FormControl>
                      <Checkbox
                        id="agreed"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="mt-0.5 shrink-0"
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <label htmlFor="agreed" className="text-sm text-zinc-700 leading-snug cursor-pointer select-none">
                        I have read and agree to the{" "}
                        <a href="/privacy-policy" className="font-medium text-blue-600 hover:underline">
                          Privacy Policy
                        </a>{" "}
                        and{" "}
                        <a href="/terms" className="font-medium text-blue-600 hover:underline">
                          Terms of Service
                        </a>
                        .
                      </label>
                      <p className="text-xs text-zinc-400">
                        Your data is encrypted and never sold or shared with third parties.
                      </p>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Data processing notice */}
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-600 leading-relaxed">
                We collect your name and email to create and manage your account. Passwords
                are stored using industry-standard one-way hashing and are never readable by
                anyone, including our team.
              </p>
            </div>

            <Button
              type="submit"
              data-testid="button-submit-register"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium h-11"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? "Creating account..." : "Create account"}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
