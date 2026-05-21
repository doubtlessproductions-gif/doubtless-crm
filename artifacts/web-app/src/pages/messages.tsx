import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useListThreads,
  useGetThread,
  useCreateThread,
  useSendMessage,
  useUploadFile,
  getListThreadsQueryKey,
  getGetThreadQueryKey,
} from "@workspace/api-client-react";
import type { MessageThread, ChatMessage } from "@workspace/api-client-react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MessageSquare, Plus, Send, Paperclip, X, FileText, Image as ImageIcon,
  Download, Lock, CheckCircle2, Star, Headphones, Flag, CreditCard,
  Music, Film, Play, Pause, Clock3, Link2, ChevronLeft, Trash2,
  MoreHorizontal, BadgeCheck, DollarSign, ArchiveX, Users, Hash, AtSign,
  UserPlus,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

interface Participant { id: number; name: string; email: string; }
interface TeamMember { id: number; name: string; email: string; role: string; }

interface ExtendedThread extends MessageThread {
  reviewFileUrl?: string | null;
  reviewFileName?: string | null;
  isFinalLocked?: boolean;
  manuallyPaid?: boolean;
  isCompleted?: boolean;
  completedAt?: string | null;
  dealIsPaid?: boolean;
  contactId?: number | null;
  artistId?: number | null;
  participants?: Participant[];
}

interface ExtendedMessage extends ChatMessage {
  isFinalDelivery?: boolean;
}

interface PaymentStatus {
  paid: boolean;
  dealId: number | null;
  isFinalLocked: boolean;
  manuallyPaid?: boolean;
}

