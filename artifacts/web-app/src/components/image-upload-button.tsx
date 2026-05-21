import { useRef, useState } from "react";
import { Loader2, Upload, ImagePlus, Music } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ImageUploadButtonProps {
  token: string | null;
  onUpload: (url: string) => void;
  onError?: (msg: string) => void;
  className?: string;
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default" | "lg" | "icon";
  label?: string;
  icon?: "upload" | "image";
  disabled?: boolean;
}

export function ImageUploadButton({
  token,
  onUpload,
  onError,
  className,
  variant = "outline",
  size = "sm",
  label,
  icon = "image",
  disabled = false,
}: ImageUploadButtonProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/api/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Upload failed");
      }
      const data = (await res.json()) as { url: string };
      onUpload(data.url);
    } catch (err) {
      onError?.((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const Icon = uploading ? Loader2 : icon === "image" ? ImagePlus : Upload;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn("gap-1.5 shrink-0", className)}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        title={label ?? "Upload image"}
      >
        <Icon className={cn("h-4 w-4", uploading && "animate-spin")} />
        {label && <span>{label}</span>}
      </Button>
    </>
  );
}

interface AudioUploadButtonProps {
  token: string | null;
  onUpload: (url: string) => void;
  onError?: (msg: string) => void;
  className?: string;
  label?: string;
  disabled?: boolean;
}

export function AudioUploadButton({
  token, onUpload, onError, className, label = "Upload audio", disabled = false,
}: AudioUploadButtonProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${BASE}/api/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token ?? ""}` },
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Upload failed");
      }
      const data = (await res.json()) as { url: string };
      onUpload(data.url);
    } catch (err) {
      onError?.((err as Error).message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/wav,audio/aac,audio/m4a,audio/ogg,audio/flac,audio/*"
        className="hidden"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("gap-1.5 shrink-0", className)}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading}
        title={label}
      >
        {uploading
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Music className="h-3.5 w-3.5" />
        }
        <span>{uploading ? "Uploading…" : label}</span>
      </Button>
    </>
  );
}

/**
 * Appends ?token=<jwt> to internal storage URLs so <img> tags can load them.
 * External URLs (http/https) are returned unchanged.
 */
export function getStorageImgSrc(url: string | null | undefined, token: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/storage/")) return `${url}?token=${encodeURIComponent(token ?? "")}`;
  return url;
}
