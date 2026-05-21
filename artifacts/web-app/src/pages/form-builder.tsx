// Custom Form Builder — /forms/builder and /forms/builder/:id
import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, Plus, Trash2, GripVertical, ChevronUp, ChevronDown,
  Globe, Lock, Eye, Save, Copy, ExternalLink, Search,
  Type, AlignLeft, Mail, Phone, Hash, Calendar, ChevronDown as DropIcon,
  Circle, CheckSquare, CheckCircle2, Minus, Heading, UserCheck,
  User, Link, Clock, MapPin, ToggleLeft, Star, BarChart2, Sliders,
  PenLine, FileSignature, CalendarCheck, ScrollText, ShieldCheck,
  AlignJustify, Info, Maximize2, Layers, Upload, Download, DollarSign, Percent,
  X, FileText,
} from "lucide-react";
import FORM_TEMPLATES, { TEMPLATE_CATEGORIES, type FormTemplate } from "@/data/form-templates";

// ── Types ─────────────────────────────────────────────────────────────────────
type FieldType =
  | "short_text" | "long_text" | "email" | "phone" | "number" | "date"
  | "full_name" | "url" | "time" | "address"
  | "dropdown" | "radio" | "checkbox_group" | "checkbox" | "yes_no"
  | "rating" | "scale" | "slider"
  | "signature" | "initials" | "date_signed" | "contract_text" | "legal_agreement"
  | "heading" | "divider" | "statement" | "instructions" | "spacer";

type CrmFieldMapping = "name" | "email" | "phone" | "company" | "notes";

const CRM_FIELD_OPTIONS: { value: CrmFieldMapping; label: string }[] = [
  { value: "name",    label: "Contact Name" },
  { value: "email",   label: "Email Address" },
  { value: "phone",   label: "Phone Number" },
  { value: "company", label: "Company" },
  { value: "notes",   label: "Notes" },
];

interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  options?: string[];
  content?: string;
  crmField?: CrmFieldMapping;
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

interface CustomForm {
  id: number;
  name: string;
  description?: string;
  slug: string;
  fields: FormField[];
  status: "draft" | "published" | "archived";
  submitButtonLabel: string;
  successMessage: string;
  createContact: boolean;
  createDeal: boolean;
  dealStage?: string;
}

// ── Field type palette ────────────────────────────────────────────────────────
const FIELD_TYPES: { type: FieldType; label: string; icon: React.ReactNode; group: string }[] = [
  // Basic
  { type: "short_text",     label: "Short text",       icon: <Type className="h-3.5 w-3.5" />,           group: "Basic" },
  { type: "long_text",      label: "Long text",        icon: <AlignLeft className="h-3.5 w-3.5" />,      group: "Basic" },
  { type: "email",          label: "Email",            icon: <Mail className="h-3.5 w-3.5" />,           group: "Basic" },
  { type: "phone",          label: "Phone",            icon: <Phone className="h-3.5 w-3.5" />,          group: "Basic" },
  { type: "number",         label: "Number",           icon: <Hash className="h-3.5 w-3.5" />,           group: "Basic" },
  { type: "date",           label: "Date",             icon: <Calendar className="h-3.5 w-3.5" />,       group: "Basic" },
  // Contact
  { type: "full_name",      label: "Full name",        icon: <User className="h-3.5 w-3.5" />,           group: "Contact" },
  { type: "url",            label: "Website URL",      icon: <Link className="h-3.5 w-3.5" />,           group: "Contact" },
  { type: "time",           label: "Time",             icon: <Clock className="h-3.5 w-3.5" />,          group: "Contact" },
  { type: "address",        label: "Address",          icon: <MapPin className="h-3.5 w-3.5" />,         group: "Contact" },
  // Choice
  { type: "dropdown",       label: "Dropdown",         icon: <DropIcon className="h-3.5 w-3.5" />,       group: "Choice" },
  { type: "radio",          label: "Radio buttons",    icon: <Circle className="h-3.5 w-3.5" />,         group: "Choice" },
  { type: "checkbox_group", label: "Multi-select",     icon: <CheckSquare className="h-3.5 w-3.5" />,    group: "Choice" },
  { type: "checkbox",       label: "Single checkbox",  icon: <CheckCircle2 className="h-3.5 w-3.5" />,   group: "Choice" },
  { type: "yes_no",         label: "Yes / No",         icon: <ToggleLeft className="h-3.5 w-3.5" />,     group: "Choice" },
  // Scale & Rating
  { type: "rating",         label: "Star rating",      icon: <Star className="h-3.5 w-3.5" />,           group: "Scale & Rating" },
  { type: "scale",          label: "Number scale",     icon: <BarChart2 className="h-3.5 w-3.5" />,      group: "Scale & Rating" },
  { type: "slider",         label: "Slider",           icon: <Sliders className="h-3.5 w-3.5" />,        group: "Scale & Rating" },
  // Contract & Signature
  { type: "contract_text",  label: "Contract text",    icon: <ScrollText className="h-3.5 w-3.5" />,     group: "Contract & Sign" },
  { type: "legal_agreement",label: "Legal agreement",  icon: <ShieldCheck className="h-3.5 w-3.5" />,    group: "Contract & Sign" },
  { type: "signature",      label: "Signature",        icon: <PenLine className="h-3.5 w-3.5" />,        group: "Contract & Sign" },
  { type: "initials",       label: "Initials",         icon: <FileSignature className="h-3.5 w-3.5" />,  group: "Contract & Sign" },
  { type: "date_signed",    label: "Date signed",      icon: <CalendarCheck className="h-3.5 w-3.5" />,  group: "Contract & Sign" },
  // Layout
  { type: "heading",        label: "Heading",          icon: <Heading className="h-3.5 w-3.5" />,        group: "Layout" },
  { type: "divider",        label: "Divider",          icon: <Minus className="h-3.5 w-3.5" />,          group: "Layout" },
  { type: "statement",      label: "Statement",        icon: <AlignJustify className="h-3.5 w-3.5" />,   group: "Layout" },
  { type: "instructions",   label: "Instructions",     icon: <Info className="h-3.5 w-3.5" />,           group: "Layout" },
  { type: "spacer",         label: "Spacer",           icon: <Maximize2 className="h-3.5 w-3.5" />,      group: "Layout" },
];

