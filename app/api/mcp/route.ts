/**
 * app/api/mcp/route.ts
 *
 * The MCP endpoint (Plan 13 §4.3). POST only — a console MCP client (Claude Code and
 * equivalents) sends JSON-RPC requests here, authenticated by a per-user bearer token
 * generated in /account, never the browser session cookie.
 *
 * Node runtime, mandatory: better-sqlite3 (reached indirectly through the repository
 * calls inside lib/mcp/*) is a native module and cannot run on the Edge runtime.
 *
 * middleware.ts bypasses this path entirely (its own header explains why: middleware
 * is not the authorization boundary) — this route independently calls
 * authenticateMcpToken() below, so an unauthenticated POST here gets 401 from THIS
 * route handler, not from middleware.
 *
 * Origin validation (§4.3): legitimate console MCP clients are not browsers and send
 * no Origin header at all. A present Origin is the DNS-rebinding signature the MCP
 * spec warns servers to guard against, so any present Origin is rejected outright —
 * there is no browser client this endpoint should ever accept one from, and no CORS
 * headers are emitted for the same reason.
 */

export const runtime = 'nodejs';

import { authenticateMcpToken } from '@/lib/auth/mcpGuard';
import { handleMcpRequest } from '@/lib/mcp/server';

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ error: 'method_not_allowed', message: 'This endpoint only accepts POST (stateless JSON-RPC) — GET/DELETE session semantics are not supported.' }),
    { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateMcpToken(request);
  if (!auth.ok) return auth.response;

  const origin = request.headers.get('Origin');
  if (origin !== null) {
    return new Response(
      JSON.stringify({ error: 'origin_not_allowed' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return handleMcpRequest(request, auth.principal);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}
