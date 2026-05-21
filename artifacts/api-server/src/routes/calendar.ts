import { Router } from "express";
import { db, calendarEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { createGCalEvent, deleteGCalEvent } from "../lib/google-calendar.js";
import { z } from "zod";

const router = Router();

const CreateEventBody = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  startTime: z.string(),
  endTime: z.string(),
  attendeeEmails: z.array(z.string().email()).default([]),
  dealId: z.number().optional().nullable(),
  contactId: z.number().optional().nullable(),
  meetingUrl: z.string().url().optional().nullable(),
});

router.get("/", requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.createdBy, req.user!.userId))
    .orderBy(calendarEventsTable.startTime);
  res.json(rows.map(formatEvent));
});

router.post("/", requireAuth, async (req, res) => {
  const parse = CreateEventBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.message });
    return;
  }
  const { title, description, startTime, endTime, attendeeEmails, dealId, contactId } = parse.data;

  // Try Google Calendar via Replit Connectors SDK
  const gcalResult = await createGCalEvent({
    summary: title,
    description: description ?? undefined,
    start: { dateTime: startTime },
    end: { dateTime: endTime },
    attendees: attendeeEmails.map((email) => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: `crm-${req.user!.userId}-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  });

  const { meetingUrl } = parse.data;

  const [row] = await db
    .insert(calendarEventsTable)
    .values({
      title,
      description: description ?? null,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      attendeeEmails,
      dealId: dealId ?? null,
      contactId: contactId ?? null,
      googleEventId: gcalResult?.id ?? null,
      meetLink: gcalResult?.hangoutLink ?? null,
      meetingUrl: meetingUrl ?? null,
      createdBy: req.user!.userId,
    })
    .returning();

  res.status(201).json(formatEvent(row!));
});

// ── iCal export — works with any calendar app ────────────────────────────────
function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

router.get("/:id/ical", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const joinUrl = row.meetingUrl ?? row.meetLink ?? "";
  const description = [row.description, joinUrl ? `Join: ${joinUrl}` : ""].filter(Boolean).join("\\n\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Doubtless Productions CRM//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:crm-event-${row.id}@doubtlessproductions`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(row.startTime)}`,
    `DTEND:${toIcsDate(row.endTime)}`,
    `SUMMARY:${escapeIcs(row.title)}`,
    description ? `DESCRIPTION:${description}` : "",
    joinUrl ? `URL:${joinUrl}` : "",
    ...(row.attendeeEmails ?? []).map((e) => `ATTENDEE;CN=${e}:mailto:${e}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="event-${row.id}.ics"`);
  res.send(lines);
});

router.delete("/:id", requireAuth, async (req, res) => {
  const id = parseInt(req.params["id"] as string);
  const [row] = await db.select().from(calendarEventsTable).where(eq(calendarEventsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (row.googleEventId) {
    await deleteGCalEvent(row.googleEventId);
  }

  await db.delete(calendarEventsTable).where(eq(calendarEventsTable.id, id));
  res.status(204).end();
});

function formatEvent(row: typeof calendarEventsTable.$inferSelect) {
  return {
    id: row.id,
    dealId: row.dealId,
    contactId: row.contactId,
    googleEventId: row.googleEventId,
    title: row.title,
    description: row.description,
    startTime: row.startTime,
    endTime: row.endTime,
    attendeeEmails: row.attendeeEmails,
    meetLink: row.meetLink,
    meetingUrl: row.meetingUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export default router;
