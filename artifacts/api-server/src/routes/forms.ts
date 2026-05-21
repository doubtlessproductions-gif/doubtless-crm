// Forms routes — public client intake + internal staff invoice + general inquiry
import { Router } from "express";
import { db, formSubmissionsTable, contactsTable, dealsTable, usersTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { formLimiter, honeypotCheck } from "../middlewares/security.js";
import { z } from "zod";

const router = Router();

const SERVICE_TYPES = ["Artist roster", "Live show", "Merch", "Mixing", "Recording", "Video"] as const;
const GENRES = ["Hip-Hop/Rap", "R&B/Soul", "Pop", "Rock", "Electronic/EDM", "Country", "Gospel/Christian", "Jazz", "Classical", "Latin", "Reggae/Dancehall", "Afrobeats", "Other"] as const;

// ── GET system user (first admin) for auto-creating records ──────────────────
async function getSystemUserId(): Promise<number> {
  const [admin] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .limit(1);
  if (!admin) throw new Error("No users in system");
  return admin.id;
}

// ── POST /api/forms/intake — PUBLIC, rate-limited + honeypot ─────────────────
const IntakeBody = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(254),
  artistName: z.string().max(200).optional().default(""),
  phone: z.string().max(30).optional().default(""),
  primaryGenre: z.string().max(100).optional().default(""),
  musicLink: z.string().max(500).optional().default(""),
  socialLinks: z.string().max(500).optional().default(""),
  serviceType: z.string().max(100).optional().default(""),
  _hp: z.string().optional(), // honeypot field
});

router.post("/intake", formLimiter, honeypotCheck, async (req, res) => {
  const parse = IntakeBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const systemUserId = await getSystemUserId();
  const fullName = `${d.firstName} ${d.lastName}`.trim();

  const tags: string[] = [];
  if (d.primaryGenre) tags.push(d.primaryGenre);
  if (d.serviceType) tags.push(d.serviceType);

  const [contact] = await db.insert(contactsTable).values({
    name: fullName,
    email: d.email,
    phone: d.phone || null,
    company: d.artistName || null,
    tags,
    notes: [
      d.musicLink ? `Music Link: ${d.musicLink}` : null,
      d.socialLinks ? `Social: ${d.socialLinks}` : null,
    ].filter(Boolean).join("\n") || null,
    createdBy: systemUserId,
  }).returning();

  const [deal] = await db.insert(dealsTable).values({
    title: `${d.artistName || fullName} — ${d.serviceType || "Inquiry"}`,
    stage: "lead",
    contactId: contact!.id,
    notes: `Source: Client Intake Form\nService: ${d.serviceType}\nGenre: ${d.primaryGenre}`,
    createdBy: systemUserId,
  }).returning();

  const [submission] = await db.insert(formSubmissionsTable).values({
    formType: "contact_intake",
    status: "new",
    data: d as unknown as Record<string, unknown>,
    contactId: contact!.id,
    dealId: deal!.id,
    submitterName: fullName,
    submitterEmail: d.email,
    serviceType: d.serviceType || null,
  }).returning();

  res.status(201).json({ ok: true, submissionId: submission!.id, contactId: contact!.id, dealId: deal!.id });
});

// ── POST /api/forms/invoice — auth required ──────────────────────────────────
const InvoiceBody = z.object({
  staffRequested: z.string().min(1).max(200),
  serviceType: z.enum(SERVICE_TYPES),
  date: z.string().min(1),
  invoicePrice: z.coerce.number().positive().max(1_000_000),
  paymentType: z.array(z.string()).min(1),
  otherInfo: z.string().max(2000).optional().default(""),
});

router.post("/invoice", requireAuth, async (req, res) => {
  const parse = InvoiceBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const [deal] = await db.insert(dealsTable).values({
    title: `${d.serviceType} — ${d.staffRequested}`,
    value: d.invoicePrice.toString(),
    stage: "proposal",
    notes: [
      `Service: ${d.serviceType}`,
      `Staff: ${d.staffRequested}`,
      `Date: ${d.date}`,
      `Payment: ${d.paymentType.join(", ")}`,
      d.otherInfo ? `Notes: ${d.otherInfo}` : null,
    ].filter(Boolean).join("\n"),
    createdBy: req.user!.userId,
  }).returning();

  const [submission] = await db.insert(formSubmissionsTable).values({
    formType: "staff_invoice",
    status: "new",
    data: d as unknown as Record<string, unknown>,
    dealId: deal!.id,
    submitterName: d.staffRequested,
    serviceType: d.serviceType,
    invoiceAmount: d.invoicePrice.toString(),
    notes: d.otherInfo || null,
  }).returning();

  res.status(201).json({ ok: true, submissionId: submission!.id, dealId: deal!.id });
});

