/**
 * lib/auth/oauth/__tests__/tx.test.ts
 *
 * Tests for the OAuth transaction cookie (§10.3, §3.5).
 *
 * Cases:
 *   buildOAuthTxCookie:
 *     - round-trip build → encode; readOAuthTx → decode returns original tx
 *     - cookie name is OAUTH_TX_COOKIE
 *     - attributes: httpOnly=true, sameSite=lax, path=/api/auth/oauth, maxAge=600
 *
 *   readOAuthTx:
 *     - absent cookie → null
 *     - malformed base64 → null
 *     - valid base64 but invalid JSON → null
 *     - wrong version (v: 2) → null
 *     - wrong provider → null
 *     - correct provider → the full OAuthTx object
 *     - preserves optional fields (inviteCode, consent, next)
 *
 *   clearOAuthTxOn:
 *     - sets the cookie to empty string with maxAge 0
 *     - uses the IDENTICAL path as buildOAuthTxCookie (the silent-no-op bug)
 */

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { buildOAuthTxCookie, clearOAuthTxOn, readOAuthTx } from '../tx.js';
import { OAUTH_TX_COOKIE, OAUTH_TX_TTL_SECONDS } from '../../constants.js';
import type { OAuthTx } from '../types.js';

const BASE_TX: OAuthTx = {
  v: 1,
  provider: 'google',
  mode: 'login',
  state: 'state-abc',
  codeVerifier: 'verifier-xyz',
  nonce: 'nonce-123',
};

/** Build a NextRequest carrying a specific raw cookie value. */
function makeRequest(cookieValue: string | undefined): NextRequest {
  const headers = new Headers();
  if (cookieValue !== undefined) {
    headers.set('cookie', `${OAUTH_TX_COOKIE}=${cookieValue}`);
  }
  return new NextRequest('https://example.com/api/auth/oauth/google/callback', { headers });
}

// ── buildOAuthTxCookie ─────────────────────────────────────────────────────────

describe('buildOAuthTxCookie', () => {
  it('round-trip: build → read returns the original tx', () => {
    const { value } = buildOAuthTxCookie(BASE_TX);
    const req = makeRequest(value);
    const result = readOAuthTx(req, 'google');
    expect(result).toEqual(BASE_TX);
  });

  it('cookie name is OAUTH_TX_COOKIE (myagent_oauth_tx)', () => {
    const { name } = buildOAuthTxCookie(BASE_TX);
    expect(name).toBe(OAUTH_TX_COOKIE);
    expect(OAUTH_TX_COOKIE).toBe('myagent_oauth_tx');
  });

  it('has httpOnly: true', () => {
    const { options } = buildOAuthTxCookie(BASE_TX);
    expect(options.httpOnly).toBe(true);
  });

  it('has sameSite: lax (load-bearing for cross-site top-level GET navigation)', () => {
    const { options } = buildOAuthTxCookie(BASE_TX);
    expect(options.sameSite).toBe('lax');
  });

  it('has path: /api/auth/oauth', () => {
    const { options } = buildOAuthTxCookie(BASE_TX);
    expect(options.path).toBe('/api/auth/oauth');
  });

  it('has maxAge: OAUTH_TX_TTL_SECONDS (600)', () => {
    const { options } = buildOAuthTxCookie(BASE_TX);
    expect(options.maxAge).toBe(OAUTH_TX_TTL_SECONDS);
    expect(OAUTH_TX_TTL_SECONDS).toBe(600);
  });
});

// ── readOAuthTx ────────────────────────────────────────────────────────────────

describe('readOAuthTx', () => {
  it('returns null when cookie is absent', () => {
    const req = makeRequest(undefined);
    expect(readOAuthTx(req, 'google')).toBeNull();
  });

  it('returns null for a malformed (non-base64url) value', () => {
    // Build a raw string that cannot decode as valid base64url JSON
    const req = makeRequest('!!!not-valid-base64!!!');
    expect(readOAuthTx(req, 'google')).toBeNull();
  });

  it('returns null when base64url decodes but is not JSON', () => {
    const notJson = Buffer.from('this is not json', 'utf-8').toString('base64url');
    const req = makeRequest(notJson);
    expect(readOAuthTx(req, 'google')).toBeNull();
  });

  it('returns null when v is not 1 (wrong cookie version)', () => {
    const wrong = Buffer.from(JSON.stringify({ ...BASE_TX, v: 2 }), 'utf-8').toString('base64url');
    const req = makeRequest(wrong);
    expect(readOAuthTx(req, 'google')).toBeNull();
  });

  it('returns null when provider does not match', () => {
    // A tx for 'github' must not satisfy a 'google' callback
    const { value } = buildOAuthTxCookie({ ...BASE_TX, provider: 'github' });
    const req = makeRequest(value);
    expect(readOAuthTx(req, 'google')).toBeNull();
  });

  it('returns the tx when everything matches', () => {
    const { value } = buildOAuthTxCookie(BASE_TX);
    const req = makeRequest(value);
    expect(readOAuthTx(req, 'google')).toEqual(BASE_TX);
  });

  it('preserves optional fields (inviteCode, consent, next) in a signup tx', () => {
    const tx: OAuthTx = {
      ...BASE_TX,
      mode: 'signup',
      inviteCode: 'INVITE-XYZ',
      consent: true,
      next: '/agents/abc',
    };
    const { value } = buildOAuthTxCookie(tx);
    const req = makeRequest(value);
    expect(readOAuthTx(req, 'google')).toEqual(tx);
  });
});

// ── clearOAuthTxOn ─────────────────────────────────────────────────────────────

describe('clearOAuthTxOn', () => {
  it('uses the identical path as buildOAuthTxCookie — no silent no-op bug', () => {
    const { options: buildOptions } = buildOAuthTxCookie(BASE_TX);

    // Capture the arguments passed to response.cookies.set()
    const setCalls: Array<[string, string, Record<string, unknown>]> = [];
    const mockResponse = {
      cookies: {
        set: (name: string, value: string, opts: Record<string, unknown>) => {
          setCalls.push([name, value, opts]);
        },
      },
    } as unknown as import('next/server').NextResponse;

    clearOAuthTxOn(mockResponse);

    expect(setCalls).toHaveLength(1);
    const [name, , clearOptions] = setCalls[0];
    expect(name).toBe(OAUTH_TX_COOKIE);
    expect(clearOptions['path']).toBe(buildOptions.path);
    expect(clearOptions['path']).toBe('/api/auth/oauth');
  });

  it('sets the cookie value to empty string with maxAge 0', () => {
    const setCalls: Array<[string, string, Record<string, unknown>]> = [];
    const mockResponse = {
      cookies: {
        set: (name: string, value: string, opts: Record<string, unknown>) => {
          setCalls.push([name, value, opts]);
        },
      },
    } as unknown as import('next/server').NextResponse;

    clearOAuthTxOn(mockResponse);

    expect(setCalls).toHaveLength(1);
    const [, value, opts] = setCalls[0];
    expect(value).toBe('');
    expect(opts['maxAge']).toBe(0);
  });

  it('sets httpOnly: true and sameSite: lax on the clear (matching the set)', () => {
    const setCalls: Array<[string, string, Record<string, unknown>]> = [];
    const mockResponse = {
      cookies: {
        set: (name: string, value: string, opts: Record<string, unknown>) => {
          setCalls.push([name, value, opts]);
        },
      },
    } as unknown as import('next/server').NextResponse;

    clearOAuthTxOn(mockResponse);

    const [, , opts] = setCalls[0];
    expect(opts['httpOnly']).toBe(true);
    expect(opts['sameSite']).toBe('lax');
  });
});