const FIELD_GROUPS = ["Basic", "Contact", "Choice", "Scale & Rating", "Contract & Sign", "Layout"];

// ── Non-input display types (skip required validation) ────────────────────────
const DISPLAY_ONLY = new Set(["divider", "heading", "contract_text", "statement", "instructions", "spacer"]);
// Types that don't show CRM mapping
const NO_CRM = new Set(["divider", "heading", "contract_text", "statement", "instructions", "spacer", "checkbox", "signature", "initials", "date_signed", "legal_agreement", "yes_no", "rating", "scale", "slider"]);

function makeField(type: FieldType): FormField {
  const base: FormField = {
    id: crypto.randomUUID(),
    type,
    label: FIELD_TYPES.find((f) => f.type === type)?.label ?? type,
    required: false,
  };
  if (["dropdown", "radio", "checkbox_group"].includes(type)) base.options = ["Option 1", "Option 2", "Option 3"];
  if (type === "heading") base.content = "Section heading";
  if (type === "statement") base.content = "This is a statement or paragraph of text shown to the form respondent.";
  if (type === "instructions") base.content = "Please read and follow these instructions carefully before proceeding.";
  if (type === "contract_text") base.content = "Enter the contract or agreement text here. This will be displayed to the form respondent.";
  if (type === "legal_agreement") { base.content = "I agree to the terms and conditions stated above."; base.required = true; }
  if (type === "signature") base.required = true;
  if (type === "initials") base.required = true;
  if (type === "date_signed") base.required = true;
  if (type === "rating") base.maxStars = 5;
  if (type === "scale") { base.min = 1; base.max = 10; }
  if (type === "slider") { base.min = 0; base.max = 100; base.step = 1; }
  if (type === "yes_no") { base.yesLabel = "Yes"; base.noLabel = "No"; }
  return base;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function authH(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Expand template fields into full FormField objects ───────────────────────
function expandTemplate(template: FormTemplate): FormField[] {
  return template.fields.map((f) => {
    const base = makeField(f.type as FieldType);
    return {
      ...base,
      label: f.label || base.label,
      required: f.required ?? base.required,
      options: f.options ?? base.options,
      content: f.content ?? base.content,
      helpText: f.helpText,
      placeholder: f.placeholder,
      crmField: f.crmField as CrmFieldMapping | undefined,
      min: f.min ?? base.min,
      max: f.max ?? base.max,
      step: f.step ?? base.step,
      unit: f.unit,
      maxStars: f.maxStars ?? base.maxStars,
      matrixRows: f.matrixRows,
      matrixCols: f.matrixCols,
      yesLabel: f.yesLabel ?? base.yesLabel,
      noLabel: f.noLabel ?? base.noLabel,
    };
  });
}

// ── Field preview (read-only visual in canvas) ────────────────────────────────
function FieldPreview({ field }: { field: FormField }) {
  const today = new Date().toISOString().slice(0, 10);

  if (field.type === "divider") return <hr className="border-zinc-200 my-1" />;
  if (field.type === "spacer") return <div className="h-6 bg-zinc-50 rounded border border-dashed border-zinc-200 flex items-center justify-center"><span className="text-[10px] text-zinc-300">spacer</span></div>;
  if (field.type === "heading") return <p className="text-base font-semibold text-zinc-800 mt-2">{field.content || field.label}</p>;

  if (field.type === "statement") {
    return <p className="text-sm text-zinc-600 leading-relaxed">{field.content || "Statement text"}</p>;
  }

  if (field.type === "instructions") {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-700 leading-relaxed">{field.content || "Instructions text"}</p>
      </div>
    );
  }

  if (field.type === "contract_text") {
    return (
      <div className="max-h-32 overflow-y-auto bg-zinc-50 border border-zinc-200 rounded-lg p-3">
        <p className="text-xs text-zinc-600 whitespace-pre-wrap leading-relaxed">{field.content || "Contract text will appear here."}</p>
      </div>
    );
  }

  if (field.type === "legal_agreement") {
    return (
      <div className="space-y-2">
        {field.content && <p className="text-xs text-zinc-500 italic leading-relaxed">{field.content}</p>}
        <div className="flex items-start gap-2 text-xs text-zinc-600">
          <div className="h-3.5 w-3.5 rounded border border-zinc-300 mt-0.5 shrink-0" />
          {field.label}
        </div>
      </div>
    );
  }

  if (field.type === "signature") {
    return (
      <div className="h-20 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 flex items-center justify-center">
        <div className="text-center">
          <PenLine className="h-5 w-5 text-zinc-300 mx-auto mb-1" />
          <span className="text-xs text-zinc-300 italic">Draw signature here</span>
        </div>
      </div>
    );
  }

  if (field.type === "initials") {
    return (
      <div className="h-14 w-24 rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 flex items-center justify-center">
        <span className="text-xs text-zinc-300 italic">Initials</span>
      </div>
    );
  }

  if (field.type === "date_signed") {
    return (
      <div className="h-8 rounded-md border border-zinc-200 bg-zinc-100 px-3 flex items-center">
        <span className="text-xs text-zinc-500">{today} (auto-filled)</span>
      </div>
    );
  }

  if (field.type === "rating") {
    const stars = field.maxStars ?? 5;
    return (
      <div className="flex items-center gap-1">
        {Array.from({ length: stars }).map((_, i) => (
          <Star key={i} className={`h-4 w-4 ${i < 3 ? "text-amber-400 fill-amber-400" : "text-zinc-200"}`} />
        ))}
      </div>
    );
  }

  if (field.type === "scale") {
    const min = field.min ?? 1;
    const max = field.max ?? 10;
    const items = Array.from({ length: Math.min(max - min + 1, 11) }, (_, i) => min + i);
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {items.map((n) => (
          <div key={n} className={`h-6 w-6 rounded-full border text-[10px] flex items-center justify-center ${n === min ? "bg-blue-500 border-blue-500 text-white" : "border-zinc-300 text-zinc-400"}`}>{n}</div>
        ))}
      </div>
    );
  }

  if (field.type === "slider") {
    return (
      <div className="space-y-1">
        <input type="range" min={field.min ?? 0} max={field.max ?? 100} defaultValue={50} className="w-full accent-blue-500" readOnly />
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>{field.min ?? 0}{field.unit ? ` ${field.unit}` : ""}</span>
          <span>{field.max ?? 100}{field.unit ? ` ${field.unit}` : ""}</span>
        </div>
      </div>
    );
  }

  if (field.type === "yes_no") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-8 px-4 rounded-md bg-blue-500 text-white text-xs flex items-center font-medium">{field.yesLabel ?? "Yes"}</div>
        <div className="h-8 px-4 rounded-md border border-zinc-300 text-zinc-500 text-xs flex items-center">{field.noLabel ?? "No"}</div>
      </div>
    );
  }

  if (field.type === "address") {
    return (
      <div className="space-y-1.5">
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center"><span className="text-xs text-zinc-400">Street address</span></div>
        <div className="flex gap-1.5">
          <div className="h-8 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center"><span className="text-xs text-zinc-400">City</span></div>
          <div className="h-8 w-16 rounded-md border border-zinc-200 bg-zinc-50 px-2 flex items-center"><span className="text-xs text-zinc-400">State</span></div>
          <div className="h-8 w-20 rounded-md border border-zinc-200 bg-zinc-50 px-2 flex items-center"><span className="text-xs text-zinc-400">ZIP</span></div>
        </div>
      </div>
    );
  }

  if (field.type === "full_name") {
    return (
      <div className="flex gap-1.5">
        <div className="h-8 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center"><span className="text-xs text-zinc-400">First name</span></div>
        <div className="h-8 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center"><span className="text-xs text-zinc-400">Last name</span></div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-zinc-600">
        {field.label}{field.required && <span className="text-red-400 ml-1">*</span>}
      </Label>
      {(["short_text", "email", "phone", "number", "url", "time", "currency", "percentage"].includes(field.type)) && (
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center">
          <span className="text-xs text-zinc-400">{field.placeholder || (field.type === "url" ? "https://" : field.type === "time" ? "—:—" : "Text input")}</span>
        </div>
      )}
      {field.type === "date" && (
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center">
          <span className="text-xs text-zinc-400">mm/dd/yyyy</span>
        </div>
      )}
      {field.type === "long_text" && (
        <div className="h-16 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <span className="text-xs text-zinc-400">{field.placeholder || "Multi-line text"}</span>
        </div>
      )}
      {field.type === "dropdown" && (
        <div className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-3 flex items-center justify-between">
          <span className="text-xs text-zinc-400">Select an option…</span>
          <DropIcon className="h-3 w-3 text-zinc-300" />
        </div>
      )}
      {field.type === "radio" && (
        <div className="space-y-1">
          {(field.options ?? []).slice(0, 3).map((o) => (
            <div key={o} className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="h-3 w-3 rounded-full border border-zinc-300" />{o}
            </div>
          ))}
        </div>
      )}
      {field.type === "checkbox_group" && (
        <div className="space-y-1">
          {(field.options ?? []).slice(0, 3).map((o) => (
            <div key={o} className="flex items-center gap-2 text-xs text-zinc-500">
              <div className="h-3 w-3 rounded border border-zinc-300" />{o}
            </div>
          ))}
        </div>
      )}
      {field.type === "checkbox" && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <div className="h-3 w-3 rounded border border-zinc-300" />
          {field.placeholder || field.label}
        </div>
      )}
      {field.helpText && <p className="text-[10px] text-zinc-400">{field.helpText}</p>}
    </div>
  );
}

