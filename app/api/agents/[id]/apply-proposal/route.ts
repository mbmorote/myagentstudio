/**
 * app/api/agents/[id]/apply-proposal/route.ts
 *
 * POST /api/agents/[id]/apply-proposal
 *
 * The single writer in the propose/apply flow. Accepts a modifications object
 * produced by POST /api/chat and applies it to the agent.
 *
 * Contract (plans/08-prometheus-apply.md §3.2, §3.3):
 *   Request:  { modifications: { description?, sections?, config? } }
 *   Response: { agent: AgentDTO,
 *               applied: { description, sectionKeys, removedSectionKeys, configKeys },
 *               skipped[] }
 *
 * Algorithm (§3.3 — order is normative):
 *   1. authenticate() → 401
 *   2. Parse body shape only (never content) → 400 invalid_body
 *   3. getAgentFull(id, session.userId) → 404 if null (enforces ownership)
 *   4. Drop modifications.name → skipped
 *   5. Sections first — a sectionKey mapped to `null` deletes the matching section
 *      (2026-08-12, closes roadmap TODO item 1's remaining chat half — mirrors config's
 *      null-to-delete convention); a sectionKey matching an existing section goes through
 *      updateSectionContent(author:'ai', expectedVersion=current); a sectionKey with no
 *      match is treated as an add (2026-08-11, closes roadmap TODO item 1's add half)
 *      via addSection(), with a heading derived server-side (catalog lookup, else
 *      derived from the key) since the sections contract carries content only.
 *   6. description + config together in one updateAgent() call (config = merged full set)
 *   7. Return fresh getAgentFull() read
 *
 * Config merge (§3.4 — the highest-risk invariant):
 *   updateAgent() does a FULL REPLACE of config rows. The apply route builds the merged
 *   full set from the current config before calling updateAgent(), so a one-key
 *   modifications.config never silently deletes the other keys. null = delete; any other
 *   value = set. Only passes config to updateAgent() when modifications.config is present
 *   and non-empty (§3.4 last paragraph).
 *
 * Error codes (plans/08-prometheus-apply.md §8):
 *   400  malformed body (modifications not a plain object, sections values not strings,
 *        config not a plain object)
 *   401  unauthorized
 *   404  agent not found or not owned by caller (cross-owner yields 404, never 403)
 *   500  unexpected write failure
 */

