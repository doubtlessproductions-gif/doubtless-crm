import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Globe, Edit2, Trash2, Eye, ExternalLink } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { format } from "date-fns";

interface ProjectPage {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function ProjectPages() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [deletePageId, setDeletePageId] = useState<number | null>(null);
  const { data: me } = useGetMe({ query: { queryKey: getGetMeQueryKey() } });
  const canDelete = me?.role === "owner" || me?.role === "admin" || me?.permissions?.["projects:delete"] === true;

  const authH = (): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}` } : {};

  const { data: pages = [], isLoading } = useQuery<ProjectPage[]>({
    queryKey: ["project-pages"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/pages`, { headers: authH() });
      if (!r.ok) throw new Error("Failed to load pages");
      return r.json();
    },
    enabled: !!token,
  });

  const publishMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/pages/${id}/publish`, {
        method: "POST",
        headers: authH(),
      });
      if (!r.ok) throw new Error("Failed to toggle publish");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-pages"] }),
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/pages/${id}`, {
        method: "DELETE",
        headers: authH(),
      });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-pages"] });
      toast({ title: "Page deleted" });
    },
    onError: () => toast({ title: "Failed to delete page", variant: "destructive" }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-white shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-violet-500" />
          <div>
            <h1 className="text-lg font-semibold text-zinc-900">Project Pages</h1>
            <p className="text-xs text-zinc-500">Build rich block-based pages and share with clients</p>
          </div>
        </div>
        <Button onClick={() => setLocation("/pages/builder")} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Page
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />
            ))}
          </div>
        ) : pages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center gap-3">
            <Globe className="h-10 w-10 text-zinc-300" />
            <p className="text-zinc-500 font-medium">No pages yet</p>
            <p className="text-zinc-400 text-sm max-w-sm">
              Create block-based project pages with video, audio, images, and text.
            </p>
            <Button onClick={() => setLocation("/pages/builder")} size="sm" className="mt-2">
              <Plus className="h-4 w-4 mr-1.5" />
              Create your first page
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {pages.map((page) => (
              <div
                key={page.id}
                className="flex items-center gap-4 px-4 py-3 bg-white border rounded-xl hover:border-violet-200 hover:shadow-sm transition-all group"
              >
                {/* Status indicator */}
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    page.status === "published" ? "bg-emerald-400" : "bg-zinc-300"
                  }`}
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-zinc-900 truncate">{page.title}</span>
                    <Badge
                      variant="outline"
                      className={
                        page.status === "published"
                          ? "text-emerald-700 border-emerald-200 bg-emerald-50 text-xs"
                          : "text-zinc-500 border-zinc-200 bg-zinc-50 text-xs"
                      }
                    >
                      {page.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-zinc-400 font-mono">/p/{page.slug}</span>
                    {page.description && (
                      <span className="text-xs text-zinc-400 truncate max-w-xs">
                        {page.description}
                      </span>
                    )}
                    <span className="text-xs text-zinc-300">
                      {format(new Date(page.updatedAt), "MMM d, yyyy")}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {page.status === "published" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-zinc-500"
                      onClick={() => window.open(`/p/${page.slug}`, "_blank")}
                      title="View public page"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => publishMutation.mutate(page.id)}
                    disabled={publishMutation.isPending}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    {page.status === "published" ? "Unpublish" : "Publish"}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLocation(`/pages/builder/${page.id}`)}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>

                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => setDeletePageId(page.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={deletePageId !== null} onOpenChange={open => { if (!open) setDeletePageId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{pages.find(p => p.id === deletePageId)?.title}</strong> will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletePageId && deleteMutation.mutate(deletePageId)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
