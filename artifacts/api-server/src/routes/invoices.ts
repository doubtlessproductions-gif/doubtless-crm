import { Router } from "express";
import { z } from "zod";
import { eq, desc, and, lt, ne, sql, asc } from "drizzle-orm";
import {
  db, invoicesTable, contactsTable, dealsTable,
  userEmailSettingsTable, themeSettingsTable, usersTable, timeEntriesTable,
  userConnectionsTable,
  type InvoiceLineItem,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/auth.js";
import { auditLog } from "../lib/audit.js";
import nodemailer from "nodemailer";
import { buildInvoicePdf } from "../lib/invoice-pdf.js";
import { sendGraphEmail } from "../lib/microsoft-graph.js";
import { getUncachableStripeClient } from "../lib/stripe.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getNextInvoiceNumber(): Promise<string> {
  // Use MAX of the numeric suffix so deletions never cause reuse and the number
  // always increases. The UNIQUE constraint on invoices.number is the final
  // guard against race conditions.
  const [row] = await db
    .select({ max: sql<string>`MAX(CAST(SUBSTRING(number FROM 5) AS INTEGER))` })
    .from(invoicesTable);
  const num = ((Number(row?.max ?? 0)) + 1).toString().padStart(4, "0");
  return `INV-${num}`;
}

function recalc(lineItems: { description: string; quantity: number; rate: number; amount?: number }[], taxRate: number) {
  const items = lineItems.map((li) => ({
    description: li.description,
    quantity:    li.quantity,
    rate:        li.rate,
    amount:      +(li.quantity * li.rate).toFixed(2),
  }));
  const subtotal = +items.reduce((s, li) => s + li.amount, 0).toFixed(2);
  const taxAmount = +(subtotal * taxRate / 100).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);
  return { items, subtotal, taxAmount, total };
}

async function getSmtp(userId: number) {
  const [s] = await db.select().from(userEmailSettingsTable).where(eq(userEmailSettingsTable.userId, userId)).limit(1);
  return s ?? null;
}

// Auto-flag overdue: any "sent" invoice past its due date → "overdue"
async function flagOverdue() {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(invoicesTable)
    .set({ status: "overdue", updatedAt: new Date() })
    .where(
      and(
        eq(invoicesTable.status, "sent"),
        lt(invoicesTable.dueDate, today),
      ),
    );
}

function formatCurrency(n: number | string): string {
  return `$${Number(n).toFixed(2)}`;
}

/** Escape HTML entities to prevent XSS in server-rendered HTML */
function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Validate a URL is http/https only (prevents javascript: injection in src/href) */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch { return null; }
}

// ── Validation ────────────────────────────────────────────────────────────────

const LineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  rate: z.number().min(0),
  amount: z.number().min(0).optional(),
});