// ── Field configurator (right panel) ─────────────────────────────────────────
function FieldConfig({ field, onChange, onDelete }: {
  field: FormField;
  onChange: (updated: FormField) => void;
  onDelete: () => void;
}) {
  const [optionInput, setOptionInput] = useState("");
  const hasOptions = ["dropdown", "radio", "checkbox_group"].includes(field.type);
  const isDisplayOnly = DISPLAY_ONLY.has(field.type);
  const hasContent = ["heading", "statement", "instructions", "contract_text", "legal_agreement"].includes(field.type);
  const showCrm = !NO_CRM.has(field.type);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Field settings</span>
        <Button size="sm" variant="ghost" className="h-7 text-red-500 hover:bg-red-50 hover:text-red-600 px-2" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {field.type !== "divider" && field.type !== "spacer" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Label</Label>
          <Input value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })} className="h-8 text-sm" />
        </div>
      )}

      {hasContent && (
        <div className="space-y-1.5">
          <Label className="text-xs">
            {field.type === "heading" ? "Heading text" :
             field.type === "contract_text" ? "Contract / Agreement text" :
             field.type === "legal_agreement" ? "Agreement text (shown above checkbox)" :
             "Content"}
          </Label>
          <Textarea
            value={field.content ?? ""}
            onChange={(e) => onChange({ ...field, content: e.target.value })}
            className="text-xs"
            rows={field.type === "contract_text" ? 8 : 3}
            placeholder={field.type === "contract_text" ? "Enter the full contract or terms text…" : undefined}
          />
        </div>
      )}

      {!isDisplayOnly && !["heading", "yes_no", "rating", "scale", "slider", "signature", "initials", "date_signed"].includes(field.type) && (
        <div className="space-y-1.5">
          <Label className="text-xs">Placeholder</Label>
          <Input value={field.placeholder ?? ""} onChange={(e) => onChange({ ...field, placeholder: e.target.value })} className="h-8 text-sm" />
        </div>
      )}

      {!isDisplayOnly && field.type !== "divider" && field.type !== "spacer" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Help text</Label>
          <Input value={field.helpText ?? ""} onChange={(e) => onChange({ ...field, helpText: e.target.value })} placeholder="Optional hint below field" className="h-8 text-sm" />
        </div>
      )}

      {!isDisplayOnly && field.type !== "divider" && field.type !== "spacer" && (
        <div className="flex items-center justify-between">
          <Label className="text-xs">Required</Label>
          <Switch checked={field.required} onCheckedChange={(v) => onChange({ ...field, required: v })} />
        </div>
      )}

      {/* Rating config */}
      {field.type === "rating" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Maximum stars</Label>
          <Select value={String(field.maxStars ?? 5)} onValueChange={(v) => onChange({ ...field, maxStars: parseInt(v) })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[3, 4, 5, 6, 7, 10].map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n} stars</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Scale config */}
      {field.type === "scale" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Min value</Label>
            <Input type="number" value={field.min ?? 1} onChange={(e) => onChange({ ...field, min: parseInt(e.target.value) || 1 })} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max value</Label>
            <Input type="number" value={field.max ?? 10} onChange={(e) => onChange({ ...field, max: parseInt(e.target.value) || 10 })} className="h-8 text-sm" />
          </div>
        </div>
      )}

      {/* Slider config */}
      {field.type === "slider" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Min</Label>
              <Input type="number" value={field.min ?? 0} onChange={(e) => onChange({ ...field, min: parseFloat(e.target.value) })} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max</Label>
              <Input type="number" value={field.max ?? 100} onChange={(e) => onChange({ ...field, max: parseFloat(e.target.value) })} className="h-8 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Step</Label>
              <Input type="number" value={field.step ?? 1} onChange={(e) => onChange({ ...field, step: parseFloat(e.target.value) })} className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit (optional)</Label>
              <Input value={field.unit ?? ""} onChange={(e) => onChange({ ...field, unit: e.target.value })} className="h-8 text-sm" placeholder="e.g. hrs" />
            </div>
          </div>
        </div>
      )}

      {/* Yes/No labels */}
      {field.type === "yes_no" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Yes label</Label>
            <Input value={field.yesLabel ?? "Yes"} onChange={(e) => onChange({ ...field, yesLabel: e.target.value })} className="h-8 text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">No label</Label>
            <Input value={field.noLabel ?? "No"} onChange={(e) => onChange({ ...field, noLabel: e.target.value })} className="h-8 text-sm" />
          </div>
        </div>
      )}

      {/* CRM mapping */}
      {showCrm && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <UserCheck className="h-3.5 w-3.5 text-violet-500" />
            <Label className="text-xs text-violet-700 font-medium">CRM Field Mapping</Label>
          </div>
          <Select
            value={field.crmField ?? "__none__"}
            onValueChange={(v) => onChange({ ...field, crmField: v === "__none__" ? undefined : v as CrmFieldMapping })}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Not mapped" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-zinc-400">Not mapped</SelectItem>
              {CRM_FIELD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-zinc-400">Populates this contact slot when "Create Contact" is on</p>
        </div>
      )}

      {/* Options for choice fields */}
      {hasOptions && (
        <div className="space-y-2">
          <Label className="text-xs">Options</Label>
          <div className="space-y-1.5">
            {(field.options ?? []).map((opt, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={opt}
                  onChange={(e) => {
                    const opts = [...(field.options ?? [])];
                    opts[i] = e.target.value;
                    onChange({ ...field, options: opts });
                  }}
                  className="h-7 text-xs flex-1"
                />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0 text-zinc-400 hover:text-red-500"
                  onClick={() => onChange({ ...field, options: (field.options ?? []).filter((_, j) => j !== i) })}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Input
              value={optionInput}
              onChange={(e) => setOptionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (optionInput.trim()) { onChange({ ...field, options: [...(field.options ?? []), optionInput.trim()] }); setOptionInput(""); }
                }
              }}
              placeholder="New option…"
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" variant="outline" className="h-7 px-2 shrink-0"
              onClick={() => { if (optionInput.trim()) { onChange({ ...field, options: [...(field.options ?? []), optionInput.trim()] }); setOptionInput(""); } }}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-[10px] text-zinc-400">Press Enter or + to add</p>
        </div>
      )}
    </div>
  );
}

