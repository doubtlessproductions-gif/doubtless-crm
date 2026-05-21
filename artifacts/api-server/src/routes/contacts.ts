import { Router } from "express";
import {
  db,
  contactsTable,
  dealsTable,
  dealNotesTable,
  usersTable,
  emailSendsTable,
  userPermissionsTable,
  formSubmissionsTable,
  messageThreadsTable,
  messagesTable,
  timeEntriesTable,
  invoicesTable,
  clientSubscriptionsTable,
  subscriptionPlansTable,
  auditLogsTable,
  artistsTable,
  parseLabelStatus,
} from "@workspace/db";
import { eq, ilike, or, sql, desc, and, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireReadAuth } from "../middlewares/auth.js";
import { z } from "zod";
import { notifyUsersWithPref } from "../lib/notify-email.js";
import { auditLog } from "../lib/audit.js";
import { fireAutomation } from "../lib/automations.js";
import { fireWebhook } from "../lib/webhooks.js";

const router = Router();

const ContactBody = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  organization: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
});

router.get("/", requireReadAuth, async (req, res) => {
  const search = req.query["search"] as string | undefined;
  let rows;
  if (search) {
    rows = await db
      .select()
      .from(contactsTable)
      .where(
        or(
          ilike(contactsTable.name, `%${search}%`),
          ilike(contactsTable.email ?? sql`''`, `%${search}%`),
          ilike(contactsTable.company ?? sql`''`, `%${search}%`),
        ),
      );
  } else {
    rows = await db.select().from(contactsTable).orderBy(contactsTable.createdAt);
  }
  res.json(rows.map(formatContact));
});

router.post("/", requireAuth, async (req, res) => {
  const parse = ContactBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { name, email, phone, company, organization, tags, notes } = parse.data;
  const [contact] = await db
    .insert(contactsTable)
    .values({ name, email, phone, company, organization, tags: tags ?? [], notes, createdBy: req.user!.userId })
    .returning();
  void notifyUsersWithPref(
    "newContact",
    `New contact: ${name}`,
    `A new contact <strong>${name}</strong>${company ? ` from ${company}` : ""}${organization ? ` (${organization})` : ""} has been added to the CRM.`,
    req.user!.userId,
  );
  void auditLog({ userId: req.user!.userId, action: "contact.created", entityType: "contact", entityId: contact!.id, entityLabel: name, metadata: { email, company, organization }, req });
  void fireAutomation({ trigger: "contact.created", entityType: "contact", entityId: contact!.id, data: { contact: { name, email, company, organization, tags } }, userId: req.user!.userId });
  void fireWebhook("contact.created", { contactId: contact!.id, name, email: email ?? null, company: company ?? null, organization: organization ?? null }, req.user!.userId);
  res.status(201).json(formatContact(contact!));
});

// ── CSV export ──────────────────────────────────────────────────────────────
function csvRow(vals: (string | number | null | undefined)[]): string {
  return vals.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
}

