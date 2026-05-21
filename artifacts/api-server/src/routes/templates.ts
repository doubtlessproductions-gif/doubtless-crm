import { Router } from "express";
import { db, templatesTable, emailSendsTable, contactsTable, dealsTable, userEmailSettingsTable, userConnectionsTable } from "@workspace/db";
import { eq, or, and, inArray, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import { sendGraphEmail } from "../lib/microsoft-graph.js";

const router = Router();

const TemplateBody = z.object({
  title: z.string().min(1),
  type: z.enum(["email", "proposal", "sms"]).default("email"),
  subject: z.string().optional().nullable(),
  body: z.string().min(1),
  variables: z.array(z.string()).default([]),
  isShared: z.boolean().default(false),
});

// Extract {{variable}} placeholders from body/subject automatically
function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

// Render template by substituting {{var}} with provided values
function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

async function getSmtp(userId: number) {
  const [s] = await db
    .select()
    .from(userEmailSettingsTable)
    .where(eq(userEmailSettingsTable.userId, userId))
    .limit(1);
  return s ?? null;
}

function makeTransport(s: typeof userEmailSettingsTable.$inferSelect) {
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: { user: s.smtpUser, pass: s.smtpPass },
  });
}

router.get("/", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const rows = await db
    .select()
    .from(templatesTable)
    .where(or(eq(templatesTable.createdBy, userId), eq(templatesTable.isShared, true)))
    .orderBy(templatesTable.createdAt);
  res.json(rows);
});

router.post("/", requireAuth, async (req, res) => {
  const parse = TemplateBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const data = parse.data;
  const allText = `${data.subject ?? ""} ${data.body}`;
  const detectedVars = extractVariables(allText);
  const variables = detectedVars.length ? detectedVars : data.variables;

  const [row] = await db
    .insert(templatesTable)
    .values({ ...data, variables, createdBy: req.user!.userId })
    .returning();
  res.status(201).json(row);
});

router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Template not found" }); return; }
  if (!row.isShared && row.createdBy !== req.user!.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(row);
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.createdBy !== req.user!.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  const parse = TemplateBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const data = parse.data;
  const allText = `${data.subject ?? ""} ${data.body}`;
  const variables = extractVariables(allText);
  const [row] = await db
    .update(templatesTable)
    .set({ ...data, variables, updatedAt: new Date() })
    .where(eq(templatesTable.id, id))
    .returning();
  res.json(row);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [existing] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.createdBy !== req.user!.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(templatesTable).where(eq(templatesTable.id, id));
  res.status(204).end();
});

router.post("/:id/render", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const vars: Record<string, string> = req.body?.variables ?? {};
  const rendered = {
    subject: row.subject ? renderTemplate(row.subject, vars) : null,
    body: renderTemplate(row.body, vars),
  };
  res.json(rendered);
});

// ── GET /api/templates/sends/history — list email send history (scoped by user)
router.get("/sends/history", requireAuth, async (req, res) => {
  const userId = req.user!.userId;
  const role = req.user!.role as string;
  const contactId = req.query["contactId"] ? parseInt(req.query["contactId"] as string) : null;

  // Privileged roles see all workspace sends; regular users see only their own sends
  const isPrivileged = ["owner", "admin", "manager"].includes(role);

  const conditions = [];
  if (contactId) conditions.push(eq(emailSendsTable.contactId, contactId));
  if (!isPrivileged) conditions.push(eq(emailSendsTable.sentBy, userId));

  const rows = await db
    .select({
      id: emailSendsTable.id,
      contactId: emailSendsTable.contactId,
      templateId: emailSendsTable.templateId,
      templateTitle: templatesTable.title,
      toEmail: emailSendsTable.toEmail,
      subject: emailSendsTable.subject,
      status: emailSendsTable.status,
      error: emailSendsTable.error,
      sentAt: emailSendsTable.sentAt,
    })
    .from(emailSendsTable)
    .leftJoin(templatesTable, eq(emailSendsTable.templateId, templatesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(emailSendsTable.sentAt))
    .limit(100);
  res.json(rows);
});

// ── POST /api/templates/:id/send — send to a single contact or raw email
const SendBody = z.object({
  toEmail: z.string().email().optional(),
  contactId: z.number().int().optional(),
  variables: z.record(z.string()).default({}),
});

router.post("/:id/send", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!template.isShared && template.createdBy !== req.user!.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const parse = SendBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  let toEmail = parse.data.toEmail ?? null;
  const contactId = parse.data.contactId ?? null;
  const vars: Record<string, string> = { ...parse.data.variables };

  if (contactId && !toEmail) {
    const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId)).limit(1);
    if (!contact?.email) { res.status(400).json({ error: "Contact has no email address" }); return; }
    toEmail = contact.email;
    if (!vars["name"]) vars["name"] = contact.name;
    if (!vars["email"]) vars["email"] = contact.email;
    if (contact.company && !vars["company"]) vars["company"] = contact.company;
    if (contact.phone && !vars["phone"]) vars["phone"] = contact.phone;
  }

  if (!toEmail) { res.status(400).json({ error: "No recipient email provided" }); return; }

  const subject = template.subject ? renderTemplate(template.subject, vars) : "(no subject)";
  const body = renderTemplate(template.body, vars);
  const html = body.replace(/\n/g, "<br>");

  // Try Outlook / Graph first, fall back to SMTP
  const graphSent = await sendGraphEmail(req.user!.userId, { to: toEmail, subject, html });
  if (graphSent) {
    await db.insert(emailSendsTable).values({ contactId, templateId: id, toEmail, subject, status: "sent", sentBy: req.user!.userId });
    res.json({ ok: true, toEmail });
    return;
  }

  const smtp = await getSmtp(req.user!.userId);
  if (!smtp) {
    res.status(400).json({ error: "No email sender configured. Connect your Outlook account or configure SMTP in Settings.", code: "NO_SENDER" });
    return;
  }

  try {
    const transport = makeTransport(smtp);
    await transport.sendMail({
      from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: toEmail, subject, html, text: body,
    });
    await db.insert(emailSendsTable).values({ contactId, templateId: id, toEmail, subject, status: "sent", sentBy: req.user!.userId });
    res.json({ ok: true, toEmail });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : "Send failed";
    await db.insert(emailSendsTable).values({ contactId, templateId: id, toEmail, subject, status: "failed", error, sentBy: req.user!.userId });
    res.status(422).json({ error });
  }
});

