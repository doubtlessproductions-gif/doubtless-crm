import { useState, useEffect, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  useAdminListUsers, useAdminUpdateUserRole, useAdminUpdateUserTabs,
  useCreateInvite, useGetMe,
  getAdminListUsersQueryKey, getGetMeQueryKey,
  type AdminUser, type InviteResponse, type UpdateRoleBodyRole,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert, UserPlus, SlidersHorizontal, Copy, Check, Loader2,
  Mail, HardDrive, Cloud, Shield, Users, Lock, Crown, Globe,
  UserCheck, UserX, Trash2, ToggleLeft, ToggleRight, Building2, Target, Bell,
  Clock, X, MailCheck, Moon, Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Page catalogue ─────────────────────────────────────────────────────────────
const ALL_PAGES = [
  // ── Core ──────────────────────────────────────────────────────────────────
  { key: "dashboard",        label: "Dashboard",       group: "Core" },
  { key: "pipeline",         label: "Pipeline",        group: "Core" },
  { key: "contacts",         label: "Contacts",        group: "Core" },
  { key: "messages",         label: "Messages",        group: "Core" },
  { key: "analytics",        label: "Analytics",       group: "Core" },
  // ── Artists ───────────────────────────────────────────────────────────────
  { key: "artists",          label: "Artists",         group: "Artists" },
  { key: "outreach",         label: "Outreach",        group: "Artists" },
  // ── Communication ─────────────────────────────────────────────────────────
  { key: "calendar",         label: "Calendar",        group: "Communication" },
  { key: "outlook",          label: "Outlook Email",   group: "Communication" },
  // ── Music & Releases ──────────────────────────────────────────────────────
  { key: "releases",         label: "Releases",        group: "Music" },
  { key: "content-calendar", label: "Content",         group: "Music" },
  { key: "templates",        label: "Marketing",       group: "Music" },
  { key: "video-engine",     label: "Video Engine",    group: "Music" },
  { key: "studio-projects",  label: "Studio Projects", group: "Music" },
  { key: "release-assets",   label: "Assets",          group: "Music" },
  // ── Finance ───────────────────────────────────────────────────────────────
  { key: "payments",         label: "Payments",        group: "Finance" },
  { key: "invoices",         label: "Invoices",        group: "Finance" },
  { key: "royalties",        label: "Royalties",       group: "Finance" },
  { key: "subscriptions",    label: "Retainers",       group: "Finance" },
  { key: "time",             label: "Time Tracking",   group: "Finance" },
  // ── Content & Tools ───────────────────────────────────────────────────────
  { key: "forms",            label: "Forms",           group: "Content" },
  { key: "pages",            label: "Pages",           group: "Content" },
  { key: "onedrive",         label: "OneDrive",        group: "Content" },
  // ── Operations ────────────────────────────────────────────────────────────
  { key: "automations",      label: "Automations",     group: "Operations" },
  { key: "settings",         label: "Settings",        group: "Operations" },
  // ── Security ──────────────────────────────────────────────────────────────
  { key: "audit-logs",       label: "Audit Log",       group: "Security" },
] as const;

type PageKey = (typeof ALL_PAGES)[number]["key"];

// Non-owner roles that appear as permission matrix columns (owner always has full access)
const PERMISSION_ROLES: UpdateRoleBodyRole[] = ["admin", "manager", "artist", "engineer", "ar", "intern"];

// Pages that are permanently locked to owner-only — not configurable in the matrix
const OWNER_ONLY_PAGES = new Set(["audit-logs"]);

const ROLE_META: Record<string, { label: string; className: string }> = {
  owner:    { label: "Owner",    className: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200" },
  admin:    { label: "Admin",    className: "bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200" },
  manager:  { label: "Manager",  className: "bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200" },
  artist:   { label: "Artist",   className: "bg-rose-100 text-rose-700 hover:bg-rose-100 border-rose-200" },
  engineer: { label: "Engineer", className: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200" },
  ar:       { label: "A&R",      className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200" },
  intern:   { label: "Intern",   className: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100 border-zinc-200" },
};

function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role] ?? { label: role, className: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100 border-zinc-200" };
  return (
    <Badge className={cn(meta.className, "gap-1")}>
      {role === "owner" && <Crown className="h-3 w-3" />}
      {meta.label}
    </Badge>
  );
}

// ── Invite Dialog ─────────────────────────────────────────────────────────────
function InviteDialog({ open, onClose, isOwner }: { open: boolean; onClose: () => void; isOwner: boolean }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UpdateRoleBodyRole>("intern");
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteUrl = result ? `${window.location.origin}${BASE}/invite/${result.inviteToken}` : "";

  const createInvite = useCreateInvite({
    mutation: {
      onSuccess: (data) => setResult(data),
      onError: (err) => toast({ title: err.message || "Failed to create invite", variant: "destructive" }),
    },
  });

  const handleClose = () => {
    setEmail(""); setRole("intern"); setResult(null); setCopied(false);
    createInvite.reset(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" />Invite Team Member</DialogTitle></DialogHeader>
        {!result ? (
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Email address</Label>
              <Input type="email" placeholder="colleague@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UpdateRoleBodyRole)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {isOwner && <SelectItem value="owner"><span className="flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-amber-500" />Owner</span></SelectItem>}
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="artist">Artist</SelectItem>
                  <SelectItem value="engineer">Engineer</SelectItem>
                  <SelectItem value="ar">A&amp;R</SelectItem>
                  <SelectItem value="intern">Intern</SelectItem>
                </SelectContent>
              </Select>
              {role === "owner" && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Owners have unrestricted access to everything including this admin panel.
                </p>
              )}
            </div>
            <p className="text-xs text-zinc-400">Invite link expires in 7 days.</p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-sm font-medium text-emerald-800">
                {result.emailSent ? `Invite email sent to ${result.email}` : `Invite created for ${result.email}`}
              </p>
              <p className="text-xs text-emerald-600 mt-1">Role: {ROLE_META[result.role]?.label ?? result.role}</p>
            </div>
            {!result.emailSent && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
                No email configured — share this link manually.
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-zinc-500">
                {result.emailSent ? "Invite link (also sent by email)" : "Invite link (expires in 7 days)"}
              </Label>
              <div className="flex gap-2">
                <Input value={inviteUrl} readOnly className="h-9 text-xs bg-zinc-50 font-mono" />
                <Button size="sm" variant="outline" className="h-9 w-9 p-0"
                  onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          {!result ? (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={() => createInvite.mutate({ data: { email, role } })}
                disabled={!email || createInvite.isPending}>
                {createInvite.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Sending…</> : "Send Invite"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleClose} className="w-full">Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Per-user Tab Permissions Dialog ───────────────────────────────────────────
const USER_TABS = ALL_PAGES.map(p => ({ key: p.key as string, label: p.label }));

function TabPermissionsDialog({ open, user, onClose, viewerIsOwner }: {
  open: boolean; user: AdminUser | null; onClose: () => void; viewerIsOwner: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const initSelected = (): Set<string> => {
    if (!user?.allowedTabs) return new Set(USER_TABS.map((t) => t.key));
    return new Set(user.allowedTabs!);
  };

  const [selected, setSelected] = useState<Set<string>>(initSelected);
  useEffect(() => { if (open) setSelected(initSelected()); }, [user?.id, open]);

  const updateTabs = useAdminUpdateUserTabs({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getAdminListUsersQueryKey() }); toast({ title: "Tab permissions saved" }); onClose(); },
      onError: (err) => toast({ title: err.message || "Failed to save", variant: "destructive" }),
    },
  });

  const toggle = (key: string) => setSelected(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const handleSave = () => {
    if (!user) return;
    const isAll = USER_TABS.every((t) => selected.has(t.key));
    updateTabs.mutate({ id: user.id, data: { allowedTabs: isAll ? null : Array.from(selected) } });
  };

  if (!user) return null;

  const isTargetOwner = user.role === "owner";
  const isTargetAdmin = user.role === "admin";
  // Admins can restrict other admins only if viewer is owner
  const canEdit = !isTargetOwner && (isTargetAdmin ? viewerIsOwner : true);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setSelected(initSelected()); else onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Tab Permissions — {user.name}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          {isTargetOwner
            ? <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700 flex items-center gap-2">
                <Crown className="h-4 w-4 shrink-0" />Owners always have full unrestricted access.
              </div>
            : isTargetAdmin && !viewerIsOwner
            ? <div className="rounded-xl bg-violet-50 border border-violet-200 p-3 text-sm text-violet-700">
                Only the owner can restrict admin tab access.
              </div>
            : isTargetAdmin && viewerIsOwner
            ? <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700 flex items-center gap-2">
                <Shield className="h-4 w-4 shrink-0" />As owner you can restrict which pages this admin sees.
              </div>
            : <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3 text-xs text-zinc-500">
                Toggle which sections this user can see. Unchecked tabs are hidden from their sidebar.
              </div>
          }
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setSelected(new Set(USER_TABS.map((t) => t.key)))}>All</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setSelected(new Set())}>None</Button>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {USER_TABS.map(({ key, label }) => (
              <label key={key} className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors",
                !canEdit ? "bg-zinc-50 border-zinc-100 text-zinc-400 cursor-not-allowed"
                  : selected.has(key) ? "bg-blue-50 border-blue-200 text-blue-800"
                  : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50",
              )}>
                <input type="checkbox" className="accent-blue-600"
                  checked={!canEdit || selected.has(key)}
                  disabled={!canEdit}
                  onChange={() => { if (canEdit) toggle(key); }} />
                {label}
              </label>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={updateTabs.isPending || !canEdit}>
            {updateTabs.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Role Permissions Matrix — owner only ──────────────────────────────────────
function RolePermissionsTab({ isOwner }: { isOwner: boolean }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: saved, isLoading } = useQuery<Record<string, string[]>>({
    queryKey: ["rolePermissions"],
    queryFn: () => fetch("/api/admin/role-permissions", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => d.permissions ?? {}),
    enabled: !!token,
    staleTime: 30000,
  });

  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (saved === undefined) return;
    const d: Record<string, Set<string>> = {};
    for (const page of ALL_PAGES) {
      d[page.key] = new Set(saved[page.key] ?? PERMISSION_ROLES);
    }
    setDraft(d);
    setDirty(false);
  }, [saved]);

  function toggle(pageKey: string, role: string) {
    setDraft(prev => {
      const current = new Set(prev[pageKey] ?? PERMISSION_ROLES);
      current.has(role) ? current.delete(role) : current.add(role);
      return { ...prev, [pageKey]: current };
    });
    setDirty(true);
  }

  function setAllForRole(role: string, value: boolean) {
    setDraft(prev => {
      const next = { ...prev };
      for (const page of ALL_PAGES) {
        const current = new Set(next[page.key] ?? PERMISSION_ROLES);
        value ? current.add(role) : current.delete(role);
        next[page.key] = current;
      }
      return next;
    });
    setDirty(true);
  }

  function setAllForPage(pageKey: string, value: boolean) {
    setDraft(prev => ({ ...prev, [pageKey]: value ? new Set(PERMISSION_ROLES) : new Set<string>() }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const permissions: Record<string, string[]> = {};
      for (const page of ALL_PAGES) {
        const allowed = Array.from(draft[page.key] ?? PERMISSION_ROLES);
        if (allowed.length < PERMISSION_ROLES.length) {
          permissions[page.key] = allowed;
        }
      }
      const res = await fetch("/api/admin/role-permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ permissions }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Role permissions saved" });
      qc.invalidateQueries({ queryKey: ["rolePermissions"] });
      setDirty(false);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const groups = [...new Set(ALL_PAGES.map(p => p.group))];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Role-Based Page Access</h2>
          <p className="text-sm text-muted-foreground">
            Control which roles can see each page. The <span className="font-medium text-amber-600">Owner</span> always has
            unrestricted access. You can restrict <span className="font-medium text-purple-600">Admins</span> too — any page
            where Admin is turned off will be hidden from admins as well.
          </p>
        </div>
        {isOwner && (
          <Button onClick={handleSave} disabled={saving || !dirty} className="shrink-0">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
          </Button>
        )}
      </div>

      {!isOwner && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          <Crown className="h-4 w-4 shrink-0" />
          Only the owner can modify role permissions. You can view the current configuration below.
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-zinc-50">
              <TableHead className="w-48 font-semibold">Page</TableHead>
              {/* Owner column — always locked */}
              <TableHead className="text-center w-20">
                <div className="flex flex-col items-center gap-1">
                  <Badge className={ROLE_META.owner.className}><Crown className="h-3 w-3 mr-1" />Owner</Badge>
                  <span className="text-[10px] text-muted-foreground">always</span>
                </div>
              </TableHead>
              {PERMISSION_ROLES.map(role => (
                <TableHead key={role} className="text-center w-24">
                  <div className="flex flex-col items-center gap-1">
                    <Badge className={ROLE_META[role]?.className ?? ""}>{ROLE_META[role]?.label ?? role}</Badge>
                    {isOwner && (
                      <div className="flex gap-1">
                        <button title="Allow all" onClick={() => setAllForRole(role, true)}
                          className="text-[10px] text-blue-500 hover:underline">all</button>
                        <span className="text-[10px] text-muted-foreground">/</span>
                        <button title="Deny all" onClick={() => setAllForRole(role, false)}
                          className="text-[10px] text-red-400 hover:underline">none</button>
                      </div>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(group => (
              <Fragment key={`group-${group}`}>
                <TableRow className="bg-zinc-50/80">
                  <TableCell colSpan={2 + PERMISSION_ROLES.length} className="py-1.5 px-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group}</span>
                  </TableCell>
                </TableRow>
                {ALL_PAGES.filter(p => p.group === group).map(page => {
                  const ownerOnly = OWNER_ONLY_PAGES.has(page.key);
                  const pageDraft = draft[page.key] ?? new Set(PERMISSION_ROLES);
                  const allAllowed = PERMISSION_ROLES.every(r => pageDraft.has(r));
                  const noneAllowed = PERMISSION_ROLES.every(r => !pageDraft.has(r));
                  return (
                    <TableRow key={page.key} className={cn("hover:bg-zinc-50/50", ownerOnly && "bg-amber-50/40")}>
                      <TableCell>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm">{page.label}</span>
                            {ownerOnly && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-600 font-medium">
                                <Crown className="h-2.5 w-2.5" />Owner only
                              </span>
                            )}
                          </div>
                          {isOwner && !ownerOnly && (
                            <button
                              title={allAllowed ? "Restrict all roles" : "Allow all roles"}
                              onClick={() => setAllForPage(page.key, !allAllowed)}
                              className={cn("text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                                allAllowed ? "border-green-200 text-green-600 bg-green-50 hover:bg-red-50 hover:text-red-500 hover:border-red-200"
                                  : noneAllowed ? "border-red-200 text-red-500 bg-red-50 hover:bg-green-50 hover:text-green-600 hover:border-green-200"
                                  : "border-zinc-200 text-zinc-500 bg-white hover:bg-zinc-50")}
                            >
                              {allAllowed ? "open" : noneAllowed ? "locked" : "mixed"}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      {/* Owner — always on */}
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <Switch checked disabled className="data-[state=checked]:bg-amber-400" />
                        </div>
                      </TableCell>
                      {PERMISSION_ROLES.map(role => (
                        <TableCell key={role} className="text-center">
                          <div className="flex justify-center">
                            {ownerOnly ? (
                              <Switch checked={false} disabled className="opacity-30" />
                            ) : (
                              <Switch
                                checked={pageDraft.has(role)}
                                onCheckedChange={() => isOwner && toggle(page.key, role)}
                                disabled={!isOwner}
                                className={pageDraft.has(role) ? (role === "admin" ? "data-[state=checked]:bg-purple-500" : "data-[state=checked]:bg-blue-500") : ""}
                              />
                            )}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {isOwner && dirty && (
        <div className="flex items-center justify-end gap-3 py-2">
          <p className="text-sm text-amber-600 font-medium">You have unsaved changes</p>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Role Quotas Tab ────────────────────────────────────────────────────────────
const QUOTA_ROLES = ["owner", "admin", "manager", "artist", "engineer", "ar", "intern"] as const;
interface QuotaMetric { key: string; label: string; hint: string; group: string; prefix?: string }
const QUOTA_METRICS: QuotaMetric[] = [
  { key: "deals_closed",     label: "Deals Closed",    hint: "Won deals per month",                group: "Sales" },
  { key: "revenue_closed",   label: "Revenue ($)",     hint: "Closed revenue in USD per month",    group: "Sales",         prefix: "$" },
  { key: "hours_logged",     label: "Hours Logged",    hint: "Hours logged per month",             group: "Time" },
  { key: "artists_signed",   label: "Artists Signed",  hint: "New signed artists per month",       group: "A&R / BizDev" },
  { key: "projects_booked",  label: "Projects Booked", hint: "Studio projects created per month",  group: "A&R / BizDev" },
  { key: "templates_sent",   label: "Templates Sent",  hint: "Marketing emails/proposals sent",    group: "Marketing" },
  { key: "form_submissions", label: "Form Responses",  hint: "Public form submissions received",   group: "Marketing" },
];

interface QuotaRow { id: number; role: string; metricKey: string; targetValue: string; updatedAt: string; }

const ROLE_META_ADMIN: Record<string, { label: string; className: string }> = {
  owner:    { label: "Owner",    className: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200" },
  admin:    { label: "Admin",    className: "bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200" },
  manager:  { label: "Manager",  className: "bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200" },
  artist:   { label: "Artist",   className: "bg-rose-100 text-rose-700 hover:bg-rose-100 border-rose-200" },
  engineer: { label: "Engineer", className: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200" },
  ar:       { label: "A&R",      className: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200" },
  intern:   { label: "Intern",   className: "bg-zinc-100 text-zinc-600 hover:bg-zinc-100 border-zinc-200" },
};

function QuotasTab({ isAdmin }: { isAdmin: boolean }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data: quotas, isLoading, refetch } = useQuery<QuotaRow[]>({
    queryKey: ["role-quotas"],
    queryFn: async () => {
      const r = await fetch("/api/admin/role-quotas", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token,
  });

  useEffect(() => {
    if (!quotas) return;
    const d: Record<string, Record<string, string>> = {};
    for (const role of QUOTA_ROLES) {
      d[role] = {};
      for (const m of QUOTA_METRICS) {
        const found = quotas.find((q) => q.role === role && q.metricKey === m.key);
        d[role][m.key] = found ? found.targetValue : "0";
      }
    }
    setDraft(d);
    setDirty(false);
  }, [quotas]);

  function setValue(role: string, metricKey: string, val: string) {
    setDraft((prev) => ({ ...prev, [role]: { ...(prev[role] ?? {}), [metricKey]: val } }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const quotasToSave = [];
      for (const role of QUOTA_ROLES) {
        for (const m of QUOTA_METRICS) {
          quotasToSave.push({ role, metricKey: m.key, targetValue: Number(draft[role]?.[m.key] ?? 0) });
        }
      }
      const res = await fetch("/api/admin/role-quotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quotas: quotasToSave }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Role quotas saved" });
      refetch();
      setDirty(false);
    } catch {
      toast({ title: "Failed to save quotas", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Role Quotas</h2>
          <p className="text-sm text-muted-foreground">
            Set monthly performance targets per role. These appear as progress indicators on the Team Performance analytics dashboard.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleSave} disabled={saving || !dirty} className="shrink-0">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Quotas"}
          </Button>
        )}
      </div>

      {/* Group headers legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { group: "Sales", color: "bg-blue-100 text-blue-700 border-blue-200" },
          { group: "A&R / BizDev", color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
          { group: "Time", color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
          { group: "Marketing", color: "bg-pink-100 text-pink-700 border-pink-200" },
        ].map((g) => (
          <span key={g.group} className={cn("px-2 py-0.5 rounded-full border font-medium", g.color)}>{g.group}</span>
        ))}
        <span className="text-zinc-400 italic self-center">— column colors indicate category</span>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b">
              <th className="text-left px-4 py-3 font-semibold text-zinc-700 w-28">Role</th>
              {QUOTA_METRICS.map((m) => {
                const colColor = m.group === "Sales"
                  ? "bg-blue-50 text-blue-800"
                  : m.group === "A&R / BizDev"
                  ? "bg-emerald-50 text-emerald-800"
                  : m.group === "Time"
                  ? "bg-cyan-50 text-cyan-800"
                  : "bg-pink-50 text-pink-800";
                return (
                  <th key={m.key} className={cn("text-center px-3 py-3 font-semibold", colColor)}>
                    <div className="text-xs font-semibold uppercase tracking-wide">{m.group}</div>
                    <div className="text-sm font-medium mt-0.5">{m.label}</div>
                    <div className="text-[10px] font-normal text-zinc-500 mt-0.5 normal-case">{m.hint}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {QUOTA_ROLES.map((role) => (
              <tr key={role} className="hover:bg-zinc-50/50 transition-colors">
                <td className="px-4 py-3">
                  <Badge className={cn(ROLE_META_ADMIN[role]?.className ?? "", "gap-1")}>
                    {role === "owner" && <Crown className="h-3 w-3" />}
                    {ROLE_META_ADMIN[role]?.label ?? role}
                  </Badge>
                </td>
                {QUOTA_METRICS.map((m) => (
                  <td key={m.key} className="px-3 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {m.prefix && <span className="text-zinc-400 text-xs">{m.prefix}</span>}
                      <input
                        type="number"
                        min="0"
                        step={m.prefix === "$" ? "100" : "1"}
                        value={draft[role]?.[m.key] ?? "0"}
                        onChange={(e) => isAdmin && setValue(role, m.key, e.target.value)}
                        disabled={!isAdmin}
                        className={cn(
                          "w-20 text-center rounded-lg border px-2 py-1.5 text-sm font-mono",
                          "border-zinc-200 bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all",
                          !isAdmin && "bg-zinc-50 text-zinc-400 cursor-not-allowed"
                        )}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          <Crown className="h-4 w-4 shrink-0" />
          Only admins can modify role quotas.
        </div>
      )}

      {isAdmin && dirty && (
        <div className="flex items-center justify-end gap-3 py-2">
          <p className="text-sm text-amber-600 font-medium">You have unsaved changes</p>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Quotas"}
          </Button>
        </div>
      )}

      {/* Per-user quota overrides */}
      <div className="border-t border-zinc-200 pt-6">
        <UserQuotasSection isAdmin={isAdmin} />
      </div>
    </div>
  );
}

// ── Per-User Quota Overrides ──────────────────────────────────────────────────

interface UserQuotaRow { id: number; userId: number; metricKey: string; targetValue: string }

function UserQuotasSection({ isAdmin }: { isAdmin: boolean }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: users } = useAdminListUsers({ query: { queryKey: getAdminListUsersQueryKey() } });
  const teamUsers = (users ?? []).filter((u: AdminUser) => (u as AdminUser & { userType?: string }).userType !== "portal");

  const { data: userQuotas, refetch } = useQuery<UserQuotaRow[]>({
    queryKey: ["user-quotas"],
    queryFn: async () => {
      const r = await fetch("/api/admin/user-quotas", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: !!token && isAdmin,
  });

  const overriddenUserIds = new Set((userQuotas ?? []).map((q) => q.userId));

  useEffect(() => {
    if (selectedUserId == null) { setDraft({}); return; }
    const d: Record<string, string> = {};
    for (const m of QUOTA_METRICS) {
      const found = (userQuotas ?? []).find((q) => q.userId === selectedUserId && q.metricKey === m.key);
      d[m.key] = found ? found.targetValue : "";
    }
    setDraft(d);
  }, [selectedUserId, userQuotas]);

  async function handleSave() {
    if (!selectedUserId) return;
    setSaving(true);
    try {
      const quotasToSave = QUOTA_METRICS
        .filter((m) => draft[m.key] && Number(draft[m.key]) > 0)
        .map((m) => ({ userId: selectedUserId, metricKey: m.key, targetValue: Number(draft[m.key]) }));
      const res = await fetch("/api/admin/user-quotas", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ quotas: quotasToSave }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Member quota overrides saved" });
      refetch();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Per-Member Overrides</h3>
        <p className="text-sm text-muted-foreground">
          Override monthly targets for individual members. Takes priority over role defaults.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Select
          value={selectedUserId ? String(selectedUserId) : ""}
          onValueChange={(v) => setSelectedUserId(Number(v))}
        >
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Select a team member…" />
          </SelectTrigger>
          <SelectContent>
            {teamUsers.map((u: AdminUser) => (
              <SelectItem key={u.id} value={String(u.id)}>
                <span className="flex items-center gap-2">
                  {u.name}
                  {overriddenUserIds.has(u.id) && (
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 rounded-full font-medium">override</span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedUserId && isAdmin && (
          <Button onClick={handleSave} disabled={saving} size="sm">
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Overrides"}
          </Button>
        )}
      </div>

      {selectedUserId && (
        <div className="rounded-xl border border-zinc-200 bg-white shadow-sm p-4 space-y-3">
          <p className="text-xs text-zinc-400">Leave blank to use role default. Set 0 to disable the quota for this member.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {QUOTA_METRICS.map((m) => (
              <div key={m.key} className="space-y-1">
                <label className="text-xs font-medium text-zinc-600">{m.label}</label>
                <div className="relative">
                  {m.prefix && <span className="absolute left-2.5 top-2 text-zinc-400 text-xs">{m.prefix}</span>}
                  <input
                    type="number"
                    min="0"
                    step={m.prefix === "$" ? "100" : "1"}
                    placeholder="role default"
                    value={draft[m.key] ?? ""}
                    onChange={(e) => setDraft((prev) => ({ ...prev, [m.key]: e.target.value }))}
                    disabled={!isAdmin}
                    className={cn(
                      "w-full rounded-lg border px-2 py-1.5 text-sm font-mono text-center",
                      m.prefix ? "pl-5" : "",
                      "border-zinc-200 bg-white focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all",
                      !isAdmin && "bg-zinc-50 text-zinc-400 cursor-not-allowed",
                    )}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(userQuotas ?? []).length > 0 && (
        <div className="rounded-xl border bg-zinc-50 p-4">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Active Overrides</p>
          <div className="space-y-2">
            {teamUsers
              .filter((u: AdminUser) => overriddenUserIds.has(u.id))
              .map((u: AdminUser) => {
                const uOverrides = (userQuotas ?? []).filter((q) => q.userId === u.id);
                return (
                  <div key={u.id} className="flex items-center gap-2 text-sm flex-wrap">
                    <div className="h-6 w-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-zinc-800">{u.name}</span>
                    <span className="text-zinc-300">—</span>
                    <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                      {uOverrides.map((q) => {
                        const meta = QUOTA_METRICS.find((m) => m.key === q.metricKey);
                        return (
                          <span key={q.metricKey} className="text-xs bg-white border border-zinc-200 px-2 py-0.5 rounded-full text-zinc-600">
                            {meta?.label ?? q.metricKey}: {meta?.prefix ?? ""}{q.targetValue}
                          </span>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setSelectedUserId(u.id)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          <Crown className="h-4 w-4 shrink-0" />
          Only admins can set per-member quota overrides.
        </div>
      )}
    </div>
  );
}

// ── Portal Clients Tab — owner only ───────────────────────────────────────────
interface PortalUserRow {
  id: number;
  email: string;
  contactId: number;
  isActive: boolean;
  inviteAcceptedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  contactName: string | null;
  contactCompany: string | null;
  dealCount: number;
}

interface PortalContactOption {
  id: number;
  name: string;
  email: string | null;
  company: string | null;
}

function portalStatus(pu: PortalUserRow): "active" | "pending" | "deactivated" {
  if (!pu.isActive) return "deactivated";
  if (!pu.inviteAcceptedAt) return "pending";
  return "active";
}

const STATUS_META = {
  active:      { label: "Active",      className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  pending:     { label: "Pending",     className: "bg-amber-100 text-amber-700 border-amber-200" },
  deactivated: { label: "Deactivated", className: "bg-zinc-100 text-zinc-500 border-zinc-200" },
} as const;

// ── Invite Client Dialog ───────────────────────────────────────────────────────
function InviteClientDialog({ open, onClose, token, onInvited }: {
  open: boolean; onClose: () => void; token: string; onInvited: () => void;
}) {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<PortalContactOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PortalContactOption | null>(null);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/admin/portal-contacts", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { setContacts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, token]);

  const filtered = contacts.filter(c =>
    (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleInvite() {
    if (!selected) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/portal-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contactId: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to invite");
      setInviteUrl(data.inviteUrl);
      onInvited();
    } catch (err: unknown) {
      toast({ title: (err as Error).message || "Failed to send invite", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  function handleClose() {
    setSelected(null); setSearch(""); setInviteUrl(null); setCopied(false);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Globe className="h-4 w-4 text-teal-500" />Invite Client to Portal</DialogTitle></DialogHeader>
        {!inviteUrl ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-500">Select a contact to invite. They'll receive a link to set up their portal account.</p>
            <Input
              placeholder="Search contacts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9"
            />
            {loading ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-6 text-sm text-zinc-400">
                {contacts.length === 0 ? "All contacts are already invited to the portal." : "No contacts match your search."}
              </div>
            ) : (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-zinc-200 divide-y">
                {filtered.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50",
                      selected?.id === c.id && "bg-teal-50 hover:bg-teal-50"
                    )}
                  >
                    <div className="h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700 shrink-0">
                      {(c.name || c.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{c.name}</p>
                      <p className="text-xs text-zinc-400 truncate">{c.email}</p>
                    </div>
                    {selected?.id === c.id && <Check className="h-4 w-4 text-teal-600 ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-sm font-medium text-emerald-800">Invite generated for {selected?.name || selected?.email}</p>
              <p className="text-xs text-emerald-600 mt-1">Share this link so they can set up their account</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-500">Invite link</Label>
              <div className="flex gap-2">
                <Input value={inviteUrl} readOnly className="h-9 text-xs bg-zinc-50 font-mono" />
                <Button size="sm" variant="outline" className="h-9 w-9 p-0"
                  onClick={() => { navigator.clipboard.writeText(inviteUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          {!inviteUrl ? (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={handleInvite} disabled={!selected || sending}>
                {sending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Inviting…</> : "Send Invite"}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleClose} className="w-full">Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Portal Client Detail Drawer ───────────────────────────────────────────────
interface PortalClientDetail extends PortalUserRow {
  contactEmail: string | null;
  deals: Array<{
    id: number;
    title: string;
    stage: string;
    value: string | null;
    createdAt: string;
    closedAt: string | null;
  }>;
  recentActivity: Array<{
    messageId: number;
    content: string;
    fileUrl: string | null;
    fileName: string | null;
    createdAt: string;
    threadTitle: string;
    threadId: number;
  }>;
}

const DEAL_STAGE_LABELS: Record<string, string> = {
  lead: "New Inquiry", qualified: "In Discussion", proposal: "Proposal Sent",
  negotiation: "In Negotiation", won: "Complete", lost: "Closed",
};

function PortalClientDrawer({ client, token, open, onClose, onStatusChange, onReinvite, onReset, onRemove }: {
  client: PortalUserRow | null;
  token: string;
  open: boolean;
  onClose: () => void;
  onStatusChange: (id: number, isActive: boolean) => void;
  onReinvite: (pu: PortalUserRow) => void;
  onReset: (pu: PortalUserRow) => void;
  onRemove: (pu: PortalUserRow) => void;
}) {
  const [detail, setDetail] = useState<PortalClientDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !client) { setDetail(null); return; }
    setLoading(true);
    fetch(`/api/admin/portal-clients/${client.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setDetail(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, client?.id, token]);

  if (!client) return null;

  const status = portalStatus(client);
  const meta = STATUS_META[status];

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col">
        <SheetHeader className="pb-4 border-b shrink-0">
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-indigo-100 flex items-center justify-center text-lg font-bold text-indigo-700 shrink-0">
              {(client.contactName ?? client.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-base leading-none">{client.contactName ?? <span className="text-zinc-400 italic">No name</span>}</SheetTitle>
                <Badge className={cn(meta.className, "text-xs")}>{meta.label}</Badge>
              </div>
              <p className="text-sm text-zinc-500 mt-1">{client.email}</p>
              {client.contactCompany && <p className="text-xs text-zinc-400 mt-0.5">{client.contactCompany}</p>}
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-6 py-5 flex-1 overflow-y-auto">
          {/* Access Timeline */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Invite & Login History</h3>
            <div className="space-y-3">
              {[
                { label: "Invite sent",     value: client.createdAt,        icon: Mail,      active: true },
                { label: "Invite accepted", value: client.inviteAcceptedAt, icon: UserCheck, active: !!client.inviteAcceptedAt },
                { label: "Last login",      value: client.lastLoginAt,      icon: UserCheck, active: !!client.lastLoginAt },
              ].map(({ label, value, icon: Icon, active }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0", active ? "bg-zinc-100" : "bg-zinc-50")}>
                    <Icon className={cn("h-3.5 w-3.5", active ? "text-indigo-500" : "text-zinc-300")} />
                  </div>
                  <span className="text-sm text-zinc-600 flex-1">{label}</span>
                  <span className="text-xs text-zinc-400">
                    {value ? format(new Date(value), "MMM d, yyyy 'at' h:mm a") : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Linked Deals */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Linked Deals {!loading && detail && <span className="normal-case font-normal">({detail.deals.length})</span>}
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              </div>
            ) : !detail || detail.deals.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-400">
                No deals linked to this contact yet.
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-zinc-50">
                      <TableHead className="text-xs py-2 h-auto">Deal</TableHead>
                      <TableHead className="text-xs py-2 h-auto">Stage</TableHead>
                      <TableHead className="text-xs py-2 h-auto text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.deals.map(deal => (
                      <TableRow key={deal.id} className="hover:bg-zinc-50/50">
                        <TableCell className="text-sm py-2 font-medium">{deal.title}</TableCell>
                        <TableCell className="text-xs py-2 text-zinc-500">{DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}</TableCell>
                        <TableCell className="text-xs py-2 text-right text-zinc-600">
                          {deal.value ? `$${parseFloat(deal.value).toLocaleString()}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Recent Portal Activity */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
              Recent Portal Activity {!loading && detail && <span className="normal-case font-normal">({detail.recentActivity.length})</span>}
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              </div>
            ) : !detail || detail.recentActivity.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 py-5 text-center text-xs text-zinc-400">
                No portal messages sent yet.
              </div>
            ) : (
              <div className="space-y-2">
                {detail.recentActivity.map(item => (
                  <div key={item.messageId} className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-zinc-500 truncate">{item.threadTitle}</span>
                      <span className="text-xs text-zinc-400 shrink-0">{format(new Date(item.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                    {item.fileName ? (
                      <p className="text-xs text-indigo-600 truncate flex items-center gap-1">
                        <span className="inline-block h-3 w-3 shrink-0">📎</span>{item.fileName}
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-600 line-clamp-2">{item.content}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Actions</h3>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" className="justify-start gap-2 w-full"
                onClick={() => { onReinvite(client); onClose(); }}>
                <Copy className="h-4 w-4" />Copy invite link
              </Button>
              <Button variant="outline" size="sm"
                className={cn("justify-start gap-2 w-full", client.isActive ? "hover:border-amber-300 hover:text-amber-700" : "hover:border-emerald-300 hover:text-emerald-700")}
                onClick={() => { onStatusChange(client.id, !client.isActive); onClose(); }}>
                {client.isActive
                  ? <><ToggleLeft className="h-4 w-4" />Deactivate access</>
                  : <><ToggleRight className="h-4 w-4" />Reactivate access</>}
              </Button>
              {client.inviteAcceptedAt && (
                <Button variant="outline" size="sm" className="justify-start gap-2 w-full hover:border-amber-300 hover:text-amber-700"
                  onClick={() => { onReset(client); onClose(); }}>
                  <ToggleLeft className="h-4 w-4" />Reset portal access
                </Button>
              )}
              <Button variant="outline" size="sm" className="justify-start gap-2 w-full text-red-600 hover:border-red-300 hover:bg-red-50"
                onClick={() => { onRemove(client); onClose(); }}>
                <Trash2 className="h-4 w-4" />Remove portal access
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PortalClientsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedClient, setSelectedClient] = useState<PortalUserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PortalUserRow | null>(null);
  const [confirmReset, setConfirmReset] = useState<PortalUserRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [reinviteRow, setReinviteRow] = useState<{ id: number; email: string } | null>(null);
  const [reinviteUrl, setReinviteUrl] = useState<string | null>(null);
  const [reinviteCopied, setReinviteCopied] = useState(false);
  const [reinviting, setReinviting] = useState(false);
  const [search, setSearch] = useState("");

  const { data: portalUsers, isLoading } = useQuery<PortalUserRow[]>({
    queryKey: ["adminPortalUsers"],
    queryFn: () => fetch("/api/admin/portal-clients", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()),
    enabled: !!token,
  });

  const filtered = (portalUsers ?? []).filter(pu => {
    const q = search.toLowerCase();
    return (
      (pu.contactName ?? "").toLowerCase().includes(q) ||
      (pu.contactCompany ?? "").toLowerCase().includes(q) ||
      pu.email.toLowerCase().includes(q)
    );
  });

  const total = portalUsers?.length ?? 0;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeThisWeek = portalUsers?.filter(p => p.lastLoginAt && new Date(p.lastLoginAt).getTime() >= sevenDaysAgo).length ?? 0;
  const pendingCount = portalUsers?.filter(p => portalStatus(p) === "pending").length ?? 0;
  const deactivatedCount = portalUsers?.filter(p => portalStatus(p) === "deactivated").length ?? 0;

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`/api/admin/portal-users/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive }),
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["adminPortalUsers"] }); toast({ title: "Portal access updated" }); },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/admin/portal-users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["adminPortalUsers"] }); toast({ title: "Portal access removed" }); setConfirmDelete(null); },
    onError: () => toast({ title: "Failed to remove access", variant: "destructive" }),
  });

  async function handleReinvite(pu: PortalUserRow) {
    setReinviteRow({ id: pu.id, email: pu.email });
    setReinviting(true);
    try {
      const res = await fetch(`/api/admin/portal-reinvite/${pu.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setReinviteUrl(data.inviteUrl);
      qc.invalidateQueries({ queryKey: ["adminPortalUsers"] });
    } catch {
      toast({ title: "Failed to regenerate invite", variant: "destructive" });
      setReinviteRow(null);
    } finally {
      setReinviting(false);
    }
  }

  async function handleReset(pu: PortalUserRow) {
    setConfirmReset(pu);
  }

  async function executeReset() {
    if (!confirmReset) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/portal-reset/${confirmReset.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setReinviteUrl(data.inviteUrl);
      setReinviteRow({ id: confirmReset.id, email: confirmReset.email });
      qc.invalidateQueries({ queryKey: ["adminPortalUsers"] });
    } catch {
      toast({ title: "Failed to reset portal access", variant: "destructive" });
    } finally {
      setResetting(false);
      setConfirmReset(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Portal Clients</h2>
          <p className="text-sm text-muted-foreground">Manage client access to the portal. Invite contacts, monitor activity, and control access.</p>
        </div>
        <Button size="sm" onClick={() => setInviteOpen(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" />Invite Client
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Clients",    value: total,           icon: Users,     color: "text-indigo-600",  bg: "bg-indigo-50"  },
          { label: "Active This Week", value: activeThisWeek,  icon: UserCheck, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Pending Invite",   value: pendingCount,    icon: Mail,      color: "text-amber-600",   bg: "bg-amber-50"   },
          { label: "Deactivated",      value: deactivatedCount, icon: UserX,    color: "text-zinc-500",    bg: "bg-zinc-100"   },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-zinc-200 bg-white p-4 flex items-center gap-3 shadow-sm">
            <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", bg)}>
              <Icon className={cn("h-[18px] w-[18px]", color)} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-2xl font-bold text-zinc-800 leading-none mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Input
            placeholder="Search by name, email, or company…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
        </div>
        {search && (
          <span className="text-xs text-zinc-400">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center w-20">Deals</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead>Invited</TableHead>
              <TableHead className="w-32 text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-zinc-400" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-zinc-400">
                  <Globe className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">{search ? "No clients match your search." : "No portal clients yet."}</p>
                  {!search && <p className="text-xs mt-1">Click "Invite Client" to get started.</p>}
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtered.map((pu) => {
              const status = portalStatus(pu);
              const meta = STATUS_META[status];
              return (
                <TableRow key={pu.id} className="cursor-pointer hover:bg-zinc-50/80" onClick={() => setSelectedClient(pu)}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-700 shrink-0">
                        {(pu.contactName ?? pu.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-800 truncate">{pu.contactName ?? <span className="text-zinc-400 italic">No name</span>}</p>
                        {pu.contactCompany && <p className="text-xs text-zinc-400 truncate">{pu.contactCompany}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-zinc-500 text-sm">{pu.email}</TableCell>
                  <TableCell><Badge className={cn(meta.className)}>{meta.label}</Badge></TableCell>
                  <TableCell className="text-center">
                    <span className={cn("text-sm font-semibold", pu.dealCount > 0 ? "text-zinc-800" : "text-zinc-300")}>
                      {pu.dealCount}
                    </span>
                  </TableCell>
                  <TableCell className="text-zinc-400 text-xs">
                    {pu.lastLoginAt
                      ? format(new Date(pu.lastLoginAt), "MMM d, yyyy")
                      : <span className="text-zinc-300">Never</span>}
                  </TableCell>
                  <TableCell className="text-zinc-400 text-xs">{format(new Date(pu.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <Button size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-zinc-400 hover:text-indigo-600"
                        title="Regenerate invite link"
                        onClick={() => handleReinvite(pu)}
                        disabled={reinviting && reinviteRow?.id === pu.id}
                      >
                        {reinviting && reinviteRow?.id === pu.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost"
                        className={cn("h-8 w-8 p-0", pu.isActive ? "text-zinc-400 hover:text-amber-600" : "text-zinc-400 hover:text-emerald-600")}
                        title={pu.isActive ? "Deactivate access" : "Reactivate access"}
                        disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate({ id: pu.id, isActive: !pu.isActive })}
                      >
                        {pu.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-zinc-400 hover:text-red-600"
                        title="Remove portal access"
                        onClick={() => setConfirmDelete(pu)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Reset portal access confirm dialog */}
      <Dialog open={!!confirmReset} onOpenChange={() => setConfirmReset(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-amber-600">Reset Portal Access</DialogTitle></DialogHeader>
          <p className="text-sm text-zinc-600 py-2">
            This will <strong>invalidate the current password</strong> for{" "}
            <strong>{confirmReset?.contactName ?? confirmReset?.email}</strong> and force them to set a new password
            via a fresh invite link. They will be logged out immediately.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmReset(null)}>Cancel</Button>
            <Button variant="default" size="sm" className="bg-amber-600 hover:bg-amber-700"
              disabled={resetting}
              onClick={executeReset}>
              {resetting ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Resetting…</> : "Reset Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Re-invite result dialog */}
      <Dialog open={!!reinviteUrl} onOpenChange={() => { setReinviteUrl(null); setReinviteRow(null); setReinviteCopied(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Invite Link Ready</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              Share this link with <strong>{reinviteRow?.email}</strong>. Existing credentials remain valid until they use this link.
            </div>
            <div className="flex gap-2">
              <Input value={reinviteUrl ?? ""} readOnly className="h-9 text-xs bg-zinc-50 font-mono" />
              <Button size="sm" variant="outline" className="h-9 w-9 p-0"
                onClick={() => { navigator.clipboard.writeText(reinviteUrl ?? ""); setReinviteCopied(true); setTimeout(() => setReinviteCopied(false), 2000); }}>
                {reinviteCopied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" className="w-full" onClick={() => { setReinviteUrl(null); setReinviteRow(null); setReinviteCopied(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="text-red-600">Remove Portal Access</DialogTitle></DialogHeader>
          <p className="text-sm text-zinc-600 py-2">
            Are you sure you want to remove portal access for{" "}
            <strong>{confirmDelete?.contactName ?? confirmDelete?.email}</strong>?
            They will lose all access immediately. You can re-invite them later.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}>
              {deleteMutation.isPending ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Removing…</> : "Remove Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteClientDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        token={token ?? ""}
        onInvited={() => qc.invalidateQueries({ queryKey: ["adminPortalUsers"] })}
      />

      <PortalClientDrawer
        client={selectedClient}
        token={token ?? ""}
        open={!!selectedClient}
        onClose={() => setSelectedClient(null)}
        onStatusChange={(id, isActive) => statusMutation.mutate({ id, isActive })}
        onReinvite={handleReinvite}
        onReset={handleReset}
        onRemove={setConfirmDelete}
      />
    </div>
  );
}

// ── Notification Preferences Dialog ───────────────────────────────────────────
const NOTIF_EVENTS = [
  { key: "newMessage",            label: "New message in thread",       desc: "When any team member sends a chat message" },
  { key: "portalMessage",         label: "Client portal message",        desc: "When a client sends a message via the portal" },
  { key: "dealCreated",           label: "New deal created",             desc: "When a new deal is added to the pipeline" },
  { key: "dealStageChanged",      label: "Deal stage change",            desc: "When a deal moves to a new stage" },
  { key: "dealUpdated",           label: "Deal info updated",            desc: "When deal details are edited" },
  { key: "newContact",            label: "New contact added",            desc: "When a new contact is created in the CRM" },
  { key: "projectCreated",        label: "New studio project",           desc: "When a studio project is created" },
  { key: "projectStatusChanged",  label: "Studio project status change", desc: "When a project moves to a new status" },
  { key: "dealNoteAdded",         label: "Note added to deal",           desc: "When a note is added to any deal" },
] as const;

function NotificationPrefsDialog({ open, user, onClose, token }: {
  open: boolean; user: AdminUser | null; onClose: () => void; token: string;
}) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    fetch(`/api/admin/users/${user.id}/notification-prefs`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => { setPrefs(data ?? {}); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, user?.id, token]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/notification-prefs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(prefs),
      });
      if (!res.ok) throw new Error("Save failed");
      toast({ title: "Notification preferences saved" });
      onClose();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-blue-500" />Email Notifications — {user.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
            Emails are sent via the first verified SMTP account. The user must also have a working email address.
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : (
            <div className="space-y-2">
              {NOTIF_EVENTS.map(({ key, label, desc }) => (
                <div key={key} className="flex items-start justify-between gap-3 p-3 rounded-lg border border-zinc-100 bg-zinc-50/60 hover:bg-zinc-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-800">{label}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
                  </div>
                  <Switch
                    checked={!!prefs[key]}
                    onCheckedChange={(v) => setPrefs((prev) => ({ ...prev, [key]: v }))}
                    className="shrink-0 mt-0.5"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Advanced ACL — Per-User Action Permissions ────────────────────────────────
const ACL_ACTIONS = [
  { key: "deals:delete",         label: "Delete Deals",          group: "Pipeline" },
  { key: "deals:export",         label: "Export Deals",          group: "Pipeline" },
  { key: "deals:bulk_edit",      label: "Bulk Edit Deals",       group: "Pipeline" },
  { key: "contacts:delete",      label: "Delete Contacts",       group: "Contacts" },
  { key: "contacts:export",      label: "Export Contacts",       group: "Contacts" },
  { key: "contacts:merge",       label: "Merge Contacts",        group: "Contacts" },
  { key: "artists:delete",       label: "Delete Artists",        group: "Artists" },
  { key: "messages:delete",      label: "Delete Messages / Threads", group: "Messages" },
  { key: "forms:delete",         label: "Delete Forms",          group: "Forms" },
  { key: "projects:delete",      label: "Delete Project Pages",  group: "Projects" },
  { key: "media:approve",        label: "Approve Media Versions",group: "Projects" },
  { key: "files:delete",         label: "Delete Files",          group: "Files" },
  { key: "marketing:send",       label: "Send Marketing Emails", group: "Marketing" },
  { key: "automations:toggle",   label: "Toggle Automations",    group: "Automation" },
  { key: "subscriptions:manage", label: "Manage Subscriptions",  group: "Billing" },
  { key: "audit_logs:view",      label: "View Audit Logs",       group: "Admin" },
  { key: "admin:invite",         label: "Invite Team Members",   group: "Admin" },
] as const;

type AclKey = (typeof ACL_ACTIONS)[number]["key"];

function UserPermissionsDialog({ open, user, onClose }: {
  open: boolean; user: AdminUser | null; onClose: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    fetch(`/api/admin/users/${user.id}/permissions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((data: Record<string, boolean>) => { setPerms(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, user?.id]);

  const groups = [...new Set(ACL_ACTIONS.map(a => a.group))];

  function toggle(key: AclKey) {
    setPerms(p => ({ ...p, [key]: !p[key] }));
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(perms),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Permissions saved" });
      onClose();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const isOwnerUser = user?.role === "owner";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-violet-600" />
            Action Permissions — {user?.name}
          </DialogTitle>
        </DialogHeader>

        {isOwnerUser ? (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700 flex items-center gap-2">
            <Crown className="h-4 w-4 shrink-0" />Owners always have unrestricted access to all actions.
          </div>
        ) : loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        ) : (
          <div className="space-y-5 py-2">
            <p className="text-xs text-zinc-500">
              Explicitly grant or deny specific actions for this user. These override role defaults.
              Toggled <span className="font-semibold text-green-700">on</span> = explicitly allowed;
              toggled <span className="font-semibold text-red-700">off</span> = explicitly denied;
              unset = inherits from role.
            </p>
            {groups.map(group => {
              const actions = ACL_ACTIONS.filter(a => a.group === group);
              return (
                <div key={group} className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{group}</p>
                  <div className="rounded-xl border border-zinc-200 bg-white divide-y">
                    {actions.map(a => (
                      <div key={a.key} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm text-zinc-700">{a.label}</span>
                        <div className="flex items-center gap-2">
                          {perms[a.key] === undefined && (
                            <span className="text-[10px] text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">role default</span>
                          )}
                          <Switch
                            checked={perms[a.key] === true}
                            onCheckedChange={(v) => {
                              if (!v && perms[a.key] === undefined) {
                                setPerms(p => ({ ...p, [a.key]: false }));
                              } else {
                                toggle(a.key as AclKey);
                              }
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" className="text-xs text-zinc-400"
              onClick={() => setPerms({})}>
              Reset all to role defaults
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || isOwnerUser || loading}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Saving…</> : "Save Permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Pending Invites Tab ────────────────────────────────────────────────────────
interface StaffInvite {
  id: number;
  email: string;
  role: string;
  invitedBy: number;
  inviterName: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
  claimedByName: string | null;
}

function inviteStatus(invite: StaffInvite): "pending" | "expired" | "used" {
  if (invite.usedAt) return "used";
  if (new Date() > new Date(invite.expiresAt)) return "expired";
  return "pending";
}

function InviteStatusBadge({ invite }: { invite: StaffInvite }) {
  const status = inviteStatus(invite);
  if (status === "used") return (
    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200 gap-1">
      <MailCheck className="h-3 w-3" />Accepted
    </Badge>
  );
  if (status === "expired") return (
    <Badge className="bg-zinc-100 text-zinc-500 hover:bg-zinc-100 border-zinc-200 gap-1">
      <Clock className="h-3 w-3" />Expired
    </Badge>
  );
  return (
    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 gap-1">
      <Clock className="h-3 w-3" />Pending
    </Badge>
  );
}

function PendingInvitesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: invites, isLoading } = useQuery<StaffInvite[]>({
    queryKey: ["admin-invites"],
    queryFn: async () => {
      const r = await fetch("/api/admin/invites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Failed to load invites");
      return r.json();
    },
    enabled: !!token,
    staleTime: 15000,
  });

  const [revoking, setRevoking] = useState<number | null>(null);

  async function handleRevoke(invite: StaffInvite) {
    setRevoking(invite.id);
    try {
      const r = await fetch(`/api/admin/invites/${invite.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to revoke invite");
      }
      toast({ title: `Invite for ${invite.email} revoked` });
      qc.invalidateQueries({ queryKey: ["admin-invites"] });
    } catch (err: unknown) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setRevoking(null);
    }
  }

  const pendingCount = invites?.filter((i) => inviteStatus(i) === "pending").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Team Invite History</h2>
          <p className="text-sm text-muted-foreground">
            All staff invites sent. Pending invites can be revoked; accepted invites are shown for audit purposes.
          </p>
        </div>
        {pendingCount > 0 && (
          <Badge className="bg-blue-100 text-blue-700 border-blue-200 shrink-0">
            {pendingCount} pending
          </Badge>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Invited By</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Claimed By</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                </TableCell>
              </TableRow>
            )}
            {!isLoading && invites?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-zinc-400">
                  No invites sent yet.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && invites?.map((invite) => {
              const status = inviteStatus(invite);
              return (
                <TableRow key={invite.id} className={cn(status === "used" && "opacity-60")}>
                  <TableCell className="font-medium">{invite.email}</TableCell>
                  <TableCell><RoleBadge role={invite.role} /></TableCell>
                  <TableCell className="text-zinc-500">{invite.inviterName ?? "—"}</TableCell>
                  <TableCell className="text-zinc-500 text-sm">
                    {format(new Date(invite.expiresAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell><InviteStatusBadge invite={invite} /></TableCell>
                  <TableCell className="text-zinc-500 text-sm">
                    {invite.claimedByName ?? <span className="text-zinc-300">—</span>}
                  </TableCell>
                  <TableCell>
                    {status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                        disabled={revoking === invite.id}
                        onClick={() => handleRevoke(invite)}
                        title="Revoke invite"
                      >
                        {revoking === invite.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <X className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Main Admin Page ───────────────────────────────────────────────────────────
export default function Admin() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [tabsUser, setTabsUser] = useState<AdminUser | null>(null);
  const [notifUser, setNotifUser] = useState<AdminUser | null>(null);
  const [permsUser, setPermsUser] = useState<AdminUser | null>(null);
  const [deleteStaffUser, setDeleteStaffUser] = useState<AdminUser | null>(null);
  const [deletingStaff, setDeletingStaff] = useState(false);

  const handleDeleteStaff = async () => {
    if (!deleteStaffUser) return;
    setDeletingStaff(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteStaffUser.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to remove user");
      }
      toast({ title: `${deleteStaffUser.name} removed` });
      qc.invalidateQueries({ queryKey: getAdminListUsersQueryKey() });
      setDeleteStaffUser(null);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to remove user", variant: "destructive" });
    } finally {
      setDeletingStaff(false);
    }
  };

  const { data: me } = useGetMe({ query: { enabled: !!token, queryKey: getGetMeQueryKey() } });
  const isOwner = me?.role === "owner";
  const isAdmin = me?.role === "admin";

  const { data: users, isLoading } = useAdminListUsers({
    query: { enabled: isOwner || isAdmin, queryKey: getAdminListUsersQueryKey() },
  });

  const updateRole = useAdminUpdateUserRole({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getAdminListUsersQueryKey() }); toast({ title: "Role updated" }); },
      onError: (err) => toast({ title: "Failed to update role", description: err.message, variant: "destructive" }),
    },
  });

  if (!isOwner && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <ShieldAlert className="h-16 w-16 text-zinc-300 mb-4" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-zinc-500 mt-2">You don't have permission to view this page.</p>
      </div>
    );
  }

  // Which roles can be set by the current viewer in the role dropdown
  function allowedRolesToSet(targetUser: AdminUser): UpdateRoleBodyRole[] {
    if (isOwner) return ["owner", "admin", "manager", "artist", "engineer", "ar", "intern"];
    // Admin can only change non-admin, non-owner users to non-admin roles
    return ["manager", "artist", "engineer", "ar", "intern"];
  }

  function canChangeRole(targetUser: AdminUser): boolean {
    if (targetUser.id === me?.id) return false;          // can't change self
    if (targetUser.role === "owner") return isOwner;     // only owner can touch owners
    if (targetUser.role === "admin") return isOwner;     // only owner can touch admins
    return true;
  }

  return (
    <div className="flex-1 p-4 sm:p-8 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
            {isOwner
              ? <><Crown className="h-6 w-6 text-amber-500" />Owner Panel</>
              : <><Shield className="h-6 w-6 text-violet-600" />Admin Panel</>}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isOwner
              ? "Full control over team access, client portal, roles, and page permissions."
              : "Manage team access, roles, and page permissions."}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" />Invite Member
        </Button>
      </div>

      <Tabs defaultValue="users">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-6">
          <TabsList className="w-max min-w-full">
            <TabsTrigger value="users" className="gap-2 shrink-0">
              <Users className="h-4 w-4" /><span className="hidden sm:inline">Team Members</span><span className="sm:hidden">Team</span>
            </TabsTrigger>
            <TabsTrigger value="role-permissions" className="gap-2 shrink-0">
              <Lock className="h-4 w-4" /><span className="hidden sm:inline">Role Permissions</span><span className="sm:hidden">Roles</span>
            </TabsTrigger>
            <TabsTrigger value="quotas" className="gap-2 shrink-0">
              <Target className="h-4 w-4" />Quotas
            </TabsTrigger>
            {(isOwner || isAdmin) && (
              <TabsTrigger value="portal-clients" className="gap-2 shrink-0">
                <Building2 className="h-4 w-4" /><span className="hidden sm:inline">Portal Clients</span><span className="sm:hidden">Clients</span>
              </TabsTrigger>
            )}
            <TabsTrigger value="invites" className="gap-2 shrink-0">
              <Mail className="h-4 w-4" />Invites
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ── Team Members tab ─────────────────────────────────────────────── */}
        <TabsContent value="users">
          <div className="bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Connections</TableHead>
                  <TableHead>Theme</TableHead>
                  <TableHead>Tab Access</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="w-[140px]">Change Role</TableHead>
                  {isOwner && <TableHead className="w-[48px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-zinc-500">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && users?.map((u) => {
                  const roleOptions = allowedRolesToSet(u);
                  const changeable = canChangeRole(u);
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {u.role === "owner" && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                          {u.name}
                          {u.id === me?.id && <Badge variant="secondary" className="text-xs">You</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-500">{u.email}</TableCell>
                      <TableCell><RoleBadge role={u.role} /></TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {u.connectedProviders.length === 0
                            ? <span className="text-xs text-zinc-400">None</span>
                            : u.connectedProviders.map((p) => (
                              <span key={p} title={p.charAt(0).toUpperCase() + p.slice(1)}
                                className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-zinc-100 border border-zinc-200">
                                {p === "onedrive" && <HardDrive className="h-3 w-3 text-[#0078d4]" />}
                                {p === "dropbox"  && <Cloud className="h-3 w-3 text-[#0061ff]" />}
                                {p === "smtp"     && <Mail className="h-3 w-3 text-zinc-500" />}
                              </span>
                            ))
                          }
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.colorMode === "dark"
                          ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-800 text-zinc-100 border border-zinc-700">
                              <Moon className="h-3 w-3" />Dark
                            </span>
                          : u.colorMode === "light"
                          ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                              <Sun className="h-3 w-3" />Light
                            </span>
                          : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-400 border border-zinc-200">
                              <Sun className="h-3 w-3" />Default
                            </span>
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setTabsUser(u)}
                            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-600 transition-colors"
                            title="Manage tab visibility">
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            {u.role === "owner" ? "All (Owner)"
                              : u.role === "admin" && !isOwner ? "All (Admin)"
                              : u.allowedTabs == null ? "All tabs"
                              : `${u.allowedTabs.length} tab${u.allowedTabs.length !== 1 ? "s" : ""}`}
                          </button>
                          <button onClick={() => setNotifUser(u)}
                            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-blue-600 transition-colors"
                            title="Email notification preferences">
                            <Bell className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setPermsUser(u)}
                            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-violet-600 transition-colors"
                            title="Action permissions (Advanced ACL)">
                            <Shield className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="text-zinc-500">{format(new Date(u.createdAt), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        {!changeable ? (
                          <span className="text-xs text-zinc-300 px-2">
                            {u.id === me?.id ? "—" : u.role === "owner" ? "Owner protected" : "Owner only"}
                          </span>
                        ) : (
                          <Select
                            value={u.role}
                            disabled={updateRole.isPending}
                            onValueChange={(value) => updateRole.mutate({ id: u.id, data: { role: value as UpdateRoleBodyRole } })}
                          >
                            <SelectTrigger className="w-[130px] h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {roleOptions.includes("owner")   && <SelectItem value="owner"><span className="flex items-center gap-1.5"><Crown className="h-3.5 w-3.5 text-amber-500" />Owner</span></SelectItem>}
                              {roleOptions.includes("admin")   && <SelectItem value="admin">Admin</SelectItem>}
                              {roleOptions.includes("manager") && <SelectItem value="manager">Manager</SelectItem>}
                              {roleOptions.includes("artist")  && <SelectItem value="artist">Artist</SelectItem>}
                              {roleOptions.includes("engineer")&& <SelectItem value="engineer">Engineer</SelectItem>}
                              {roleOptions.includes("ar")      && <SelectItem value="ar">A&amp;R</SelectItem>}
                              {roleOptions.includes("intern")  && <SelectItem value="intern">Intern</SelectItem>}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                      {isOwner && (
                        <TableCell>
                          {u.id !== me?.id && u.role !== "owner" && (
                            <button
                              onClick={() => setDeleteStaffUser(u)}
                              className="p-1.5 rounded text-zinc-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              title={`Remove ${u.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {!isLoading && users?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={isOwner ? 9 : 8} className="text-center py-8 text-zinc-500">No users found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Role Permissions tab ─────────────────────────────────────────── */}
        <TabsContent value="role-permissions">
          <RolePermissionsTab isOwner={isOwner} />
        </TabsContent>

        {/* ── Quotas tab ──────────────────────────────────────────────────── */}
        <TabsContent value="quotas">
          <QuotasTab isAdmin={isAdmin || isOwner} />
        </TabsContent>

        {/* ── Portal Clients tab — admin + owner ──────────────────────────── */}
        {(isOwner || isAdmin) && (
          <TabsContent value="portal-clients">
            <PortalClientsTab />
          </TabsContent>
        )}

        {/* ── Invites tab ──────────────────────────────────────────────────── */}
        <TabsContent value="invites">
          <PendingInvitesTab />
        </TabsContent>
      </Tabs>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} isOwner={isOwner} />
      <TabPermissionsDialog open={!!tabsUser} user={tabsUser} onClose={() => setTabsUser(null)} viewerIsOwner={isOwner} />
      <NotificationPrefsDialog open={!!notifUser} user={notifUser} onClose={() => setNotifUser(null)} token={token ?? ""} />
      <UserPermissionsDialog open={!!permsUser} user={permsUser} onClose={() => setPermsUser(null)} />

      <AlertDialog open={!!deleteStaffUser} onOpenChange={(v) => { if (!v) setDeleteStaffUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteStaffUser?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteStaffUser?.name}</strong> ({deleteStaffUser?.email}) and all their session data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingStaff}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteStaff}
              disabled={deletingStaff}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deletingStaff ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Removing…</> : "Remove User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
