"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// Chunks are content-hashed (e.g. /_next/static/chunks/11eang…). After a
// redeploy the old hashes 404, so a tab loaded against the previous build
// throws ChunkLoadError the moment it tries to lazy-load anything. A hard
// reload refetches the build manifest and the new hashes resolve. Gate it
// with sessionStorage so a chunk that's genuinely broken can't pin us in a
// reload loop.
const CHUNK_RELOAD_KEY = "pt:chunk-reload-attempt";
function isChunkLoadError(err: Error): boolean {
  const msg = err?.message || "";
  return err?.name === "ChunkLoadError"
    || /Loading chunk [\w-]+ failed/i.test(msg)
    || /Failed to load chunk/i.test(msg);
}

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Project page error]", error);
    if (isChunkLoadError(error) && typeof window !== "undefined") {
      const already = sessionStorage.getItem(CHUNK_RELOAD_KEY);
      if (!already) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        window.location.reload();
      }
    } else if (typeof window !== "undefined") {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    }
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>
      <div>
        <h2 className="text-xl font-bold mb-2">Something went wrong</h2>
        <p className="text-muted-foreground text-sm max-w-md">
          This page ran into an error. You can try reloading it, or go back to the projects list.
        </p>
        {error?.message && (
          <p className="mt-3 text-xs text-muted-foreground/60 font-mono bg-muted px-3 py-1.5 rounded-md inline-block max-w-sm truncate">
            {error.message}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Go back
        </Button>
        <Button size="sm" onClick={reset}>
          <RefreshCw className="w-4 h-4 mr-1.5" /> Reload page
        </Button>
      </div>
    </div>
  );
}