// ── GET /api/forms/submissions — list all (auth required) ────────────────────
router.get("/submissions", requireReadAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(formSubmissionsTable)
    .orderBy(desc(formSubmissionsTable.submittedAt))
    .limit(200);
  res.json(rows);
});

// ── GET /api/forms/submissions/export.csv ────────────────────────────────────
router.get("/submissions/export.csv", requireAuth, async (_req, res) => {
  const rows = await db
    .select()
    .from(formSubmissionsTable)
    .orderBy(desc(formSubmissionsTable.submittedAt));

  function csvRow(vals: (string | number | null | undefined)[]): string {
    return vals.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
  }

  const lines = [
    csvRow(["ID", "Type", "Status", "Submitter Name", "Submitter Email", "Service Type", "Invoice Amount", "Notes", "Submitted At"]),
    ...rows.map(r => csvRow([
      r.id, r.formType, r.status,
      r.submitterName, r.submitterEmail,
      r.serviceType, r.invoiceAmount, r.notes,
      r.submittedAt.toISOString(),
    ])),
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="form-submissions.csv"`);
  res.send(lines.join("\n"));
});

// ── PATCH /api/forms/submissions/bulk ─────────────────────────────────────────
router.patch("/submissions/bulk", requireAuth, async (req, res) => {
  const parse = z.object({
    ids:    z.array(z.number().int().positive()).min(1).max(500),
    status: z.enum(["new", "reviewed", "processed"]),
  }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { ids, status } = parse.data;
  await db.update(formSubmissionsTable).set({ status }).where(inArray(formSubmissionsTable.id, ids));
  res.json({ ok: true, affected: ids.length });
});

// ── GET /api/forms/submissions/:id ───────────────────────────────────────────
router.get("/submissions/:id", requireReadAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db.select().from(formSubmissionsTable).where(eq(formSubmissionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ── PATCH /api/forms/submissions/:id — update status ─────────────────────────
router.patch("/submissions/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = z.object({ status: z.enum(["new", "reviewed", "processed"]) }).safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const [updated] = await db
    .update(formSubmissionsTable)
    .set({ status: parse.data.status })
    .where(eq(formSubmissionsTable.id, id))
    .returning();
  res.json(updated);
});

// ── POST /api/forms/inquiry — PUBLIC, rate-limited + honeypot ────────────────
const InquiryBody = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(254),
  serviceType: z.string().min(1).max(100),
  sessionNotes: z.string().max(2000).optional().default(""),
  _hp: z.string().optional(), // honeypot field
});

router.post("/inquiry", formLimiter, honeypotCheck, async (req, res) => {
  const parse = InquiryBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const systemUserId = await getSystemUserId();
  const fullName = `${d.firstName} ${d.lastName}`.trim();

  const [contact] = await db.insert(contactsTable).values({
    name: fullName,
    email: d.email,
    tags: [d.serviceType],
    notes: d.sessionNotes ? `Session notes: ${d.sessionNotes}` : null,
    createdBy: systemUserId,
  }).returning();

  const [deal] = await db.insert(dealsTable).values({
    title: `${fullName} — ${d.serviceType}`,
    stage: "lead",
    contactId: contact!.id,
    notes: `Source: General Inquiry Form\nService: ${d.serviceType}${d.sessionNotes ? `\nNotes: ${d.sessionNotes}` : ""}`,
    createdBy: systemUserId,
  }).returning();

  const [submission] = await db.insert(formSubmissionsTable).values({
    formType: "general_inquiry",
    status: "new",
    data: d as unknown as Record<string, unknown>,
    contactId: contact!.id,
    dealId: deal!.id,
    submitterName: fullName,
    submitterEmail: d.email,
    serviceType: d.serviceType,
    notes: d.sessionNotes || null,
  }).returning();

  res.status(201).json({ ok: true, submissionId: submission!.id, contactId: contact!.id, dealId: deal!.id });
});

export { SERVICE_TYPES, GENRES };
export default router;
