/**
 * lib/proposalStore.ts
 *
 * Client-only module (no 'server-only' import).
 *
 * useSyncExternalStore-compatible store for a localStorage-backed pending proposal.
 * Key: `myagent:proposal:<userId>:<agentId>` — both parts required to prevent
 * cross-agent or cross-account bleed (§5.2).
 *
 * Two implementation traps from §5.3, both explicitly guarded:
 *  1. getSnapshot must be referentially stable — returns the same cached object
 *     reference until a write/clear/storage event invalidates it. A fresh
 *     JSON.parse on every call would cause useSyncExternalStore to loop forever.
 *  2. Every read is wrapped in try/catch. Malformed JSON, v !== 1, or a
 *     userId/agentId mismatch inside the payload is treated as "no proposal"
 *     and the key is cleared. A corrupted entry must never permanently lock
 *     a user out of editing.
 */

export interface PendingProposal {
  v: 1;
  agentId: string;
  userId: string;
  proposedAt: string; // ISO
  message: string;
  modifications: {
    description?: string;
    sections?: Record<string, string>;
    config?: Record<string, unknown>;
  };
  warnings: string[];
}

// ── Internal state ──────────────────────────────────────────────────────────

/** Snapshot cache: storageKey → parsed PendingProposal (invalidated on write/clear/storage event) */
const cache = new Map<string, PendingProposal>();

/**
 * In-memory fallback for when localStorage.setItem fails (QuotaExceededError, etc.).
 * A proposal in this map survives Apply but not a page reload (§5.3 quota note).
 */
const memoryFallback = new Map<string, PendingProposal>();

/** Same-tab subscriber callbacks (useSyncExternalStore) */
const subscribers = new Set<() => void>();

/** Whether the window 'storage' event listener has been installed */
let storageListenerInstalled = false;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeKey(userId: string, agentId: string): string {
  return `myagent:proposal:${userId}:${agentId}`;
}

function notifySubscribers(): void {
  subscribers.forEach((cb) => cb());
}

/**
 * Install a single module-level 'storage' event listener for cross-tab sync.
 * Called lazily so it never runs during SSR.
 */
function ensureStorageListener(): void {
  if (storageListenerInstalled || typeof window === 'undefined') return;
  storageListenerInstalled = true;
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === null) {
      // localStorage.clear() — invalidate everything
      cache.clear();
      notifySubscribers();
    } else if (e.key.startsWith('myagent:proposal:')) {
      cache.delete(e.key);
      notifySubscribers();
    }
  });
}

/**
 * Read and validate a raw localStorage entry.
 * Returns null and clears the key if the value is missing, malformed, or mismatched.
 */
function tryReadFromStorage(userId: string, agentId: string): PendingProposal | null {
  const key = makeKey(userId, agentId);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Record<string, unknown>)['v'] !== 1 ||
      (parsed as Record<string, unknown>)['userId'] !== userId ||
      (parsed as Record<string, unknown>)['agentId'] !== agentId
    ) {
      console.warn('[proposalStore] Discarding corrupt/mismatched localStorage entry:', key);
      try {
        localStorage.removeItem(key);
      } catch { /* ignore */ }
      return null;
    }
    return parsed as PendingProposal;
  } catch (e) {
    console.warn('[proposalStore] Error reading localStorage entry:', key, e);
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Subscribe to store changes. Returns an unsubscribe function.
 * Used as the first argument to useSyncExternalStore.
 * Installs the cross-tab window 'storage' listener lazily (client-only).
 */
export function subscribe(cb: () => void): () => void {
  ensureStorageListener();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * Get the current proposal for a (userId, agentId) pair.
 * Referentially stable: returns the same object reference until the cache is
 * invalidated by a write, clear, or cross-tab storage event.
 */
export function getSnapshot(userId: string, agentId: string): PendingProposal | null {
  const key = makeKey(userId, agentId);

  // Memory fallback has priority (localStorage write failed for this key)
  if (memoryFallback.has(key)) {
    return memoryFallback.get(key)!;
  }

  // Return the cached reference if still valid (referential stability guarantee)
  if (cache.has(key)) {
    return cache.get(key)!;
  }

  // Read, validate, and cache
  const proposal = tryReadFromStorage(userId, agentId);
  if (proposal !== null) {
    cache.set(key, proposal);
  }
  return proposal;
}

/**
 * Server snapshot — always null (localStorage is unavailable on the server).
 * Passed as the third argument to useSyncExternalStore to prevent hydration mismatches.
 */
export function getServerSnapshot(): null {
  return null;
}

/**
 * Write a proposal to localStorage and notify same-tab subscribers.
 * On QuotaExceededError, falls back to in-memory storage: the proposal is never
 * lost and Apply still works, but it will not survive a page reload (§5.3 quota note).
 */
export function writeProposal(p: PendingProposal): void {
  const key = makeKey(p.userId, p.agentId);

  // Invalidate stale cache and any old memory fallback before writing
  cache.delete(key);
  memoryFallback.delete(key);

  try {
    localStorage.setItem(key, JSON.stringify(p));
    // Cache the written value directly for same-tab referential stability
    cache.set(key, p);
  } catch (e) {
    const isQuota =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    if (isQuota) {
      console.warn(
        '[proposalStore] QuotaExceededError — proposal kept in memory only; it will not survive a page reload.',
      );
    } else {
      console.warn('[proposalStore] Unexpected localStorage write error, falling back to memory:', e);
    }
    memoryFallback.set(key, p);
    // getSnapshot will find it via memoryFallback; no cache.set needed
  }

  notifySubscribers();
}

/**
 * Clear a proposal from localStorage and memory, then notify all subscribers.
 */
export function clearProposal(userId: string, agentId: string): void {
  const key = makeKey(userId, agentId);
  cache.delete(key);
  memoryFallback.delete(key);
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
  notifySubscribers();
}
