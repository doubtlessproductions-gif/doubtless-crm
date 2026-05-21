import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Music2, ShieldCheck } from "lucide-react";

const GENRES = [
  "Hip-Hop/Rap", "R&B/Soul", "Pop", "Rock", "Electronic/EDM",
  "Country", "Gospel/Christian", "Jazz", "Classical", "Latin",
  "Reggae/Dancehall", "Afrobeats", "Other",
];
const SERVICE_TYPES = ["Artist roster", "Live show", "Merch", "Mixing", "Recording", "Video"];

const schema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Valid email required"),
  artistName: z.string().optional(),
  phone: z.string().optional(),
  primaryGenre: z.string().optional(),
  musicLink: z.string().optional(),
  socialLinks: z.string().optional(),
  serviceType: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function IntakePage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/forms/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!r.ok) {
        const body = await r.json() as { error?: string };
        throw new Error(body.error ?? "Submission failed");
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 to-zinc-900 flex items-center justify-center p-6">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-10 max-w-md w-full text-center shadow-2xl backdrop-blur-sm">
          <div className="h-16 w-16 rounded-full bg-[#00e5b0]/15 flex items-center justify-center mx-auto mb-5 ring-1 ring-[#00e5b0]/30">
            <CheckCircle2 className="h-8 w-8 text-[#00e5b0]" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Submission received</h2>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Thanks for reaching out. Our team will review your submission and get back to you shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">

      {/* Branded header */}
      <div className="pt-12 pb-10 px-4 text-center">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#00e5b0]/10 border border-[#00e5b0]/20 mb-5">
          <Music2 className="h-7 w-7 text-[#00e5b0]" />
        </div>
        <div className="mb-1">
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[#00e5b0]">Doubtless Productions</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Artist Intake Form</h1>
        <p className="mt-2 text-sm text-zinc-400 max-w-xs mx-auto">
          Tell us about yourself and what you're looking for. We'll be in touch soon.
        </p>
      </div>

      {/* Form card */}
      <div className="max-w-xl mx-auto px-4 pb-16">
        <div className="bg-white rounded-2xl shadow-2xl border border-zinc-100 p-7 sm:p-8">

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-700 font-medium text-sm">First Name <span className="text-rose-500">*</span></Label>
                <Input {...register("firstName")} placeholder="First name" className="border-zinc-200 focus:border-zinc-400" />
                {errors.firstName && <p className="text-xs text-rose-500">{errors.firstName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-700 font-medium text-sm">Last Name <span className="text-rose-500">*</span></Label>
                <Input {...register("lastName")} placeholder="Last name" className="border-zinc-200 focus:border-zinc-400" />
                {errors.lastName && <p className="text-xs text-rose-500">{errors.lastName.message}</p>}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Email address <span className="text-rose-500">*</span></Label>
              <Input type="email" {...register("email")} placeholder="your@email.com" className="border-zinc-200 focus:border-zinc-400" />
              {errors.email && <p className="text-xs text-rose-500">{errors.email.message}</p>}
            </div>

            {/* Artist / Stage Name */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Artist / Stage Name</Label>
              <Input {...register("artistName")} placeholder="Artist or stage name" className="border-zinc-200 focus:border-zinc-400" />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Phone Number</Label>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 px-3 border border-zinc-200 rounded-md bg-zinc-50 text-sm text-zinc-600 shrink-0">
                  🇺🇸 +1
                </div>
                <Input {...register("phone")} placeholder="(555) 000-0000" className="flex-1 border-zinc-200 focus:border-zinc-400" />
              </div>
            </div>

            {/* Primary Genre */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Primary Genre</Label>
              <Select onValueChange={(v) => setValue("primaryGenre", v)}>
                <SelectTrigger className="border-zinc-200">
                  <SelectValue placeholder="Select genre..." />
                </SelectTrigger>
                <SelectContent>
                  {GENRES.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Primary Music Link */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Primary Music Link</Label>
              <Input {...register("musicLink")} placeholder="Spotify, SoundCloud, YouTube..." className="border-zinc-200 focus:border-zinc-400" />
            </div>

            {/* Social Media Links */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Social Media Links</Label>
              <Input {...register("socialLinks")} placeholder="Instagram, TikTok, X..." className="border-zinc-200 focus:border-zinc-400" />
            </div>

            {/* Service type */}
            <div className="space-y-1.5">
              <Label className="text-zinc-700 font-medium text-sm">Service type</Label>
              <Select onValueChange={(v) => setValue("serviceType", v)}>
                <SelectTrigger className="border-zinc-200">
                  <SelectValue placeholder="Select service..." />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-[#00e5b0] hover:bg-[#00ccaa] text-zinc-900 font-semibold text-sm shadow-sm transition-colors"
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit application"}
            </Button>

            {/* Privacy */}
            <div className="flex items-start gap-2.5 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 text-zinc-400 mt-0.5 shrink-0" />
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Your information is encrypted and never shared with third parties. Doubtless Productions may use it to contact you about your inquiry and related services.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
