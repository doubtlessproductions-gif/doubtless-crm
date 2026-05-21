import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center px-6 max-w-md">
        <div className="text-[96px] font-black leading-none tracking-tighter text-foreground/10 select-none">
          404
        </div>
        <div className="space-y-2 -mt-4">
          <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            The page you're looking for doesn't exist or may have been moved.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
            Go back
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setLocation("/dashboard")}>
            <Home className="h-4 w-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
