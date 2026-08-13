/**
 * lib/__tests__/proposalStore.test.ts
 *
 * Unit tests for lib/proposalStore.ts — the localStorage-backed pending-proposal
 * store (useSyncExternalStore-compatible).
 *
 * The module holds private mutable state (an in-memory cache Map, a subscriber
 * Set, and a "listener already installed" flag) with no reset export, so each
 * test gets a fully fresh module instance via vi.resetModules() + a dynamic
 * import — this also sidesteps the "listener only installs once" issue for the
 * cross-tab storage-event tests below.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingProposal } from '../proposalStore.js';

type ProposalStoreModule = typeof import('../proposalStore.js');

function createFakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    _raw: data,
  };
}

const USER = 'user-1';
const AGENT = 'agent-1';

function makeProposal(overrides: Partial<PendingProposal> = {}): PendingProposal {
  return {
    v: 1,
    agentId: AGENT,
    userId: USER,
    proposedAt: '2026-08-12T00:00:00.000Z',
    message: 'test proposal',
    modifications: { description: 'new description' },
    warnings: [],
    ...overrides,
  };
}

let localStorageMock: ReturnType<typeof createFakeLocalStorage>;
let store: ProposalStoreModule;

beforeEach(async () => {
  vi.resetModules();
  localStorageMock = createFakeLocalStorage();
  vi.stubGlobal('localStorage', localStorageMock);
  store = await import('../proposalStore.js');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getSnapshot / getServerSnapshot', () => {
  it('returns null when nothing is stored', () => {
    expect(store.getSnapshot(USER, AGENT)).toBeNull();
  });

  it('getServerSnapshot always returns null', () => {
    expect(store.getServerSnapshot()).toBeNull();
  });

  it('is referentially stable across repeated calls with no write in between', () => {
    store.writeProposal(makeProposal());
    const a = store.getSnapshot(USER, AGENT);
    const b = store.getSnapshot(USER, AGENT);
    expect(a).toBe(b);
  });
});

describe('writeProposal', () => {
  it('stores a proposal retrievable via getSnapshot', () => {
    const p = makeProposal({ message: 'hello' });
    store.writeProposal(p);
    expect(store.getSnapshot(USER, AGENT)).toEqual(p);
  });

  it('scopes storage by both userId and agentId (no cross-bleed)', () => {
    store.writeProposal(makeProposal({ userId: 'user-A', agentId: 'agent-X', message: 'A' }));
    store.writeProposal(makeProposal({ userId: 'user-B', agentId: 'agent-X', message: 'B' }));
    expect(store.getSnapshot('user-A', 'agent-X')?.message).toBe('A');
    expect(store.getSnapshot('user-B', 'agent-X')?.message).toBe('B');
  });

  it('invalidates the old cached reference on a new write', () => {
    store.writeProposal(makeProposal({ message: 'first' }));
    const first = store.getSnapshot(USER, AGENT);
    store.writeProposal(makeProposal({ message: 'second' }));
    const second = store.getSnapshot(USER, AGENT);
    expect(first).not.toBe(second);
    expect(second?.message).toBe('second');
  });

  it('notifies subscribers on write', () => {
    const cb = vi.fn();
    store.subscribe(cb);
    store.writeProposal(makeProposal());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('an unsubscribed callback is not notified', () => {
    const cb = vi.fn();
    const unsubscribe = store.subscribe(cb);
    unsubscribe();
    store.writeProposal(makeProposal());
    expect(cb).not.toHaveBeenCalled();
  });

  it('falls back to in-memory storage on QuotaExceededError, proposal still retrievable', () => {
    localStorageMock.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const p = makeProposal({ message: 'over quota' });
    expect(() => store.writeProposal(p)).not.toThrow();
    expect(store.getSnapshot(USER, AGENT)).toEqual(p);
    // Never actually landed in localStorage — only in the memory fallback.
    expect(localStorageMock._raw.size).toBe(0);
  });
});

describe('clearProposal', () => {
  it('removes a stored proposal so getSnapshot returns null afterward', () => {
    store.writeProposal(makeProposal());
    expect(store.getSnapshot(USER, AGENT)).not.toBeNull();
    store.clearProposal(USER, AGENT);
    expect(store.getSnapshot(USER, AGENT)).toBeNull();
  });

  it('notifies subscribers on clear', () => {
    const cb = vi.fn();
    store.writeProposal(makeProposal());
    store.subscribe(cb);
    store.clearProposal(USER, AGENT);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('corrupted/mismatched localStorage entries', () => {
  const key = `myagent:proposal:${USER}:${AGENT}`;

  it('malformed JSON is treated as no proposal and the key is removed', () => {
    localStorageMock.setItem(key, '{not valid json');
    expect(store.getSnapshot(USER, AGENT)).toBeNull();
    expect(localStorageMock.getItem(key)).toBeNull();
  });

  it('a payload with a mismatched userId/agentId is discarded', () => {
    localStorageMock.setItem(
      key,
      JSON.stringify(makeProposal({ userId: 'someone-else' })),
    );
    expect(store.getSnapshot(USER, AGENT)).toBeNull();
    expect(localStorageMock.getItem(key)).toBeNull();
  });

  it('a payload with an unrecognized version is discarded', () => {
    localStorageMock.setItem(
      key,
      JSON.stringify({ ...makeProposal(), v: 2 }),
    );
    expect(store.getSnapshot(USER, AGENT)).toBeNull();
  });
});

describe('cross-tab storage events', () => {
  it('a storage event for the matching key invalidates the cache and notifies subscribers', () => {
    let capturedHandler: ((e: Partial<StorageEvent>) => void) | undefined;
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: (e: Partial<StorageEvent>) => void) => {
        if (type === 'storage') capturedHandler = handler;
      },
    });

    store.writeProposal(makeProposal());
    const cb = vi.fn();
    store.subscribe(cb); // installs the storage listener lazily
    expect(capturedHandler).toBeDefined();

    const key = `myagent:proposal:${USER}:${AGENT}`;
    capturedHandler?.({ key });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a storage event with key: null (localStorage.clear()) invalidates everything', () => {
    let capturedHandler: ((e: Partial<StorageEvent>) => void) | undefined;
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: (e: Partial<StorageEvent>) => void) => {
        if (type === 'storage') capturedHandler = handler;
      },
    });

    store.writeProposal(makeProposal());
    const cb = vi.fn();
    store.subscribe(cb);

    capturedHandler?.({ key: null });

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a storage event for an unrelated key does not notify subscribers', () => {
    let capturedHandler: ((e: Partial<StorageEvent>) => void) | undefined;
    vi.stubGlobal('window', {
      addEventListener: (type: string, handler: (e: Partial<StorageEvent>) => void) => {
        if (type === 'storage') capturedHandler = handler;
      },
    });

    const cb = vi.fn();
    store.subscribe(cb);
    capturedHandler?.({ key: 'some:unrelated:key' });

    expect(cb).not.toHaveBeenCalled();
  });
});
