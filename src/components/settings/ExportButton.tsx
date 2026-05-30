"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";

/**
 * Generic data-export button used in /settings → Profile (personal data) and
 * /settings → Organisation (org-wide data).
 *
 * Fetches the endpoint, reads the response as a blob, and pushes a download
 * via a temporary <a download>. We don't navigate the browser to the URL
 * because the body needs to flow through the session cookie + role gate
 * and the response uses Content-Disposition to suggest a filename.
 */
export function ExportButton({
  endpoint,
  label,
  description,
}: {
  endpoint: string;
  label: string;
  description?: string;
}) {
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || "Export failed");
      }
      // Pull the filename out of Content-Disposition so the saved file
      // matches what the server suggested (org-export-<slug>-<date>.json).
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m?.[1] || "export.json";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={handle} disabled={busy}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Download className="w-3.5 h-3.5 mr-1.5" /> Export</>}
      </Button>
    </div>
  );
}