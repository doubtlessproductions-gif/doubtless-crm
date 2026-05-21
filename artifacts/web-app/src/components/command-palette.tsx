import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useGlobalSearch } from "@workspace/api-client-react";
import { Search, Users, Trello, Music, FileText, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

type ResultItem = {
  id: number;
  label: string;
  sub?: string;
  href: string;
  group: string;
  icon: React.ReactNode;
};

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Contacts: <Users className="h-3.5 w-3.5" />,
  Deals: <Trello className="h-3.5 w-3.5" />,
  Artists: <Music className="h-3.5 w-3.5" />,
  Templates: <FileText className="h-3.5 w-3.5" />,
};

const NAV_SHORTCUTS = [
  { label: "Dashboard", href: "/dashboard", icon: "🏠" },
  { label: "Pipeline", href: "/pipeline", icon: "📋" },
  { label: "Contacts", href: "/contacts", icon: "👥" },
  { label: "Artists", href: "/artists", icon: "🎵" },
  { label: "Messages", href: "/messages", icon: "💬" },
  { label: "Analytics", href: "/analytics", icon: "📊" },
  { label: "Templates", href: "/templates", icon: "📝" },
  { label: "Payments", href: "/payments", icon: "💳" },
  { label: "Calendar", href: "/calendar", icon: "📅" },
];

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results, isFetching } = useGlobalSearch(
    { q: query },
    { query: { enabled: query.length >= 2, queryKey: ["globalSearch", query] } },
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Build flat result list
  const items: ResultItem[] = [];
  if (query.length >= 2 && results) {
    results.contacts?.forEach((c) =>
      items.push({ id: c.id, label: c.name, sub: c.company ?? c.email ?? "", href: `/contacts`, group: "Contacts", icon: GROUP_ICONS["Contacts"] }),
    );
    results.deals?.forEach((d) =>
      items.push({ id: d.id, label: d.title, sub: d.stage, href: `/pipeline`, group: "Deals", icon: GROUP_ICONS["Deals"] }),
    );
    results.artists?.forEach((a) =>
      items.push({ id: a.id, label: a.name, sub: a.genre ?? a.labelStatus?.join(", "), href: `/artists`, group: "Artists", icon: GROUP_ICONS["Artists"] }),
    );
    results.templates?.forEach((t) =>
      items.push({ id: t.id, label: t.title, sub: t.type, href: `/templates`, group: "Templates", icon: GROUP_ICONS["Templates"] }),
    );
  }

  const navFiltered = query.length < 2
    ? NAV_SHORTCUTS
    : NAV_SHORTCUTS.filter((n) => n.label.toLowerCase().includes(query.toLowerCase()));

  function navigate(href: string) {
    setLocation(href);
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    const total = items.length + navFiltered.length;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % Math.max(total, 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i - 1 + Math.max(total, 1)) % Math.max(total, 1)); }
    if (e.key === "Escape") onClose();
    if (e.key === "Enter") {
      if (activeIdx < items.length) navigate(items[activeIdx]!.href);
      else {
        const navIdx = activeIdx - items.length;
        if (navFiltered[navIdx]) navigate(navFiltered[navIdx]!.href);
      }
    }
  }

  if (!open) return null;

  const grouped = items.reduce<Record<string, ResultItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group]!.push(item);
    return acc;
  }, {});

  let globalIdx = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          {isFetching ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
          ) : (
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKey}
            className="flex-1 text-sm outline-none placeholder:text-muted-foreground bg-transparent"
            placeholder="Search contacts, deals, artists, templates..."
          />
          <kbd className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {/* API results grouped */}
          {Object.entries(grouped).map(([group, groupItems]) => (
            <div key={group}>
              <div className="px-4 pt-3 pb-1 flex items-center gap-1.5">
                <span className="text-muted-foreground">{GROUP_ICONS[group]}</span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{group}</span>
              </div>
              {groupItems.map((item) => {
                const idx = globalIdx++;
                return (
                  <button
                    key={`${group}-${item.id}`}
                    onClick={() => navigate(item.href)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      activeIdx === idx ? "bg-primary/8" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="text-muted-foreground">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.label}</p>
                      {item.sub && <p className="text-xs text-muted-foreground truncate capitalize">{item.sub}</p>}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          ))}

          {/* Nav shortcuts */}
          {navFiltered.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {query.length < 2 ? "Quick Navigation" : "Pages"}
                </span>
              </div>
              {navFiltered.map((nav) => {
                const idx = globalIdx++;
                return (
                  <button
                    key={nav.href}
                    onClick={() => navigate(nav.href)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      activeIdx === idx ? "bg-primary/8" : "hover:bg-muted/50",
                    )}
                  >
                    <span className="text-base leading-none">{nav.icon}</span>
                    <p className="text-sm font-medium flex-1">{nav.label}</p>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {query.length >= 2 && items.length === 0 && !isFetching && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No results for &quot;{query}&quot;
            </div>
          )}
        </div>

        <div className="border-t px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span><kbd className="border rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border rounded px-1">↵</kbd> open</span>
          <span><kbd className="border rounded px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
