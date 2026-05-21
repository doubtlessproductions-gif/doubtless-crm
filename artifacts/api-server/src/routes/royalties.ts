import { Router } from "express";
import { z } from "zod/v4";
import { eq, and, desc, sum } from "drizzle-orm";
import { db, royaltiesTable, royaltySplitsTable, contactsTable, artistsTable } from "@workspace/db";
import { requireAuth, requireReadAuth, requireRole } from "../middlewares/auth.js";
import { sendNotificationEmail } from "../lib/notify-email.js";

const router = Router();

const RoyaltyBody = z.object({
  artistId:    z.coerce.number().int().positive(),
  releaseId:   z.coerce.number().int().positive().optional(),
  periodStart: z.string().min(1),
  periodEnd:   z.string().min(1),
  streamCount: z.coerce.number().int().nonnegative().default(0),
  grossCents:  z.coerce.number().int().nonnegative().default(0),
  netCents:    z.coerce.number().int().nonnegative().default(0),
  splitPct:    z.coerce.number().int().min(0).max(100).default(50),
  status:      z.enum(["pending", "processing", "paid", "disputed"]).optional(),
  notes:       z.string().optional(),
});

// GET /royalties
router.get("/", requireReadAuth, async (req, res) => {
  try {
    const where = [];
    if (req.query.artistId)  where.push(eq(royaltiesTable.artistId, Number(req.query.artistId)));
    if (req.query.releaseId) where.push(eq(royaltiesTable.releaseId, Number(req.query.releaseId)));
    if (req.query.status)    where.push(eq(royaltiesTable.status, req.query.status as "pending" | "processing" | "paid" | "disputed"));

    const rows = await db.select().from(royaltiesTable)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(royaltiesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "listRoyalties failed");
    res.status(500).json({ error: "Failed to list royalties" });
  }
});

// POST /royalties
router.post("/", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const parsed = RoyaltyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;
  try {
    const [row] = await db.insert(royaltiesTable).values({
      artistId:    d.artistId,
      releaseId:   d.releaseId ?? null,
      periodStart: d.periodStart,
      periodEnd:   d.periodEnd,
      streamCount: d.streamCount,
      grossCents:  d.grossCents,
      netCents:    d.netCents,
      splitPct:    d.splitPct,
      status:      d.status ?? "pending",
      notes:       d.notes ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createRoyalty failed");
    res.status(500).json({ error: "Failed to create royalty record" });
  }
});

// GET /royalties/:id
router.get("/:id", requireReadAuth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.select().from(royaltiesTable).where(eq(royaltiesTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "getRoyalty failed");
    res.status(500).json({ error: "Failed to get royalty record" });
  }
});

// PUT /royalties/:id
router.put("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = RoyaltyBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  const updates: Record<string, unknown> = { ...d };
  if (d.status === "paid" && !("paidAt" in d)) {
    updates.paidAt = new Date();
  }

  try {
    const [row] = await db.update(royaltiesTable)
      .set(updates)
      .where(eq(royaltiesTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "updateRoyalty failed");
    res.status(500).json({ error: "Failed to update royalty record" });
  }
});

// DELETE /royalties/:id
router.delete("/:id", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [row] = await db.delete(royaltiesTable).where(eq(royaltiesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteRoyalty failed");
    res.status(500).json({ error: "Failed to delete royalty record" });
  }
});

// ── Splits ────────────────────────────────────────────────────────────────────

const SplitBody = z.object({
  contactId:  z.coerce.number().int().positive().optional(),
  name:       z.string().min(1),
  percentage: z.coerce.number().int().min(1).max(100),
});

// GET /royalties/:id/splits
router.get("/:id/splits", requireReadAuth, async (req, res) => {
  const royaltyId = Number(req.params.id);
  try {
    const splits = await db.select().from(royaltySplitsTable)
      .where(eq(royaltySplitsTable.royaltyId, royaltyId))
      .orderBy(royaltySplitsTable.createdAt);
    res.json(splits);
  } catch (err) {
    req.log.error({ err }, "listSplits failed");
    res.status(500).json({ error: "Failed to list splits" });
  }
});

// POST /royalties/:id/splits
router.post("/:id/splits", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const royaltyId = Number(req.params.id);
  const parsed = SplitBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const d = parsed.data;

  try {
    const [royalty] = await db.select().from(royaltiesTable).where(eq(royaltiesTable.id, royaltyId));
    if (!royalty) { res.status(404).json({ error: "Royalty not found" }); return; }

    const existing = await db.select({ pct: royaltySplitsTable.percentage })
      .from(royaltySplitsTable).where(eq(royaltySplitsTable.royaltyId, royaltyId));
    const used = existing.reduce((s, r) => s + r.pct, 0);
    if (used + d.percentage > 100) {
      res.status(400).json({ error: `Adding ${d.percentage}% would exceed 100% (${used}% already allocated)` });
      return;
    }

    const [row] = await db.insert(royaltySplitsTable).values({
      royaltyId,
      contactId: d.contactId ?? null,
      name:      d.name,
      percentage: d.percentage,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "createSplit failed");
    res.status(500).json({ error: "Failed to create split" });
  }
});

