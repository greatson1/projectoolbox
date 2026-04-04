/**
 * Agent Backend Client — HTTP client for communicating with the VPS
 * agent runtime. Includes retry, timeout, and circuit breaker.
 */

const VPS_URL = process.env.AGENT_BACKEND_URL || "http://187.77.182.159:3001";
const JOB_API_KEY = process.env.JOB_API_KEY || "";
const TIMEOUT_MS = 10_000;

let consecutiveFailures = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60_000;
let circuitOpenUntil = 0;

function isCircuitOpen(): boolean {
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (Date.now() < circuitOpenUntil) return true;
    // Half-open: allow one attempt
    consecutiveFailures = CIRCUIT_BREAKER_THRESHOLD - 1;
  }
  return false;
}

function recordSuccess() {
  consecutiveFailures = 0;
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
  }
}

/** Nudge the VPS to process pending jobs. Fire-and-forget with short timeout. */
export async function nudgeJobProcessor(): Promise<{ ok: boolean; error?: string }> {
  if (isCircuitOpen()) {
    return { ok: false, error: "Circuit breaker open — VPS unreachable" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${VPS_URL}/api/jobs/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Job-Api-Key": JOB_API_KEY,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      recordSuccess();
      return { ok: true };
    }

    recordFailure();
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    recordFailure();
    return { ok: false, error: err.message || "Network error" };
  }
}

/** Check if the VPS agent backend is reachable */
export async function checkBackendHealth(): Promise<{
  healthy: boolean;
  circuitOpen: boolean;
  consecutiveFailures: number;
}> {
  if (isCircuitOpen()) {
    return { healthy: false, circuitOpen: true, consecutiveFailures };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    const res = await fetch(`${VPS_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      recordSuccess();
      return { healthy: true, circuitOpen: false, consecutiveFailures: 0 };
    }
    recordFailure();
    return { healthy: false, circuitOpen: false, consecutiveFailures };
  } catch {
    recordFailure();
    return { healthy: false, circuitOpen: isCircuitOpen(), consecutiveFailures };
  }
}

/** Send a specific job to the VPS for immediate processing */
export async function dispatchJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  if (isCircuitOpen()) {
    return { ok: false, error: "Circuit breaker open" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${VPS_URL}/api/jobs/${jobId}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Job-Api-Key": JOB_API_KEY,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      recordSuccess();
      return { ok: true };
    }
    recordFailure();
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    recordFailure();
    return { ok: false, error: err.message || "Network error" };
  }
}