router.get("/export.csv", requireAuth, async (req, res) => {
  const search = req.query["search"] as string | undefined;
  let rows;
  if (search) {
    rows = await db.select().from(contactsTable).where(
      or(
        ilike(contactsTable.name, `%${search}%`),
        ilike(contactsTable.email ?? sql`''`, `%${search}%`),
        ilike(contactsTable.company ?? sql`''`, `%${search}%`),
      ),
    );
  } else {
    rows = await db.select().from(contactsTable).orderBy(contactsTable.createdAt);
  }
  const lines = [
    csvRow(["ID", "Name", "Email", "Phone", "Company", "Organization", "Tags", "Notes", "Created At"]),
    ...rows.map(c => csvRow([
      c.id, c.name, c.email, c.phone, c.company, c.organization,
      (c.tags ?? []).join("; "),
      (c.notes ?? "").replace(/\n/g, " "),
      c.createdAt.toISOString(),
    ])),
  ];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="contacts.csv"`);
  res.send(lines.join("\n"));
});

// ── Bulk actions ────────────────────────────────────────────────────────────
const ContactBulkBody = z.object({
  ids:        z.array(z.number().int().positive()).min(1).max(500),
  action:     z.enum(["tag", "untag", "delete", "assign"]),
  tag:        z.string().min(1).max(100).optional(),
  assignedTo: z.number().int().positive().nullable().optional(),
});

router.patch("/bulk", requireAuth, async (req, res) => {
  const parse = ContactBulkBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.message }); return; }
  const { ids, action, tag, assignedTo } = parse.data;

  if (action === "delete") {
    await db.delete(contactsTable).where(inArray(contactsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }

  if (action === "assign") {
    await db.update(contactsTable).set({ assignedTo: assignedTo ?? null, updatedAt: new Date() }).where(inArray(contactsTable.id, ids));
    res.json({ ok: true, affected: ids.length });
    return;
  }

  if (!tag) { res.status(400).json({ error: "tag is required for tag/untag" }); return; }

  const contacts = await db
    .select({ id: contactsTable.id, tags: contactsTable.tags })
    .from(contactsTable)
    .where(inArray(contactsTable.id, ids));

  await Promise.all(contacts.map(c => {
    const cur = (c.tags ?? []) as string[];
    const next = action === "tag"
      ? (cur.includes(tag) ? cur : [...cur, tag])
      : cur.filter(t => t !== tag);
    return db.update(contactsTable).set({ tags: next, updatedAt: new Date() }).where(eq(contactsTable.id, c.id));
  }));

  res.json({ ok: true, affected: contacts.length });
});

// ── CSV Import ───────────────────────────────────────────────────────────────

const ImportBody = z.object({
  contacts: z.array(z.object({
    name:         z.string().min(1),
    email:        z.string().optional().nullable(),
    phone:        z.string().optional().nullable(),
    company:      z.string().optional().nullable(),
    organization: z.string().optional().nullable(),
    tags:         z.array(z.string()).optional().default([]),
    notes:        z.string().optional().nullable(),
  })).min(1).max(1000),
});

router.post("/import", requireAuth, async (req, res) => {
  const parse = ImportBody.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: "Invalid import payload" }); return; }

  const rows = parse.data.contacts.map((c) => ({
    name:         c.name,
    email:        c.email        ?? null,
    phone:        c.phone        ?? null,
    company:      c.company      ?? null,
    organization: c.organization ?? null,
    tags:         c.tags         ?? [],
    notes:        c.notes        ?? null,
    createdBy:    req.user!.userId,
  }));

  let imported = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    await db.insert(contactsTable).values(batch);
    imported += batch.length;
  }

  void auditLog({ userId: req.user!.userId, action: "contact.imported", entityType: "contact", entityId: 0, entityLabel: `${imported} contacts`, metadata: { count: imported }, req });
  res.json({ imported });
});

router.get("/:id/timeline", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid contact id" }); return; }

  const offset = parseInt((req.query["offset"] as string) ?? "0") || 0;
  const limit = Math.min(parseInt((req.query["limit"] as string) ?? "20") || 20, 50);
  const typeFilter = req.query["type"] as string | undefined;

  // Collect all deals for this contact (needed for sub-queries)
  const contactDeals = await db
    .select({ id: dealsTable.id, title: dealsTable.title, stage: dealsTable.stage, value: dealsTable.value, createdAt: dealsTable.createdAt })
    .from(dealsTable)
    .where(eq(dealsTable.contactId, id));

  const dealIds = contactDeals.map((d) => d.id);

  interface TimelineItem {
    key: string;
    type: string;
    description: string;
    actorName: string | null;
    timestamp: Date;
    meta: Record<string, unknown>;
  }

  const items: TimelineItem[] = [];

  const include = (t: string) => !typeFilter || typeFilter === t;

  // Deals
  if (include("deal")) {
    for (const d of contactDeals) {
      items.push({
        key: `deal:${d.id}`,
        type: "deal",
        description: `Deal created: ${d.title}`,
        actorName: null,
        timestamp: d.createdAt,
        meta: { dealId: d.id, stage: d.stage, value: d.value ? Number(d.value) : null },
      });
    }
  }

  // Deal notes
  if (include("note") && dealIds.length > 0) {
    const notes = await db
      .select({
        id: dealNotesTable.id,
        content: dealNotesTable.content,
        createdAt: dealNotesTable.createdAt,
        dealId: dealNotesTable.dealId,
        authorName: usersTable.name,
      })
      .from(dealNotesTable)
      .leftJoin(usersTable, eq(dealNotesTable.authorId, usersTable.id))
      .where(inArray(dealNotesTable.dealId, dealIds));

    for (const n of notes) {
      const deal = contactDeals.find((d) => d.id === n.dealId);
      items.push({
        key: `note:${n.id}`,
        type: "note",
        description: `Note on ${deal?.title ?? "deal"}: ${n.content.slice(0, 80)}${n.content.length > 80 ? "…" : ""}`,
        actorName: n.authorName ?? null,
        timestamp: n.createdAt,
        meta: { noteId: n.id, dealId: n.dealId },
      });
    }
  }

  // Emails sent
  if (include("email")) {
    const emails = await db
      .select({
        id: emailSendsTable.id,
        subject: emailSendsTable.subject,
        status: emailSendsTable.status,
        sentAt: emailSendsTable.sentAt,
        actorName: usersTable.name,
      })
      .from(emailSendsTable)
      .leftJoin(usersTable, eq(emailSendsTable.sentBy, usersTable.id))
      .where(eq(emailSendsTable.contactId, id));

    for (const e of emails) {
      items.push({
        key: `email:${e.id}`,
        type: "email",
        description: `Email sent: ${e.subject ?? "(no subject)"}`,
        actorName: e.actorName ?? null,
        timestamp: e.sentAt,
        meta: { emailId: e.id, status: e.status },
      });
    }
  }

  // Form submissions
  if (include("form")) {
    const submissions = await db
      .select()
      .from(formSubmissionsTable)
      .where(eq(formSubmissionsTable.contactId, id));

    for (const s of submissions) {
      items.push({
        key: `form:${s.id}`,
        type: "form",
        description: `Form submission: ${s.formType.replace(/_/g, " ")}${s.submitterName ? ` by ${s.submitterName}` : ""}`,
        actorName: s.submitterName ?? null,
        timestamp: s.submittedAt,
        meta: { submissionId: s.id, formType: s.formType, status: s.status },
      });
    }
  }

  // Messages in threads linked to this contact
  if (include("message")) {
    const threads = await db
      .select({ id: messageThreadsTable.id, title: messageThreadsTable.title })
      .from(messageThreadsTable)
      .where(eq(messageThreadsTable.contactId, id));

    if (threads.length > 0) {
      const threadIds = threads.map((t) => t.id);
      const msgs = await db
        .select({
          id: messagesTable.id,
          content: messagesTable.content,
          createdAt: messagesTable.createdAt,
          threadId: messagesTable.threadId,
          authorName: usersTable.name,
        })
        .from(messagesTable)
        .leftJoin(usersTable, eq(messagesTable.authorId, usersTable.id))
        .where(inArray(messagesTable.threadId, threadIds));

      for (const m of msgs) {
        const thread = threads.find((t) => t.id === m.threadId);
        items.push({
          key: `message:${m.id}`,
          type: "message",
          description: `Message in "${thread?.title ?? "thread"}": ${m.content.slice(0, 80)}${m.content.length > 80 ? "…" : ""}`,
          actorName: m.authorName ?? null,
          timestamp: m.createdAt,
          meta: { messageId: m.id, threadId: m.threadId },
        });
      }
    }
  }

  // Time entries on deals linked to this contact
  if (include("time") && dealIds.length > 0) {
    const entries = await db
      .select({
        id: timeEntriesTable.id,
        durationMinutes: timeEntriesTable.durationMinutes,
        category: timeEntriesTable.category,
        description: timeEntriesTable.description,
        date: timeEntriesTable.date,
        createdAt: timeEntriesTable.createdAt,
        dealId: timeEntriesTable.dealId,
        actorName: usersTable.name,
      })
      .from(timeEntriesTable)
      .leftJoin(usersTable, eq(timeEntriesTable.userId, usersTable.id))
      .where(inArray(timeEntriesTable.dealId, dealIds));

    for (const e of entries) {
      const deal = contactDeals.find((d) => d.id === e.dealId);
      const hrs = Math.floor(e.durationMinutes / 60);
      const mins = e.durationMinutes % 60;
      const dur = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      items.push({
        key: `time:${e.id}`,
        type: "time",
        description: `${dur} logged on ${deal?.title ?? "deal"}${e.description ? ` — ${e.description}` : ""}`,
        actorName: e.actorName ?? null,
        timestamp: e.createdAt,
        meta: { entryId: e.id, dealId: e.dealId, durationMinutes: e.durationMinutes, category: e.category },
      });
    }
  }

  // Invoices
  if (include("invoice")) {
    const invs = await db
      .select({
        id: invoicesTable.id,
        number: invoicesTable.number,
        total: invoicesTable.total,
        status: invoicesTable.status,
        createdAt: invoicesTable.createdAt,
        actorName: usersTable.name,
      })
      .from(invoicesTable)
      .leftJoin(usersTable, eq(invoicesTable.createdBy, usersTable.id))
      .where(eq(invoicesTable.contactId, id));

    for (const inv of invs) {
      items.push({
        key: `invoice:${inv.id}`,
        type: "invoice",
        description: `Invoice ${inv.number} — $${Number(inv.total).toLocaleString()} (${inv.status})`,
        actorName: inv.actorName ?? null,
        timestamp: inv.createdAt,
        meta: { invoiceId: inv.id, number: inv.number, status: inv.status, total: Number(inv.total) },
      });
    }
  }

  // Deal stage changes (from audit log)
  if (include("stage_change") && dealIds.length > 0) {
    const stageChanges = await db
      .select()
      .from(auditLogsTable)
      .where(and(eq(auditLogsTable.action, "deal.stage_changed"), inArray(auditLogsTable.entityId!, dealIds)));

    for (const sc of stageChanges) {
      const newStage = (sc.metadata as Record<string, unknown>)?.stage as string | undefined;
      items.push({
        key: `stage_change:${sc.id}`,
        type: "stage_change",
        description: `Deal stage changed${newStage ? ` → ${newStage}` : ""}: ${sc.entityLabel ?? ""}`,
        actorName: sc.userName ?? null,
        timestamp: sc.createdAt,
        meta: { auditId: sc.id, dealId: sc.entityId, stage: newStage },
      });
    }
  }

  // Subscriptions
  if (include("subscription")) {
    const subs = await db
      .select({
        id: clientSubscriptionsTable.id,
        status: clientSubscriptionsTable.status,
        interval: clientSubscriptionsTable.interval,
        createdAt: clientSubscriptionsTable.createdAt,
        planName: subscriptionPlansTable.name,
        priceMonthly: subscriptionPlansTable.priceMonthly,
      })
      .from(clientSubscriptionsTable)
      .leftJoin(subscriptionPlansTable, eq(clientSubscriptionsTable.planId, subscriptionPlansTable.id))
      .where(eq(clientSubscriptionsTable.contactId, id));

    for (const s of subs) {
      items.push({
        key: `subscription:${s.id}`,
        type: "subscription",
        description: `Subscription: ${s.planName ?? "Plan"} (${s.status})`,
        actorName: null,
        timestamp: s.createdAt,
        meta: { subscriptionId: s.id, status: s.status, planName: s.planName, priceMonthly: s.priceMonthly },
      });
    }
  }

  // Sort descending by timestamp, paginate
  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const total = items.length;
  const page = items.slice(offset, offset + limit);

  res.json({
    total,
    offset,
    limit,
    hasMore: offset + limit < total,
    items: page.map((item) => ({
      ...item,
      timestamp: item.timestamp.toISOString(),
    })),
  });
});

router.get("/:id", requireReadAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, id)).limit(1);
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  const deals = await db.select().from(dealsTable).where(eq(dealsTable.contactId, id));
  res.json({ ...formatContact(contact), deals: deals.map(formatDeal) });
});

router.put("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const parse = ContactBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { name, email, phone, company, organization, tags, notes } = parse.data;
  const [contact] = await db
    .update(contactsTable)
    .set({ name, email, phone, company, organization, tags: tags ?? [], notes, updatedAt: new Date() })
    .where(eq(contactsTable.id, id))
    .returning();
  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json(formatContact(contact));
});

/**
 * GET /contacts/:id/artist
 * Returns the artist linked to this contact (if any).
 */
router.get("/:id/artist", requireAuth, async (req, res) => {
  const contactId = parseInt(req.params["id"] as string);
  const [artist] = await db
    .select({
      id: artistsTable.id,
      name: artistsTable.name,
      genre: artistsTable.genre,
      imageUrl: artistsTable.imageUrl,
      labelStatus: artistsTable.labelStatus,
    })
    .from(artistsTable)
    .where(and(eq(artistsTable.contactId, contactId), isNull(artistsTable.deletedAt)))
    .limit(1);
  if (!artist) { res.status(404).json({ error: "No artist linked to this contact" }); return; }
  res.json({ ...artist, labelStatus: parseLabelStatus(artist.labelStatus) });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const role = req.user!.role ?? "";
  const roleCanDelete = ["owner", "admin"].includes(role);
  if (!roleCanDelete) {
    const [permsRow] = await db.select({ permissions: userPermissionsTable.permissions })
      .from(userPermissionsTable).where(eq(userPermissionsTable.userId, req.user!.userId)).limit(1);
    const allowed = (permsRow?.permissions as Record<string, boolean> | null)?.["contacts:delete"] === true;
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const result = await db.delete(contactsTable).where(eq(contactsTable.id, id)).returning();
  if (!result.length) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.status(204).send();
  void auditLog({ userId: req.user!.userId, userName: req.user!.email, action: "contact.deleted", entityType: "contact", entityId: id, entityLabel: result[0]!.name, req });
});

function formatContact(c: typeof contactsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    company: c.company,
    organization: c.organization,
    tags: c.tags,
    notes: c.notes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function formatDeal(d: typeof dealsTable.$inferSelect) {
  return {
    id: d.id,
    title: d.title,
    value: d.value ? Number(d.value) : null,
    stage: d.stage,
    contactId: d.contactId,
    contactName: null,
    assignedTo: d.assignedTo,
    assignedToName: null,
    notes: d.notes,
    closedAt: d.closedAt,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export default router;
