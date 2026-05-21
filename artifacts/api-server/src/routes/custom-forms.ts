// Custom Form Builder routes
import { Router } from "express";
import { db, customFormsTable, customFormSubmissionsTable, contactsTable, dealsTable, usersTable, userEmailSettingsTable, themeSettingsTable, userPermissionsTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { formLimiter, honeypotCheck } from "../middlewares/security.js";
import { logger } from "../lib/logger.js";
import { notifyAll } from "../lib/notify.js";
import { z } from "zod";
import type { CustomFormField } from "@workspace/db";
import nodemailer from "nodemailer";
import { fireWebhook } from "../lib/webhooks.js";

const router = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────
const CRM_FIELD_MAPPING = ["name", "email", "phone", "company", "notes"] as const;

// Types that don't require user input — skip required validation
const DISPLAY_ONLY_TYPES = new Set([
  "divider", "heading", "contract_text", "statement", "instructions", "spacer",
]);

const FieldSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum([
    "short_text", "long_text", "email", "phone", "number", "date",
    "full_name", "url", "time", "address",
    "dropdown", "radio", "checkbox_group", "checkbox", "yes_no",
    "rating", "scale", "slider",
    "signature", "initials", "date_signed", "contract_text", "legal_agreement",
    "heading", "divider", "statement", "instructions", "spacer",
  ]),
  label: z.string().max(200),
  placeholder: z.string().max(200).optional(),
  helpText: z.string().max(500).optional(),
  required: z.boolean(),
  options: z.array(z.string().max(200)).optional(),
  content: z.string().max(20000).optional(),
  crmField: z.enum(CRM_FIELD_MAPPING).optional(),
  // Scale / slider
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().max(20).optional(),
  // Rating
  maxStars: z.number().int().min(3).max(10).optional(),
  // Matrix
  matrixRows: z.array(z.string().max(200)).optional(),
  matrixCols: z.array(z.string().max(200)).optional(),
  // Yes/No labels
  yesLabel: z.string().max(50).optional(),
  noLabel: z.string().max(50).optional(),
});

const FormBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens only"),
  fields: z.array(FieldSchema).max(150),
  submitButtonLabel: z.string().max(100).optional().default("Submit"),
  successMessage: z.string().max(500).optional().default("Thank you! Your response has been recorded."),
  createContact: z.boolean().optional().default(false),
  createDeal: z.boolean().optional().default(false),
  dealStage: z.string().max(50).optional(),
});

// ── GET /api/custom-forms — list all (auth) ───────────────────────────────────
router.get("/", requireAuth, async (_req, res) => {
  const forms = await db
    .select()
    .from(customFormsTable)
    .orderBy(desc(customFormsTable.createdAt));
  res.json(forms);
});

// ── POST /api/custom-forms — create form (auth) ───────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const parse = FormBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const existing = await db.select({ id: customFormsTable.id }).from(customFormsTable).where(eq(customFormsTable.slug, parse.data.slug)).limit(1);
  if (existing.length > 0) { res.status(409).json({ error: "A form with this slug already exists" }); return; }

  const [form] = await db.insert(customFormsTable).values({
    ...parse.data,
    fields: parse.data.fields as CustomFormField[],
    createdBy: req.user!.userId,
  }).returning();

  logger.info({ formId: form!.id, userId: req.user!.userId }, "Custom form created");
  res.status(201).json(form);
});

// ── GET /api/custom-forms/:id — get one form (auth) ───────────────────────────
router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [form] = await db.select().from(customFormsTable).where(eq(customFormsTable.id, id)).limit(1);
  if (!form) { res.status(404).json({ error: "Not found" }); return; }
  res.json(form);
});

