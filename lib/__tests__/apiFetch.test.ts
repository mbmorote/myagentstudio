/**
 * lib/__tests__/apiFetch.test.ts
 *
 * Unit tests for apiFetch — the client-side fetch wrapper (issue #14,
 * 2026-08-28 rewrite). On a 401 it now requests in-place re-authentication
 * via the shared re-auth store (requestReauth/resolveReauth, module-internal
 * to apiFetch.ts and exercised here through the exported subscribe/snapshot
 * pair) instead of hard-navigating immediately. Only a cancelled re-auth, or
 * a retry that's still 401, falls back to the old hard-navigate/hang-forever
 * behavior — asserted the same way as before: checking side effects without
 * ever awaiting the outer promise (awaiting it would hang the test forever).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  getReauthSnapshot,
  getReauthServerSnapshot,
  resolveReauth,
  subscribeReauth,
} from '../apiFetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
  // Drain any re-auth request left pending by a test that didn't resolve it,
  // so state doesn't leak into the next test (the store is module-level).
  if (getReauthSnapshot().needed) resolveReauth(false);
});

describe('apiFetch — non-401 pass-through', () => {
  it('passes input/init through to the underlying fetch and returns a non-401 response as-is', async () => {
    const fakeResponse = new Response('ok', { status: 200 });
    const fetchMock = vi.fn(async () => fakeResponse);
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiFetch('/api/agents', { method: 'POST' });

    expect(fetchMock).toHaveBeenCalledWith('/api/agents', { method: 'POST' });
    expect(result).toBe(fakeResponse);
  });

  it('returns a 401 response as-is when window is undefined (no browser context, e.g. SSR/node)', async () => {
    expect(typeof window).toBe('undefined');
    const fakeResponse = new Response(null, { status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => fakeResponse));

    const result = await apiFetch('/api/agents/123');

    expect(result.status).toBe(401);
  });
});

describe('apiFetch — 401 requests in-place re-auth instead of navigating immediately', () => {
  it('sets the shared re-auth state to needed, and does not resolve while it is pending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    vi.stubGlobal('window', { location: { pathname: '/agents/123', search: '', href: '' } });

    let resolved = false;
    void apiFetch('/api/agents/123').then(() => {
      resolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(getReauthSnapshot().needed).toBe(true);
    expect(resolved).toBe(false);

    resolveReauth(false); // cleanup — falls through to hard-navigate internally
  });

  it('getReauthServerSnapshot always reports idle (SSR can never need re-auth)', () => {
    expect(getReauthServerSnapshot()).toEqual({ needed: false });
  });

  it('notifies subscribers when re-auth becomes needed and when it resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    vi.stubGlobal('window', { location: { pathname: '/x', search: '', href: '' } });

    const cb = vi.fn();
    const unsubscribe = subscribeReauth(cb);

    void apiFetch('/api/x');
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).toHaveBeenCalled();

    cb.mockClear();
    resolveReauth(false);
    expect(cb).toHaveBeenCalled();
    expect(getReauthSnapshot().needed).toBe(false);

    unsubscribe();
  });
});

describe('apiFetch — resume in place on successful re-auth', () => {
  it('retries the original request once re-auth succeeds, and returns the retried response', async () => {
    const retried = new Response('ok', { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // original attempt
      .mockResolvedValueOnce(retried); // retry after re-auth
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { pathname: '/agents/123', search: '', href: '' } });

    const promise = apiFetch('/api/agents/123', { method: 'POST', body: '{}' });
    await Promise.resolve();
    await Promise.resolve();

    expect(getReauthSnapshot().needed).toBe(true);
    resolveReauth(true);

    const result = await promise;

    expect(result).toBe(retried);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/agents/123', { method: 'POST', body: '{}' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/agents/123', { method: 'POST', body: '{}' });
  });

  it('shares one re-auth prompt across concurrent 401s and resumes both in place', async () => {
    const retriedA = new Response('a', { status: 200 });
    const retriedB = new Response('b', { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // A original
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // B original
      .mockResolvedValueOnce(retriedA) // A retry
      .mockResolvedValueOnce(retriedB); // B retry
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', { location: { pathname: '/x', search: '', href: '' } });

    const promiseA = apiFetch('/api/a');
    const promiseB = apiFetch('/api/b');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Both 401s share the single pending prompt — only one navigate-away fallback
    // would ever fire per prompt, and resolving once unblocks both callers.
    resolveReauth(true);

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);
    expect(resultA).toBe(retriedA);
    expect(resultB).toBe(retriedB);
  });

  it('falls back to hard-navigate when the retried request is still 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 })) // original
      .mockResolvedValueOnce(new Response(null, { status: 401 })); // retry, still 401
    vi.stubGlobal('fetch', fetchMock);
    const locationMock = { pathname: '/agents/123', search: '?tab=chat', href: '' };
    vi.stubGlobal('window', { location: locationMock });

    let resolved = false;
    void apiFetch('/api/agents/123').then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    resolveReauth(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(locationMock.href).toBe('/login?next=' + encodeURIComponent('/agents/123?tab=chat'));
    expect(resolved).toBe(false);
  });
});

describe('apiFetch — cancelled re-auth falls back to hard-navigate (old behavior)', () => {
  it('on 401 in a browser context, a cancelled re-auth redirects to /login?next=<path+search> and never resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const locationMock = { pathname: '/agents/123', search: '?tab=chat', href: '' };
    vi.stubGlobal('window', { location: locationMock });

    let resolved = false;
    void apiFetch('/api/agents/123').then(() => {
      resolved = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    resolveReauth(false);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(locationMock.href).toBe('/login?next=' + encodeURIComponent('/agents/123?tab=chat'));
    expect(resolved).toBe(false);
  });

  it('URL-encodes the next parameter', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const locationMock = { pathname: '/agents', search: '?q=a b&x=1', href: '' };
    vi.stubGlobal('window', { location: locationMock });

    void apiFetch('/api/agents');
    await Promise.resolve();
    await Promise.resolve();
    resolveReauth(false);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(locationMock.href).toBe(
      '/login?next=' + encodeURIComponent('/agents?q=a b&x=1'),
    );
    expect(locationMock.href).not.toContain(' ');
  });
});
