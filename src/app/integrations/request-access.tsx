"use client";

// "Request access" capture for coming-soon integration tiles (review P3).
// Previously the tiles were inert badges — interest went nowhere. Posts to
// the existing waitlist API (sector carries the integration name) so
// requests land in Admin → Waitlist alongside signup leads.

import { useState } from "react";

export function RequestAccess({ integrationName }: { integrationName: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  if (state === "done") {
    return <p className="text-xs font-medium text-green-600">✓ Noted — we&apos;ll email you when {integrationName} lands.</p>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-primary hover:underline text-left"
      >
        Request access →
      </button>
    );
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim()) return;
        setState("sending");
        fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), sector: `integration:${integrationName}` }),
        })
          .then((r) => (r.ok ? setState("done") : Promise.reject()))
          .catch(() => setState("error"));
      }}
    >
      <input
        type="email"
        required
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="flex-1 min-w-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-md bg-primary text-primary-foreground text-xs font-semibold px-2.5 py-1 hover:opacity-90 disabled:opacity-50"
      >
        {state === "sending" ? "…" : "Notify me"}
      </button>
      {state === "error" && <span className="text-xs text-red-500 self-center">Failed — try again</span>}
    </form>
  );
}
