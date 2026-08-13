/**
 * lib/__tests__/apiFetch.test.ts
 *
 * Unit tests for apiFetch — the client-side fetch wrapper that hard-redirects
 * to /login on a 401 and never resolves afterward (so no caller renders an
 * error flash mid-navigation). Global fetch/window are stubbed per test; the
 * "never resolves" case is asserted by checking side effects without ever
 * awaiting the returned promise (awaiting it would hang the test forever).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../apiFetch.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
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

  it('on 401 in a browser context, redirects to /login?next=<path+search> and never resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const locationMock = { pathname: '/agents/123', search: '?tab=chat', href: '' };
    vi.stubGlobal('window', { location: locationMock });

    let resolved = false;
    void apiFetch('/api/agents/123').then(() => {
      resolved = true;
    });

    // Flush pending microtasks (the fetch resolution + redirect assignment) —
    // deliberately never awaiting the outer promise itself, since it's designed
    // to hang forever.
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
    await Promise.resolve();

    expect(locationMock.href).toBe(
      '/login?next=' + encodeURIComponent('/agents?q=a b&x=1'),
    );
    expect(locationMock.href).not.toContain(' ');
  });
});