import { NextResponse } from 'next/server';
import {
  getAgentFull,
  updateSectionContent,
  addSection,
  deleteSection,
  updateAgent,
  getSectionDefs,
  SectionNotFoundError,
} from '@/lib/db/repository';
import {
  demoteSplitLevelHeadings,
  ensureTrailingBlankLine,
  stripEchoedHeading,
  deriveHeadingForNewSection,
} from '@/lib/ai/prometheus';
import { authenticate } from '@/lib/auth/guard';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext): Promise<NextResponse> {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const auth = await authenticate();
  if (!auth.ok) return auth.response;
  const { session } = auth;

  const { id } = await params;

  // ── 2. Parse + validate body shape (never content — §3.5) ─────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_body', field: 'modifications' }, { status: 400 });
  }

  const rawMods = (body as Record<string, unknown>).modifications;
  if (!rawMods || typeof rawMods !== 'object' || Array.isArray(rawMods)) {
    return NextResponse.json({ error: 'invalid_body', field: 'modifications' }, { status: 400 });
  }

  const mods = rawMods as Record<string, unknown>;

  // sections must be a plain object with string or null values (if present) —
  // null = delete the section, mirroring config's null-to-delete convention.
  if (mods.sections !== undefined) {
    if (typeof mods.sections !== 'object' || Array.isArray(mods.sections) || mods.sections === null) {
      return NextResponse.json({ error: 'invalid_body', field: 'sections' }, { status: 400 });
    }
    for (const val of Object.values(mods.sections as Record<string, unknown>)) {
      if (typeof val !== 'string' && val !== null) {
        return NextResponse.json({ error: 'invalid_body', field: 'sections' }, { status: 400 });
      }
    }
  }

  // config must be a plain object (if present)
  if (mods.config !== undefined) {
    if (typeof mods.config !== 'object' || Array.isArray(mods.config) || mods.config === null) {
      return NextResponse.json({ error: 'invalid_body', field: 'config' }, { status: 400 });
    }
  }

  const modifications = {
    description: typeof mods.description === 'string' ? mods.description : undefined,
    sections: mods.sections as Record<string, string | null> | undefined,
    config: mods.config as Record<string, unknown> | undefined,
    name: mods.name,
  };

  // ── 3. Load agent — enforces ownership; 404 for cross-owner (§7 invariant 10) ──
  const agent = getAgentFull(id, session.userId);
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Tracking for the response
  const skipped: { part: string; key: string; reason: string }[] = [];
  const appliedSectionKeys: string[] = [];
  const removedSectionKeys: string[] = [];
  let appliedDescription = false;
  const appliedConfigKeys: string[] = [];

  // ── 4. Drop modifications.name (§7 invariant 2, §3.3 step 4) ─────────────
  if (modifications.name !== undefined) {
    console.warn(`[apply-proposal] agent ${id}: modifications.name dropped (never chat-editable)`);
    skipped.push({ part: 'name', key: 'name', reason: 'name_not_editable' });
  }

  // ── 5. Sections first (§3.3 step 5) ──────────────────────────────────────
  // sectionKey → { id, version } map from the loaded agent (last-in-order wins for
  // duplicate sectionKeys — same documented MVP caveat as the old chat route).
  const sectionMap = new Map<string, { id: string; version: number; heading: string | null }>();
  for (const section of agent.sections) {
    sectionMap.set(section.sectionKey, { id: section.id, version: section.version, heading: section.heading });
  }

  for (const [sectionKey, content] of Object.entries(modifications.sections ?? {})) {
    const entry = sectionMap.get(sectionKey);

    if (content === null) {
      // null = delete the section, mirroring config's null-to-delete convention (§3.4).
      if (!entry) {
        // Nothing to delete — proposing removal of a section that doesn't exist
        // (or was already removed since the proposal was made) is a no-op, not an error.
        skipped.push({ part: 'section', key: sectionKey, reason: 'no_such_section' });
        continue;
      }
      try {
        deleteSection(id, entry.id, session.userId);
        removedSectionKeys.push(sectionKey);
      } catch (err) {
        if (err instanceof SectionNotFoundError) {
          console.warn(`[apply-proposal] agent ${id}: sectionKey "${sectionKey}" disappeared mid-apply while deleting`);
          skipped.push({ part: 'section', key: sectionKey, reason: 'no_such_section' });
        } else {
          console.error(`[apply-proposal] Unexpected write failure deleting section "${sectionKey}":`, String(err));
          return NextResponse.json({ error: 'internal' }, { status: 500 });
        }
      }
      continue;
    }

    if (!entry) {
      // Unknown sectionKey — Prometheus is proposing a section that doesn't exist yet
      // on this agent (2026-08-11, closes roadmap TODO item 1's chat half). Same
      // content processing as an update (demotion, echoed-heading strip, trailing
      // blank line), but against a heading derived here rather than one the model
      // returned — the sections contract carries content only (GUARDRAILS #9).
      const heading = deriveHeadingForNewSection(sectionKey, agent.splitLevel, getSectionDefs(agent.platform));
      const stripped = stripEchoedHeading(content, heading);
      const demoted = demoteSplitLevelHeadings(stripped, agent.splitLevel);
      const safe = ensureTrailingBlankLine(demoted);
      try {
        addSection(id, session.userId, { sectionKey, heading, content: safe }, 'ai');
        appliedSectionKeys.push(sectionKey);
      } catch (err) {
        if (err instanceof SectionNotFoundError) {
          // Should never happen (we just loaded the agent in step 3), but handle cleanly.
          console.warn(`[apply-proposal] agent ${id}: agent disappeared mid-apply while adding "${sectionKey}"`);
          skipped.push({ part: 'section', key: sectionKey, reason: 'no_such_section' });
        } else {
          console.error(`[apply-proposal] Unexpected write failure adding section "${sectionKey}":`, String(err));
          return NextResponse.json({ error: 'internal' }, { status: 500 });
        }
      }
      continue;
    }

    // §3.3 step 5 + §7 invariant 8: split-level demotion runs at the apply route,
    // regardless of what the caller already did — the apply route is the authoritative gate.
    // Same reasoning for the other two: strip a redundant echo of the section's own
    // heading (content is body-only — heading is a separate field, never duplicated
    // inside it), then ensure a trailing blank line so exportAgent()'s no-separator
    // concatenation (lib/serialize/export.ts) never glues the next heading onto this
    // section's last line of text.
    const stripped = stripEchoedHeading(content, entry.heading);
    const demoted = demoteSplitLevelHeadings(stripped, agent.splitLevel);
    const safe = ensureTrailingBlankLine(demoted);

    try {
      // expectedVersion = version read in step 3 → force-write (§3.6, Decision G)
      updateSectionContent(id, entry.id, session.userId, safe, 'ai', entry.version);
      appliedSectionKeys.push(sectionKey);
    } catch (err) {
      if (err instanceof SectionNotFoundError) {
        // Should never happen (we just loaded the agent in step 3), but handle cleanly.
        console.warn(`[apply-proposal] agent ${id}: sectionKey "${sectionKey}" disappeared mid-apply`);
        skipped.push({ part: 'section', key: sectionKey, reason: 'no_such_section' });
      } else {
        console.error(`[apply-proposal] Unexpected write failure for section "${sectionKey}":`, String(err));
        return NextResponse.json({ error: 'internal' }, { status: 500 });
      }
    }
  }

  // ── 6. description + config together in one updateAgent() call (§3.3 step 6) ──
  const agentUpdates: {
    description?: string;
    config?: { propKey: string; value: unknown }[];
  } = {};

  // description: only if present and different from current
  if (
    modifications.description !== undefined &&
    modifications.description !== agent.description
  ) {
    agentUpdates.description = modifications.description;
    appliedDescription = true;
  }

  // config: MERGED full set (§3.4 — never pass the raw diff to updateAgent())
  // Only compute and pass config when modifications.config is present and non-empty.
  if (modifications.config !== undefined && Object.keys(modifications.config).length > 0) {
    const merged = new Map<string, unknown>(
      agent.config.map((c) => [c.propKey, c.value]),
    );

    for (const [propKey, value] of Object.entries(modifications.config)) {
      if (value === null) {
        // null = delete the key (§3.4)
        merged.delete(propKey);
      } else {
        merged.set(propKey, value);
      }
      // Track which keys were actually modified (whether set or deleted)
      appliedConfigKeys.push(propKey);
    }

    agentUpdates.config = [...merged].map(([propKey, value]) => ({ propKey, value }));
  }

  if (agentUpdates.description !== undefined || agentUpdates.config !== undefined) {
    try {
      updateAgent(id, session.userId, agentUpdates);
    } catch (err) {
      console.error('[apply-proposal] Unexpected failure in updateAgent():', String(err));
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }
  }

  // ── 7. Fresh read — response reflects all writes (§3.3 step 7) ────────────
  const updated = getAgentFull(id, session.userId);
  if (!updated) {
    // Should be unreachable — we just wrote to this agent.
    console.error(`[apply-proposal] agent ${id}: getAgentFull returned null after writes`);
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json(
    {
      agent: updated,
      applied: {
        description: appliedDescription,
        sectionKeys: appliedSectionKeys,
        removedSectionKeys,
        configKeys: appliedConfigKeys,
      },
      skipped,
    },
    { status: 200 },
  );
}
