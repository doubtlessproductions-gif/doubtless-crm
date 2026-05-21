import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCalendarEvents,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  getListCalendarEventsQueryKey,
} from "@workspace/api-client-react";
import type { CalendarEvent } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Calendar, Clock, Video, Mail, Trash2, ExternalLink,
  AlertCircle, Link2, Download, CalendarDays,
} from "lucide-react";

function formatDateTime(dateStr: string | Date) {
  const d = new Date(dateStr);
  return d.toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(start: string | Date, end: string | Date) {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function toLocalDatetimeValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Detect the platform from a meeting URL and return a label + color. */
function detectPlatform(url: string): { label: string; color: string } {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("zoom.us"))            return { label: "Zoom",      color: "bg-blue-100 text-blue-700" };
    if (host.includes("teams.microsoft"))    return { label: "Teams",     color: "bg-violet-100 text-violet-700" };
    if (host.includes("meet.google"))        return { label: "Meet",      color: "bg-green-100 text-green-700" };
    if (host.includes("webex"))              return { label: "Webex",     color: "bg-orange-100 text-orange-700" };
    if (host.includes("calendly"))           return { label: "Calendly",  color: "bg-teal-100 text-teal-700" };
    if (host.includes("whereby"))            return { label: "Whereby",   color: "bg-pink-100 text-pink-700" };
    if (host.includes("bluejeans"))          return { label: "BlueJeans", color: "bg-blue-100 text-blue-800" };
    if (host.includes("gotomeeting"))        return { label: "GoTo",      color: "bg-amber-100 text-amber-700" };
    if (host.includes("skype"))              return { label: "Skype",     color: "bg-sky-100 text-sky-700" };
    if (host.includes("discord"))            return { label: "Discord",   color: "bg-indigo-100 text-indigo-700" };
    if (host.includes("slack"))              return { label: "Slack",     color: "bg-emerald-100 text-emerald-700" };
    return { label: "Join", color: "bg-zinc-100 text-zinc-700" };
  } catch {
    return { label: "Join", color: "bg-zinc-100 text-zinc-700" };
  }
}

const now = new Date();
const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

const BLANK = {
  title: "",
  description: "",
  startTime: toLocalDatetimeValue(now),
  endTime: toLocalDatetimeValue(oneHourLater),
  attendeeEmailsRaw: "",
  meetingUrl: "",
};