const InvoiceBody = z.object({
  contactId:    z.number().int(),
  dealId:       z.number().int().optional().nullable(),
  lineItems:    z.array(LineItemSchema).min(1),
  taxRate:      z.number().min(0).max(100).default(0),
  dueDate:      z.string().optional().nullable(),
  notes:        z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/invoices — list all, auto-flag overdue
router.get("/", requireAuth, async (_req, res) => {
  await flagOverdue();
  const rows = await db
    .select({
      id:           invoicesTable.id,
      number:       invoicesTable.number,
      contactId:    invoicesTable.contactId,
      contactName:  contactsTable.name,
      contactEmail: contactsTable.email,
      dealId:       invoicesTable.dealId,
      subtotal:     invoicesTable.subtotal,
      taxRate:      invoicesTable.taxRate,
      taxAmount:    invoicesTable.taxAmount,
      total:        invoicesTable.total,
      status:       invoicesTable.status,
      dueDate:      invoicesTable.dueDate,
      sentAt:       invoicesTable.sentAt,
      paidAt:       invoicesTable.paidAt,
      viewedAt:     invoicesTable.viewedAt,
      notes:        invoicesTable.notes,
      paymentTerms: invoicesTable.paymentTerms,
      createdBy:    invoicesTable.createdBy,
      createdAt:    invoicesTable.createdAt,
      updatedAt:    invoicesTable.updatedAt,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(rows);
});

// GET /api/invoices/contact/:contactId — invoices for one contact
router.get("/contact/:contactId", requireAuth, async (req, res) => {
  await flagOverdue();
  const contactId = parseInt(req.params["contactId"] as string);
  const rows = await db
    .select({
      id:       invoicesTable.id,
      number:   invoicesTable.number,
      total:    invoicesTable.total,
      status:   invoicesTable.status,
      dueDate:  invoicesTable.dueDate,
      sentAt:   invoicesTable.sentAt,
      paidAt:   invoicesTable.paidAt,
      createdAt: invoicesTable.createdAt,
    })
    .from(invoicesTable)
    .where(eq(invoicesTable.contactId, contactId))
    .orderBy(desc(invoicesTable.createdAt));
  res.json(rows);
});

// GET /api/invoices/view/:token — public hosted invoice view (HTML, no auth)
router.get("/view/:token", async (req, res) => {
  const token = req.params["token"] as string;
  const [row] = await db
    .select({
      inv:         invoicesTable,
      contactName: contactsTable.name,
      contactEmail: contactsTable.email,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(eq(invoicesTable.viewToken, token))
    .limit(1);
  if (!row) { res.status(404).send("<p style='font-family:sans-serif;padding:2rem'>Invoice not found or link has expired.</p>"); return; }

  // Record view timestamp by primary key (fire-and-forget; never blocks the response)
  db.update(invoicesTable)
    .set({ viewedAt: new Date(), updatedAt: new Date() })
    .where(eq(invoicesTable.id, row.inv.id))
    .catch((err: unknown) => logger.error({ err }, "Failed to record invoice view timestamp"));

  const [theme] = await db.select({ companyName: themeSettingsTable.companyName, logoUrl: themeSettingsTable.logoUrl }).from(themeSettingsTable).limit(1);
  const companyName = theme?.companyName ?? "My Company";
  const logoUrl     = theme?.logoUrl ?? null;
  const inv   = row.inv;
  const items = (inv.lineItems ?? []) as InvoiceLineItem[];

  const statusColors: Record<string, string> = { draft: "#94a3b8", sent: "#3b82f6", paid: "#22c55e", overdue: "#ef4444" };
  const sColor = statusColors[inv.status] ?? "#94a3b8";

  const safeLogoUrl = safeUrl(logoUrl);
  const rowsHtml = items.map((li) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${esc(li.description)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center">${esc(String(li.quantity))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right">${esc(formatCurrency(li.rate))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600">${esc(formatCurrency(li.amount))}</td>
    </tr>`).join("");

  const isPayable = inv.status === "sent" || inv.status === "overdue";
  const isPaid    = inv.status === "paid";
  const payUrl    = `/api/invoices/pay/${token}`;

  const paidBannerHtml = isPaid
    ? `<div style="margin:0 40px 0;padding:14px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">✓</span>
        <div>
          <div style="font-weight:600;color:#166534">Payment received</div>
          ${inv.paidAt ? `<div style="font-size:12px;color:#15803d">Paid on ${esc(new Date(inv.paidAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}))}</div>` : ""}
        </div>
      </div>`
    : "";

  const payNowHtml = isPayable
    ? `<div style="margin:24px 40px 0;text-align:center">
        <form action="${esc(payUrl)}" method="POST">
          <button type="submit" style="display:inline-block;padding:14px 36px;background:#3b82f6;color:#fff;font-size:15px;font-weight:600;border:none;border-radius:8px;cursor:pointer;letter-spacing:.01em">
            Pay ${esc(formatCurrency(inv.total))} Now
          </button>
        </form>
        <div style="margin-top:8px;font-size:12px;color:#94a3b8">Secure payment via Stripe</div>
      </div>`
    : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src 'none'; script-src 'none'; form-action 'self'");
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(inv.number)}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b">
<div style="max-width:720px;margin:40px auto;background:#fff;border-radius:12px;box-shadow:0 1px 8px rgba(0,0,0,.08);overflow:hidden">
  <div style="padding:32px 40px 24px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      ${safeLogoUrl ? `<img src="${esc(safeLogoUrl)}" alt="${esc(companyName)}" style="height:48px;margin-bottom:8px;display:block">` : ""}
      <div style="font-size:${safeLogoUrl ? "14px" : "22px"};font-weight:${safeLogoUrl ? "400" : "700"};color:#1e293b">${esc(companyName)}</div>
      ${!safeLogoUrl ? `<div style="font-size:13px;color:#64748b;margin-top:2px">Invoice</div>` : ""}
    </div>
    <div style="text-align:right">
      <div style="font-size:22px;font-weight:700">${esc(inv.number)}</div>
      <div style="display:inline-block;padding:3px 10px;border-radius:999px;background:${sColor}22;color:${sColor};font-size:12px;font-weight:600;margin-top:4px">${esc(inv.status.toUpperCase())}</div>
    </div>
  </div>
  ${paidBannerHtml ? `<div style="padding:16px 0 0">${paidBannerHtml}</div>` : ""}
  <div style="padding:24px 40px;display:flex;justify-content:space-between;border-bottom:1px solid #f1f5f9">
    <div>
      <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em">Bill To</div>
      <div style="font-size:15px;font-weight:600;margin-top:4px">${esc(row.contactName ?? "Client")}</div>
      ${row.contactEmail ? `<div style="font-size:13px;color:#64748b">${esc(row.contactEmail)}</div>` : ""}
    </div>
    <div style="text-align:right;font-size:13px">
      <div style="color:#64748b">Issue Date</div><div style="margin-bottom:8px">${esc(new Date(inv.createdAt).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}))}</div>
      ${inv.dueDate ? `<div style="color:#64748b">Due Date</div><div>${esc(new Date(inv.dueDate).toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"}))}</div>` : ""}
    </div>
  </div>
  <div style="padding:24px 40px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#f8fafc">
        <th style="padding:8px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Description</th>
        <th style="padding:8px 12px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Qty</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Rate</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Amount</th>
      </tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:16px;text-align:right;font-size:14px">
      <div style="color:#64748b">Subtotal: <strong style="color:#1e293b">${esc(formatCurrency(inv.subtotal))}</strong></div>
      ${Number(inv.taxRate) > 0 ? `<div style="color:#64748b">Tax (${esc(String(inv.taxRate))}%): <strong style="color:#1e293b">${esc(formatCurrency(inv.taxAmount))}</strong></div>` : ""}
      <div style="font-size:18px;font-weight:700;margin-top:8px">Total: ${esc(formatCurrency(inv.total))}</div>
    </div>
    ${inv.notes ? `<div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569">${esc(inv.notes)}</div>` : ""}
    ${inv.paymentTerms ? `<div style="margin-top:8px;font-size:12px;color:#94a3b8">Payment Terms: ${esc(inv.paymentTerms)}</div>` : ""}
  </div>
  ${payNowHtml}
  <div style="padding:${isPayable ? "16px" : "16px"} 40px;margin-top:${isPayable ? "24px" : "0"};background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center">
    This invoice was sent by ${esc(companyName)}. Please contact us if you have any questions.
  </div>
</div>
</body></html>`);
});

// POST /api/invoices/pay/:token — create Stripe Checkout Session and redirect (no auth, public)
router.post("/pay/:token", async (req, res) => {
  const token = req.params["token"] as string;

  const [row] = await db
    .select({
      inv:         invoicesTable,
      contactName: contactsTable.name,
      contactEmail: contactsTable.email,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(eq(invoicesTable.viewToken, token))
    .limit(1);

  if (!row) {
    res.status(404).send("<p style='font-family:sans-serif;padding:2rem'>Invoice not found.</p>");
    return;
  }

  const inv = row.inv;

  if (inv.status === "paid") {
    res.redirect(303, `/api/invoices/view/${token}`);
    return;
  }

  if (inv.status === "draft") {
    res.status(400).send("<p style='font-family:sans-serif;padding:2rem'>This invoice is not yet available for payment.</p>");
    return;
  }

  const stripe = await getUncachableStripeClient();
  if (!stripe) {
    logger.warn("Stripe client unavailable when creating checkout session for invoice");
    res.status(503).send("<p style='font-family:sans-serif;padding:2rem'>Online payment is not available right now. Please contact us to arrange payment.</p>");
    return;
  }

  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  const baseUrl = domain
    ? `https://${domain}`
    : `${req.protocol}://${req.get("x-forwarded-host") ?? req.get("host")}`;
  const viewUrl = `${baseUrl}/api/invoices/view/${token}`;

  const totalCents = Math.round(Number(inv.total) * 100);
  if (totalCents <= 0) {
    res.status(400).send("<p style='font-family:sans-serif;padding:2rem'>This invoice has a zero total and cannot be paid online.</p>");
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Invoice ${inv.number}` },
            unit_amount: totalCents,
          },
          quantity: 1,
        },
      ],
      customer_email: row.contactEmail ?? undefined,
      metadata: {
        invoiceId:     inv.id.toString(),
        invoiceNumber: inv.number,
      },
      success_url: `${viewUrl}?paid=1`,
      cancel_url:  viewUrl,
    });

    await db
      .update(invoicesTable)
      .set({ stripeCheckoutSessionId: session.id, updatedAt: new Date() })
      .where(eq(invoicesTable.id, inv.id));

    logger.info({ invoiceId: inv.id, sessionId: session.id }, "Stripe Checkout session created for invoice");

    res.redirect(303, session.url!);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error({ err, invoiceId: inv.id }, "Failed to create Stripe Checkout session");
    res.status(500).send(`<p style='font-family:sans-serif;padding:2rem'>Payment could not be initiated: ${esc(msg)}</p>`);
  }
});

// GET /api/invoices/deal/:dealId/time-entries — time entries for a deal (for invoice import)
router.get("/deal/:dealId/time-entries", requireAuth, async (req, res) => {
  const dealId = parseInt(req.params["dealId"] as string);
  if (isNaN(dealId)) { res.status(400).json({ error: "Invalid dealId" }); return; }
  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.dealId, dealId))
    .orderBy(asc(timeEntriesTable.date));
  res.json(entries);
});

// POST /api/invoices
router.post("/", requireAuth, async (req, res) => {
  const parse = InvoiceBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, d.contactId)).limit(1);
  if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }

  const { items, subtotal, taxAmount, total } = recalc(d.lineItems, d.taxRate);
  const number = await getNextInvoiceNumber();

  const [inv] = await db.insert(invoicesTable).values({
    contactId:    d.contactId,
    dealId:       d.dealId ?? null,
    number,
    viewToken:    randomUUID(),
    lineItems:    items,
    subtotal:     subtotal.toString(),
    taxRate:      d.taxRate.toString(),
    taxAmount:    taxAmount.toString(),
    total:        total.toString(),
    status:       "draft",
    dueDate:      d.dueDate ?? null,
    notes:        d.notes ?? null,
    paymentTerms: d.paymentTerms ?? null,
    createdBy:    req.user!.userId,
  }).returning();

  void auditLog({ userId: req.user!.userId, action: "invoice.created", entityType: "invoice", entityId: inv!.id, entityLabel: inv!.number, req });
  res.status(201).json(inv);
});

// GET /api/invoices/:id/view-link — public view URL + SMTP status for send dialog
router.get("/:id/view-link", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db
    .select({
      inv:          invoicesTable,
      contactEmail: contactsTable.email,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

  let viewToken = row.inv.viewToken;
  if (!viewToken) {
    viewToken = randomUUID();
    await db.update(invoicesTable).set({ viewToken }).where(eq(invoicesTable.id, id));
  }

  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  const baseUrl = domain
    ? `https://${domain}`
    : `${req.protocol}://${req.get("x-forwarded-host") ?? req.get("host")}`;
  const viewUrl = `${baseUrl}/api/invoices/view/${viewToken}`;

  const smtp = await getSmtp(req.user!.userId);
  const smtpConfigured = !!(smtp?.smtpHost);

  const [outlookRow] = await db
    .select({ displayName: userConnectionsTable.displayName, credentials: userConnectionsTable.credentials })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, req.user!.userId), eq(userConnectionsTable.provider, "outlook")))
    .limit(1);
  const outlookConnected = !!outlookRow?.credentials;
  const outlookEmail = outlookConnected
    ? ((outlookRow!.credentials as Record<string, unknown>)["email"] as string | undefined) ?? outlookRow!.displayName ?? null
    : null;

  const [theme] = await db.select({ companyName: themeSettingsTable.companyName }).from(themeSettingsTable).limit(1);
  const companyName = theme?.companyName ?? "My Company";

  res.json({ viewUrl, contactEmail: row.contactEmail ?? null, smtpConfigured, outlookConnected, outlookEmail, companyName });
});

// GET /api/invoices/:id — single invoice with line items
router.get("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db
    .select({
      id:           invoicesTable.id,
      number:       invoicesTable.number,
      contactId:    invoicesTable.contactId,
      contactName:  contactsTable.name,
      contactEmail: contactsTable.email,
      dealId:       invoicesTable.dealId,
      lineItems:    invoicesTable.lineItems,
      subtotal:     invoicesTable.subtotal,
      taxRate:      invoicesTable.taxRate,
      taxAmount:    invoicesTable.taxAmount,
      total:        invoicesTable.total,
      status:       invoicesTable.status,
      dueDate:      invoicesTable.dueDate,
      sentAt:       invoicesTable.sentAt,
      paidAt:       invoicesTable.paidAt,
      notes:        invoicesTable.notes,
      paymentTerms: invoicesTable.paymentTerms,
      createdBy:    invoicesTable.createdBy,
      createdAt:    invoicesTable.createdAt,
      updatedAt:    invoicesTable.updatedAt,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  res.json(row);
});

// PUT /api/invoices/:id — update (draft only)
router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = InvoiceBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const d = parse.data;

  const [existing] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (existing.status !== "draft") {
    res.status(409).json({ error: "Only draft invoices can be edited." }); return;
  }

  const { items, subtotal, taxAmount, total } = recalc(d.lineItems, d.taxRate);

  const [inv] = await db.update(invoicesTable).set({
    contactId:    d.contactId,
    dealId:       d.dealId ?? null,
    lineItems:    items,
    subtotal:     subtotal.toString(),
    taxRate:      d.taxRate.toString(),
    taxAmount:    taxAmount.toString(),
    total:        total.toString(),
    dueDate:      d.dueDate ?? null,
    notes:        d.notes ?? null,
    paymentTerms: d.paymentTerms ?? null,
    updatedAt:    new Date(),
  }).where(eq(invoicesTable.id, id)).returning();

  void auditLog({ userId: req.user!.userId, action: "invoice.updated", entityType: "invoice", entityId: id, entityLabel: existing.number, req });
  res.json(inv);
});

// DELETE /api/invoices/:id
router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [inv] = await db.select({ number: invoicesTable.number }).from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
  await db.delete(invoicesTable).where(eq(invoicesTable.id, id));
  void auditLog({ userId: req.user!.userId, action: "invoice.deleted", entityType: "invoice", entityId: id, entityLabel: inv.number, req });
  res.status(204).send();
});

// GET /api/invoices/:id/pdf — download PDF
router.get("/:id/pdf", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db
    .select({
      inv:         invoicesTable,
      contactName: contactsTable.name,
      contactEmail: contactsTable.email,
    })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }

  const [theme] = await db.select({ companyName: themeSettingsTable.companyName, logoUrl: themeSettingsTable.logoUrl }).from(themeSettingsTable).limit(1);
  const companyName = theme?.companyName ?? "My Company";
  const logoUrl = theme?.logoUrl ?? null;

  try {
    const pdf = await buildInvoicePdf(row.inv, row.contactName ?? "Client", row.contactEmail ?? null, companyName, logoUrl);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.inv.number}.pdf"`);
    res.send(pdf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "PDF generation failed";
    res.status(500).json({ error: msg });
  }
});

const SendInvoiceBody = z.object({
  subject: z.string().optional(),
  message: z.string().optional(),
});

// POST /api/invoices/:id/send — render PDF + email to contact
// Tries Outlook (Graph API) first, falls back to SMTP.
router.post("/:id/send", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parsed = SendInvoiceBody.safeParse(req.body);
  const customSubject = parsed.success ? parsed.data.subject : undefined;
  const customMessage = parsed.success ? parsed.data.message : undefined;

  const [row] = await db
    .select({ inv: invoicesTable, contactName: contactsTable.name, contactEmail: contactsTable.email })
    .from(invoicesTable)
    .leftJoin(contactsTable, eq(invoicesTable.contactId, contactsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (row.inv.status === "paid") { res.status(409).json({ error: "Paid invoices cannot be re-sent." }); return; }
  if (!row.contactEmail) { res.status(422).json({ error: "Contact has no email address" }); return; }

  const [theme] = await db.select({ companyName: themeSettingsTable.companyName, logoUrl: themeSettingsTable.logoUrl }).from(themeSettingsTable).limit(1);
  const companyName = theme?.companyName ?? "My Company";
  const logoUrl = theme?.logoUrl ?? null;

  let viewToken = row.inv.viewToken;
  if (!viewToken) {
    viewToken = randomUUID();
    await db.update(invoicesTable).set({ viewToken }).where(eq(invoicesTable.id, id));
  }

  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  const baseUrl = domain ? `https://${domain}` : `${req.protocol}://${req.get("x-forwarded-host") ?? req.get("host")}`;
  const viewUrl = `${baseUrl}/api/invoices/view/${viewToken}`;

  const subject = customSubject ?? `Invoice ${row.inv.number} from ${companyName}`;

  const standardBody = [
    `Hi ${esc(row.contactName ?? "there")},`,
    `Please find your invoice <strong>${esc(row.inv.number)}</strong> for <strong>${formatCurrency(row.inv.total)}</strong> attached as a PDF.`,
    row.inv.dueDate ? `Payment is due by <strong>${new Date(row.inv.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</strong>.` : null,
    row.inv.paymentTerms ? `Payment Terms: ${esc(row.inv.paymentTerms)}` : null,
    `You can also <a href="${viewUrl}" style="color:#3b82f6;font-weight:600">view this invoice online</a>.`,
    `Thank you for your business.`,
    `${esc(companyName)}`,
  ].filter(Boolean).map((l) => `<p>${l}</p>`).join("\n");

  const trimmedNote = customMessage?.trim() ?? "";
  const personalNote = trimmedNote
    ? trimmedNote
        .split(/\r?\n/)
        .map((line) => `<p>${esc(line)}</p>`)
        .join("\n") + "\n<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:16px 0\">\n"
    : "";

  const defaultMsg = personalNote + standardBody;

  // ── Pre-check: verify a sender is available before building the PDF ──────────
  const [outlookConn] = await db
    .select({ credentials: userConnectionsTable.credentials })
    .from(userConnectionsTable)
    .where(and(eq(userConnectionsTable.userId, req.user!.userId), eq(userConnectionsTable.provider, "outlook")))
    .limit(1);
  const hasOutlook = !!outlookConn?.credentials;
  const smtp = await getSmtp(req.user!.userId);
  if (!hasOutlook && !smtp?.smtpHost) {
    res.status(422).json({ error: "No email sender configured. Connect your Outlook account or configure SMTP in Settings.", code: "NO_SENDER" });
    return;
  }

  try {
    const pdf = await buildInvoicePdf(row.inv, row.contactName ?? "Client", row.contactEmail, companyName, logoUrl);

    // ── Try Outlook / Graph API first ──────────────────────────────────────────
    const graphSent = await sendGraphEmail(req.user!.userId, {
      to: row.contactEmail,
      subject,
      html: defaultMsg,
      attachments: [{ filename: `${row.inv.number}.pdf`, content: pdf, contentType: "application/pdf" }],
    });

    // ── Fall back to SMTP if Graph unavailable ─────────────────────────────────
    if (!graphSent) {
      if (!smtp?.smtpHost) {
        res.status(422).json({ error: "No email sender configured. Connect your Outlook account or configure SMTP in Settings.", code: "NO_SENDER" });
        return;
      }
      const transport = nodemailer.createTransport({
        host: smtp.smtpHost, port: smtp.smtpPort, secure: smtp.smtpSecure,
        auth: { user: smtp.smtpUser, pass: smtp.smtpPass },
      });
      await transport.sendMail({
        from: `"${smtp.fromName}" <${smtp.fromEmail}>`,
        to: row.contactEmail,
        subject,
        html: defaultMsg,
        attachments: [{ filename: `${row.inv.number}.pdf`, content: pdf, contentType: "application/pdf" }],
      });
    }

    await db.update(invoicesTable)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(invoicesTable.id, id));

    void auditLog({ userId: req.user!.userId, action: "invoice.sent", entityType: "invoice", entityId: id, entityLabel: row.inv.number, metadata: { to: row.contactEmail }, req });
    res.json({ ok: true, sentTo: row.contactEmail });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Send failed";
    res.status(500).json({ error: msg });
  }
});

// POST /api/invoices/:id/mark-paid
router.post("/:id/mark-paid", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
  if (inv.status === "paid") { res.json({ ok: true }); return; }

  await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(invoicesTable.id, id));

  void auditLog({ userId: req.user!.userId, action: "invoice.marked_paid", entityType: "invoice", entityId: id, entityLabel: inv.number, req });
  res.json({ ok: true });
});

export default router;
