import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";

// ── Local types (mirror server schema) ───────────────────────────────────────
interface TextBlock    { id: string; type: "text";    content: string }
interface HeadingBlock { id: string; type: "heading"; text: string; level: 1 | 2 | 3 }
interface ImageBlock   { id: string; type: "image";   url: string; alt?: string; caption?: string }
interface VideoBlock   { id: string; type: "video";   url: string; title?: string }
interface AudioBlock   { id: string; type: "audio";   url: string; title?: string }
interface EmbedBlock   { id: string; type: "embed";   url: string; title?: string }
interface DividerBlock { id: string; type: "divider" }
interface GridBlock    { id: string; type: "grid";    columns: 2 | 3; children: ContentBlock[] }
type ContentBlock = TextBlock | HeadingBlock | ImageBlock | VideoBlock | AudioBlock | EmbedBlock | DividerBlock | GridBlock;

interface ProjectPage {
  id: number; title: string; slug: string; description?: string | null;
  blocks: ContentBlock[]; status: "draft" | "published";
}

// ── Media helpers ─────────────────────────────────────────────────────────────

function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^?#&/]+)/);
  return m?.[1] ?? null;
}

function getVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m?.[1] ?? null;
}

// ── Block renderers ───────────────────────────────────────────────────────────

function VideoPlayer({ url, title }: { url: string; title?: string }) {
  const ytId = getYouTubeId(url);
  const viId = getVimeoId(url);

  const iframe = ytId
    ? `https://www.youtube.com/embed/${ytId}`
    : viId
    ? `https://player.vimeo.com/video/${viId}`
    : null;

  return (
    <div className="rounded-xl overflow-hidden shadow-md bg-black">
      {title && (
        <p className="px-4 py-2 text-sm font-medium text-white/80 bg-zinc-900">{title}</p>
      )}
      {iframe ? (
        <div className="aspect-video">
          <iframe
            src={iframe}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="w-full h-full"
          />
        </div>
      ) : (
        <video src={url} controls className="w-full" />
      )}
    </div>
  );
}

function AudioPlayer({ url, title }: { url: string; title?: string }) {
  return (
    <div className="rounded-xl bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-100 p-4">
      {title && <p className="text-sm font-semibold text-violet-800 mb-3">{title}</p>}
      <audio controls src={url} className="w-full" />
    </div>
  );
}

function EmbedBlock({ url, title }: { url: string; title?: string }) {
  return (
    <div className="rounded-xl overflow-hidden border shadow-sm">
      {title && (
        <p className="px-4 py-2 text-sm font-medium bg-zinc-50 border-b text-zinc-700">{title}</p>
      )}
      <div className="aspect-video">
        <iframe
          src={url}
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="w-full h-full"
        />
      </div>
    </div>
  );
}

function BlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3";
      const cls = block.level === 1
        ? "text-3xl font-bold text-zinc-900"
        : block.level === 2
        ? "text-2xl font-semibold text-zinc-800"
        : "text-xl font-semibold text-zinc-700";
      return <Tag className={cls}>{block.text}</Tag>;
    }

    case "text":
      return (
        <p className="text-zinc-700 leading-relaxed whitespace-pre-wrap">
          {block.content}
        </p>
      );

    case "image":
      return (
        <figure className="space-y-2">
          <img
            src={block.url}
            alt={block.alt ?? ""}
            className="w-full rounded-xl shadow-md object-cover"
          />
          {block.caption && (
            <figcaption className="text-center text-sm text-zinc-500 italic">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );

    case "video":
      return <VideoPlayer url={block.url} title={block.title} />;

    case "audio":
      return <AudioPlayer url={block.url} title={block.title} />;

    case "embed":
      return <EmbedBlock url={block.url} title={block.title} />;

    case "divider":
      return <hr className="border-zinc-200" />;

    case "grid":
      return (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))` }}
        >
          {block.children.map((child) => (
            <div key={child.id} className="min-w-0">
              <BlockRenderer block={child} />
            </div>
          ))}
        </div>
      );

    default:
      return null;
  }
}

// ── Public page ───────────────────────────────────────────────────────────────

export default function ProjectPageView() {
  const [, params] = useRoute("/p/:slug");
  const slug = params?.slug ?? "";

  const { data: page, isLoading, error } = useQuery<ProjectPage>({
    queryKey: ["public-page", slug],
    queryFn: async () => {
      const r = await fetch(`/api/pages/public/${slug}`);
      if (!r.ok) throw new Error("Page not found");
      return r.json();
    },
    enabled: !!slug,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3 text-zinc-500">
        <p className="text-5xl">404</p>
        <p className="text-lg">Page not found</p>
      </div>
    );
  }

  const blocks = page.blocks as ContentBlock[];

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center">
          <span className="font-semibold text-zinc-900 truncate">{page.title}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        {page.description && (
          <p className="text-zinc-500 text-lg leading-relaxed">{page.description}</p>
        )}

        {blocks.length === 0 && (
          <p className="text-zinc-400 text-center py-20">This page has no content yet.</p>
        )}

        {blocks.map((block) => (
          <div key={block.id}>
            <BlockRenderer block={block} />
          </div>
        ))}
      </main>
    </div>
  );
}