// ── Template Library Modal ────────────────────────────────────────────────────
function TemplateLibrary({ open, onClose, onLoad }: {
  open: boolean;
  onClose: () => void;
  onLoad: (fields: FormField[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const filtered = FORM_TEMPLATES.filter((t) => {
    const matchCat = category === "All" || t.category === category;
    const matchSearch = search === "" || t.name.toLowerCase().includes(search.toLowerCase()) || t.description.toLowerCase().includes(search.toLowerCase()) || (t.tags ?? []).some((tag) => tag.includes(search.toLowerCase()));
    return matchCat && matchSearch;
  });

  const contractBadgeStyle = "bg-purple-100 text-purple-700 border-purple-200";
  const categoryColors: Record<string, string> = {
    "Contracts": contractBadgeStyle,
    "Music Industry": "bg-blue-100 text-blue-700 border-blue-200",
    "Client & Lead": "bg-green-100 text-green-700 border-green-200",
    "Events & Booking": "bg-orange-100 text-orange-700 border-orange-200",
    "HR & Internal": "bg-zinc-100 text-zinc-700 border-zinc-200",
    "Surveys & Feedback": "bg-pink-100 text-pink-700 border-pink-200",
    "Marketing & General": "bg-teal-100 text-teal-700 border-teal-200",
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-blue-600" />
            Template Library
            <Badge variant="outline" className="text-xs ml-1">{FORM_TEMPLATES.length}+ templates</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="px-6 py-3 border-b bg-zinc-50 shrink-0 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {["All", ...TEMPLATE_CATEGORIES].map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  category === cat
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-zinc-400 text-sm">No templates match your search</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((tpl) => (
                <div key={tpl.id} className="bg-white border border-zinc-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${categoryColors[tpl.category] ?? "bg-zinc-100 text-zinc-600"}`}>
                      {tpl.category}
                    </span>
                    <span className="text-[10px] text-zinc-400">{tpl.fields.length} fields</span>
                  </div>
                  <p className="text-sm font-semibold text-zinc-900 mb-1 leading-tight">{tpl.name}</p>
                  <p className="text-xs text-zinc-500 flex-1 leading-relaxed mb-3">{tpl.description}</p>
                  <Button
                    size="sm"
                    className="w-full h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      onLoad(expandTemplate(tpl));
                      onClose();
                    }}
                  >
                    Use this template
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main builder ──────────────────────────────────────────────────────────────
export default function FormBuilderPage() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const importRef = useRef<HTMLInputElement>(null);

  const [matchEdit, paramsEdit] = useRoute("/forms/builder/:id");
  const editId = matchEdit ? parseInt(paramsEdit?.id ?? "") : null;
  const isEdit = !!editId && !isNaN(editId);

  const [name, setName] = useState("Untitled Form");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitLabel, setSubmitLabel] = useState("Submit");
  const [successMsg, setSuccessMsg] = useState("Thank you! Your response has been recorded.");
  const [createContact, setCreateContact] = useState(false);
  const [createDeal, setCreateDeal] = useState(false);
  const [dealStage, setDealStage] = useState("lead");
  const [tab, setTab] = useState<"build" | "settings" | "preview">("build");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [templateOpen, setTemplateOpen] = useState(false);

  const { data: existingForm } = useQuery<CustomForm>({
    queryKey: ["custom-form-edit", editId],
    queryFn: async () => {
      const r = await fetch(`/api/custom-forms/${editId}`, { headers: authH(token) });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: isEdit && !!token,
  });

  useEffect(() => {
    if (existingForm) {
      setName(existingForm.name);
      setDescription(existingForm.description ?? "");
      setSlug(existingForm.slug);
      setSlugManual(true);
      setFields(existingForm.fields);
      setSubmitLabel(existingForm.submitButtonLabel);
      setSuccessMsg(existingForm.successMessage);
      setCreateContact(existingForm.createContact);
      setCreateDeal(existingForm.createDeal);
      setDealStage(existingForm.dealStage ?? "lead");
      setStatus(existingForm.status === "published" ? "published" : "draft");
    }
  }, [existingForm]);

  useEffect(() => {
    if (!slugManual && name) setSlug(slugify(name));
  }, [name, slugManual]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, description, slug, fields, submitButtonLabel: submitLabel, successMessage: successMsg, createContact, createDeal, dealStage: createDeal ? dealStage : undefined };
      const url = isEdit ? `/api/custom-forms/${editId}` : "/api/custom-forms";
      const r = await fetch(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...authH(token) }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json() as { error?: string }; throw new Error(e.error ?? "Save failed"); }
      return r.json() as Promise<CustomForm>;
    },
    onSuccess: (form) => {
      toast({ title: "Form saved" });
      qc.invalidateQueries({ queryKey: ["custom-forms"] });
      if (!isEdit) navigate(`/forms/builder/${form.id}`);
      setStatus(form.status === "published" ? "published" : "draft");
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const publish = useMutation({
    mutationFn: async () => {
      const body = { name, description, slug, fields, submitButtonLabel: submitLabel, successMessage: successMsg, createContact, createDeal, dealStage: createDeal ? dealStage : undefined };
      const url = isEdit ? `/api/custom-forms/${editId}` : "/api/custom-forms";
      const r = await fetch(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json", ...authH(token) }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json() as { error?: string }; throw new Error(e.error ?? "Save failed"); }
      const form = await r.json() as CustomForm;
      const pr = await fetch(`/api/custom-forms/${form.id}/publish`, { method: "POST", headers: authH(token) });
      if (!pr.ok) throw new Error("Publish failed");
      return pr.json() as Promise<CustomForm>;
    },
    onSuccess: (form) => {
      toast({ title: form.status === "published" ? "Form published!" : "Form unpublished" });
      qc.invalidateQueries({ queryKey: ["custom-forms"] });
      setStatus(form.status === "published" ? "published" : "draft");
      if (!isEdit && form.id) navigate(`/forms/builder/${form.id}`);
    },
    onError: (err: Error) => toast({ title: err.message, variant: "destructive" }),
  });

  const addField = (type: FieldType) => {
    const f = makeField(type);
    setFields((prev) => [...prev, f]);
    setSelectedId(f.id);
  };

  const updateField = (updated: FormField) => setFields((prev) => prev.map((f) => f.id === updated.id ? updated : f));
  const deleteField = (id: string) => { setFields((prev) => prev.filter((f) => f.id !== id)); setSelectedId(null); };
  const moveField = (id: string, dir: -1 | 1) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap]!, next[idx]!];
      return next;
    });
  };

  // ── Import/Export ──────────────────────────────────────────────────────────
  function exportForm() {
    const data = { name, description, slug, fields, submitButtonLabel: submitLabel, successMessage: successMsg };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "form"}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Form exported as JSON" });
  }

  function importForm(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string) as Record<string, unknown>;
        if (!data["fields"] || !Array.isArray(data["fields"])) throw new Error("Invalid format");
        if (typeof data["name"] === "string") setName(data["name"]);
        if (typeof data["description"] === "string") setDescription(data["description"]);
        const imported = (data["fields"] as FormField[]).map((f) => ({ ...f, id: crypto.randomUUID() }));
        setFields(imported);
        setSelectedId(null);
        if (typeof data["submitButtonLabel"] === "string") setSubmitLabel(data["submitButtonLabel"]);
        if (typeof data["successMessage"] === "string") setSuccessMsg(data["successMessage"]);
        toast({ title: "Form imported successfully", description: `${imported.length} fields loaded` });
      } catch {
        toast({ title: "Import failed", description: "The file doesn't appear to be a valid form JSON", variant: "destructive" });
      }
      if (importRef.current) importRef.current.value = "";
    };
    reader.readAsText(file);
  }

  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const publicUrl = `${window.location.origin}/f/${slug}`;
  const hasContractFields = fields.some((f) => ["signature", "contract_text", "legal_agreement"].includes(f.type));

  return (
    <div className="flex flex-col h-full">
      {/* Hidden import input */}
      <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importForm} />

      {/* Top bar */}
      <div className="border-b border-zinc-200 bg-white px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm">
        <Button variant="ghost" size="sm" className="h-8 px-2 gap-1.5 text-zinc-500" onClick={() => navigate("/forms")}>
          <ArrowLeft className="h-4 w-4" /> Forms
        </Button>
        <div className="h-5 border-l border-zinc-200" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 border-none shadow-none text-sm font-semibold w-48 px-1 focus-visible:ring-0"
          placeholder="Form name"
        />
        {hasContractFields && (
          <Badge variant="outline" className="text-xs gap-1 border-purple-300 text-purple-700 bg-purple-50 shrink-0">
            <FileSignature className="h-3 w-3" />Contract
          </Badge>
        )}
        <div className="flex-1" />

        {/* Template / Import / Export */}
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => setTemplateOpen(true)}>
            <Layers className="h-3.5 w-3.5" />Templates
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => importRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />Import
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={exportForm}>
            <Download className="h-3.5 w-3.5" />Export
          </Button>
        </div>

        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
          {(["build", "settings", "preview"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${tab === t ? "bg-white shadow-sm text-zinc-900" : "text-zinc-500 hover:text-zinc-700"}`}
            >
              {t === "preview" ? <><Eye className="h-3 w-3 inline mr-1" />Preview</> : t}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-2">
          <Badge variant="outline" className={`text-xs gap-1 ${status === "published" ? "border-green-300 text-green-700 bg-green-50" : "text-zinc-500"}`}>
            {status === "published" ? <><Globe className="h-3 w-3" />Live</> : <><Lock className="h-3 w-3" />Draft</>}
          </Badge>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-3.5 w-3.5" />{save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" className={`h-8 gap-1.5 ${status === "published" ? "bg-amber-500 hover:bg-amber-600" : "bg-green-600 hover:bg-green-700"}`}
            onClick={() => publish.mutate()} disabled={publish.isPending}>
            {status === "published" ? <><Lock className="h-3.5 w-3.5" />Unpublish</> : <><Globe className="h-3.5 w-3.5" />Publish</>}
          </Button>
        </div>
      </div>

      {/* Build tab */}
      {tab === "build" && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left — field palette */}
          <div className="w-52 shrink-0 border-r bg-zinc-50 overflow-y-auto">
            <div className="p-3">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest mb-2 px-1">Add fields</p>
              {FIELD_GROUPS.map((group) => (
                <div key={group} className="mb-3">
                  <p className={`text-[10px] font-medium mb-1.5 px-1 ${group === "Contract & Sign" ? "text-purple-500" : "text-zinc-400"}`}>{group}</p>
                  <div className="space-y-0.5">
                    {FIELD_TYPES.filter((f) => f.group === group).map((ft) => (
                      <button
                        key={ft.type}
                        onClick={() => addField(ft.type)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-600 hover:bg-white hover:text-zinc-900 hover:shadow-sm transition-all text-left border border-transparent hover:border-zinc-200 ${ft.group === "Contract & Sign" ? "hover:text-purple-700 hover:border-purple-200" : ""}`}
                      >
                        <span className={`${ft.group === "Contract & Sign" ? "text-purple-400" : "text-zinc-400"}`}>{ft.icon}</span>
                        <span className="text-xs">{ft.label}</span>
                        <Plus className="h-2.5 w-2.5 ml-auto text-zinc-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Center — form canvas */}
          <div className="flex-1 overflow-y-auto bg-zinc-100 p-6">
            <div className="max-w-lg mx-auto bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
              <div className="px-6 pt-6 pb-4 border-b border-zinc-100">
                <p className="font-semibold text-zinc-800">{name || "Untitled Form"}</p>
                {description && <p className="text-xs text-zinc-400 mt-1">{description}</p>}
              </div>

              <div className="p-6 space-y-4">
                {fields.length === 0 && (
                  <div className="text-center py-10 text-zinc-300 border-2 border-dashed border-zinc-200 rounded-lg">
                    <Layers className="h-8 w-8 mx-auto mb-2 text-zinc-200" />
                    <p className="text-sm">Add fields from the left, or</p>
                    <button onClick={() => setTemplateOpen(true)} className="text-sm text-blue-500 hover:underline mt-1">browse 100+ templates</button>
                  </div>
                )}

                {fields.map((field, i) => (
                  <div
                    key={field.id}
                    onClick={() => setSelectedId(field.id === selectedId ? null : field.id)}
                    className={`relative group rounded-lg border-2 px-3 py-3 cursor-pointer transition-all ${
                      selectedId === field.id
                        ? "border-blue-400 bg-blue-50/40"
                        : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    {/* Reorder controls */}
                    <div className="absolute -left-8 top-1/2 -translate-y-1/2 hidden group-hover:flex flex-col gap-0.5">
                      <button onClick={(e) => { e.stopPropagation(); moveField(field.id, -1); }} disabled={i === 0}
                        className="h-5 w-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-20">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); moveField(field.id, 1); }} disabled={i === fields.length - 1}
                        className="h-5 w-5 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-700 disabled:opacity-20">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="absolute right-2 top-2 flex items-center gap-1">
                      {field.crmField && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 font-medium border border-violet-200">
                          <UserCheck className="h-2.5 w-2.5" />{CRM_FIELD_OPTIONS.find((o) => o.value === field.crmField)?.label}
                        </span>
                      )}
                      {["signature", "contract_text", "legal_agreement"].includes(field.type) && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 font-medium border border-purple-200">
                          <FileSignature className="h-2.5 w-2.5" />{field.type.replace("_", " ")}
                        </span>
                      )}
                      <GripVertical className="h-3.5 w-3.5 text-zinc-300 hidden group-hover:block" />
                    </div>

                    <FieldPreview field={field} />
                  </div>
                ))}

                {fields.length > 0 && (
                  <div className="pt-2">
                    <div className="h-9 rounded-md bg-zinc-800 flex items-center justify-center">
                      <span className="text-xs text-white font-medium">{submitLabel}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right — field config */}
          <div className="w-64 shrink-0 border-l bg-white overflow-y-auto">
            {selected ? (
              <FieldConfig field={selected} onChange={updateField} onDelete={() => deleteField(selected.id)} />
            ) : (
              <div className="p-4 text-center text-zinc-400 text-xs mt-8 space-y-3">
                <p>Click a field in the canvas to configure it</p>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 w-full" onClick={() => setTemplateOpen(true)}>
                  <Layers className="h-3 w-3" />Browse templates
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings tab */}
      {tab === "settings" && (
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-xl mx-auto space-y-6">
            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-6 space-y-4">
              <h3 className="font-semibold text-sm">Form details</h3>
              <div className="space-y-1.5">
                <Label className="text-xs">Form name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description (optional)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown below the form title" rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">URL slug</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 shrink-0">/f/</span>
                  <Input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugManual(true); }} placeholder="my-form" className="font-mono text-sm" />
                </div>
                {slug && (
                  <p className="text-[10px] text-zinc-400 flex items-center gap-1.5">
                    Public URL: {publicUrl}
                    <button onClick={() => { navigator.clipboard.writeText(publicUrl); toast({ title: "URL copied" }); }}>
                      <Copy className="h-3 w-3 hover:text-zinc-700" />
                    </button>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Submit button label</Label>
                <Input value={submitLabel} onChange={(e) => setSubmitLabel(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Success message</Label>
                <Textarea value={successMsg} onChange={(e) => setSuccessMsg(e.target.value)} rows={2} />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-6 space-y-4">
              <h3 className="font-semibold text-sm">CRM automation</h3>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Create contact on submit</Label>
                  <p className="text-xs text-zinc-400">Automatically create a Contact from the submission</p>
                </div>
                <Switch checked={createContact} onCheckedChange={setCreateContact} />
              </div>
              {createContact && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Create deal on submit</Label>
                    <p className="text-xs text-zinc-400">Also create a Deal linked to the contact</p>
                  </div>
                  <Switch checked={createDeal} onCheckedChange={setCreateDeal} />
                </div>
              )}
              {createContact && createDeal && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Initial deal stage</Label>
                  <Select value={dealStage} onValueChange={setDealStage}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["lead", "qualified", "proposal", "won", "lost"].map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm p-6 space-y-3">
              <h3 className="font-semibold text-sm">Import / Export</h3>
              <p className="text-xs text-zinc-500">Export your form as JSON to back it up or share it. Import a JSON to load a form.</p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 gap-1.5" onClick={exportForm}>
                  <Download className="h-3.5 w-3.5" />Export JSON
                </Button>
                <Button variant="outline" className="flex-1 gap-1.5" onClick={() => importRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />Import JSON
                </Button>
              </div>
            </div>

            <Button onClick={() => save.mutate()} disabled={save.isPending} className="w-full">
              {save.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      )}

      {/* Preview tab */}
      {tab === "preview" && (
        <div className="flex-1 overflow-y-auto bg-zinc-100 p-8">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-500">This is how your form will look to visitors</p>
              {status === "published" && (
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                    <ExternalLink className="h-3 w-3" /> Open live form
                  </Button>
                </a>
              )}
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 overflow-hidden">
              <div className="px-8 pt-8 pb-6 border-b border-zinc-100">
                <h1 className="text-2xl font-bold text-zinc-900">{name || "Untitled Form"}</h1>
                {description && <p className="text-zinc-500 mt-2 text-sm">{description}</p>}
              </div>
              <div className="px-8 py-6 space-y-5">
                {fields.map((field) => {
                  if (field.type === "divider") return <hr key={field.id} className="border-zinc-200" />;
                  if (field.type === "heading") return <h3 key={field.id} className="text-base font-semibold text-zinc-800">{field.content || field.label}</h3>;
                  if (field.type === "spacer") return <div key={field.id} className="h-4" />;
                  if (field.type === "statement") return <p key={field.id} className="text-sm text-zinc-600">{field.content || field.label}</p>;
                  if (field.type === "instructions") return (
                    <div key={field.id} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-xs text-blue-700">{field.content || field.label}</p>
                    </div>
                  );
                  if (field.type === "contract_text") return (
                    <div key={field.id} className="max-h-48 overflow-y-auto bg-zinc-50 border border-zinc-200 rounded-lg p-4">
                      <p className="text-xs text-zinc-600 whitespace-pre-wrap leading-relaxed">{field.content}</p>
                    </div>
                  );
                  return (
                    <div key={field.id} className="space-y-1.5">
                      <Label className="text-sm font-medium text-zinc-700">
                        {field.label}{field.required && <span className="text-red-500 ml-1">*</span>}
                      </Label>
                      <FieldPreview field={field} />
                    </div>
                  );
                })}
                {fields.length > 0 && <Button className="w-full mt-2">{submitLabel}</Button>}
                {fields.length === 0 && <p className="text-center text-zinc-400 text-sm py-8">Add fields in the Build tab to preview them here</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Library Dialog */}
      <TemplateLibrary
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onLoad={(tplFields) => {
          if (fields.length > 0) {
            if (!confirm("This will replace your current fields with the template. Continue?")) return;
          }
          setFields(tplFields);
          setSelectedId(null);
          toast({ title: "Template loaded", description: `${tplFields.length} fields added` });
        }}
      />
    </div>
  );
}
