"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { handleChunkLoadError, hardReloadWithCacheBust, isChunkLoadError } from "@/lib/chunk-recovery";

export default function DashboardError({
  error,
  reset: _reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Dashboard error]", error);
    handleChunkLoadError(error);
  }, [error]);

  const isChunk = isChunkLoadError(error);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>
      <div>
        <h2 className="text-xl font-bold mb-2">
          {isChunk ? "Refreshing to load the new version…" : "Something went wrong"}
        </h2>
        <p className="text-muted-foreground text-sm max-w-md">
          {isChunk
            ? "A new build was deployed while this tab was open. Reloading to pick up the latest chunks."
            : "An unexpected error occurred. Try reloading the page."}
        </p>
      </div>
      <Button size="sm" onClick={hardReloadWithCacheBust}>
        <RefreshCw className="w-4 h-4 mr-1.5" /> Reload page
      </Button>
    </div>
  );
}
