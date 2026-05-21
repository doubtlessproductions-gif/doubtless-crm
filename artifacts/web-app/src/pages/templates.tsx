import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTemplates,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
  useRenderTemplate,
  useListContacts,
  getListTemplatesQueryKey,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import type { Template } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus, FileText, Mail, MessageSquare, Edit2, Trash2, Copy, Eye, Share2,
  Send, Megaphone, CheckCircle, AlertCircle, Settings, X, Users,
} from "lucide-react";
import { Link } from "wouter";

const TYPE_CONFIG = {
  email: { label: "Email", icon: Mail, color: "bg-blue-100 text-blue-700" },
  proposal: { label: "Proposal", icon: FileText, color: "bg-violet-100 text-violet-700" },
  sms: { label: "SMS", icon: MessageSquare, color: "bg-green-100 text-green-700" },
} as const;

const BLANK_FORM = {
  title: "",
  type: "email" as "email" | "proposal" | "sms",
  subject: "",
  body: "",
  isShared: false,
};

const DEAL_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;

export default function Templates() {
  const { toast } = useToast();
  const { token } = useAuth();
  const queryClient = useQueryClient();

  // Edit / create state
  const [editOpen, setEditOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [rendered, setRendered] = useState<{ subject: string | null; body: string } | null>(null);

  // Send state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTemplate, setSendTemplate] = useState<Template | null>(null);
  const [sendMode, setSendMode] = useState<"contact" | "raw">("contact");
  const [sendContactId, setSendContactId] = useState<number | null>(null);
  const [sendToEmail, setSendToEmail] = useState("");
  const [sendVars, setSendVars] = useState<Record<string, string>>({});
  const [sendLoading, setSendLoading] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [outlookEmail, setOutlookEmail] = useState<string | null>(null);
  const [sendRendered, setSendRendered] = useState<{ subject: string | null; body: string } | null>(null);
  const [sendRenderLoading, setSendRenderLoading] = useState(false);

  // Campaign state
  const [campaignTemplateId, setCampaignTemplateId] = useState<number | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<"all" | "tags" | "stage">("all");
  const [campaignTags, setCampaignTags] = useState("");
  const [campaignStage, setCampaignStage] = useState<string>("");
  const [campaignResult, setCampaignResult] = useState<{ sent: number; failed: number; total: number } | null>(null);
  const [campaignLoading, setCampaignLoading] = useState(false);

  // Load sender info once on mount so Campaign tab can show it too
  useEffect(() => {
    if (!token) return;
    Promise.all([
      fetch("/api/email-settings", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/integrations/connections", { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(async ([smtpRes, connRes]) => {
      const smtpData = await smtpRes.json();
      setSmtpConfigured(!!smtpData?.smtpHost);
      if (connRes.ok) {
        const connData: Array<{ provider: string; displayName?: string; isWorkspace?: boolean }> = await connRes.json();
        // A connection record existing means OAuth was completed — credentials
        // are stored server-side and never returned to the client.
        const outlook = connData.find((c) => c.provider === "outlook");
        setOutlookEmail(outlook?.displayName ?? null);
      }
    }).catch(() => {
      // On network error leave smtpConfigured as null — do not falsely gate sending.
      // The server will return NO_SENDER if truly unconfigured.
    });
  }, [token]);

  const { data: templates, isLoading } = useListTemplates({
    query: { queryKey: getListTemplatesQueryKey() },
  });

  const { data: allContacts } = useListContacts(
    {},
    { query: { queryKey: getListContactsQueryKey({}) } },
  );

  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();
  const renderTemplate = useRenderTemplate();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListTemplatesQueryKey() });

  const emailTemplates = useMemo(() => templates?.filter((t) => t.type === "email") ?? [], [templates]);

  const filteredContacts = useMemo(() => {
    if (!contactSearch) return allContacts ?? [];
    const q = contactSearch.toLowerCase();
    return (allContacts ?? []).filter(
      (c) => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q),
    );
  }, [allContacts, contactSearch]);

  // Campaign estimated count
  const campaignCount = useMemo(() => {
    const contacts = (allContacts ?? []).filter((c) => c.email);
    if (campaignFilter === "all") return contacts.length;
    if (campaignFilter === "tags") {
      const tags = campaignTags.split(",").map((t) => t.trim()).filter(Boolean);
      if (!tags.length) return contacts.length;
      return contacts.filter((c) => tags.some((tag) => (c.tags ?? []).includes(tag))).length;
    }
    // stage filter is server-side only (needs deals join), approximate with all
    return contacts.length;
  }, [allContacts, campaignFilter, campaignTags]);

  const openNew = () => {
    setSelectedTemplate(null);
    setForm(BLANK_FORM);
    setEditOpen(true);
  };

  const openEdit = (t: Template) => {
    setSelectedTemplate(t);
    setForm({
      title: t.title,
      type: t.type as "email" | "proposal" | "sms",
      subject: t.subject ?? "",
      body: t.body,
      isShared: t.isShared,
    });
    setEditOpen(true);
  };

  const openPreview = async (t: Template) => {
    setSelectedTemplate(t);
    const initVars: Record<string, string> = {};
    t.variables.forEach((v) => (initVars[v] = ""));
    setPreviewVars(initVars);
    setRendered(null);
    setPreviewOpen(true);
  };

  const openSend = (t: Template) => {
    setSendTemplate(t);
    setSendContactId(null);
    setSendToEmail("");
    setSendMode("contact");
    setContactSearch("");
    setSendRendered(null);
    const initVars: Record<string, string> = {};
    t.variables.forEach((v) => (initVars[v] = ""));
    setSendVars(initVars);
    setSendOpen(true);
    // Sender info is already loaded on mount; no re-fetch needed
  };

  const handleSendPreview = async () => {
    if (!sendTemplate) return;
    setSendRenderLoading(true);
    try {
      const res = await fetch(`/api/templates/${sendTemplate.id}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ variables: sendVars }),
      });
      const data = await res.json();
      setSendRendered({ subject: data.subject ?? null, body: data.body });
    } catch {
      toast({ title: "Preview failed", variant: "destructive" });
    } finally {
      setSendRenderLoading(false);
    }
  };

  const handleRender = async () => {
    if (!selectedTemplate) return;
    try {
      const result = await renderTemplate.mutateAsync({
        id: selectedTemplate.id,
        data: { variables: previewVars },
      });
      setRendered({ subject: result.subject ?? null, body: result.body });
    } catch {
      toast({ title: "Render failed", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        title: form.title,
        type: form.type,
        subject: form.subject || null,
        body: form.body,
        isShared: form.isShared,
        variables: [],
      };
      if (selectedTemplate) {
        await updateTemplate.mutateAsync({ id: selectedTemplate.id, data: payload });
        toast({ title: "Template updated" });
      } else {
        await createTemplate.mutateAsync({ data: payload });
        toast({ title: "Template created" });
      }
      invalidate();
      setEditOpen(false);
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    await deleteTemplate.mutateAsync({ id });
    invalidate();
    toast({ title: "Template deleted" });
  };

  const handleCopyBody = (body: string) => {
    navigator.clipboard.writeText(body);
    toast({ title: "Copied to clipboard" });
  };

  const handleSend = async () => {
    if (!sendTemplate) return;
    setSendLoading(true);
    try {
      const body: Record<string, unknown> = { variables: sendVars };
      if (sendMode === "contact" && sendContactId) {
        body["contactId"] = sendContactId;
      } else if (sendMode === "raw" && sendToEmail) {
        body["toEmail"] = sendToEmail;
      } else {
        toast({ title: "Select a contact or enter an email address", variant: "destructive" });
        setSendLoading(false);
        return;
      }
      const res = await fetch(`/api/templates/${sendTemplate.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "NO_SENDER" || data.code === "NO_SMTP") {
          toast({
            title: "No email sender configured",
            description: "Connect your Outlook account or configure SMTP in Settings.",
            variant: "destructive",
          });
        } else {
          toast({ title: data.error ?? "Send failed", variant: "destructive" });
        }
        return;
      }
      toast({ title: `Email sent to ${data.toEmail}` });
      setSendOpen(false);
    } catch {
      toast({ title: "Send failed", variant: "destructive" });
    } finally {
      setSendLoading(false);
    }
  };

  const handleCampaign = async () => {
    if (!campaignTemplateId) {
      toast({ title: "Select a template first", variant: "destructive" });
      return;
    }
    setCampaignLoading(true);
    setCampaignResult(null);
    try {
      const body: Record<string, unknown> = { filter: campaignFilter, variables: {} };
      if (campaignFilter === "tags") {
        body["tags"] = campaignTags.split(",").map((t) => t.trim()).filter(Boolean);
      }
      if (campaignFilter === "stage" && campaignStage) {
        body["stage"] = campaignStage;
      }
      const res = await fetch(`/api/templates/${campaignTemplateId}/campaign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "NO_SENDER" || data.code === "NO_SMTP") {
          toast({
            title: "No email sender configured",
            description: "Connect your Outlook account or configure SMTP in Settings before sending campaigns.",
            variant: "destructive",
          });
        } else {
          toast({ title: data.error ?? "Campaign failed", variant: "destructive" });
        }
        return;
      }
      setCampaignResult(data);
    } catch {
      toast({ title: "Campaign failed", variant: "destructive" });
    } finally {
      setCampaignLoading(false);
    }
  };

  const groupedTemplates = templates?.reduce(
    (acc, t) => {
      const key = t.type as "email" | "proposal" | "sms";
      if (!acc[key]) acc[key] = [];
      acc[key]!.push(t);
      return acc;
    },
    {} as Record<string, Template[]>,
  );

  const selectedContact = sendContactId ? allContacts?.find((c) => c.id === sendContactId) : null;

  return (
    <div className="p-6 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Marketing Templates</h1>
          <p className="text-muted-foreground text-sm">
            Build reusable email, proposal, and SMS templates with{" "}
            <code className="text-xs bg-muted px-1 rounded">{"{{variable}}"}</code> substitution
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates"><FileText className="h-3.5 w-3.5 mr-1.5" />Templates</TabsTrigger>
          <TabsTrigger value="campaign"><Megaphone className="h-3.5 w-3.5 mr-1.5" />Campaign</TabsTrigger>
        </TabsList>

        {/* ── Templates Tab ── */}
        <TabsContent value="templates" className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : !templates?.length ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-semibold text-lg mb-1">No templates yet</h3>
              <p className="text-muted-foreground text-sm mb-4">
                Create your first email, proposal, or SMS template.
              </p>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" />
                Create Template
              </Button>
            </div>
          ) : (
            <div className="space-y-8">
              {(["email", "proposal", "sms"] as const).map((type) => {
                const items = groupedTemplates?.[type];
                if (!items?.length) return null;
                const cfg = TYPE_CONFIG[type];
                const Icon = cfg.icon;
                return (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                        {cfg.label} Templates
                      </h2>
                      <Badge variant="secondary">{items.length}</Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {items.map((t) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          onEdit={() => openEdit(t)}
                          onPreview={() => openPreview(t)}
                          onDelete={() => handleDelete(t.id)}
                          onCopy={() => handleCopyBody(t.body)}
                          onSend={t.type === "email" ? () => openSend(t) : undefined}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Campaign Tab ── */}
        <TabsContent value="campaign" className="mt-4">
          <div className="max-w-xl space-y-6">
            <div className="bg-muted/40 border border-zinc-200 rounded-xl p-5 space-y-5">
              <div className="space-y-1.5">
                <Label>Email Template</Label>
                <Select
                  value={campaignTemplateId?.toString() ?? ""}
                  onValueChange={(v) => { setCampaignTemplateId(parseInt(v)); setCampaignResult(null); }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an email template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id.toString()}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!emailTemplates.length && (
                  <p className="text-xs text-muted-foreground">No email templates yet. Create one first.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Recipient Filter</Label>
                <Select value={campaignFilter} onValueChange={(v) => setCampaignFilter(v as typeof campaignFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All contacts with email</SelectItem>
                    <SelectItem value="tags">Filter by tags</SelectItem>
                    <SelectItem value="stage">Filter by deal stage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {campaignFilter === "tags" && (
                <div className="space-y-1.5">
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    placeholder="VIP, Lead, Artist"
                    value={campaignTags}
                    onChange={(e) => setCampaignTags(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Sends to contacts that have any of these tags.</p>
                </div>
              )}

              {campaignFilter === "stage" && (
                <div className="space-y-1.5">
                  <Label>Deal Stage</Label>
                  <Select value={campaignStage} onValueChange={setCampaignStage}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select stage…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DEAL_STAGES.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Sends to contacts with at least one deal in this stage.</p>
                </div>
              )}

              <div className="flex items-center justify-between text-sm border-t pt-4">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Users className="h-4 w-4" />
                  {campaignFilter === "stage" ? "Estimated" : "Estimated"} recipients:
                  <strong className="text-foreground">{campaignCount}</strong>
                </span>
                <Button
                  onClick={handleCampaign}
                  disabled={!campaignTemplateId || campaignLoading || (campaignFilter === "stage" && !campaignStage)}
                >
                  <Megaphone className="h-4 w-4 mr-2" />
                  {campaignLoading ? "Sending…" : "Send Campaign"}
                </Button>
              </div>
            </div>

            {campaignLoading && (
              <Alert>
                <AlertDescription className="flex items-center gap-2">
                  <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Sending campaign emails, please wait…
                </AlertDescription>
              </Alert>
            )}

            {campaignResult && (
              <Alert className={campaignResult.failed === 0 ? "border-green-200 bg-green-50" : "border-yellow-200 bg-yellow-50"}>
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  <span className="font-medium">Campaign complete</span> — {campaignResult.sent} sent
                  {campaignResult.failed > 0 && (
                    <span className="text-red-600">, {campaignResult.failed} failed</span>
                  )}{" "}
                  out of {campaignResult.total} contacts.
                </AlertDescription>
              </Alert>
            )}

            {smtpConfigured === false && outlookEmail === null ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No email sender configured.{" "}
                  <Link href="/settings" className="underline font-medium">
                    Connect Outlook or configure SMTP in Settings
                  </Link>{" "}
                  before sending campaigns.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-blue-200 bg-blue-50">
                <Mail className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                  {outlookEmail
                    ? <>Campaigns will send from your connected Outlook account (<strong>{outlookEmail}</strong>).</>
                    : smtpConfigured
                    ? <>Campaigns will send via your configured SMTP account. <Link href="/settings" className="underline font-medium">Check settings</Link> if sends are failing.</>
                    : <>Checking sender configuration…</>
                  }
                </AlertDescription>
              </Alert>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Edit / Create Dialog ── */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTemplate ? "Edit Template" : "New Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Q4 Proposal Template"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as typeof form.type })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.type !== "sms" && (
              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Proposal for {{company}}"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Body</Label>
                <span className="text-xs text-muted-foreground">Use {"{{variable}}"} for dynamic fields</span>
              </div>
              <Textarea
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder={`Hi {{name}},\n\nThank you for your interest in {{company}}...`}
                rows={10}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="shared"
                checked={form.isShared}
                onCheckedChange={(v) => setForm({ ...form, isShared: v })}
              />
              <Label htmlFor="shared">Share with team</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={!form.title || !form.body || createTemplate.isPending || updateTemplate.isPending}
              >
                {selectedTemplate ? "Save Changes" : "Create Template"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview Dialog ── */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preview: {selectedTemplate?.title}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="variables">
            <TabsList>
              <TabsTrigger value="variables">Fill Variables</TabsTrigger>
              <TabsTrigger value="preview" disabled={!rendered}>Rendered Output</TabsTrigger>
            </TabsList>
            <TabsContent value="variables" className="space-y-4 pt-2">
              {selectedTemplate?.variables.length === 0 ? (
                <p className="text-sm text-muted-foreground">This template has no variables.</p>
              ) : (
                selectedTemplate?.variables.map((v) => (
                  <div key={v} className="space-y-1.5">
                    <Label><code className="text-xs bg-muted px-1 rounded">{`{{${v}}}`}</code></Label>
                    <Input
                      value={previewVars[v] ?? ""}
                      onChange={(e) => setPreviewVars((prev) => ({ ...prev, [v]: e.target.value }))}
                      placeholder={`Value for ${v}`}
                    />
                  </div>
                ))
              )}
              <Button onClick={handleRender} disabled={renderTemplate.isPending} className="w-full">
                <Eye className="h-4 w-4 mr-2" />
                {renderTemplate.isPending ? "Rendering..." : "Render Preview"}
              </Button>
            </TabsContent>
            <TabsContent value="preview" className="pt-2 space-y-4">
              {rendered?.subject && (
                <div>
                  <Label>Subject</Label>
                  <p className="mt-1 font-medium">{rendered.subject}</p>
                </div>
              )}
              <div>
                <Label>Body</Label>
                <pre className="mt-1 whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg font-sans">{rendered?.body}</pre>
              </div>
              <Button variant="outline" onClick={() => rendered && handleCopyBody(rendered.body)} className="w-full">
                <Copy className="h-4 w-4 mr-2" />
                Copy to Clipboard
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* ── Send Dialog ── */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4" /> Send: {sendTemplate?.title}
            </DialogTitle>
          </DialogHeader>

          {/* Sender identity / no-sender warning */}
          {(outlookEmail !== null || smtpConfigured === true) ? (
            <div className="flex items-center gap-2 text-sm text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
              <Mail className="h-4 w-4 text-zinc-400 shrink-0" />
              <span>Sending from{" "}
                <span className="font-medium text-zinc-800">
                  {outlookEmail ?? "your SMTP account"}
                </span>
              </span>
            </div>
          ) : smtpConfigured === false && outlookEmail === null ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No email sender configured.{" "}
                <Link href="/settings" className="underline font-medium" onClick={() => setSendOpen(false)}>
                  Connect Outlook or configure SMTP in Settings
                </Link>.
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="compose">
            <TabsList className="w-full">
              <TabsTrigger value="compose" className="flex-1">Compose</TabsTrigger>
              <TabsTrigger value="preview" className="flex-1" disabled={!sendRendered}>
                Preview {sendRendered && <CheckCircle className="h-3 w-3 ml-1 text-green-500" />}
              </TabsTrigger>
            </TabsList>

            {/* ── Compose tab ── */}
            <TabsContent value="compose" className="space-y-4 pt-2">
              {/* Recipient mode toggle */}
              <div className="flex gap-2">
                <Button size="sm" variant={sendMode === "contact" ? "default" : "outline"} onClick={() => setSendMode("contact")}>
                  Pick Contact
                </Button>
                <Button size="sm" variant={sendMode === "raw" ? "default" : "outline"} onClick={() => setSendMode("raw")}>
                  Enter Email
                </Button>
              </div>

              {sendMode === "contact" ? (
                <div className="space-y-2">
                  <Label>Search Contacts</Label>
                  <Input
                    placeholder="Search by name or email…"
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                  />
                  <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-lg divide-y bg-white shadow-sm">
                    {filteredContacts.length === 0 && (
                      <p className="text-sm text-muted-foreground p-3 text-center">No contacts found</p>
                    )}
                    {filteredContacts.slice(0, 20).map((c) => (
                      <button
                        key={c.id}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${sendContactId === c.id ? "bg-primary/10 font-medium" : ""}`}
                        onClick={() => {
                          setSendContactId(c.id);
                          setSendRendered(null);
                          const vars = { ...sendVars };
                          if (c.name) vars["name"] = c.name;
                          if (c.email) vars["email"] = c.email;
                          if (c.company) vars["company"] = c.company;
                          if (c.phone) vars["phone"] = c.phone;
                          setSendVars(vars);
                        }}
                      >
                        <div className="font-medium">{c.name}</div>
                        {c.email && <div className="text-muted-foreground text-xs">{c.email}</div>}
                      </button>
                    ))}
                  </div>
                  {sendContactId && selectedContact && (
                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5">
                      <CheckCircle className="h-3.5 w-3.5" />
                      Sending to {selectedContact.name} ({selectedContact.email})
                      <button className="ml-auto" onClick={() => { setSendContactId(null); setSendRendered(null); }}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {sendContactId && selectedContact && !selectedContact.email && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>This contact has no email address.</AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    placeholder="contact@example.com"
                    value={sendToEmail}
                    onChange={(e) => { setSendToEmail(e.target.value); setSendRendered(null); }}
                  />
                </div>
              )}

              {/* Variable overrides */}
              {sendTemplate && sendTemplate.variables.length > 0 && (
                <div className="space-y-3 border-t pt-3">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Template Variables</Label>
                  {sendTemplate.variables.map((v) => (
                    <div key={v} className="space-y-1">
                      <Label className="text-xs"><code className="bg-muted px-1 rounded">{`{{${v}}}`}</code></Label>
                      <Input
                        value={sendVars[v] ?? ""}
                        onChange={(e) => { setSendVars((prev) => ({ ...prev, [v]: e.target.value })); setSendRendered(null); }}
                        placeholder={`Value for ${v}`}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleSendPreview}
                  disabled={sendRenderLoading}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  {sendRenderLoading ? "Previewing…" : "Preview Email"}
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSend}
                  disabled={
                    sendLoading ||
                    (smtpConfigured === false && outlookEmail === null) ||
                    (sendMode === "contact" && (!sendContactId || !selectedContact?.email)) ||
                    (sendMode === "raw" && !sendToEmail)
                  }
                >
                  <Send className="h-4 w-4 mr-2" />
                  {sendLoading ? "Sending…" : "Send Email"}
                </Button>
              </div>
            </TabsContent>

            {/* ── Preview tab ── */}
            <TabsContent value="preview" className="space-y-4 pt-2">
              {sendRendered ? (
                <>
                  {sendRendered.subject && (
                    <div>
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">Subject</Label>
                      <p className="mt-1 font-semibold text-sm">{sendRendered.subject}</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Body</Label>
                    <pre className="mt-1 whitespace-pre-wrap text-sm bg-muted p-4 rounded-lg font-sans leading-relaxed">
                      {sendRendered.body}
                    </pre>
                  </div>
                  <div className="flex gap-2 pt-2 border-t">
                    <Button variant="outline" className="flex-1" onClick={() => handleCopyBody(sendRendered.body)}>
                      <Copy className="h-4 w-4 mr-2" />Copy
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleSend}
                      disabled={
                        sendLoading ||
                        (smtpConfigured === false && outlookEmail === null) ||
                        (sendMode === "contact" && (!sendContactId || !selectedContact?.email)) ||
                        (sendMode === "raw" && !sendToEmail)
                      }
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {sendLoading ? "Sending…" : "Confirm & Send"}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Click "Preview Email" on the Compose tab to render the message.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onPreview,
  onDelete,
  onCopy,
  onSend,
}: {
  template: Template;
  onEdit: () => void;
  onPreview: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onSend?: () => void;
}) {
  const cfg = TYPE_CONFIG[template.type as keyof typeof TYPE_CONFIG];
  const Icon = cfg?.icon ?? FileText;

  return (
    <Card className="group hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`p-1.5 rounded-md ${cfg?.color}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <CardTitle className="text-sm font-semibold truncate">{template.title}</CardTitle>
          </div>
          {template.isShared && (
            <span title="Shared with team">
              <Share2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            </span>
          )}
        </div>
        {template.subject && (
          <p className="text-xs text-muted-foreground truncate pl-8">{template.subject}</p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-xs text-muted-foreground line-clamp-3 mb-3">{template.body}</p>
        {template.variables.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {template.variables.map((v) => (
              <Badge key={v} variant="outline" className="text-xs font-mono">
                {`{{${v}}}`}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onPreview} title="Preview">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCopy} title="Copy body">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          {onSend && (
            <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-600 hover:text-blue-700" onClick={onSend} title="Send email">
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
