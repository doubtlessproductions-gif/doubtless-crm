// Public form renderer — /f/:slug
import { useState, useRef, useEffect, useCallback } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, Star, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PublicField {
  id: string;
  type: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  options?: string[];
  content?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  maxStars?: number;
  matrixRows?: string[];
  matrixCols?: string[];
  yesLabel?: string;
  noLabel?: string;
}

interface PublicForm {
  id: number;
  name: string;
  description?: string;
  fields: PublicField[];
  submitButtonLabel: string;
  successMessage: string;
}

// Display-only types that skip required validation
const DISPLAY_ONLY = new Set(["divider", "heading", "contract_text", "statement", "instructions", "spacer"]);

// ── Signature Pad ─────────────────────────────────────────────────────────────
function SignaturePad({ value, onChange, error, label = "Signature", initials = false }: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label?: string;
  initials?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value);

  // Restore existing signature on mount
  useEffect(() => {
    if (value && canvasRef.current) {
      const img = new Image();
      img.onload = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          ctx.drawImage(img, 0, 0);
          setIsEmpty(false);
        }
      };
      img.src = value;
    }
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setIsEmpty(false);
  }, []);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e, canvas);
    ctx.lineWidth = initials ? 2.5 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1e293b";
    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing, initials]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }, [isDrawing, onChange]);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    onChange("");
  };

  const width = initials ? 160 : 480;
  const height = initials ? 100 : 150;

  return (
    <div className="space-y-1">
      <div className={`relative border-2 rounded-lg overflow-hidden bg-white ${error ? "border-red-400" : isEmpty ? "border-dashed border-zinc-300" : "border-zinc-300"}`} style={{ maxWidth: initials ? 200 : "100%" }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full cursor-crosshair touch-none block"
          style={{ height: initials ? 70 : 130 }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-zinc-300 italic">{initials ? "Initials" : `Draw your ${label.toLowerCase()} here`}</p>
          </div>
        )}
        {!isEmpty && (
          <button
            type="button"
            onClick={clear}
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-white/80 border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:border-red-200 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {!isEmpty && <p className="text-[10px] text-zinc-400">Click the × to clear and re-draw</p>}
    </div>
  );
}

// ── Star Rating ───────────────────────────────────────────────────────────────
function StarRating({ value, maxStars = 5, onChange, error }: {
  value: number;
  maxStars?: number;
  onChange: (v: number) => void;
  error?: string;
}) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className={`flex items-center gap-1 ${error ? "outline outline-red-400 rounded" : ""}`}>
      {Array.from({ length: maxStars }).map((_, i) => {
        const n = i + 1;
        const filled = n <= (hovered || value);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            className="transition-transform hover:scale-110"
          >
            <Star className={`h-7 w-7 transition-colors ${filled ? "text-amber-400 fill-amber-400" : "text-zinc-200"}`} />
          </button>
        );
      })}
      {value > 0 && (
        <span className="text-sm text-zinc-500 ml-2">{value}/{maxStars}</span>
      )}
    </div>
  );
}

