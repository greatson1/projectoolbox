/**
 * Chunk-load recovery shared between every app error boundary.
 *
 * Background. Next.js content-hashes every JS chunk. After a redeploy
 * the old hashes 404, so a tab loaded against the previous build
 * throws ChunkLoadError the moment it tries to lazy-load anything
 * (route change, modal open, server-action invoke). A hard reload
 * normally fetches the new build manifest and the new hashes resolve.
 *
 * What was wrong. The previous handler reloaded ONCE, then surrendered.
 * If the browser's HTML cache, Vercel's edge cache, or a stuck service
 * worker re-served the stale HTML on the first reload, the new tab
 * loaded with the same dead manifest, threw the same chunk error, was
 * blocked by sessionStorage, and the user saw the generic
 * "Something went wrong" screen with a "Reload page" button that just
 * called reset() — a no-op against a missing chunk.
 *
 * What this module does.
 *   - Retries up to MAX_ATTEMPTS times. Each retry navigates to the
 *     same path with a cache-busting query (`?_pt_rv=<ts>-<n>`) so
 *     every layer (browser disk cache, edge cache, service worker)
 *     issues a fresh GET and gets the new manifest.
 *   - After MAX_ATTEMPTS, gives up on this route and hard-navigates
 *     to "/" — the dashboard shell almost always has its own chunks
 *     in the new manifest, so a hop to root + the user clicking back
 *     in beats an infinite loop on a doomed page.
 *   - Resets the counter on any non-chunk error so a genuine app
 *     error doesn't burn attempts.
 *
 * The cache-bust param is stripped from the visible URL by the
 * dashboard shell on mount (see usage notes).
 */

const ATTEMPT_KEY = "pt:chunk-reload-attempts";
const MAX_ATTEMPTS = 3;
const CACHE_BUST_PARAM = "_pt_rv";

export function isChunkLoadError(err: Error | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message || "";
  return err.name === "ChunkLoadError"
    || /Loading chunk [\w-]+ failed/i.test(msg)
    || /Failed to load chunk/i.test(msg)
    || /ChunkLoadError/i.test(msg);
}

/**
 * Call from a route error boundary's useEffect. Returns true if the
 * caller should KEEP RENDERING the fallback UI (because we've exhausted
 * retries) and false if a navigation has been queued (so the caller
 * can render a brief "Recovering…" state if it wants).
 */
export function handleChunkLoadError(err: Error): { recovering: boolean; attempt: number } {
  if (typeof window === "undefined") return { recovering: false, attempt: 0 };
  if (!isChunkLoadError(err)) {
    // Reset so a future chunk error gets the full retry budget.
    try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ }
    return { recovering: false, attempt: 0 };
  }

  let attempt = 0;
  try {
    attempt = Number.parseInt(sessionStorage.getItem(ATTEMPT_KEY) || "0", 10) || 0;
  } catch { /* ignore */ }

  if (attempt >= MAX_ATTEMPTS) {
    // Give up on this route — bounce to root. Clear the counter so the
    // dashboard shell isn't stuck thinking it's mid-recovery.
    try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ }
    window.location.assign("/");
    return { recovering: true, attempt };
  }

  attempt += 1;
  try { sessionStorage.setItem(ATTEMPT_KEY, String(attempt)); } catch { /* ignore */ }

  const url = new URL(window.location.href);
  url.searchParams.set(CACHE_BUST_PARAM, `${Date.now()}-${attempt}`);
  window.location.replace(url.toString());
  return { recovering: true, attempt };
}

/**
 * Hard reload bound to the error UI's "Reload page" button. The
 * default reset() React provides only tries to re-render — it doesn't
 * refetch the HTML manifest, so it's useless against a missing chunk.
 * This forces a navigation with a fresh cache-bust param.
 */
export function hardReloadWithCacheBust(): void {
  if (typeof window === "undefined") return;
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set(CACHE_BUST_PARAM, `${Date.now()}-user`);
  window.location.assign(url.toString());
}