export default function CalendarPage() {
  const { toast } = useToast();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);

  const { data: events, isLoading } = useListCalendarEvents({
    query: { queryKey: getListCalendarEventsQueryKey() },
  });

  const createEvent = useCreateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListCalendarEventsQueryKey() });

  const handleCreate = async () => {
    if (!form.title || !form.startTime || !form.endTime) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    const start = new Date(form.startTime);
    const end = new Date(form.endTime);
    if (end <= start) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    const attendeeEmails = form.attendeeEmailsRaw
      .split(/[\s,]+/).map((e) => e.trim()).filter(Boolean);

    try {
      await createEvent.mutateAsync({
        data: {
          title: form.title,
          description: form.description || null,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          attendeeEmails,
          meetingUrl: form.meetingUrl.trim() || null,
        },
      });
      invalidate();
      setForm(BLANK);
      setOpen(false);
      toast({ title: "Meeting scheduled" });
    } catch {
      toast({ title: "Failed to create meeting", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    await deleteEvent.mutateAsync({ id });
    invalidate();
    toast({ title: "Meeting deleted" });
  };

  const handleIcalDownload = (id: number) => {
    const url = `/api/calendar/${id}/ical`;
    const a = document.createElement("a");
    a.href = token ? `${url}?token=${encodeURIComponent(token)}` : url;
    a.download = `meeting-${id}.ics`;
    a.click();
  };

  const googleConnected = events?.some((e) => e.googleEventId);
  const upcoming = events?.filter((e) => new Date(e.endTime) >= new Date()) ?? [];
  const past = events?.filter((e) => new Date(e.endTime) < new Date()) ?? [];

  return (
    <div className="p-6 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Calendar</h1>
          <p className="text-muted-foreground text-sm">
            Schedule meetings — syncs to Google Calendar when connected, and exports to any calendar app
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Schedule Meeting
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Schedule a Meeting</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Title *</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Studio session with artist"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start *</Label>
                  <Input
                    type="datetime-local"
                    value={form.startTime}
                    onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>End *</Label>
                  <Input
                    type="datetime-local"
                    value={form.endTime}
                    onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  />
                </div>
              </div>

              {/* Meeting link — any platform */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Meeting Link
                </Label>
                <Input
                  value={form.meetingUrl}
                  onChange={(e) => setForm({ ...form, meetingUrl: e.target.value })}
                  placeholder="https://zoom.us/j/… or teams, Webex, Calendly, etc."
                />
                <p className="text-xs text-muted-foreground">
                  Paste any Zoom, Teams, Webex, Calendly, Google Meet, or other link.
                  {!googleConnected && " Google Meet links are auto-generated when Google Calendar is connected."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Attendees</Label>
                <Input
                  value={form.attendeeEmailsRaw}
                  onChange={(e) => setForm({ ...form, attendeeEmailsRaw: e.target.value })}
                  placeholder="artist@email.com, manager@email.com"
                />
                <p className="text-xs text-muted-foreground">Comma or space separated emails</p>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Agenda, talking points..."
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createEvent.isPending}>
                  {createEvent.isPending ? "Scheduling..." : "Schedule Meeting"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Integration hints */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            icon: "🗓",
            title: "Google Calendar",
            desc: googleConnected
              ? "Connected — events sync automatically with Meet links"
              : "Connect in Integrations to auto-sync and generate Meet links",
            connected: googleConnected,
          },
          {
            icon: "📅",
            title: "Any Calendar App",
            desc: "Download .ics from any event to add it to Apple Calendar, Outlook, Fantastical, or any iCal-compatible app",
            connected: true,
          },
          {
            icon: "🔗",
            title: "Any Meeting Platform",
            desc: "Paste a Zoom, Teams, Webex, Calendly, or any other link when scheduling",
            connected: true,
          },
        ].map((item) => (
          <div
            key={item.title}
            className={`rounded-xl border border-zinc-200 shadow-sm p-4 text-sm ${item.connected ? "bg-white" : "bg-zinc-50/60"}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-base">{item.icon}</span>
              <span className="font-medium text-zinc-800">{item.title}</span>
              {item.connected && (
                <span className="ml-auto text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded-full">
                  {googleConnected && item.title === "Google Calendar" ? "Connected" : "Ready"}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* Google Calendar banner when not connected and have local events */}
      {!googleConnected && events && events.length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <AlertCircle className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Google Calendar not connected</p>
            <p className="text-xs text-blue-700 mt-0.5">
              Events are saved locally. Connect Google Calendar in Integrations to enable auto-sync and Meet link generation.
              You can still export any event to your calendar via the .ics download button.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : !events?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">No meetings scheduled</h3>
          <p className="text-muted-foreground text-sm mb-4 max-w-sm">
            Schedule your first meeting. Add any Zoom, Teams, Webex, or Calendly link —
            or connect Google Calendar to auto-generate Meet links.
          </p>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Schedule Meeting
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Upcoming ({upcoming.length})
              </h2>
              <div className="space-y-3">
                {upcoming.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={() => handleDelete(event.id)}
                    onIcal={() => handleIcalDownload(event.id)}
                  />
                ))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Past ({past.length})
              </h2>
              <div className="space-y-3 opacity-60">
                {past.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onDelete={() => handleDelete(event.id)}
                    onIcal={() => handleIcalDownload(event.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventCard({
  event, onDelete, onIcal,
}: {
  event: CalendarEvent & { meetingUrl?: string | null };
  onDelete: () => void;
  onIcal: () => void;
}) {
  const isPast = new Date(event.endTime) < new Date();
  const joinUrl = event.meetingUrl || event.meetLink || null;
  const platform = joinUrl ? detectPlatform(joinUrl) : null;

  return (
    <div className="flex items-start gap-4 p-4 bg-white border border-zinc-200 rounded-xl shadow-sm hover:shadow-md transition-shadow group">
      <div className={`p-2 rounded-lg shrink-0 ${isPast ? "bg-zinc-100" : "bg-primary/10"}`}>
        <CalendarDays className={`h-5 w-5 ${isPast ? "text-zinc-400" : "text-primary"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <p className="font-medium text-sm truncate">{event.title}</p>
          {platform && (
            <Badge variant="outline" className={`text-xs flex items-center gap-1 ${platform.color} border-transparent`}>
              <Video className="h-3 w-3" />
              {platform.label}
            </Badge>
          )}
          {event.googleEventId && (
            <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">Google</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDateTime(event.startTime)}
          </span>
          <span>·</span>
          <span>{formatDuration(event.startTime, event.endTime)}</span>
        </div>
        {event.attendeeEmails.length > 0 && (
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <Mail className="h-3 w-3" />
            {event.attendeeEmails.join(", ")}
          </div>
        )}
        {event.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{event.description}</p>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 items-center">
        {/* Join meeting */}
        {joinUrl && (
          <a href={joinUrl} target="_blank" rel="noreferrer">
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" title="Join Meeting">
              <ExternalLink className="h-3.5 w-3.5" />
              {platform?.label ?? "Join"}
            </Button>
          </a>
        )}
        {/* Add to calendar (.ics download) */}
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={onIcal}
          title="Add to calendar (.ics — works with Apple Calendar, Outlook, Fantastical, etc.)"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive hover:text-destructive"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