// ── Number Scale ──────────────────────────────────────────────────────────────
function NumberScale({ value, min = 1, max = 10, onChange, error }: {
  value: number | null;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  error?: string;
}) {
  const items = Array.from({ length: Math.min(max - min + 1, 11) }, (_, i) => min + i);
  return (
    <div className={`space-y-2 ${error ? "outline outline-red-400 rounded" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-9 w-9 rounded-full border text-sm font-medium transition-colors ${
              value === n
                ? "bg-blue-600 border-blue-600 text-white"
                : "border-zinc-300 text-zinc-600 hover:border-blue-400 hover:text-blue-600"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {min !== undefined && max !== undefined && (
        <div className="flex justify-between text-xs text-zinc-400">
          <span>{min} = Low</span>
          <span>{max} = High</span>
        </div>
      )}
    </div>
  );
}

// ── Address Block ─────────────────────────────────────────────────────────────
function AddressInput({ value, onChange, error }: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  error?: string;
}) {
  const set = (key: string, val: string) => onChange({ ...value, [key]: val });
  const borderClass = error ? "border-red-400" : "";
  return (
    <div className="space-y-2">
      <Input placeholder="Street address" value={value.street ?? ""} onChange={(e) => set("street", e.target.value)} className={borderClass} />
      <Input placeholder="Apt, suite, unit (optional)" value={value.apt ?? ""} onChange={(e) => set("apt", e.target.value)} />
      <div className="flex gap-2">
        <Input placeholder="City" value={value.city ?? ""} onChange={(e) => set("city", e.target.value)} className={`flex-1 ${borderClass}`} />
        <Input placeholder="State" value={value.state ?? ""} onChange={(e) => set("state", e.target.value)} className={`w-20 ${borderClass}`} />
        <Input placeholder="ZIP" value={value.zip ?? ""} onChange={(e) => set("zip", e.target.value)} className={`w-24 ${borderClass}`} />
      </div>
    </div>
  );
}

// ── Full Name Block ───────────────────────────────────────────────────────────
function FullNameInput({ value, onChange, error }: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  error?: string;
}) {
  const borderClass = error ? "border-red-400" : "";
  return (
    <div className="flex gap-2">
      <div className="flex-1 space-y-1">
        <Input placeholder="First name" value={value.first ?? ""} onChange={(e) => onChange({ ...value, first: e.target.value })} className={borderClass} />
        <p className="text-xs text-zinc-400">First</p>
      </div>
      <div className="flex-1 space-y-1">
        <Input placeholder="Last name" value={value.last ?? ""} onChange={(e) => onChange({ ...value, last: e.target.value })} className={borderClass} />
        <p className="text-xs text-zinc-400">Last</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function FormPublicPage() {
  const [, params] = useRoute("/f/:slug");
  const slug = params?.slug ?? "";
  const today = new Date().toISOString().slice(0, 10);

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const { data: form, isLoading, error } = useQuery<PublicForm>({
    queryKey: ["public-form", slug],
    queryFn: async () => {
      const r = await fetch(`/api/custom-forms/public/${slug}`);
      if (!r.ok) throw new Error("Form not found");
      return r.json();
    },
    enabled: !!slug,
    retry: false,
  });

  // Auto-fill date_signed fields
  useEffect(() => {
    if (!form) return;
    const dateSignedFields = form.fields.filter(f => f.type === "date_signed");
    if (dateSignedFields.length > 0) {
      setValues(prev => {
        const next = { ...prev };
        for (const f of dateSignedFields) {
          if (!next[f.id]) next[f.id] = today;
        }
        return next;
      });
    }
  }, [form, today]);

  const submit = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const r = await fetch(`/api/custom-forms/${form!.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const body = await r.json() as { error?: string };
        throw new Error(body.error ?? "Submission failed");
      }
      return r.json() as Promise<{ successMessage: string }>;
    },
    onSuccess: (res) => { setSuccessMsg(res.successMessage); setDone(true); },
    onError: (err: Error) => setErrors({ _form: err.message }),
  });

  function set(id: string, val: unknown) {
    setValues((prev) => ({ ...prev, [id]: val }));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  function toggleCheckbox(id: string, option: string) {
    const current = (values[id] as string[] | undefined) ?? [];
    set(id, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const newErrors: Record<string, string> = {};
    for (const field of form.fields) {
      if (field.required && !DISPLAY_ONLY.has(field.type)) {
        const val = values[field.id];
        let empty = val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
        // Object values (address, full_name) — check at least one sub-field filled
        if (!empty && typeof val === "object" && !Array.isArray(val)) {
          empty = Object.values(val as Record<string, string>).every(v => !v.trim());
        }
        if (empty) newErrors[field.id] = `${field.label} is required`;
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }
    const submitData = { ...values, _hp: undefined };
    // Stringify object values (address, full_name) for storage
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(submitData)) {
      if (v !== undefined && typeof v === "object" && !Array.isArray(v) && v !== null) {
        normalized[k] = Object.entries(v as Record<string, string>).map(([fk, fv]) => `${fk}: ${fv}`).join(", ");
      } else {
        normalized[k] = v;
      }
    }
    submit.mutate(normalized);
  }

  // ── Loading / Error / Done states ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !form) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-500 text-sm">This form is not available.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-10 max-w-md w-full text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-zinc-900 mb-2">Submitted!</h2>
          <p className="text-zinc-500 text-sm">{successMsg}</p>
        </div>
      </div>
    );
  }

  // ── Form render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50 py-12 px-4">
      <div className="max-w-xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-zinc-100">
            <h1 className="text-2xl font-bold text-zinc-900">{form.name}</h1>
            {form.description && <p className="text-zinc-500 mt-2 text-sm">{form.description}</p>}
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-6 space-y-6">
            {/* Honeypot */}
            <input type="text" name="_hp" className="hidden" tabIndex={-1} autoComplete="off" />

            {form.fields.map((field) => {
              // ── Layout / Display-only ─────────────────────────────────────
              if (field.type === "divider") return <hr key={field.id} className="border-zinc-200" />;
              if (field.type === "spacer") return <div key={field.id} className="h-4" />;
              if (field.type === "heading") {
                return (
                  <div key={field.id} className="pt-2">
                    <h3 className="text-lg font-semibold text-zinc-800">{field.content || field.label}</h3>
                  </div>
                );
              }
              if (field.type === "statement") {
                return (
                  <div key={field.id}>
                    <p className="text-sm text-zinc-600 leading-relaxed">{field.content || field.label}</p>
                  </div>
                );
              }
              if (field.type === "instructions") {
                return (
                  <div key={field.id} className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-700 leading-relaxed">{field.content || field.label}</p>
                  </div>
                );
              }
              if (field.type === "contract_text") {
                return (
                  <div key={field.id} className="max-h-64 overflow-y-auto bg-zinc-50 border border-zinc-200 rounded-xl p-5">
                    <p className="text-xs text-zinc-600 whitespace-pre-wrap leading-relaxed font-mono">{field.content}</p>
                  </div>
                );
              }

              // ── Input fields ──────────────────────────────────────────────
              return (
                <div key={field.id} className="space-y-2">
                  {/* Label (not shown for legal_agreement which has its own) */}
                  {field.type !== "legal_agreement" && (
                    <Label className="text-sm font-medium text-zinc-700">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                  )}

                  {/* ── Signature ─────────────────────────────────────── */}
                  {field.type === "signature" && (
                    <SignaturePad
                      value={(values[field.id] as string) ?? ""}
                      onChange={(v) => set(field.id, v)}
                      error={errors[field.id]}
                      label={field.label}
                    />
                  )}

                  {/* ── Initials ──────────────────────────────────────── */}
                  {field.type === "initials" && (
                    <SignaturePad
                      value={(values[field.id] as string) ?? ""}
                      onChange={(v) => set(field.id, v)}
                      error={errors[field.id]}
                      label={field.label}
                      initials
                    />
                  )}

                  {/* ── Date signed (auto-filled, read-only) ──────────── */}
                  {field.type === "date_signed" && (
                    <div className="h-10 rounded-lg border border-zinc-200 bg-zinc-50 px-4 flex items-center text-sm text-zinc-600 font-mono">
                      {today}
                      <span className="ml-2 text-xs text-zinc-400">(auto-filled)</span>
                    </div>
                  )}

                  {/* ── Legal agreement ───────────────────────────────── */}
                  {field.type === "legal_agreement" && (
                    <div className={`rounded-xl border p-4 space-y-3 ${errors[field.id] ? "border-red-400 bg-red-50/30" : "border-zinc-200 bg-zinc-50"}`}>
                      {field.content && (
                        <p className="text-xs text-zinc-600 leading-relaxed italic">{field.content}</p>
                      )}
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!values[field.id]}
                          onChange={(e) => set(field.id, e.target.checked)}
                          className="h-4 w-4 rounded mt-0.5 accent-blue-600"
                        />
                        <span className="text-sm text-zinc-700 font-medium">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </span>
                      </label>
                    </div>
                  )}

                  {/* ── Star rating ───────────────────────────────────── */}
                  {field.type === "rating" && (
                    <StarRating
                      value={(values[field.id] as number) ?? 0}
                      maxStars={field.maxStars ?? 5}
                      onChange={(v) => set(field.id, v)}
                      error={errors[field.id]}
                    />
                  )}

                  {/* ── Number scale ──────────────────────────────────── */}
                  {field.type === "scale" && (
                    <NumberScale
                      value={(values[field.id] as number | null) ?? null}
                      min={field.min ?? 1}
                      max={field.max ?? 10}
                      onChange={(v) => set(field.id, v)}
                      error={errors[field.id]}
                    />
                  )}

                  {/* ── Slider ────────────────────────────────────────── */}
                  {field.type === "slider" && (
                    <div className="space-y-2">
                      <input
                        type="range"
                        min={field.min ?? 0}
                        max={field.max ?? 100}
                        step={field.step ?? 1}
                        value={(values[field.id] as number) ?? field.min ?? 0}
                        onChange={(e) => set(field.id, parseFloat(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                      <div className="flex justify-between items-center text-xs text-zinc-500">
                        <span>{field.min ?? 0}{field.unit ? ` ${field.unit}` : ""}</span>
                        <span className="font-semibold text-zinc-800">{(values[field.id] as number) ?? field.min ?? 0}{field.unit ? ` ${field.unit}` : ""}</span>
                        <span>{field.max ?? 100}{field.unit ? ` ${field.unit}` : ""}</span>
                      </div>
                    </div>
                  )}

                  {/* ── Yes / No ──────────────────────────────────────── */}
                  {field.type === "yes_no" && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => set(field.id, "yes")}
                        className={`h-10 px-6 rounded-lg border-2 text-sm font-medium transition-colors ${
                          values[field.id] === "yes"
                            ? "bg-blue-600 border-blue-600 text-white"
                            : "border-zinc-300 text-zinc-600 hover:border-blue-400"
                        }`}
                      >
                        {field.yesLabel ?? "Yes"}
                      </button>
                      <button
                        type="button"
                        onClick={() => set(field.id, "no")}
                        className={`h-10 px-6 rounded-lg border-2 text-sm font-medium transition-colors ${
                          values[field.id] === "no"
                            ? "bg-zinc-700 border-zinc-700 text-white"
                            : "border-zinc-300 text-zinc-600 hover:border-zinc-500"
                        }`}
                      >
                        {field.noLabel ?? "No"}
                      </button>
                    </div>
                  )}

                  {/* ── Full name ─────────────────────────────────────── */}
                  {field.type === "full_name" && (
                    <FullNameInput
                      value={(values[field.id] as Record<string, string>) ?? {}}
                      onChange={(v) => set(field.id, v)}
                      error={errors[field.id]}
                    />
                  )}

                  {/* ── Address ───────────────────────────────────────── */}
                  {field.type === "address" && (
                    <AddressInput
                      value={(values[field.id] as Record<string, string>) ?? {}}
                      onChange={(v) => set(field.id, v)}
                      error={errors[field.id]}
                    />
                  )}

                  {/* ── Short text ────────────────────────────────────── */}
                  {field.type === "short_text" && (
                    <Input
                      placeholder={field.placeholder}
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Long text ─────────────────────────────────────── */}
                  {field.type === "long_text" && (
                    <Textarea
                      placeholder={field.placeholder}
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      rows={4}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Email ─────────────────────────────────────────── */}
                  {field.type === "email" && (
                    <Input
                      type="email"
                      placeholder={field.placeholder ?? "you@example.com"}
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Phone ─────────────────────────────────────────── */}
                  {field.type === "phone" && (
                    <Input
                      type="tel"
                      placeholder={field.placeholder ?? "(555) 000-0000"}
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Number ────────────────────────────────────────── */}
                  {field.type === "number" && (
                    <Input
                      type="number"
                      placeholder={field.placeholder}
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Date ──────────────────────────────────────────── */}
                  {field.type === "date" && (
                    <Input
                      type="date"
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── URL ───────────────────────────────────────────── */}
                  {field.type === "url" && (
                    <Input
                      type="url"
                      placeholder={field.placeholder ?? "https://"}
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Time ──────────────────────────────────────────── */}
                  {field.type === "time" && (
                    <Input
                      type="time"
                      value={(values[field.id] as string) ?? ""}
                      onChange={(e) => set(field.id, e.target.value)}
                      className={errors[field.id] ? "border-red-400" : ""}
                    />
                  )}

                  {/* ── Dropdown ──────────────────────────────────────── */}
                  {field.type === "dropdown" && (
                    <Select value={(values[field.id] as string) ?? ""} onValueChange={(v) => set(field.id, v)}>
                      <SelectTrigger className={errors[field.id] ? "border-red-400" : ""}>
                        <SelectValue placeholder={field.placeholder ?? "Select an option..."} />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {/* ── Radio ─────────────────────────────────────────── */}
                  {field.type === "radio" && (
                    <div className="space-y-2">
                      {(field.options ?? []).map((opt) => (
                        <label key={opt} className="flex items-center gap-3 cursor-pointer text-sm text-zinc-700 hover:text-zinc-900">
                          <input
                            type="radio"
                            name={field.id}
                            value={opt}
                            checked={(values[field.id] as string) === opt}
                            onChange={() => set(field.id, opt)}
                            className="h-4 w-4 accent-blue-600"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}

                  {/* ── Checkbox group ────────────────────────────────── */}
                  {field.type === "checkbox_group" && (
                    <div className="space-y-2">
                      {(field.options ?? []).map((opt) => {
                        const checked = ((values[field.id] as string[]) ?? []).includes(opt);
                        return (
                          <label key={opt} className="flex items-center gap-3 cursor-pointer text-sm text-zinc-700 hover:text-zinc-900">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCheckbox(field.id, opt)}
                              className="h-4 w-4 rounded accent-blue-600"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Single checkbox ───────────────────────────────── */}
                  {field.type === "checkbox" && (
                    <label className="flex items-center gap-3 cursor-pointer text-sm text-zinc-700">
                      <input
                        type="checkbox"
                        checked={!!values[field.id]}
                        onChange={(e) => set(field.id, e.target.checked)}
                        className="h-4 w-4 rounded accent-blue-600"
                      />
                      {field.placeholder || field.label}
                    </label>
                  )}

                  {field.helpText && <p className="text-xs text-zinc-400">{field.helpText}</p>}
                  {errors[field.id] && <p className="text-xs text-red-500">{errors[field.id]}</p>}
                </div>
              );
            })}

            {errors["_form"] && (
              <p className="text-sm text-red-500 text-center">{errors["_form"]}</p>
            )}

            <div className="pt-2">
              <Button type="submit" className="w-full h-11 text-base" disabled={submit.isPending}>
                {submit.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Submitting…</> : form.submitButtonLabel}
              </Button>
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-300 mt-6">Powered by Doubtless Productions</p>
      </div>
    </div>
  );
}
