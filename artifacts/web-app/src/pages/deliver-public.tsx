import { useState, useRef, useEffect, useCallback } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Music, Film, Download, MessageSquare, Clock, Send, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import WaveSurfer from "wavesurfer.js";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface DeliverableInfo {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
  dealTitle: string | null;
  hasPassword: boolean;
  expired: boolean;
}

interface Comment {
  id: number;
  authorName: string;
  authorEmail: string | null;
  timestampSeconds: number | null;
  body: string;
  createdAt: string;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTs(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ── WaveSurfer audio player ───────────────────────────────────────────────────

interface WaveMarker { time: number; label: string; }

function AudioWaveform({
  src,
  onTimeUpdate,
  markers = [],
}: {
  src: string;
  onTimeUpdate: (t: number) => void;
  markers?: WaveMarker[];
}) {
  const wrapperRef    = useRef<HTMLDivElement>(null);
  const containerRef  = useRef<HTMLDivElement>(null);
  const wsRef         = useRef<WaveSurfer | null>(null);
  const cbRef         = useRef(onTimeUpdate);
  const [playing,     setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(false);

  // Keep callback ref fresh without re-creating the WaveSurfer instance
  useEffect(() => { cbRef.current = onTimeUpdate; }, [onTimeUpdate]);

  useEffect(() => {
    if (!containerRef.current) return;
    setLoading(true);
    setError(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const ws = WaveSurfer.create({
      container:     containerRef.current,
      waveColor:     "#6d28d9",
      progressColor: "#a78bfa",
      cursorColor:   "#ddd6fe",
      barWidth:      3,
      barRadius:     3,
      barGap:        2,
      height:        80,
      normalize:     true,
      url:           src,
    });
    wsRef.current = ws;

    ws.on("ready",      () => { setDuration(ws.getDuration()); setLoading(false); });
    ws.on("timeupdate", (t) => { setCurrentTime(t); cbRef.current(t); });
    ws.on("play",       () => setPlaying(true));
    ws.on("pause",      () => setPlaying(false));
    ws.on("finish",     () => setPlaying(false));
    ws.on("error",      () => { setError(true); setLoading(false); });

    return () => { ws.destroy(); wsRef.current = null; };
  }, [src]);

  const togglePlay = () => { wsRef.current?.playPause(); };

  const seekToMarker = (time: number) => {
    if (!wsRef.current || duration === 0) return;
    wsRef.current.seekTo(Math.min(time / duration, 1));
  };

  if (error) {
    return (
      <div className="p-6 flex items-center justify-center text-zinc-500 text-sm">
        Could not load audio waveform. Try downloading the file.
      </div>
    );
  }

  // Flags are only visible once we know the duration
  const timedMarkers = duration > 0
    ? markers.filter(m => m.time >= 0 && m.time <= duration)
    : [];

  return (
    <div className="p-6 flex flex-col items-center gap-4">
      <div className="flex items-center gap-4 w-full max-w-xl">
        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          disabled={loading}
          className="shrink-0 h-12 w-12 rounded-full bg-violet-700 hover:bg-violet-600 disabled:bg-zinc-700 flex items-center justify-center transition-colors"
        >
          {loading ? (
            <div className="h-4 w-4 border-2 border-violet-300 border-t-transparent rounded-full animate-spin" />
          ) : playing ? (
            <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="h-5 w-5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Waveform + flag overlay */}
        <div className="flex-1 relative" ref={wrapperRef}>
          {/* Loading skeleton */}
          {loading && (
            <div className="h-[80px] flex items-center gap-1 px-2">
              {Array.from({ length: 40 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 bg-violet-800/50 rounded-full animate-pulse"
                  style={{ height: `${20 + Math.random() * 60}%`, animationDelay: `${i * 30}ms` }}
                />
              ))}
            </div>
          )}

          {/* WaveSurfer canvas */}
          <div ref={containerRef} className={loading ? "hidden" : ""} />

          {/* Timestamp flags */}
          {!loading && timedMarkers.map((m, i) => {
            const pct = (m.time / duration) * 100;
            return (
              <button
                key={i}
                onClick={() => seekToMarker(m.time)}
                title={`${m.label} — ${formatTs(m.time)}`}
                style={{ left: `${pct}%` }}
                className="absolute -top-1 -translate-x-1/2 flex flex-col items-center group z-10"
              >
                {/* Pin head */}
                <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-amber-600 shadow-md group-hover:scale-125 transition-transform flex items-center justify-center">
                  <span className="text-[6px] font-bold text-amber-900">{i + 1}</span>
                </div>
                {/* Stem */}
                <div className="w-px h-3 bg-amber-400/60" />
                {/* Tooltip on hover */}
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none">
                  <div className="bg-zinc-800 border border-zinc-600 text-zinc-100 text-[10px] rounded px-2 py-1 whitespace-nowrap max-w-[140px] truncate shadow-lg">
                    {formatTs(m.time)} · {m.label}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-500 font-mono">
        <span>{formatTs(Math.floor(currentTime))} / {formatTs(Math.floor(duration))}</span>
        {timedMarkers.length > 0 && (
          <span className="text-amber-500/70 font-sans">
            {timedMarkers.length} flag{timedMarkers.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeliverPublicPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [info, setInfo] = useState<DeliverableInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [streamToken, setStreamToken] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [stampComment, setStampComment] = useState(false);

  const [approving, setApproving] = useState(false);
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [approverName, setApproverName] = useState("");
  const [approvedLocal, setApprovedLocal] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Fetch deliverable metadata
  useEffect(() => {
    fetch(`${BASE}/api/deliverables/share/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setInfo(d);
        if (!d.hasPassword && !d.expired) {
          requestStreamToken("").then(st => { if (st) loadComments(st); });
        }
      })
      .catch(() => setError("Failed to load"));
  }, [token]);

  // Returns the issued stream token string on success, or null on failure.
  const requestStreamToken = useCallback(async (pw: string): Promise<string | null> => {
    const r = await fetch(`${BASE}/api/deliverables/share/${token}/stream-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    }).catch(() => null);
    if (!r || !r.ok) return null;
    const data = await r.json();
    if (data.streamToken) { setStreamToken(data.streamToken); return data.streamToken as string; }
    return null;
  }, [token]);

  // loadComments is called after we have a streamToken, so pass it for password-protected links
  const loadComments = useCallback(async (currentStreamToken?: string) => {
    setLoadingComments(true);
    try {
      const t = currentStreamToken ?? streamToken;
      const qs = t ? `?t=${encodeURIComponent(t)}` : "";
      const r = await fetch(`${BASE}/api/deliverables/share/${token}/comments${qs}`);
      const data = await r.json();
      if (Array.isArray(data)) setComments(data);
    } finally {
      setLoadingComments(false);
    }
  }, [token, streamToken]);

  const handleUnlock = async () => {
    const st = await requestStreamToken(password);
    if (st) {
      loadComments(st);
    } else {
      toast({ title: "Wrong password", variant: "destructive" });
    }
  };

  const streamUrl = streamToken
    ? `${BASE}/api/deliverables/share/${token}/stream?t=${encodeURIComponent(streamToken)}`
    : "";

  const handleSubmitComment = async () => {
    if (!authorName.trim() || !commentBody.trim()) {
      toast({ title: "Name and comment are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        authorName: authorName.trim(),
        body: commentBody.trim(),
        sharePassword: info?.hasPassword ? password : undefined,
      };
      if (authorEmail.trim()) body.authorEmail = authorEmail.trim();
      if (stampComment && currentTime > 0) body.timestampSeconds = Math.floor(currentTime);

      const r = await fetch(`${BASE}/api/deliverables/share/${token}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error || "Failed", variant: "destructive" }); return; }
      setComments(prev => [...prev, data]);
      setCommentBody("");
      toast({ title: "Comment added" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!approverName.trim()) {
      toast({ title: "Please enter your name to approve", variant: "destructive" });
      return;
    }
    setApproving(true);
    try {
      const r = await fetch(`${BASE}/api/deliverables/share/${token}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverName: approverName.trim(),
          sharePassword: info?.hasPassword ? password : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) { toast({ title: data.error || "Approval failed", variant: "destructive" }); return; }
      setApprovedLocal(true);
      setShowApproveForm(false);
      await loadComments();
      toast({ title: "Deliverable approved!" });
    } finally {
      setApproving(false);
    }
  };

  const isVideo = info?.mimeType.startsWith("video/");
  const isAudio = info?.mimeType.startsWith("audio/");
  const isUnlocked = !!streamToken;
  const effectiveStatus = approvedLocal ? "approved" : info?.status;

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white p-6">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">🎵</div>
          <h1 className="text-2xl font-bold mb-2">Unavailable</h1>
          <p className="text-zinc-400">{error}</p>
          <p className="text-sm text-zinc-600 mt-4">Doubtless Productions</p>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!info) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 animate-pulse">Loading deliverable…</div>
      </div>
    );
  }

  // ── Expired ────────────────────────────────────────────────────────────────
  if (info.expired) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white p-6">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Link Expired</h1>
          <p className="text-zinc-400 mb-1">
            The share link for <span className="text-white font-medium">{info.originalName}</span> has expired.
          </p>
          {info.dealTitle && (
            <p className="text-zinc-500 text-sm mb-4">Project: {info.dealTitle}</p>
          )}
          <p className="text-zinc-500 text-sm">Please contact Doubtless Productions for a new link.</p>
          <p className="text-sm text-zinc-700 mt-6">Doubtless Productions</p>
        </div>
      </div>
    );
  }

  // ── Password gate ──────────────────────────────────────────────────────────
  if (info.hasPassword && !isUnlocked) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 max-w-sm w-full text-center">
          <Lock className="h-10 w-10 text-violet-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-1">Password Protected</h2>
          {info.dealTitle && (
            <p className="text-zinc-500 text-sm mb-2">{info.dealTitle}</p>
          )}
          <p className="text-zinc-400 text-sm mb-6">Enter the password to access this deliverable.</p>
          <Input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleUnlock()}
            className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600 mb-4"
          />
          <Button onClick={handleUnlock} className="w-full bg-violet-600 hover:bg-violet-700">
            Unlock
          </Button>
          <p className="text-xs text-zinc-600 mt-6">Doubtless Productions</p>
        </div>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="bg-violet-900/50 border border-violet-700/50 rounded-xl p-2.5">
            {isVideo ? <Film className="h-5 w-5 text-violet-400" /> : <Music className="h-5 w-5 text-violet-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold truncate">{info.originalName}</h1>
            <div className="flex items-center gap-3 text-xs text-zinc-500 mt-0.5">
              {info.dealTitle && <span className="text-violet-400">{info.dealTitle}</span>}
              {info.dealTitle && <span>·</span>}
              <span>{formatBytes(info.sizeBytes)}</span>
              <span>·</span>
              <span>{format(new Date(info.createdAt), "MMM d, yyyy")}</span>
              <span>·</span>
              <Badge className={
                effectiveStatus === "approved" ? "bg-emerald-900/50 text-emerald-300 border-emerald-800" :
                effectiveStatus === "shared" ? "bg-blue-900/50 text-blue-300 border-blue-800" :
                "bg-zinc-800 text-zinc-400 border-zinc-700"
              } variant="outline">
                {effectiveStatus}
              </Badge>
            </div>
          </div>
          {streamUrl && (
            <a
              href={streamUrl}
              download={info.originalName}
              className="inline-flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          )}
        </div>

        {/* Media player */}
        {streamUrl && (
          <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
            {isVideo ? (
              <video
                ref={videoRef}
                src={streamUrl}
                controls
                className="w-full max-h-[480px] bg-black"
                onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
              />
            ) : isAudio ? (
              <AudioWaveform
                src={streamUrl}
                onTimeUpdate={setCurrentTime}
                markers={comments
                  .filter(c => c.timestampSeconds !== null)
                  .map(c => ({ time: c.timestampSeconds!, label: c.authorName }))
                }
              />
            ) : (
              <div className="p-8 text-center text-zinc-500">Preview not available for this file type.</div>
            )}
          </div>
        )}

        {/* Approve section */}
        {effectiveStatus !== "approved" && !approvedLocal && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
            {!showApproveForm ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white text-sm">Ready to approve?</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    If you're happy with this deliverable, click approve and we'll mark it as complete.
                  </p>
                </div>
                <Button
                  onClick={() => setShowApproveForm(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 ml-4"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />Approve
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="font-semibold text-white text-sm">Confirm approval</p>
                <Input
                  placeholder="Your name *"
                  value={approverName}
                  onChange={e => setApproverName(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600"
                />
                <div className="flex gap-3">
                  <Button
                    onClick={handleApprove}
                    disabled={approving || !approverName.trim()}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    {approving ? "Approving…" : "Confirm Approval"}
                  </Button>
                  <Button variant="outline" onClick={() => setShowApproveForm(false)} className="border-zinc-700 text-zinc-400">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {approvedLocal && (
          <div className="bg-emerald-950/50 border border-emerald-800 rounded-2xl p-5 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-300 text-sm">Approved</p>
              <p className="text-emerald-700 text-xs">Thank you! Doubtless Productions has been notified.</p>
            </div>
          </div>
        )}

        {/* Comments / Feedback */}
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
          <h2 className="font-bold text-base flex items-center gap-2 mb-5">
            <MessageSquare className="h-4 w-4 text-violet-400" />
            Feedback & Comments
          </h2>

          <div className="space-y-3 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <Input
                placeholder="Your name *"
                value={authorName}
                onChange={e => setAuthorName(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600"
              />
              <Input
                placeholder="Email (optional)"
                value={authorEmail}
                onChange={e => setAuthorEmail(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600"
              />
            </div>
            <Textarea
              placeholder="Leave your feedback here..."
              value={commentBody}
              onChange={e => setCommentBody(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-600 resize-none h-24"
            />
            {(isVideo || isAudio) && currentTime > 0 && (
              <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={stampComment}
                  onChange={e => setStampComment(e.target.checked)}
                  className="accent-violet-500"
                />
                <Clock className="h-3.5 w-3.5" />
                Attach timestamp <span className="text-violet-400 font-mono">{formatTs(Math.floor(currentTime))}</span>
              </label>
            )}
            <Button
              onClick={handleSubmitComment}
              disabled={submitting}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              <Send className="h-4 w-4 mr-2" />
              {submitting ? "Submitting…" : "Submit Feedback"}
            </Button>
          </div>

          <div className="border-t border-zinc-800 pt-5">
            {loadingComments ? (
              <p className="text-zinc-600 text-sm">Loading comments…</p>
            ) : comments.length === 0 ? (
              <p className="text-zinc-600 text-sm italic">No comments yet. Be the first to leave feedback.</p>
            ) : (
              <div className="space-y-4">
                {comments.map(c => (
                  <div key={c.id} className={`border rounded-xl p-4 ${
                    c.body.startsWith("✓ Approved")
                      ? "bg-emerald-950/30 border-emerald-800/50"
                      : "bg-zinc-800/60 border-zinc-700/50"
                  }`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-semibold text-sm text-white">{c.authorName}</span>
                        {c.authorEmail && (
                          <span className="text-zinc-500 text-xs ml-2">{c.authorEmail}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.timestampSeconds !== null && (
                          <span className="text-xs bg-violet-900/50 text-violet-300 border border-violet-800 rounded px-2 py-0.5 font-mono">
                            {formatTs(c.timestampSeconds)}
                          </span>
                        )}
                        <span className="text-xs text-zinc-600">{format(new Date(c.createdAt), "MMM d, HH:mm")}</span>
                      </div>
                    </div>
                    <p className="text-sm text-zinc-300 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-zinc-700 pb-4">
          Powered by <span className="text-zinc-500">Doubtless Productions</span>
        </div>
      </div>
    </div>
  );
}
