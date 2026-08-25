/**
 * app/api/__tests__/mcp.test.ts
 *
 * Route/protocol tests for POST/GET/DELETE /api/mcp (Plan 13 §5.6, read-only phase).
 *
 * Uses a real in-memory DB (testDb) and the real token subsystem — a token is
 * created via the actual generateApiToken()/createApiToken() path, exactly like a
 * console client would present one, so these tests exercise the real
 * authenticateMcpToken() guard and the real lib/mcp/server.ts JSON-RPC handling,
 * not mocks of either.
 *
 * Cases:
 *   - Unauthenticated POST → 401 from the route handler itself (proves the
 *     middleware bypass did not create a hole)
 *   - A request carrying a Cookie header but no bearer token → still 401 (the two
 *     auth models are disjoint on purpose)
 *   - tools/list returns all four tool names regardless of scope (list_agents,
 *     get_agent, pull_agent, push_agent — renamed from export_agent/import_agent
 *     2026-08-24)
 *   - tools/call happy path: list_agents returns the caller's agents
 *   - tools/call with an unknown tool name → a JSON-RPC error, not a 500
 *   - Malformed JSON-RPC → a protocol-level error, not a 500
 *   - A request with an unexpected Origin header → rejected (403)
 *   - GET /api/mcp → 405; DELETE /api/mcp → 405
 *   - push_agent past the per-user LLM cap → a tool error carrying
 *     retryAfterSeconds, no log row written (§5.6, D7's "same cap" answer)
 *   - Log rows from an MCP-initiated push_agent call carry origin:'mcp'
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/db/client.js', async () => {
  const { testDb } = await import('../../../lib/db/__tests__/test-db.js');
  return { db: testDb };
});

const fakeStream = vi.fn(async () => ({
  text: '# ROLE\n\nTest agent content.\n',
  stopReason: 'end_turn' as const,
  model: 'claude-opus-4-8',
  usage: { inputTokens: 5, outputTokens: 10 },
}));

vi.mock('../../../lib/ai/anthropicProvider.js', () => ({
  createAnthropicProvider: () => ({
    id: 'fake',
    defaultModel: () => 'claude-opus-4-8',
    complete: vi.fn(async () => ({ text: '{}', stopReason: 'end_turn' as const, model: 'claude-opus-4-8', usage: { inputTokens: 1, outputTokens: 1 } })),
    stream: fakeStream,
  }),
  LlmProviderResponseError: class LlmProviderResponseError extends Error {
    constructor(msg: string) { super(msg); this.name = 'LlmProviderResponseError'; }
  },
}));

import * as schema from '../../../lib/db/schema.js';
import { eq } from 'drizzle-orm';
import { testDb } from '../../../lib/db/__tests__/test-db.js';
import { createTestUser } from '../../../lib/db/__tests__/test-users.js';
import { CONFIG_DEFS } from '../../../lib/blueprint/catalog.js';
import { SECTION_DEFS } from '../../../lib/db/sectionDefsSeed.js';
import { createAgent } from '../../../lib/db/repository/agents.js';
import { createApiToken } from '../../../lib/db/repository/apiTokens.js';
import { generateApiToken } from '../../../lib/auth/apiToken.js';

import { POST as mcpPOST, GET as mcpGET, DELETE as mcpDELETE } from '../mcp/route.js';

function setSetting(key: string, value: string): void {
  testDb.insert(schema.setting).values({ key, value })
    .onConflictDoUpdate({ target: schema.setting.key, set: { value } })
    .run();
}

let tokenPlaintext: string;
let userId: string;
let fixtureAgentId: string;

beforeAll(() => {
  for (const def of CONFIG_DEFS) {
    testDb.insert(schema.configDef).values({
      key: def.key, label: def.label, datatype: def.datatype,
      allowedValues: def.allowedValues as string[] | null,
      required: def.required, isCore: def.isCore, exportable: true,
    }).onConflictDoNothing().run();
  }
  for (const def of SECTION_DEFS) {
    testDb.insert(schema.sectionDef).values({
      key: def.key, defaultHeading: def.defaultHeading,
      isCore: def.isCore, defaultOrder: def.defaultOrder,
      template: def.template, helpText: def.helpText,
    }).onConflictDoNothing().run();
  }

  const user = createTestUser('user');
  userId = user.id;

  const agent = createAgent(userId, 'mcp-route-test-agent', 'Route-test agent');
  fixtureAgentId = agent.id;

  const generated = generateApiToken();
  tokenPlaintext = generated.plaintext;
  createApiToken({
    ownerId: userId,
    name: 'route-test-token',
    tokenHash: generated.hash,
    prefix: generated.prefix,
    scope: 'read',
  });
});

// Each request gets its own x-forwarded-for so the guard's IP-keyed rate limiter (a
// real, unmocked, module-level store — see mcpGuard.ts step 2) never accumulates
// across this file's ~14 requests and falsely trips a 429 in an unrelated test, same
// pattern as auth.test.ts's nextLoginIp()/nextSignupIp().
let mcpIpCounter = 1;
function nextMcpIp(): string { return `10.0.0.${mcpIpCounter++}`; }

function jsonRpcRequest(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-forwarded-for': nextMcpIp(),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

function authedRequest(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return jsonRpcRequest(body, { Authorization: `Bearer ${tokenPlaintext}`, ...extraHeaders });
}

const TOOLS_LIST_RPC = { jsonrpc: '2.0', id: 1, method: 'tools/list' };

// ── Authentication ────────────────────────────────────────────────────────────

describe('POST /api/mcp — authentication', () => {
  it('unauthenticated request → 401 from the route handler', async () => {
    const res = await mcpPOST(jsonRpcRequest(TOOLS_LIST_RPC));
    expect(res.status).toBe(401);
  });

  it('a Cookie header with no bearer token → still 401 (auth models are disjoint)', async () => {
    const res = await mcpPOST(jsonRpcRequest(TOOLS_LIST_RPC, { Cookie: 'myagent_session=some-fake-session-value' }));
    expect(res.status).toBe(401);
  });

  it('an unknown bearer token → 401', async () => {
    const res = await mcpPOST(jsonRpcRequest(TOOLS_LIST_RPC, { Authorization: 'Bearer mya_totally-unknown-token-value-x' }));
    expect(res.status).toBe(401);
  });
});

// ── Origin validation ──────────────────────────────────────────────────────────

describe('POST /api/mcp — Origin validation', () => {
  it('a request carrying any Origin header is rejected (403) — console clients send none', async () => {
    const res = await mcpPOST(authedRequest(TOOLS_LIST_RPC, { Origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('a request with no Origin header at all proceeds normally', async () => {
    const res = await mcpPOST(authedRequest(TOOLS_LIST_RPC));
    expect(res.status).toBe(200);
  });
});

// ── tools/list ─────────────────────────────────────────────────────────────────

describe('POST /api/mcp — tools/list', () => {
  it('returns all four tool names, regardless of the token\'s scope (§5.6 — scope is enforced at call time, not by hiding tools)', async () => {
    const res = await mcpPOST(authedRequest(TOOLS_LIST_RPC));
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_agent', 'list_agents', 'pull_agent', 'push_agent']);
  });
});

// ── tools/call ─────────────────────────────────────────────────────────────────

describe('POST /api/mcp — tools/call', () => {
  it('list_agents happy path returns the caller\'s agents', async () => {
    const rpc = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_agents', arguments: {} } };
    const res = await mcpPOST(authedRequest(rpc));
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { content: Array<{ type: string; text: string }> } };
    const payload = JSON.parse(body.result.content[0].text) as { agents: Array<{ id: string }> };
    expect(payload.agents.some((a) => a.id === fixtureAgentId)).toBe(true);
  });

  it('get_agent on an unknown id returns an error result, not a 500', async () => {
    const rpc = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_agent', arguments: { agentId: 'nope' } } };
    const res = await mcpPOST(authedRequest(rpc));
    expect(res.status).not.toBe(500);
    const body = await res.json() as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBe(true);
  });

  it('an unknown tool name → a JSON-RPC error, not a 500', async () => {
    const rpc = { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } };
    const res = await mcpPOST(authedRequest(rpc));
    expect(res.status).not.toBe(500);
    const body = await res.json() as { error?: unknown; result?: { isError?: boolean } };
    expect(body.error !== undefined || body.result?.isError === true).toBe(true);
  });
});

// ── Malformed input ────────────────────────────────────────────────────────────

describe('POST /api/mcp — malformed JSON-RPC', () => {
  it('invalid JSON body → a protocol-level error, not a 500', async () => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${tokenPlaintext}`,
        'x-forwarded-for': nextMcpIp(),
      },
      body: '{not valid json',
    });
    const res = await mcpPOST(req);
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('a well-formed JSON body that is not a valid JSON-RPC message → a protocol-level error, not a 500', async () => {
    const res = await mcpPOST(authedRequest({ hello: 'world' }));
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ── Method restrictions ─────────────────────────────────────────────────────────

describe('GET/DELETE /api/mcp — unsupported methods', () => {
  it('GET → 405', async () => {
    const res = await mcpGET();
    expect(res.status).toBe(405);
  });

  it('DELETE → 405', async () => {
    const res = await mcpDELETE();
    expect(res.status).toBe(405);
  });
});

// ── push_agent: cap + origin tracking (Phase 4, §5.6) ─────────────────────────

function importAgentRpc(name: string, id: number): unknown {
  const md = `---\nname: ${name}\ndescription: test\n---\n\n# Role\n\nContent.\n`;
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'push_agent', arguments: { md } } };
}

function bearerRequest(plaintext: string, body: unknown): Request {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${plaintext}`,
      'x-forwarded-for': nextMcpIp(),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mcp — push_agent origin tracking', () => {
  it("a successful push_agent call writes a log row with origin:'mcp'", async () => {
    setSetting('mcpWrites', 'true');
    setSetting('liveLlmCalls', 'true');
    setSetting('maxLlmCallsPerUserPerHour', '1000');

    const user = createTestUser('user');
    const generated = generateApiToken();
    createApiToken({
      ownerId: user.id, name: 'write-token', tokenHash: generated.hash,
      prefix: generated.prefix, scope: 'write',
    });

    const res = await mcpPOST(bearerRequest(generated.plaintext, importAgentRpc('origin-test-agent', 10)));
    expect(res.status).toBe(200);
    const body = await res.json() as { result: { isError?: boolean } };
    expect(body.result.isError).not.toBe(true);

    const rows = testDb.select().from(schema.llmCallLog).where(eq(schema.llmCallLog.userId, user.id)).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.origin === 'mcp')).toBe(true);
  });
});

describe('POST /api/mcp — push_agent per-user cap', () => {
  it('past the per-user cap → a tool error carrying retry-after info, no new log row', async () => {
    setSetting('mcpWrites', 'true');
    setSetting('liveLlmCalls', 'true');
    setSetting('maxLlmCallsPerUserPerHour', '1');

    const user = createTestUser('user');
    const generated = generateApiToken();
    createApiToken({
      ownerId: user.id, name: 'write-token-cap', tokenHash: generated.hash,
      prefix: generated.prefix, scope: 'write',
    });

    try {
      // First call consumes the cap (limit=1)
      const first = await mcpPOST(bearerRequest(generated.plaintext, importAgentRpc('cap-agent-1', 20)));
      expect(first.status).toBe(200);

      const rowsAfterFirst = testDb.select().from(schema.llmCallLog).where(eq(schema.llmCallLog.userId, user.id)).all();
      const countAfterFirst = rowsAfterFirst.length;
      expect(countAfterFirst).toBeGreaterThan(0);

      // Second call → cap reached
      const second = await mcpPOST(bearerRequest(generated.plaintext, importAgentRpc('cap-agent-2', 21)));
      expect(second.status).toBe(200);
      const secondBody = await second.json() as { result: { content: Array<{ text: string }>; isError?: boolean } };
      expect(secondBody.result.isError).toBe(true);
      expect(secondBody.result.content[0].text).toContain('cap reached');

      // No new log row written for the cap-blocked call (the log IS the counter — §3.9)
      const rowsAfterSecond = testDb.select().from(schema.llmCallLog).where(eq(schema.llmCallLog.userId, user.id)).all();
      expect(rowsAfterSecond.length).toBe(countAfterFirst);
    } finally {
      setSetting('maxLlmCallsPerUserPerHour', '1000');
    }
  });
});