// DELETE /royalties/:id/splits/:splitId
router.delete("/:id/splits/:splitId", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const splitId = Number(req.params.splitId);
  try {
    const [row] = await db.delete(royaltySplitsTable).where(eq(royaltySplitsTable.id, splitId)).returning();
    if (!row) { res.status(404).json({ error: "Split not found" }); return; }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteSplit failed");
    res.status(500).json({ error: "Failed to delete split" });
  }
});

// ── Statement generation ──────────────────────────────────────────────────────

function buildStatementHtml(opts: {
  companyName: string;
  collaboratorName: string;
  collaboratorEmail: string | null;
  artistName: string;
  periodStart: string;
  periodEnd: string;
  grossCents: number;
  netCents: number;
  percentage: number;
  streamCount: number;
  status: string;
  generatedAt: string;
}): string {
  const fmt$ = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const payout = Math.round(opts.netCents * opts.percentage / 100);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Royalty Statement — ${opts.collaboratorName}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1a1a1a; background: #fff; padding: 48px; max-width: 720px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #18181b; padding-bottom: 24px; margin-bottom: 32px; }
  .company { font-size: 22px; font-weight: 700; color: #18181b; }
  .doc-title { font-size: 13px; color: #71717a; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  .meta { text-align: right; font-size: 13px; color: #52525b; line-height: 1.7; }
  .section { margin-bottom: 28px; }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a; margin-bottom: 12px; border-bottom: 1px solid #e4e4e7; padding-bottom: 6px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f4f4f5; font-size: 14px; }
  .row:last-child { border-bottom: none; }
  .row .label { color: #52525b; }
  .row .value { font-weight: 500; }
  .payout-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .payout-label { font-size: 14px; color: #166534; font-weight: 600; }
  .payout-amount { font-size: 28px; font-weight: 800; color: #15803d; }
  .footer { margin-top: 48px; font-size: 12px; color: #a1a1aa; border-top: 1px solid #e4e4e7; padding-top: 16px; line-height: 1.6; }
  .status-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; text-transform: capitalize; background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  @media print {
    body { padding: 32px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="no-print" style="background:#f4f4f5;border-radius:6px;padding:10px 16px;margin-bottom:24px;font-size:13px;color:#52525b;display:flex;justify-content:space-between;align-items:center;">
  <span>Use your browser's <strong>File → Print</strong> (or Cmd/Ctrl+P) to save this as a PDF.</span>
  <button onclick="window.print()" style="background:#18181b;color:#fff;border:none;border-radius:4px;padding:6px 14px;font-size:12px;cursor:pointer;">Print / Save PDF</button>
</div>

<div class="header">
  <div>
    <div class="company">${opts.companyName}</div>
    <div class="doc-title">Royalty Statement</div>
  </div>
  <div class="meta">
    <div><strong>Generated:</strong> ${opts.generatedAt}</div>
    <div><strong>Period:</strong> ${opts.periodStart} – ${opts.periodEnd}</div>
    <div style="margin-top:6px"><span class="status-badge">${opts.status}</span></div>
  </div>
</div>

<div class="section">
  <div class="section-title">Recipient</div>
  <div class="row"><span class="label">Name</span><span class="value">${opts.collaboratorName}</span></div>
  ${opts.collaboratorEmail ? `<div class="row"><span class="label">Email</span><span class="value">${opts.collaboratorEmail}</span></div>` : ""}
</div>

<div class="section">
  <div class="section-title">Artist / Release</div>
  <div class="row"><span class="label">Artist</span><span class="value">${opts.artistName}</span></div>
  <div class="row"><span class="label">Period</span><span class="value">${opts.periodStart} – ${opts.periodEnd}</span></div>
  <div class="row"><span class="label">Stream Count</span><span class="value">${opts.streamCount.toLocaleString()}</span></div>
</div>

<div class="section">
  <div class="section-title">Earnings Breakdown</div>
  <div class="row"><span class="label">Gross Revenue</span><span class="value">${fmt$(opts.grossCents)}</span></div>
  <div class="row"><span class="label">Net Revenue (after deductions)</span><span class="value">${fmt$(opts.netCents)}</span></div>
  <div class="row"><span class="label">Your Split Percentage</span><span class="value">${opts.percentage}%</span></div>
</div>

<div class="payout-box">
  <div class="payout-label">Your Payout (${opts.percentage}% of net)</div>
  <div class="payout-amount">${fmt$(payout)}</div>
</div>

<div class="footer">
  This statement was generated by ${opts.companyName} on ${opts.generatedAt}. It reflects the royalty period ${opts.periodStart} through ${opts.periodEnd}.
  For questions, contact your ${opts.companyName} representative.
</div>
</body>
</html>`;
}

// GET /royalties/:id/splits/:splitId/statement — returns HTML for print-to-PDF
router.get("/:id/splits/:splitId/statement", requireAuth, async (req, res) => {
  const royaltyId = Number(req.params.id);
  const splitId   = Number(req.params.splitId);
  try {
    const [royalty] = await db.select().from(royaltiesTable).where(eq(royaltiesTable.id, royaltyId));
    if (!royalty) { res.status(404).json({ error: "Royalty not found" }); return; }

    const [split] = await db.select().from(royaltySplitsTable).where(eq(royaltySplitsTable.id, splitId));
    if (!split || split.royaltyId !== royaltyId) { res.status(404).json({ error: "Split not found" }); return; }

    const [artist] = await db.select().from(artistsTable).where(eq(artistsTable.id, royalty.artistId));

    let contactEmail: string | null = null;
    if (split.contactId) {
      const [contact] = await db.select({ email: contactsTable.email }).from(contactsTable).where(eq(contactsTable.id, split.contactId));
      contactEmail = contact?.email ?? null;
    }

    const companyName = "Doubtless Productions";
    const html = buildStatementHtml({
      companyName,
      collaboratorName:  split.name,
      collaboratorEmail: contactEmail,
      artistName:        artist?.name ?? `Artist #${royalty.artistId}`,
      periodStart:       royalty.periodStart,
      periodEnd:         royalty.periodEnd,
      grossCents:        royalty.grossCents,
      netCents:          royalty.netCents,
      percentage:        split.percentage,
      streamCount:       royalty.streamCount,
      status:            royalty.status,
      generatedAt:       new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "getStatement failed");
    res.status(500).json({ error: "Failed to generate statement" });
  }
});

// POST /royalties/:id/splits/:splitId/statement — email the statement
router.post("/:id/splits/:splitId/statement", requireAuth, requireRole("owner", "admin", "manager"), async (req, res) => {
  const royaltyId = Number(req.params.id);
  const splitId   = Number(req.params.splitId);
  try {
    const [royalty] = await db.select().from(royaltiesTable).where(eq(royaltiesTable.id, royaltyId));
    if (!royalty) { res.status(404).json({ error: "Royalty not found" }); return; }

    const [split] = await db.select().from(royaltySplitsTable).where(eq(royaltySplitsTable.id, splitId));
    if (!split || split.royaltyId !== royaltyId) { res.status(404).json({ error: "Split not found" }); return; }

    const [artist] = await db.select().from(artistsTable).where(eq(artistsTable.id, royalty.artistId));

    let contactEmail: string | null = null;
    if (split.contactId) {
      const [contact] = await db.select({ email: contactsTable.email }).from(contactsTable).where(eq(contactsTable.id, split.contactId));
      contactEmail = contact?.email ?? null;
    }

    const toEmail = (req.body as { email?: string }).email ?? contactEmail;
    if (!toEmail) { res.status(400).json({ error: "No email address available for this collaborator" }); return; }

    const companyName = "Doubtless Productions";
    const html = buildStatementHtml({
      companyName,
      collaboratorName:  split.name,
      collaboratorEmail: toEmail,
      artistName:        artist?.name ?? `Artist #${royalty.artistId}`,
      periodStart:       royalty.periodStart,
      periodEnd:         royalty.periodEnd,
      grossCents:        royalty.grossCents,
      netCents:          royalty.netCents,
      percentage:        split.percentage,
      streamCount:       royalty.streamCount,
      status:            royalty.status,
      generatedAt:       new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    });

    const subject = `Royalty Statement — ${royalty.periodStart} to ${royalty.periodEnd} | ${companyName}`;
    await sendNotificationEmail(toEmail, subject, `Please find your royalty statement for the period ${royalty.periodStart} – ${royalty.periodEnd} attached below.`);

    // Also attempt direct HTML email send
    try {
      const { sendGraphEmailViaAnySender } = await import("../lib/microsoft-graph.js");
      const sent = await sendGraphEmailViaAnySender({ to: toEmail, subject, html });
      if (!sent) {
        const nodemailer = (await import("nodemailer")).default;
        const { db: _db, userEmailSettingsTable } = await import("@workspace/db");
        const { eq: _eq } = await import("drizzle-orm");
        const smtpRows = await _db.select().from(userEmailSettingsTable).where(_eq(userEmailSettingsTable.isVerified, true)).limit(1);
        const smtp = smtpRows[0];
        if (smtp?.smtpHost) {
          const transport = nodemailer.createTransport({ host: smtp.smtpHost, port: smtp.smtpPort, secure: smtp.smtpSecure, auth: { user: smtp.smtpUser, pass: smtp.smtpPass } });
          await transport.sendMail({ from: `"${smtp.fromName}" <${smtp.fromEmail}>`, to: toEmail, subject, html });
        }
      }
    } catch (_e) { /* fallback already attempted above */ }

    // Mark statement as sent
    await db.update(royaltySplitsTable).set({ statementSentAt: new Date() }).where(eq(royaltySplitsTable.id, splitId));

    res.json({ ok: true, sentTo: toEmail });
  } catch (err) {
    req.log.error({ err }, "sendStatement failed");
    res.status(500).json({ error: "Failed to send statement" });
  }
});

export default router;