// ── POST /api/templates/:id/campaign — bulk send to a filtered contact segment
const CampaignBody = z.object({
  filter: z.enum(["all", "tags", "stage"]).default("all"),
  tags: z.array(z.string()).optional(),
  stage: z.enum(["lead", "qualified", "proposal", "negotiation", "won", "lost"]).optional(),
  variables: z.record(z.string()).default({}),
});

router.post("/:id/campaign", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [template] = await db.select().from(templatesTable).where(eq(templatesTable.id, id)).limit(1);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }
  if (!template.isShared && template.createdBy !== req.user!.userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (template.type !== "email") { res.status(400).json({ error: "Campaigns only supported for email templates" }); return; }

  const parse = CampaignBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const { filter, tags, stage, variables: extraVars } = parse.data;

  // ── Pre-check: ensure at least one sender is available before querying contacts
  const [outlookConn] = await db
    .select({ credentials: userConnectionsTable.credentials })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, req.user!.userId), eq(userConnectionsTable.provider, "outlook")))
    .limit(1);
  const hasOutlook = !!outlookConn?.credentials;
  const smtp = await getSmtp(req.user!.userId);
  if (!hasOutlook && !smtp?.smtpHost) {
    res.status(400).json({ error: "No email sender configured. Connect your Outlook account or configure SMTP in Settings.", code: "NO_SENDER" });
    return;
  }

  // For stage filter, resolve contactIds from deals
  let stageContactIds: number[] | null = null;
  if (filter === "stage" && stage) {
    const dealRows = await db.select({ contactId: dealsTable.contactId }).from(dealsTable).where(eq(dealsTable.stage, stage));
    stageContactIds = dealRows.map((r) => r.contactId).filter((x): x is number => x != null);
    if (!stageContactIds.length) { res.json({ sent: 0, failed: 0, total: 0 }); return; }
  }

  const conditions = [sql`${contactsTable.email} is not null`];
  if (filter === "tags" && tags?.length) {
    conditions.push(sql`${contactsTable.tags} && ${tags}::text[]`);
  }
  if (filter === "stage" && stageContactIds?.length) {
    conditions.push(inArray(contactsTable.id, stageContactIds));
  }

  const contacts = await db.select().from(contactsTable).where(and(...conditions));
  if (!contacts.length) { res.json({ sent: 0, failed: 0, total: 0 }); return; }

  const transport = smtp ? makeTransport(smtp) : null;
  const userId = req.user!.userId;
  let sent = 0;
  let failed = 0;

  for (const contact of contacts) {
    if (!contact.email) continue;
    const vars: Record<string, string> = {
      name: contact.name, email: contact.email,
      company: contact.company ?? "", phone: contact.phone ?? "",
      ...extraVars,
    };
    const subject = template.subject ? renderTemplate(template.subject, vars) : "(no subject)";
    const body = renderTemplate(template.body, vars);
    const html = body.replace(/\n/g, "<br>");
    try {
      const graphSent = await sendGraphEmail(userId, { to: contact.email, subject, html });
      if (!graphSent) {
        if (!transport || !smtp) throw new Error("No email sender configured");
        await transport.sendMail({
          from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
          to: contact.email, subject, html, text: body,
        });
      }
      await db.insert(emailSendsTable).values({ contactId: contact.id, templateId: id, toEmail: contact.email, subject, status: "sent", sentBy: userId });
      sent++;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : "Send failed";
      await db.insert(emailSendsTable).values({ contactId: contact.id, templateId: id, toEmail: contact.email, subject, status: "failed", error, sentBy: userId });
      failed++;
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  res.json({ sent, failed, total: contacts.length });
});

export default router;
