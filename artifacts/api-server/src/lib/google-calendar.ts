// Google Calendar integration via Replit Connectors SDK
// The SDK handles OAuth2 token injection and refresh automatically.
import { ReplitConnectors } from "@replit/connectors-sdk";

const BASE = "https://www.googleapis.com/calendar/v3";

export interface GCalEvent {
  id?: string;
  summary: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees?: { email: string }[];
  conferenceData?: {
    createRequest: {
      requestId: string;
      conferenceSolutionKey: { type: string };
    };
  };
  hangoutLink?: string;
}

export interface GCalEventResult {
  id: string;
  hangoutLink?: string;
}

export async function isCalendarConnected(): Promise<boolean> {
  try {
    const connectors = new ReplitConnectors();
    const res = await connectors.proxy("google-calendar", "/calendars/primary", { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createGCalEvent(event: GCalEvent): Promise<GCalEventResult | null> {
  try {
    const connectors = new ReplitConnectors();
    const calendarId = encodeURIComponent("primary");
    const path = `/calendars/${calendarId}/events?conferenceDataVersion=1`;

    const res = await connectors.proxy("google-calendar", path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as GCalEventResult;
    return data;
  } catch {
    return null;
  }
}

export async function deleteGCalEvent(googleEventId: string): Promise<void> {
  try {
    const connectors = new ReplitConnectors();
    const calendarId = encodeURIComponent("primary");
    await connectors.proxy("google-calendar", `/calendars/${calendarId}/events/${googleEventId}`, {
      method: "DELETE",
    });
  } catch {
    // ignore
  }
}
