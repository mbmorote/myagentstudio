/**
 * lib/apiFetch.ts
 *
 * Client-side fetch wrapper (§5.4, Plan 05 Phase 4.1).
 *
 * On a 401 response, hard-navigates to /login?next=<current path+search> and
 * then hangs forever — so no caller can accidentally render an error flash
 * mid-navigation. The `next` parameter is validated on consumption by the
 * login page (§3.6): only a single-leading-slash path is honoured.
 *
 * Not marked `server-only` — safe to import in any 'use client' file.
 * Not a monkey-patch of the global fetch — it is a named export that every
 * call site uses explicitly, making it greppable and the fitness test in
 * route-guard.test.ts assertable.
 *
 * The future in-place re-login modal (§14) will be implemented here, which
 * is one more reason all 14 call sites go through this function now.
 */

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== 'undefined') {
    const next = window.location.pathname + window.location.search;
    window.location.href = '/login?next=' + encodeURIComponent(next);
    // Hang forever: never resolve so no caller renders an error flash mid-navigation.
    await new Promise(() => {});
  }
  return res;
}