interface TimePin {
  timeSeconds: number;
  author: string;
  msgId: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatSize(bytes?: number | null) {
  if (!bytes) return "";
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatAudioTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseTimestampSeconds(token: string): number | null {
  const m = token.match(/^@(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const a = parseInt(m[1]!), b = parseInt(m[2]!);
  const c = m[3] ? parseInt(m[3]!) : null;
  return c != null ? a * 3600 + b * 60 + c : a * 60 + b;
}

function renderContent(text: string, onSeek?: (s: number) => void) {
  const parts = text.split(/(@\d{1,2}:\d{2}(?::\d{2})?)/g);
  return parts.map((part, i) => {
    const secs = parseTimestampSeconds(part);
    if (secs !== null) {
      return (
        <button
          key={i}
          onClick={onSeek ? () => onSeek(secs) : undefined}
          className={cn(
            "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 text-xs font-mono mx-0.5 align-middle",
            onSeek ? "hover:bg-violet-200 transition-colors cursor-pointer" : "cursor-default",
          )}
          title={onSeek ? `Seek to ${part}` : part}
        >
          <Clock3 className="h-2.5 w-2.5" />{part}
        </button>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function authH(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Append ?token= to storage URLs so native <audio>/<video>/<img> elements
 * can authenticate — they cannot send Authorization headers themselves.
 */
function mediaUrl(url: string, token: string | null): string {
  if (!token || !url.includes("/api/storage/objects/")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function isAudio(name: string) {
  return /\.(mp3|wav|aac|flac|ogg|m4a|aiff?)$/i.test(name);
}
function isImage(name: string) {
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
}
function isVideo(name: string) {
  return /\.(mp4|mov|webm|avi|mkv|mpeg?)$/i.test(name);
}

// ── File preview / download cell ─────────────────────────────────────────────
function FilePreview({
  url, name, size, isFinalDelivery = false, paid = true, token,
}: {
  url: string; name: string; size?: number | null;
  isFinalDelivery?: boolean; paid?: boolean; token: string | null;
}) {
  const locked = isFinalDelivery && !paid;

  if (isAudio(name) && !locked) {
    return (
      <div className="mt-2 border border-zinc-200 rounded-lg overflow-hidden bg-gradient-to-r from-violet-50 to-purple-50 p-3 max-w-sm">
        <div className="flex items-center gap-2 mb-2">
          <Music className="h-4 w-4 text-violet-500 shrink-0" />
          <p className="text-sm font-medium text-violet-800 truncate">{name}</p>
        </div>
        <audio controls src={mediaUrl(url, token)} className="w-full h-8" style={{ height: 32 }} />
      </div>
    );
  }
  if (isImage(name) && !locked) {
    return (
      <div className="mt-2 border border-zinc-200 rounded-lg overflow-hidden max-w-xs">
        <img src={mediaUrl(url, token)} alt={name} className="max-h-48 w-full object-cover" />
      </div>
    );
  }
  if (isVideo(name) && !locked) {
    return (
      <div className="mt-2 border border-zinc-200 rounded-lg overflow-hidden max-w-sm bg-black">
        <video src={mediaUrl(url, token)} controls preload="metadata" className="w-full max-h-64" />
        <div className="flex items-center gap-2 p-2 bg-zinc-900">
          <Film className="h-4 w-4 text-zinc-400 shrink-0" />
          <p className="text-sm text-zinc-300 truncate">{name}</p>
        </div>
      </div>
    );
  }

  const locked_ = isFinalDelivery && !paid;
  return (
    <div className={cn(
      "mt-2 border rounded-lg overflow-hidden max-w-sm shadow-sm",
      locked_ ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-zinc-50",
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <FileText className="h-5 w-5 text-zinc-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{name}</p>
          {size != null && <p className="text-xs text-muted-foreground">{formatSize(size)}</p>}
        </div>
        {locked_ ? (
          <div className="flex items-center gap-1 text-amber-600"><Lock className="h-4 w-4" /></div>
        ) : (
          <a href={url} download={name} target="_blank" rel="noreferrer">
            <Button size="icon" variant="ghost" className="h-7 w-7"><Download className="h-4 w-4" /></Button>
          </a>
        )}
      </div>
      {locked_ && (
        <div className="px-3 py-2 text-xs text-amber-700 border-t border-amber-200 bg-amber-50 flex items-center gap-1.5">
          <CreditCard className="h-3.5 w-3.5 shrink-0" />
          Payment required to download this file
        </div>
      )}
    </div>
  );
}

// ── Custom audio player with timeline pins ────────────────────────────────────
function ReviewPlayer({
  fileUrl,
  fileName,
  paid,
  audioRef,
  pins,
  onPinClick,
  token,
}: {
  fileUrl: string;
  fileName: string;
  paid: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  pins: TimePin[];
  onPinClick: (msgId: number) => void;
  token: string | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);

  function seek(t: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(t, duration));
      setCurrentTime(audioRef.current.currentTime);
    }
  }

  function handleProgressClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  }

  const audio = isAudio(fileName);

  if (!audio) {
    return (
      <div className="shrink-0 border-b bg-gradient-to-r from-violet-50 via-purple-50 to-violet-50 px-5 py-3">
        <div className="flex items-center gap-2 mb-1">
          <Headphones className="h-4 w-4 text-violet-600 shrink-0" />
          <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Review File</span>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-violet-900 truncate">{fileName}</p>
          {paid ? (
            <a href={fileUrl} download={fileName} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <Download className="h-3 w-3 mr-1" /> Download
              </Button>
            </a>
          ) : (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <Lock className="h-3 w-3" /> Locked
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b bg-gradient-to-r from-violet-50 via-purple-50 to-violet-50 px-5 py-3">
      {/* Hidden audio element — controlled via ref */}
      <audio
        ref={audioRef as React.RefObject<HTMLAudioElement>}
        src={mediaUrl(fileUrl, token)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      {/* Header row */}
      <div className="flex items-center gap-2 mb-2.5">
        <Headphones className="h-4 w-4 text-violet-600 shrink-0" />
        <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Review File</span>
        <span className="text-xs text-violet-600 truncate ml-1 flex-1 min-w-0">{fileName}</span>
      </div>

      {/* Player controls */}
      <div className="flex items-center gap-2.5">
        {/* Play / Pause */}
        <button
          onClick={() => {
            if (!audioRef.current) return;
            if (playing) audioRef.current.pause();
            else audioRef.current.play().catch(() => {});
          }}
          className="h-7 w-7 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 transition-colors shrink-0"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
        </button>

        {/* Current time */}
        <span className="text-xs text-violet-700 font-mono shrink-0 w-9">{formatAudioTime(currentTime)}</span>

        {/* Progress bar with pin overlay */}
        <div
          ref={progressRef}
          className="flex-1 relative h-2.5 bg-violet-200 rounded-full cursor-pointer"
          onClick={handleProgressClick}
        >
          {/* Filled portion */}
          <div
            className="absolute inset-y-0 left-0 bg-violet-500 rounded-full pointer-events-none"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
          />
          {/* Timestamp pins from messages */}
          {duration > 0 && pins.map((pin) => (
            <div
              key={`${pin.msgId}-${pin.timeSeconds}`}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-4 bg-orange-400 rounded-sm cursor-pointer hover:bg-orange-500 hover:h-5 transition-all z-10"
              style={{ left: `${Math.min(99, (pin.timeSeconds / duration) * 100)}%` }}
              onClick={(e) => {
                e.stopPropagation();
                seek(pin.timeSeconds);
                onPinClick(pin.msgId);
              }}
              title={`${pin.author} · @${formatAudioTime(pin.timeSeconds)}`}
            />
          ))}
        </div>

        {/* Duration */}
        <span className="text-xs text-violet-700 font-mono shrink-0 w-9 text-right">{formatAudioTime(duration)}</span>
      </div>

      {pins.length > 0 && (
        <p className="text-[10px] text-violet-500 mt-1.5 pl-[3.25rem]">
          {pins.length} comment pin{pins.length !== 1 ? "s" : ""} on this track — click orange markers to jump to position
        </p>
      )}
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────────
function MessageBubble({
  msg, isAdmin, currentUserId, threadId, paid, token, onToggleFinal, onDelete, onSeek, highlighted,
}: {
  msg: ExtendedMessage;
  isAdmin: boolean;
  currentUserId: number | null;
  threadId: number;
  paid: boolean;
  token: string | null;
  onToggleFinal: (msgId: number, val: boolean) => void;
  onDelete: (msgId: number) => void;
  onSeek?: (secs: number) => void;
  highlighted?: boolean;
}) {
  const initials = msg.authorName
    .split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const canDelete = isAdmin || msg.authorId === currentUserId;

  return (
    <div
      className={cn(
        "flex gap-3 group transition-colors rounded-lg",
        msg.isFinalDelivery && "bg-violet-50/60 -mx-5 px-5 py-2 rounded-none border-l-2 border-violet-400",
        highlighted && !msg.isFinalDelivery && "bg-orange-50 -mx-5 px-5 py-1 border-l-2 border-orange-400",
      )}
    >
      <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-semibold text-primary shrink-0 mt-0.5">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-sm font-medium">{msg.authorName}</span>
          <span className="text-xs text-muted-foreground">{formatTime(msg.createdAt)}</span>
          {msg.isFinalDelivery && (
            <Badge className="h-4 px-1 text-[10px] bg-violet-600">
              <Star className="h-2.5 w-2.5 mr-0.5" /> Final Delivery
            </Badge>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(msg.id)}
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-0.5 rounded"
              title="Delete message"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {msg.content && (
          <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
            {renderContent(msg.content, onSeek)}
          </p>
        )}
        {msg.fileUrl && msg.fileName && (
          <FilePreview
            url={msg.fileUrl}
            name={msg.fileName}
            size={msg.fileSize}
            isFinalDelivery={msg.isFinalDelivery}
            paid={paid}
            token={token}
          />
        )}
        {isAdmin && msg.fileUrl && (
          <button
            onClick={() => onToggleFinal(msg.id, !msg.isFinalDelivery)}
            className={cn(
              "mt-1 flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity",
              msg.isFinalDelivery ? "text-violet-600 hover:text-violet-800" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Flag className="h-2.5 w-2.5" />
            {msg.isFinalDelivery ? "Unmark as final delivery" : "Mark as final delivery"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function Messages() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Deep-link: /messages?thread=ID — pre-select a thread on load
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(() => {
    const p = new URLSearchParams(window.location.search).get("thread");
    return p ? parseInt(p) : null;
  });
  const [messageText, setMessageText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"general" | "review" | "group">("general");
  const [newDealId, setNewDealId] = useState("");
  const [newContactId, setNewContactId] = useState("none");
  const [newArtistId, setNewArtistId] = useState("none");
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const [isFinalDelivery, setIsFinalDelivery] = useState(false);
  const [liveMessages, setLiveMessages] = useState<ExtendedMessage[]>([]);
  const [livePaid, setLivePaid] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const [deleteMessageId, setDeleteMessageId] = useState<number | null>(null);
  const [deleteThreadConfirm, setDeleteThreadConfirm] = useState(false);
  const [newParticipantIds, setNewParticipantIds] = useState<number[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reviewFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const msgRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // ── Auth / role ─────────────────────────────────────────────────────────
  const { data: meData } = useQuery<{ id?: number; role?: string; permissions?: Record<string, boolean> }>({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/users/me", { headers: authH(token) });
      return r.json();
    },
    enabled: !!token,
  });
  const isAdmin = meData?.role === "owner" || meData?.role === "admin" || meData?.role === "manager" || meData?.role === "engineer" || meData?.permissions?.["messages:delete"] === true;
  const currentUserId = meData?.id ?? null;

  // ── Contacts + Artists (for thread assignment) ───────────────────────────
  const { data: contacts } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["contacts-for-threads"],
    queryFn: () => fetch("/api/contacts", { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
  });
  const { data: artists } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["artists-for-threads"],
    queryFn: () => fetch("/api/artists", { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
  });
  // ── Team members (for DMs / @mentions) ──────────────────────────────────
  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ["messages-team"],
    queryFn: () => fetch("/api/messages/team", { headers: authH(token) }).then((r) => r.json()),
    enabled: !!token,
  });

  // ── Threads / thread detail ──────────────────────────────────────────────
  const { data: threads, isLoading: threadsLoading } = useListThreads({
    query: { queryKey: getListThreadsQueryKey() },
  });

  const { data: threadDetail, isLoading: threadLoading } = useGetThread(
    selectedThreadId!,
    { query: { queryKey: getGetThreadQueryKey(selectedThreadId!), enabled: !!selectedThreadId } },
  );

  // ── Payment status ───────────────────────────────────────────────────────
  const { data: paymentStatus } = useQuery<PaymentStatus>({
    queryKey: ["payment-status", selectedThreadId],
    queryFn: async () => {
      const r = await fetch(`/api/messages/threads/${selectedThreadId}/payment-status`, { headers: authH(token) });
      return r.json();
    },
    enabled: !!token && !!selectedThreadId && !!(threadDetail as unknown as ExtendedThread)?.isFinalLocked,
    refetchInterval: 15000,
  });

  const currentThread = threadDetail as unknown as ExtendedThread | undefined;
  const paid = (paymentStatus?.paid || !currentThread?.isFinalLocked) ?? true;

  // Sync
  useEffect(() => {
    if (threadDetail?.messages) {
      setLiveMessages((threadDetail.messages as ExtendedMessage[]));
    }
    if (currentThread) setLivePaid(paid);
  }, [threadDetail?.messages, paid, currentThread]);

  // ── Socket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
    const socket = io("/", { path: `${basePath}/api/socket.io`, auth: { token }, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("message", (msg: ExtendedMessage) => {
      setLiveMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg]);
      queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
    });
    socket.on("message_deleted", ({ msgId }: { msgId: number }) => {
      setLiveMessages((prev) => prev.filter((m) => m.id !== msgId));
      queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
    });
    socket.on("thread_updated", () => {
      queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId!) });
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [token, queryClient, selectedThreadId]);

  useEffect(() => {
    if (!socketRef.current || !selectedThreadId) return;
    socketRef.current.emit("join_thread", selectedThreadId);
    return () => { socketRef.current?.emit("leave_thread", selectedThreadId); };
  }, [selectedThreadId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [liveMessages]);

  // ── Timestamp pins: parse @M:SS tokens from all messages ─────────────────
  const timePins = useMemo<TimePin[]>(() => {
    const re = /@(\d{1,2}):(\d{2})(?::(\d{2}))?/g;
    return liveMessages.flatMap((msg) => {
      const pins: TimePin[] = [];
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(msg.content)) !== null) {
        const a = parseInt(m[1]!), b = parseInt(m[2]!);
        const c = m[3] ? parseInt(m[3]!) : null;
        const secs = c != null ? a * 3600 + b * 60 + c : a * 60 + b;
        pins.push({ timeSeconds: secs, author: msg.authorName, msgId: msg.id });
      }
      return pins;
    });
  }, [liveMessages]);

  // ── Seek audio to a position ─────────────────────────────────────────────
  const seekTo = useCallback((secs: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = secs;
    audioRef.current.play().catch(() => {});
  }, []);

  // ── Insert current playback timestamp into compose box ───────────────────
  function insertTimestamp() {
    if (!audioRef.current) return;
    const t = formatAudioTime(audioRef.current.currentTime);
    setMessageText((prev) => prev + (prev && !prev.endsWith(" ") ? " " : "") + `@${t} `);
  }

  // ── Scroll to + highlight a message (from pin click) ─────────────────────
  function jumpToMessage(msgId: number) {
    setHighlightedMsgId(msgId);
    const el = msgRefs.current[msgId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightedMsgId(null), 2000);
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  const createThread = useCreateThread();
  const sendMessage = useSendMessage();
  const uploadFile = useUploadFile();

  const toggleFinal = useMutation({
    mutationFn: async ({ msgId, val }: { msgId: number; val: boolean }) => {
      const r = await fetch(`/api/messages/threads/${selectedThreadId}/messages/${msgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ isFinalDelivery: val }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId!) }),
  });

  const startDm = useMutation({
    mutationFn: async (userId: number) => {
      const r = await fetch(`/api/messages/dm/${userId}`, {
        method: "POST", headers: authH(token),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<ExtendedThread>;
    },
    onSuccess: (thread) => {
      queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
      handleSelectThread(thread.id);
    },
    onError: () => toast({ title: "Failed to open DM", variant: "destructive" }),
  });

  const addParticipant = useMutation({
    mutationFn: async (userId: number) => {
      const r = await fetch(`/api/messages/threads/${selectedThreadId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify({ userId }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId!) }),
  });

  const deleteThread = useMutation({
    mutationFn: async (threadId: number) => {
      const r = await fetch(`/api/messages/threads/${threadId}`, {
        method: "DELETE", headers: authH(token),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
      setSelectedThreadId(null);
      toast({ title: "Thread deleted" });
    },
    onError: () => toast({ title: "Failed to delete thread", variant: "destructive" }),
  });

  const removeParticipant = useMutation({
    mutationFn: async (userId: number) => {
      const r = await fetch(`/api/messages/threads/${selectedThreadId}/participants/${userId}`, {
        method: "DELETE", headers: authH(token),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId!) }),
  });

  const deleteMessage = useMutation({
    mutationFn: async (msgId: number) => {
      const r = await fetch(`/api/messages/threads/${selectedThreadId}/messages/${msgId}`, {
        method: "DELETE",
        headers: authH(token),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      setLiveMessages((prev) => prev.filter((m) => m.id !== deleteMessageId));
      queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId!) });
      queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
      toast({ title: "Message deleted" });
    },
    onError: () => toast({ title: "Failed to delete message", variant: "destructive" }),
    onSettled: () => setDeleteMessageId(null),
  });

  const patchThread = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch(`/api/messages/threads/${selectedThreadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authH(token) },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId!) });
      queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSelectThread = useCallback((id: number) => {
    setSelectedThreadId(id);
    setLiveMessages([]);
    setIsFinalDelivery(false);
    setHighlightedMsgId(null);
  }, []);

  const handleSend = async () => {
    if (!selectedThreadId) return;
    const content = messageText.trim();
    if (!content && !pendingFile) return;

    let fileUrl: string | undefined;
    let fileName: string | undefined;
    let fileSize: number | undefined;

    if (pendingFile) {
      try {
        const result = await uploadFile.mutateAsync({ data: { file: pendingFile as Blob } });
        fileUrl = result.url;
        fileName = result.name;
        fileSize = result.size ?? undefined;
      } catch { return; }
    }

    await sendMessage.mutateAsync({
      id: selectedThreadId,
      data: {
        content: content || (fileName ? `Shared a file: ${fileName}` : ""),
        fileUrl,
        fileName,
        fileSize,
        isFinalDelivery: isAdmin && isFinalDelivery ? true : undefined,
      } as Parameters<typeof sendMessage.mutateAsync>[0]["data"],
    });

    setMessageText("");
    setPendingFile(null);
    setIsFinalDelivery(false);
    queryClient.invalidateQueries({ queryKey: getGetThreadQueryKey(selectedThreadId) });
    queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
  };

  const handleCreateThread = async () => {
    if (!newTitle.trim()) return;

    let reviewFileUrl: string | undefined;
    let reviewFileName: string | undefined;

    if (reviewFile) {
      try {
        const result = await uploadFile.mutateAsync({ data: { file: reviewFile as Blob } });
        reviewFileUrl = result.url;
        reviewFileName = result.name;
      } catch { return; }
    }

    const thread = await createThread.mutateAsync({
      data: {
        title: newTitle.trim(),
        type: newType,
        dealId: newDealId ? parseInt(newDealId) : undefined,
        contactId: newContactId !== "none" ? parseInt(newContactId) : undefined,
        artistId: newArtistId !== "none" ? parseInt(newArtistId) : undefined,
        reviewFileUrl,
        reviewFileName,
        isFinalLocked: newType === "review",
        participantIds: newParticipantIds.length ? newParticipantIds : undefined,
      } as Parameters<typeof createThread.mutateAsync>[0]["data"],
    });

    queryClient.invalidateQueries({ queryKey: getListThreadsQueryKey() });
    setNewTitle(""); setNewType("general"); setNewDealId("");
    setNewContactId("none"); setNewArtistId("none"); setReviewFile(null);
    setNewParticipantIds([]);
    setCreateOpen(false);
    handleSelectThread(thread.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const extThread = threadDetail as unknown as ExtendedThread | undefined;

  // Resolve linked contact / artist names for display
  const linkedContact = extThread?.contactId
    ? contacts?.find((c) => c.id === extThread.contactId)
    : null;
  const linkedArtist = extThread?.artistId
    ? artists?.find((a) => a.id === extThread.artistId)
    : null;

  // Is this a review thread with audio?
  const hasAudioReview = extThread?.type === "review"
    && !!extThread.reviewFileUrl
    && isAudio(extThread.reviewFileName ?? "");

  return (
    <div className="flex flex-col md:flex-row flex-1 h-full overflow-hidden">
      {/* ── Thread sidebar ───────────────────────────────────────────────── */}
      <div className={cn("border-r bg-white flex flex-col shrink-0 w-full md:w-72", selectedThreadId !== null ? "hidden md:flex" : "flex")}>
        <div className="h-14 px-4 flex items-center justify-between border-b">
          <h2 className="font-semibold text-sm">Messages</h2>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8"><Plus className="h-4 w-4" /></Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader><DialogTitle>New Thread</DialogTitle></DialogHeader>
              <div className="space-y-3 pt-2">
                {/* Type selector */}
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { t: "general", icon: <MessageSquare className="h-3.5 w-3.5" />, label: "General" },
                    { t: "review",  icon: <Headphones className="h-3.5 w-3.5" />, label: "Song Review" },
                    { t: "group",   icon: <Users className="h-3.5 w-3.5" />, label: "Group" },
                  ] as const).map(({ t, icon, label }) => (
                    <button
                      key={t}
                      onClick={() => setNewType(t as typeof newType)}
                      className={cn(
                        "py-2 px-3 rounded-lg border text-sm font-medium transition-colors flex items-center gap-1.5",
                        newType === t
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {icon}{label}
                    </button>
                  ))}
                </div>

                <Input
                  placeholder={newType === "review" ? "e.g. Track 1 — rough mix" : "Thread name..."}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateThread()}
                  autoFocus
                />

                {/* Client assignment */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Link2 className="h-3 w-3" /> Link to client (optional)
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={newContactId} onValueChange={setNewContactId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Contact..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No contact</SelectItem>
                        {contacts?.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={newArtistId} onValueChange={setNewArtistId}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Artist..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No artist</SelectItem>
                        {artists?.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {newType === "group" && teamMembers.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> Add team members
                    </Label>
                    <div className="border rounded-md divide-y max-h-36 overflow-y-auto">
                      {teamMembers
                        .filter(m => m.id !== (meData?.id ?? 0))
                        .map(m => (
                          <label key={m.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={newParticipantIds.includes(m.id)}
                              onChange={e => setNewParticipantIds(prev =>
                                e.target.checked ? [...prev, m.id] : prev.filter(id => id !== m.id)
                              )}
                            />
                            <div className="h-5 w-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                              {m.name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm truncate">{m.name}</span>
                            <span className="text-xs text-muted-foreground ml-auto capitalize">{m.role}</span>
                          </label>
                        ))}
                    </div>
                    {newParticipantIds.length > 0 && (
                      <p className="text-xs text-muted-foreground">{newParticipantIds.length} member{newParticipantIds.length !== 1 ? "s" : ""} selected</p>
                    )}
                  </div>
                )}

                {newType === "review" && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Reference file (optional)</Label>
                      <div className="flex items-center gap-2">
                        <input ref={reviewFileInputRef} type="file" className="hidden" accept="audio/*,.mp3,.wav,.flac" onChange={(e) => setReviewFile(e.target.files?.[0] ?? null)} />
                        <Button type="button" size="sm" variant="outline" className="text-xs h-8" onClick={() => reviewFileInputRef.current?.click()}>
                          <Music className="h-3.5 w-3.5 mr-1.5" /> Attach reference file
                        </Button>
                        {reviewFile && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{reviewFile.name}</span>}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Linked deal ID (for payment gate)</Label>
                      <Input placeholder="Deal ID (optional)" type="number" value={newDealId} onChange={(e) => setNewDealId(e.target.value)} className="h-8 text-sm" />
                    </div>
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 flex items-start gap-1.5">
                      <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Files marked as Final Delivery will be locked until the deal's payment is confirmed.
                    </p>
                  </>
                )}

                <Button className="w-full" onClick={handleCreateThread} disabled={createThread.isPending || uploadFile.isPending}>
                  {createThread.isPending || uploadFile.isPending ? "Creating..." : "Create Thread"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ScrollArea className="flex-1">
          {/* ── Channels section ─────────────────────────────── */}
          {threadsLoading ? (
            <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : (
            <>
              {/* Regular channels */}
              {(() => {
                const channelThreads = (threads as ExtendedThread[]).filter(t => t.type !== "dm");
                return channelThreads.length > 0 ? (
                  <div className="p-2 space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 flex items-center gap-1">
                      <Hash className="h-2.5 w-2.5" /> Channels
                    </p>
                    {channelThreads.map((thread) => {
                      const tc = thread.contactId ? contacts?.find((c) => c.id === thread.contactId) : null;
                      const ta = thread.artistId ? artists?.find((a) => a.id === thread.artistId) : null;
                      const linkedLabel = tc?.name ?? ta?.name ?? null;
                      return (
                        <button
                          key={thread.id}
                          onClick={() => handleSelectThread(thread.id)}
                          className={cn(
                            "w-full text-left px-3 py-2.5 rounded-lg transition-colors",
                            selectedThreadId === thread.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                            thread.isCompleted && "opacity-60",
                          )}
                        >
                          <div className="flex items-center justify-between mb-0.5 gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {thread.type === "review" && <Headphones className="h-3 w-3 text-violet-500 shrink-0" />}
                              {thread.type === "group" && <Users className="h-3 w-3 text-sky-500 shrink-0" />}
                              {thread.isCompleted && <BadgeCheck className="h-3 w-3 text-green-600 shrink-0" />}
                              <p className={cn("text-sm font-medium truncate", thread.isCompleted && "line-through text-muted-foreground")}>{thread.title}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {thread.isFinalLocked && <Lock className="h-3 w-3 text-amber-500" />}
                              <Badge variant="secondary" className="text-xs">{thread.messageCount}</Badge>
                            </div>
                          </div>
                          {linkedLabel && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mb-0.5">
                              <Link2 className="h-2.5 w-2.5" />{linkedLabel}
                            </p>
                          )}
                          {thread.lastMessage && <p className="text-xs text-muted-foreground truncate">{thread.lastMessage}</p>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-center p-4">
                    <MessageSquare className="h-7 w-7 text-muted-foreground mb-1.5" />
                    <p className="text-sm text-muted-foreground">No channels yet</p>
                    <p className="text-xs text-muted-foreground">Click + to start one</p>
                  </div>
                );
              })()}

              {/* DM threads (existing) */}
              {(() => {
                const dmThreads = (threads as ExtendedThread[]).filter(t => t.type === "dm");
                return (
                  <div className="px-2 pb-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 flex items-center gap-1 mt-1">
                      <AtSign className="h-2.5 w-2.5" /> Direct Messages
                    </p>
                    {/* Active DM threads */}
                    {dmThreads.map(thread => {
                      const otherParticipant = thread.participants?.find(p => p.id !== currentUserId);
                      return (
                        <button
                          key={thread.id}
                          onClick={() => handleSelectThread(thread.id)}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2",
                            selectedThreadId === thread.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                          )}
                        >
                          <div className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                            {(otherParticipant?.name ?? thread.title).charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{otherParticipant?.name ?? thread.title}</p>
                            {thread.lastMessage && <p className="text-xs text-muted-foreground truncate">{thread.lastMessage}</p>}
                          </div>
                          <Badge variant="secondary" className="text-xs shrink-0">{thread.messageCount}</Badge>
                        </button>
                      );
                    })}
                    {/* Team member rows for starting new DMs */}
                    {teamMembers
                      .filter(m => m.id !== currentUserId)
                      .filter(m => !dmThreads.some(t => t.participants?.some(p => p.id === m.id)))
                      .map(m => (
                        <button
                          key={m.id}
                          onClick={() => startDm.mutate(m.id)}
                          disabled={startDm.isPending}
                          className="w-full text-left px-3 py-2 rounded-lg transition-colors hover:bg-muted flex items-center gap-2"
                        >
                          <div className="h-6 w-6 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center text-[10px] font-bold shrink-0">
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-muted-foreground truncate flex-1">{m.name}</span>
                          <UserPlus className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                        </button>
                      ))}
                  </div>
                );
              })()}
            </>
          )}
        </ScrollArea>
      </div>

      {/* ── Chat area ────────────────────────────────────────────────────── */}
      {!selectedThreadId ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg mb-1">Select a thread</h3>
          <p className="text-muted-foreground text-sm">Pick a conversation from the left, or start a new one.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="h-14 px-3 sm:px-5 flex items-center justify-between border-b bg-white shadow-sm shrink-0">
            <button
              onClick={() => setSelectedThreadId(null)}
              className="md:hidden shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground mr-1"
              aria-label="Back to threads"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            {threadLoading ? <Skeleton className="h-5 w-40" /> : (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {extThread?.type === "review" && <Headphones className="h-4 w-4 text-violet-500 shrink-0" />}
                <h3 className={cn("font-semibold truncate", extThread?.isCompleted && "line-through text-muted-foreground")}>{extThread?.title}</h3>
                {extThread?.isCompleted && (
                  <Badge className="text-xs gap-1 shrink-0 bg-green-100 text-green-700 border-green-200">
                    <BadgeCheck className="h-3 w-3" /> Completed
                  </Badge>
                )}
                {extThread?.isFinalLocked && (
                  <Badge variant="outline" className={cn(
                    "text-xs gap-1 shrink-0",
                    paid ? "border-green-300 text-green-700" : "border-amber-300 text-amber-700",
                  )}>
                    {paid ? <CheckCircle2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {paid ? "Payment confirmed" : "Awaiting payment"}
                  </Badge>
                )}
                {(linkedContact || linkedArtist) && (
                  <Badge variant="outline" className="text-xs gap-1 shrink-0 border-blue-200 text-blue-700">
                    <Link2 className="h-3 w-3" />
                    {linkedContact?.name ?? linkedArtist?.name}
                  </Badge>
                )}
              </div>
            )}
            {/* Thread actions menu */}
            {isAdmin && !threadLoading && extThread && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 ml-1">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={() => patchThread.mutate({ isCompleted: !extThread.isCompleted })}
                  >
                    {extThread.isCompleted
                      ? <><ArchiveX className="h-4 w-4 mr-2 text-muted-foreground" /> Reopen thread</>
                      : <><BadgeCheck className="h-4 w-4 mr-2 text-green-600" /> Mark as completed</>}
                  </DropdownMenuItem>
                  {extThread.isFinalLocked && !paid && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          patchThread.mutate({ manuallyPaid: true });
                          toast({ title: "Payment marked as received" });
                        }}
                      >
                        <DollarSign className="h-4 w-4 mr-2 text-emerald-600" />
                        Mark payment received
                      </DropdownMenuItem>
                    </>
                  )}
                  {extThread.isFinalLocked && extThread.manuallyPaid && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => {
                          patchThread.mutate({ manuallyPaid: false });
                          toast({ title: "Payment mark removed" });
                        }}
                        className="text-muted-foreground"
                      >
                        <CreditCard className="h-4 w-4 mr-2" />
                        Unmark manual payment
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteThreadConfirm(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete thread
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Review reference file player */}
          {extThread?.type === "review" && extThread?.reviewFileUrl && extThread?.reviewFileName && (
            <ReviewPlayer
              fileUrl={extThread.reviewFileUrl}
              fileName={extThread.reviewFileName}
              paid={paid}
              audioRef={audioRef}
              pins={timePins}
              onPinClick={jumpToMessage}
              token={token}
            />
          )}

          {/* Messages */}
          <ScrollArea className="flex-1 px-5 py-4">
            {threadLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-2">
                    <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                    <Skeleton className="h-16 w-64 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {liveMessages.map((msg) => (
                  <div
                    key={msg.id}
                    ref={(el) => { msgRefs.current[msg.id] = el; }}
                  >
                    <MessageBubble
                      msg={msg}
                      isAdmin={isAdmin}
                      currentUserId={currentUserId}
                      threadId={selectedThreadId}
                      paid={paid}
                      token={token}
                      onToggleFinal={(msgId, val) => toggleFinal.mutate({ msgId, val })}
                      onDelete={(msgId) => setDeleteMessageId(msgId)}
                      onSeek={hasAudioReview ? seekTo : undefined}
                      highlighted={highlightedMsgId === msg.id}
                    />
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </ScrollArea>

          {/* Compose */}
          <div className="border-t bg-white p-4 shrink-0">
            {pendingFile && (
              <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-muted rounded-lg text-sm">
                {pendingFile.type.startsWith("image/") ? (
                  <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : isAudio(pendingFile.name) ? (
                  <Music className="h-4 w-4 text-violet-500 shrink-0" />
                ) : isVideo(pendingFile.name) || pendingFile.type.startsWith("video/") ? (
                  <Film className="h-4 w-4 text-blue-500 shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="truncate flex-1">{pendingFile.name}</span>
                {isAdmin && (
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={isFinalDelivery}
                      onChange={(e) => setIsFinalDelivery(e.target.checked)}
                    />
                    <Star className="h-3 w-3 text-violet-600" />
                    Final delivery
                  </label>
                )}
                <button onClick={() => { setPendingFile(null); setIsFinalDelivery(false); }}>
                  <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            )}
            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                accept="image/*,.pdf,.doc,.docx,.txt,.csv,audio/*,.mp3,.wav,.flac,.aif,.aiff,video/*,.mp4,.mov,.webm,.avi,.mkv"
              />
              <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="h-4 w-4" />
              </Button>

              {/* Insert current audio timestamp */}
              {hasAudioReview && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-50 shrink-0 gap-1"
                  onClick={insertTimestamp}
                  title="Insert current playback time as a comment pin"
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  @time
                </Button>
              )}

              <Textarea
                className="flex-1 min-h-[36px] max-h-32 resize-none"
                placeholder={
                  hasAudioReview
                    ? "Comment on this track… use @time or click @time button to pin a position"
                    : extThread?.type === "review"
                    ? "Leave a comment on this track..."
                    : "Write a message..."
                }
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={handleSend}
                disabled={(!messageText.trim() && !pendingFile) || sendMessage.isPending || uploadFile.isPending}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 pl-11">
              Enter to send · Shift+Enter for new line
              {hasAudioReview && " · Type @2:53 to pin a track position"}
            </p>
          </div>
        </div>
      )}

      {/* Delete thread confirmation */}
      <AlertDialog open={deleteThreadConfirm} onOpenChange={setDeleteThreadConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this thread?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{extThread?.title}</strong> and all its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => selectedThreadId && deleteThread.mutate(selectedThreadId)}
              disabled={deleteThread.isPending}
            >
              {deleteThread.isPending ? "Deleting…" : "Delete thread"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete message confirmation */}
      <AlertDialog open={!!deleteMessageId} onOpenChange={(open) => { if (!open) setDeleteMessageId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>This message will be permanently removed from the thread.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMessageId && deleteMessage.mutate(deleteMessageId)}
              disabled={deleteMessage.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