// ── PUT /api/custom-forms/:id — update (auth) ────────────────────────────────
router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parse = FormBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }

  const conflict = await db.select({ id: customFormsTable.id }).from(customFormsTable)
    .where(eq(customFormsTable.slug, parse.data.slug)).limit(1);
  if (conflict.length > 0 && conflict[0]!.id !== id) {
    res.status(409).json({ error: "Slug already used by another form" }); return;
  }

  const [updated] = await db.update(customFormsTable)
    .set({ ...parse.data, fields: parse.data.fields as CustomFormField[], updatedAt: new Date() })
    .where(eq(customFormsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── POST /api/custom-forms/:id/publish — toggle publish status (auth) ────────
router.post("/:id/publish", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [form] = await db.select().from(customFormsTable).where(eq(customFormsTable.id, id)).limit(1);
  if (!form) { res.status(404).json({ error: "Not found" }); return; }

  const newStatus = form.status === "published" ? "draft" : "published";
  const [updated] = await db.update(customFormsTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(customFormsTable.id, id))
    .returning();
  res.json(updated);
});

// ── GET /api/custom-forms/submissions/export.csv (auth) ──────────────────────
router.get("/submissions/export.csv", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(customFormSubmissionsTable)
    .orderBy(desc(customFormSubmissionsTable.submittedAt));

  const header = ["Submission ID", "Form ID", "Submitter Name", "Submitter Email", "Submitted At", "Status"];
  const lines = [
    header.join(","),
    ...rows.map(r => [
      r.id,
      r.formId,
      `"${(r.submitterName ?? "").replace(/"/g, '""')}"`,
      `"${(r.submitterEmail ?? "").replace(/"/g, '""')}"`,
      r.submittedAt?.toISOString() ?? "",
      `"${(r.status ?? "new").replace(/"/g, '""')}"`,
    ].join(",")),
  ];

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="custom-form-submissions.csv"`);
  res.send(lines.join("\n"));
});

// ── PATCH /api/custom-forms/submissions/bulk (auth) ───────────────────────────
const SubmissionsBulkBody = z.object({
  ids:    z.array(z.number().int().positive()).min(1).max(500),
  action: z.enum(["status", "delete"]).optional(),
  status: z.string().optional(),
});

router.patch("/submissions/bulk", requireAuth, async (req, res) => {
  const parse = SubmissionsBulkBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { ids, action, status } = parse.data;

  const resolvedAction = action ?? (status ? "status" : "delete");

  if (resolvedAction === "delete") {
    await db.delete(customFormSubmissionsTable).where(inArray(customFormSubmissionsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }

  if (!status) { res.status(400).json({ error: "status is required" }); return; }
  await db.update(customFormSubmissionsTable)
    .set({ status })
    .where(inArray(customFormSubmissionsTable.id, ids));
  res.json({ ok: true, affected: ids.length });
});

// ── DELETE /api/custom-forms/:id (auth) ───────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const role = req.user!.role ?? "";
  const roleCanDelete = ["owner", "admin"].includes(role);
  if (!roleCanDelete) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    const allowed = (permsRow?.permissions as Record<string, boolean> | null)?.["forms:delete"] === true;
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  await db.delete(customFormsTable).where(eq(customFormsTable.id, id));
  res.json({ ok: true });
});

// ── GET /api/custom-forms/:id/submissions (auth) ─────────────────────────────
router.get("/:id/submissions", requireReadAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const rows = await db
    .select()
    .from(customFormSubmissionsTable)
    .where(eq(customFormSubmissionsTable.formId, id))
    .orderBy(desc(customFormSubmissionsTable.submittedAt));
  res.json(rows);
});

// ── GET /api/custom-forms/public/:slug — public form data ─────────────────────
router.get("/public/:slug", async (req, res) => {
  const slug = req.params["slug"] as string;
  const [form] = await db.select().from(customFormsTable).where(eq(customFormsTable.slug, slug)).limit(1);
  if (!form || form.status !== "published") { res.status(404).json({ error: "Form not found" }); return; }
  res.json({
    id: form.id,
    name: form.name,
    description: form.description,
    fields: form.fields,
    submitButtonLabel: form.submitButtonLabel,
    successMessage: form.successMessage,
  });
});

// ── POST /api/custom-forms/:id/submit — public submit ────────────────────────
router.post("/:id/submit", formLimiter, honeypotCheck, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [form] = await db.select().from(customFormsTable).where(eq(customFormsTable.id, id)).limit(1);
  if (!form || form.status !== "published") { res.status(404).json({ error: "Form not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const fields = form.fields as CustomFormField[];

  // Validate required fields — skip display-only types
  for (const field of fields) {
    if (field.required && !DISPLAY_ONLY_TYPES.has(field.type)) {
      const val = body[field.id];
      const empty = val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
      if (empty) { res.status(400).json({ error: `"${field.label}" is required` }); return; }
    }
  }

  // Extract contact fields
  let submitterName: string | undefined;
  let submitterEmail: string | undefined;
  let submitterPhone: string | undefined;
  let submitterCompany: string | undefined;
  let submitterNotes: string | undefined;

  for (const field of fields) {
    const val = body[field.id];
    if (val === undefined || val === null || val === "") continue;
    // Skip signature data — too large for CRM fields
    if (field.type === "signature" || field.type === "contract_text") continue;
    const str = Array.isArray(val) ? (val as string[]).join(", ") : String(val);

    if (field.crmField === "name")    { submitterName    = submitterName    ?? str; continue; }
    if (field.crmField === "email")   { submitterEmail   = submitterEmail   ?? str; continue; }
    if (field.crmField === "phone")   { submitterPhone   = submitterPhone   ?? str; continue; }
    if (field.crmField === "company") { submitterCompany = submitterCompany ?? str; continue; }
    if (field.crmField === "notes")   { submitterNotes   = submitterNotes   ?? str; continue; }

    if (!field.crmField) {
      if ((field.type === "email" || field.type === "full_name") && !submitterEmail && field.type === "email") submitterEmail = str;
      if ((field.type === "full_name" || (field.label.toLowerCase().includes("name") && field.type === "short_text")) && !submitterName) submitterName = str;
      if (field.type === "phone" && !submitterPhone) submitterPhone = str;
      if (field.label.toLowerCase().includes("company") && !submitterCompany) submitterCompany = str;
    }
  }

  // Strip base64 signatures from stored data to keep DB rows small
  // Store a flag instead so the submission record reflects that a signature was provided
  const storedData: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(body)) {
    const field = fields.find(f => f.id === key);
    if (field?.type === "signature" && typeof val === "string" && val.length > 500) {
      storedData[key] = "[signature captured]";
    } else {
      storedData[key] = val;
    }
  }

  const [sub] = await db.insert(customFormSubmissionsTable).values({
    formId: form.id,
    data: storedData,
    submitterIp: req.ip,
    submitterName: submitterName ?? null,
    submitterEmail: submitterEmail ?? null,
  }).returning();

  if (form.createContact && (submitterName || submitterEmail)) {
    const [admin] = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
    if (admin) {
      const [contact] = await db.insert(contactsTable).values({
        name: submitterName ?? submitterEmail ?? "Unknown",
        email: submitterEmail ?? null,
        phone: submitterPhone ?? null,
        company: submitterCompany ?? null,
        notes: submitterNotes ? `Form submission notes:\n${submitterNotes}` : null,
        createdBy: admin.id,
      }).returning();

      if (form.createDeal && contact) {
        await db.insert(dealsTable).values({
          title: `${submitterName ?? submitterEmail} — ${form.name}`,
          stage: (form.dealStage as "lead") ?? "lead",
          contactId: contact.id,
          notes: `Source: Custom Form — ${form.name}`,
          createdBy: admin.id,
        });
      }
    }
  }

  void notifyAll(
    req.io ?? null,
    "form_submission",
    `New form submission: ${form.name}`,
    submitterName
      ? `${submitterName}${submitterEmail ? ` (${submitterEmail})` : ""} submitted "${form.name}"`
      : `New submission received for "${form.name}"`,
    `/forms`,
  );
  if (form.createdBy !== null) {
    void fireWebhook("form.submitted", {
      submissionId: sub!.id,
      formId: form.id,
      formName: form.name,
      submitterName: submitterName ?? null,
      submitterEmail: submitterEmail ?? null,
    }, form.createdBy);
  }
  logger.info({ formId: form.id, subId: sub!.id }, "Custom form submission received");
  res.status(201).json({ ok: true, submissionId: sub!.id, successMessage: form.successMessage });
});

// ── POST /api/custom-forms/:id/send-to-contact ─────────────────────────────
// Email the public form link directly to a CRM contact.
router.post("/:id/send-to-contact", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const SendBody = z.object({
    contactId:    z.number().int(),
    personalNote: z.string().max(1000).optional(),
  });
  const parse = SendBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid request body" }); return; }

  const [form] = await db.select().from(customFormsTable).where(eq(customFormsTable.id, id)).limit(1);
  if (!form) { res.status(404).json({ error: "Form not found" }); return; }
  if (form.status !== "published") {
    res.status(422).json({ error: "Form must be published before sending" }); return;
  }

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, parse.data.contactId)).limit(1);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
  if (!contact.email) { res.status(422).json({ error: "Contact has no email address" }); return; }

  const [smtp] = await db.select().from(userEmailSettingsTable).where(eq(userEmailSettingsTable.userId, req.user!.userId)).limit(1);
  if (!smtp?.smtpHost) { res.status(422).json({ error: "SMTP not configured", code: "NO_SMTP" }); return; }

  const [theme] = await db.select({ companyName: themeSettingsTable.companyName }).from(themeSettingsTable).limit(1);
  const companyName = theme?.companyName ?? "My Company";

  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  const baseUrl = domain
    ? `https://${domain}`
    : `${req.protocol}://${req.get("x-forwarded-host") ?? req.get("host")}`;
  const formUrl = `${baseUrl}/f/${form.slug}`;

  const isContract = (form.fields as { type: string }[]).some((f) =>
    ["signature", "contract_text", "legal_agreement"].includes(f.type),
  );
  const docType = isContract ? "contract" : "form";
  const btnLabel = isContract ? "Open & Sign Contract" : "Open Form";

  const transport = nodemailer.createTransport({
    host: smtp.smtpHost, port: smtp.smtpPort, secure: smtp.smtpSecure,
    auth: { user: smtp.smtpUser, pass: smtp.smtpPass },
  });

  await transport.sendMail({
    from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
    to: contact.email,
    subject: `${companyName} shared a ${docType} with you: ${form.name}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#1e293b">
        <p style="margin:0 0 16px">Hi ${contact.name ?? "there"},</p>
        <p style="margin:0 0 16px"><strong>${companyName}</strong> has shared a ${docType} with you: <strong>${form.name}</strong>.</p>
        ${parse.data.personalNote
          ? `<div style="margin:0 0 20px;padding:14px 16px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:4px;color:#475569;font-size:14px">${parse.data.personalNote.replace(/\n/g, "<br>")}</div>`
          : ""}
        <p style="margin:0 0 24px;color:#475569">Click the button below to open and complete it:</p>
        <a href="${formUrl}" style="display:inline-block;padding:13px 28px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">${btnLabel}</a>
        <p style="margin:24px 0 0;font-size:13px;color:#94a3b8">Or copy this link into your browser:<br><a href="${formUrl}" style="color:#3b82f6">${formUrl}</a></p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0">
        <p style="margin:0;font-size:12px;color:#94a3b8">${companyName}</p>
      </div>
    `,
  });

  logger.info({ formId: form.id, contactId: contact.id }, "Form link sent to contact");
  res.json({ ok: true, sentTo: contact.email });
});

export default router;
