/**
 * lib/apiFetch.ts
 *
 * Client-side fetch wrapper (§5.4, Plan 05 Phase 4.1).
 *
 * On a 401 response, requests in-place re-authentication (issue #14, 2026-08-28)
 * instead of hard-navigating away: it shows a re-login modal (mounted once at
 * the root layout — see ReauthModal.tsx) and awaits the outcome via a shared
 * module-level promise, so several concurrent 401s (e.g. two in-flight requests)
 * share one modal instead of stacking several. On successful re-auth it RETRIES
 * the exact same request once and returns that response — "resume in place"
 * (chosen over the narrower "just don't navigate away" reading of the issue's
 * scope note) means an in-flight action like a chat send actually completes
 * once the user is back in, not just that their typed text survives. If re-auth
 * is cancelled, or the retried request is still 401 (persistently broken auth —
 * retrying again would just loop), it falls back to the old hard-navigate to
 * /login, same as before.
 *
 * Not marked `server-only` — safe to import in any 'use client' file.
 * Not a monkey-patch of the global fetch — it is a named export that every
 * call site uses explicitly, making it greppable and the fitness test in
 * route-guard.test.ts assertable.
 */

// ── Re-auth store ────────────────────────────────────────────────────────────
// useSyncExternalStore-compatible store (mirrors lib/proposalStore.ts's
// subscribe/getSnapshot/getServerSnapshot shape) — ReauthModal.tsx subscribes
// to know when to render, and calls resolveReauth() once the user is signed
// back in (or gives up).

export type ReauthState = { needed: boolean };

const IDLE_STATE: ReauthState = { needed: false };
const NEEDED_STATE: ReauthState = { needed: true };

let currentState: ReauthState = IDLE_STATE;
const listeners = new Set<() => void>();

/** In-flight re-auth wait, shared across concurrent 401s. Null when idle. */
let pendingReauth: Promise<boolean> | null = null;
let resolvePendingReauth: ((success: boolean) => void) | null = null;

function notifyListeners(): void {
  listeners.forEach((cb) => cb());
}

/** Subscribe to re-auth state changes. Used as useSyncExternalStore's first arg. */
export function subscribeReauth(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Referentially stable — same object reference until the state actually changes. */
export function getReauthSnapshot(): ReauthState {
  return currentState;
}

/** Server snapshot — re-auth can never be needed during SSR. */
export function getReauthServerSnapshot(): ReauthState {
  return IDLE_STATE;
}

/**
 * Called by ReauthModal once the user either signs back in successfully
 * (`success: true`) or gives up / the modal is dismissed (`success: false`).
 * Resolves every apiFetch call currently waiting on this shared prompt.
 */
export function resolveReauth(success: boolean): void {
  currentState = IDLE_STATE;
  notifyListeners();
  const resolve = resolvePendingReauth;
  pendingReauth = null;
  resolvePendingReauth = null;
  resolve?.(success);
}

/** First 401 to arrive opens the shared prompt; later ones just await it. */
function requestReauth(): Promise<boolean> {
  if (!pendingReauth) {
    currentState = NEEDED_STATE;
    notifyListeners();
    pendingReauth = new Promise<boolean>((resolve) => {
      resolvePendingReauth = resolve;
    });
  }
  return pendingReauth;
}

// ── apiFetch ─────────────────────────────────────────────────────────────────

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== 'undefined') {
    const reauthed = await requestReauth();
    if (reauthed) {
      const retryRes = await fetch(input, init);
      if (retryRes.status !== 401) return retryRes;
      // Still 401 after a successful re-login — not a session-expiry case
      // (cookie domain mismatch, etc.); fall through to the hard-navigate
      // fallback below rather than looping.
    }
    const next = window.location.pathname + window.location.search;
    window.location.href = '/login?next=' + encodeURIComponent(next);
    // Hang forever: never resolve so no caller renders an error flash mid-navigation.
    await new Promise(() => {});
  }
  return res;
}
