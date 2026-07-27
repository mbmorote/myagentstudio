/**
 * lib/__mocks__/server-only.ts
 *
 * No-op mock for the 'server-only' package in Vitest/Node test environments.
 * Aliased via vitest.config.ts so DB and env modules can be imported in tests
 * without throwing the Next.js server-only guard.
 *
 * The real 'server-only' package throws at import time when not in a Next.js
 * server context. This mock replaces it with an empty module.
 */

// Intentionally empty — the module's only job is to throw if imported client-side.
export {};
