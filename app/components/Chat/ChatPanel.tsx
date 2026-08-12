'use client';

/**
 * app/components/Chat/ChatPanel.tsx
 *
 * Plan 03 Phase B, B.10 — Restyled with message bubbles and section target chips.
 * Plan 08 Phase 3 — Proposal card: ports Phase 0 mockup into real React; replaces
 *   the Phase 2 placeholder. Full five-state proposal card (Pending / Applying /
 *   Applied / Failed / Restored), before/after disclosure per row, warnings,
 *   show-more truncation past ~12 lines, ✦ Prometheus label.
 *
 * Matches the mockup's .msg/.bubble/.who layout:
 *   - User messages: right-aligned, accent background
 *   - Assistant messages: left-aligned, elev background with border
 *
 * Target chips: ◆ section · <key>, ◆ config · <key>, ◆ description.
 * Sourced from Object.keys(modifications.sections), Object.keys(modifications.config),
 * and modifications.description presence (replaces the old sections-only R13 chips).
 *
 * Sends { agentId, instruction, citedSectionKeys?, citedConfigKeys?, history? } to
 * POST /api/chat via AbortController (Rules Index #23). `history` is this session's
 * prior turns (role + text), excluding client-side synthetic notices — server caps
 * how much of it is used (settings.chatHistoryTurns).
 * Response shape: { proposal: { message, modifications, warnings }, meta }
 * (old { sections: {...} } shape removed in Plan 08 Phase 1).
 *
 * Interaction lock (§6 rule 12, Rules Index #22):
 *   - In flight: onChatStart() → lock='chat', edit disabled.
 *   - Done: onChatEnd() → lock released.
 *   - Cancel: abort() → lock released immediately.
 *   - lock='edit': send disabled.
 *   - lock='proposal': send is ALLOWED — sending discards the pending proposal
 *     first, then proceeds (§5.4 Decision F).
 *
 * Plan 05 Phase 4.1 — fetch → apiFetch (§5.4).
 * Plan 05 Phase 4.7 — cap-reached 429 handling (§3.9): two-action prompt
 *   "Preview without sending" (re-sends with dryRun:true) or "Wait" (dismiss).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import type { InteractionLock, CitedItem } from '@/app/components/WorkbenchShell';
import type { PendingProposal } from '@/lib/proposalStore';
import type { AgentDTO } from '@/lib/db/repository';
import { apiFetch } from '@/lib/apiFetch';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Section keys changed in this turn → ◆ section · <key> chips */
  changedSectionKeys?: string[];
  /** Config keys changed in this turn → ◆ config · <key> chips */
  changedConfigKeys?: string[];
  /** True when description was changed in this turn → ◆ description chip */
  hasDescriptionChange?: boolean;
  /** Non-null when this message is a dry-run notice (§5.2) */
  dryRunLogId?: string | null;
  /**
   * True for client-generated notices (dry-run, error, network-error, cancelled) —
   * never real Prometheus output. Excluded from the `history` sent to /api/chat,
   * since sending Prometheus its own error strings back as "what it said" would
   * corrupt the conversation, not preserve it.
   */
  synthetic?: boolean;
  /** Full proposed content for this turn (2026-08-07, at the user's request) — lets a
   *  past turn's proposal be reopened for reading after it's been applied/discarded,
   *  not just summarized by the chips above. In-memory only, same lifetime as the rest
   *  of `messages` (no chat persistence yet — NEXT item 2). */
  modifications?: PendingProposal['modifications'];
}

/** State for a cap-reached prompt, shown in place of a message bubble (§3.9). */
interface CapPrompt {
  instruction: string;
  retryAfterSeconds: number;
  canDryRun: boolean;
  citedSectionKeys?: string[];
  citedConfigKeys?: string[];
}

interface ChatPanelProps {
  agentId: string;
  agentName: string;
  /** Full agent DTO — needed for before/after display in the proposal card. */
  agent: AgentDTO | null;
  interactionLock: InteractionLock;
  /** Sections/config blocks currently cited (WorkbenchShell) — display-only here. */
  citedItems: CitedItem[];
  onRemoveCite: (item: CitedItem) => void;
  /** Called once the citation has been captured for an outgoing message. */
  onClearCited: () => void;
  onChatStart: () => void;
  onChatEnd: () => void;
  /**
   * Called when a 200 response with non-empty modifications arrives.
   * WorkbenchShell owns the write to proposalStore — not ChatPanel.
   * Keeps storage ownership centralized in the same place as Apply/Discard.
   */
  onProposalReceived: (
    message: string,
    modifications: PendingProposal['modifications'],
    warnings: string[],
  ) => void;
  /** Plan 08 Phase 2: pending proposal from WorkbenchShell's proposalStore. */
  pendingProposal?: PendingProposal | null;
  /** True while the apply POST is in flight. */
  isApplying?: boolean;
  onApplyProposal?: () => Promise<void>;
  onDiscardProposal?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the "2 sections · 1 config key · description" summary string. */
function buildModSummary(mods: PendingProposal['modifications']): string {
  const parts: string[] = [];
  const sectionCount = Object.keys(mods.sections ?? {}).length;
  const configCount = Object.keys(mods.config ?? {}).length;
  if (sectionCount > 0) parts.push(`${sectionCount} section${sectionCount !== 1 ? 's' : ''}`);
  if (configCount > 0) parts.push(`${configCount} config key${configCount !== 1 ? 's' : ''}`);
  if (mods.description !== undefined) parts.push('description');
  return parts.join(' · ') || 'no changes';
}

/** Format a config value for display. */
function formatConfigValue(value: unknown): { isNull: boolean; text: string } {
  if (value === null) return { isNull: true, text: 'Remove this key' };
  try {
    return { isNull: false, text: JSON.stringify(value, null, 2) };
  } catch {
    return { isNull: false, text: String(value) };
  }
}

/** Count newline-separated lines in a string. */
function countLines(str: string): number {
  return str.split('\n').length;
}

/** Return a relative time string ("2 hours ago", "5 minutes ago", etc.). */
function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
}

/** True when the proposal is older than 60 s — treat as "restored from last session". */
function isRestoredProposal(proposedAt: string): boolean {
  return Date.now() - new Date(proposedAt).getTime() > 60_000;
}

function humanizeSecs(secs: number): string {
  if (secs < 60) return `${secs} second${secs !== 1 ? 's' : ''}`;
  const m = Math.floor(secs / 60);
  return `${m} minute${m !== 1 ? 's' : ''}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatPanel({
  agentId,
  agentName,
  agent,
  interactionLock,
  citedItems,
  onRemoveCite,
  onClearCited,
  onChatStart,
  onChatEnd,
  onProposalReceived,
  pendingProposal,
  isApplying,
  onApplyProposal,
  onDiscardProposal,
}: ChatPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isInFlight, setIsInFlight] = useState(false);
  const [capPrompt, setCapPrompt] = useState<CapPrompt | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Proposal card local state ─────────────────────────────────────────────
  /** Error message set when Apply fails; cleared on new proposal or Discard. */
  const [applyError, setApplyError] = useState<string | null>(null);
  /** Brief "✓ Applied" flash after a successful apply; auto-clears after 2.5 s. */
  const [appliedTransient, setAppliedTransient] = useState(false);
  /** Previous isApplying value — lets the effect detect the true→false transition. */
  const prevIsApplyingRef = useRef(false);
  /** Rows with "show current (before)" expanded. Keyed by rowId. */
  const [openBeforeRows, setOpenBeforeRows] = useState<Set<string>>(new Set());
  /** Rows with long-value "show more" expanded. Keyed by rowId. */
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Reset per-row UI toggles (and stale error/applied state) whenever a new proposal
  // arrives — identified by its (agentId, proposedAt) pair.
  const proposalKey = pendingProposal
    ? `${pendingProposal.agentId}:${pendingProposal.proposedAt}`
    : null;
  const prevProposalKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (proposalKey === prevProposalKeyRef.current) return;
    prevProposalKeyRef.current = proposalKey;
    setOpenBeforeRows(new Set());
    setExpandedRows(new Set());
    if (proposalKey !== null) {
      // New proposal replaced an old one — clear any stale error/applied state.
      setApplyError(null);
      setAppliedTransient(false);
    }
  }, [proposalKey]);

  // Detect Apply success/failure by watching isApplying transition true → false.
  // In React 18, setIsApplying(false) and clearProposal() (→ useSyncExternalStore)
  // batch into one render, so the check below sees both final values at once.
  useEffect(() => {
    const wasApplying = prevIsApplyingRef.current;
    prevIsApplyingRef.current = !!isApplying;

    if (!wasApplying || isApplying) return; // no transition, nothing to do

    if (pendingProposal != null) {
      // isApplying went false but proposal still exists → apply failed
      setApplyError('Apply failed — your changes were not saved. Try again.');
      return;
    }

    // Proposal cleared → success
    setApplyError(null);
    setAppliedTransient(true);
    const t = setTimeout(() => setAppliedTransient(false), 2500);
    return () => clearTimeout(t);
  }, [isApplying, pendingProposal]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // 'proposal' lock: send is ALLOWED (§5.4 Decision F — discards proposal first).
  const canSend =
    !isInFlight &&
    interactionLock !== 'edit' &&
    instruction.trim().length > 0;
  const canCancel = isInFlight;

  // ── Per-row toggle helpers ────────────────────────────────────────────────
  function toggleBefore(rowId: string) {
    setOpenBeforeRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  }
  function toggleExpanded(rowId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  }

  // ── Proposal card renderer ────────────────────────────────────────────────
  /**
   * Renders the proposal card in one of five states:
   *   Applied (transient), Pending, Applying, Failed, or Restored.
   * Returns null when neither pendingProposal nor appliedTransient is active.
   */
  function renderProposalCard() {
    // Applied transient: collapse to a single "✓ Applied" line
    if (!pendingProposal && appliedTransient) {
      return (
        <div className="mt-[8px] border border-[var(--border)] rounded-[9px] overflow-hidden bg-[var(--bg)]">
          <div className="px-[10px] py-[5px] text-[11px] text-[var(--faint)] flex items-center gap-[5px]">
            <span className="text-[var(--ok)] font-semibold">✓</span> Applied
          </div>
        </div>
      );
    }

    if (!pendingProposal) return null;

    const mods = pendingProposal.modifications;
    const summary = buildModSummary(mods);
    const applying = !!isApplying;
    const restored = isRestoredProposal(pendingProposal.proposedAt);

    const sectionEntries = Object.entries(mods.sections ?? {});
    const configEntries = Object.entries(mods.config ?? {});
    const descriptionValue = mods.description;

    return (
      <details className="mt-[8px] border border-[var(--border)] rounded-[9px] overflow-hidden bg-[var(--bg)]">
        <summary className="flex items-center gap-[7px] px-[10px] py-[6px] bg-[var(--panel)] border-b border-[var(--border)] list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none">
          <span className="text-[11px] font-semibold text-[var(--text)]">Proposed changes</span>
          <span className="text-[10.5px] text-[var(--faint)]">{summary}</span>
          <span className="text-[10px] text-[var(--faint)] ml-auto">▾</span>
        </summary>

        {/* Restored-from-localStorage note */}
        {restored && (
          <div className="px-[10px] py-[5px] text-[10px] text-[var(--warn)] flex items-center gap-[5px] border-b border-[var(--border)]">
            ⟳ Proposed {relativeTime(pendingProposal.proposedAt)} — restored from your last session.
          </div>
        )}

        {/* Description row */}
        {descriptionValue !== undefined &&
          renderContentRow(
            'description',
            'Description',
            descriptionValue,
            false,
            agent?.description ?? null,
          )}

        {/* Section rows */}
        {sectionEntries.map(([key, content]) => {
          const isRemoval = content === null;
          return renderContentRow(
            `section:${key}`,
            `Section · ${key}`,
            isRemoval ? '' : content,
            isRemoval,
            agent?.sections.find((s) => s.sectionKey === key)?.content ?? null,
            'Remove this section',
          );
        })}

        {/* Config rows */}
        {configEntries.map(([key, rawValue]) => {
          const { isNull, text } = formatConfigValue(rawValue);
          const existing = agent?.config.find((c) => c.propKey === key);
          const beforeText = existing != null ? formatConfigValue(existing.value).text : null;
          return renderContentRow(`config:${key}`, `Config · ${key}`, text, isNull, beforeText);
        })}

        {/* Server-side warnings */}
        {(pendingProposal.warnings ?? []).map((w, wi) => (
          <div
            key={wi}
            className="px-[10px] py-[5px] text-[10.5px] text-[var(--warn)] border-b border-[var(--border)] bg-[rgba(179,128,28,0.07)]"
          >
            ⚠ {w}
          </div>
        ))}

        {/* Apply-failed error line (§6.3 Failed state) */}
        {applyError && (
          <div className="px-[10px] py-[5px] text-[10.5px] text-[var(--err)] border-b border-[var(--border)] bg-[rgba(207,75,65,0.07)]">
            ⚠ {applyError}
          </div>
        )}

        {/* Footer */}
        <div className="px-[10px] py-[7px] border-t border-[var(--border)] bg-[var(--panel)]">
          <div className="flex items-center gap-[7px] flex-wrap">
            <button
              type="button"
              disabled={applying}
              onClick={() => void onApplyProposal?.()}
              className={`font-[inherit] text-[11.5px] rounded-[6px] px-[12px] py-[5px] border-none bg-[var(--accent)] text-white font-semibold ${
                applying
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:brightness-110'
              }`}
            >
              {applying ? (
                <>
                  <span className="inline-block w-[9px] h-[9px] border-[1.5px] border-white/35 border-t-white rounded-full animate-spin align-middle mr-[4px]" />
                  Applying…
                </>
              ) : (
                'Apply'
              )}
            </button>
            <button
              type="button"
              disabled={applying}
              onClick={() => {
                setApplyError(null);
                onDiscardProposal?.();
              }}
              className={`font-[inherit] text-[11.5px] rounded-[6px] px-[12px] py-[5px] border border-[var(--border)] bg-[var(--elev)] text-[var(--muted)] ${
                applying
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:text-[var(--text)] hover:border-[var(--text)]'
              }`}
            >
              Discard
            </button>
            <span className="text-[10px] text-[var(--faint)] ml-[4px]">
              Editing is locked until you apply or discard.
            </span>
          </div>
        </div>
      </details>
    );
  }

  /**
   * Renders one row inside the proposal card (description, section, or config).
   * The key prop is set on the returned div so React reconciles arrays correctly.
   */
  function renderContentRow(
    rowId: string,
    label: string,
    value: string,
    isNullRemoval: boolean,
    beforeValue: string | null,
    removalLabel: string = 'Remove this key',
  ) {
    const isLong = countLines(value) > 12;
    const isExpanded = expandedRows.has(rowId);
    const showBefore = openBeforeRows.has(rowId);

    return (
      <div key={rowId} className="px-[10px] py-[7px] border-b border-[var(--border)] last:border-b-0">
        {/* Row header: label + optional "show/hide current" toggle */}
        <div className="flex items-center mb-[4px]">
          <span className="text-[10px] text-[var(--faint)] tracking-[.04em] uppercase">
            {label}
          </span>
          {beforeValue !== null && (
            <button
              type="button"
              onClick={() => toggleBefore(rowId)}
              className="ml-auto text-[10px] text-[var(--accent-ink)] bg-transparent border-none p-0 font-[inherit] cursor-pointer hover:underline"
            >
              {showBefore ? 'hide current ▴' : 'show current ▾'}
            </button>
          )}
        </div>

        {/* New value — side-by-side with Current value when "show current" is toggled on,
            instead of stacked underneath (2026-08-07, at the user's request). */}
        <div className={showBefore && beforeValue !== null ? 'flex gap-[8px] items-start' : ''}>
          {showBefore && beforeValue !== null && (
            <div className="flex-1 min-w-0">
              <span className="text-[10px] text-[var(--faint)] mb-[3px] italic block">
                Current value
              </span>
              <pre className="font-[var(--mono,monospace)] text-[10.5px] whitespace-pre-wrap text-[var(--text)] m-0 bg-[var(--elev)] border border-[var(--border)] rounded-[5px] px-[8px] py-[5px] leading-[1.5] block opacity-70">
                {beforeValue}
              </pre>
            </div>
          )}
          <div className={showBefore && beforeValue !== null ? 'flex-1 min-w-0' : ''}>
            {showBefore && beforeValue !== null && (
              <span className="text-[10px] text-[var(--faint)] mb-[3px] italic block">
                New value
              </span>
            )}
            {isNullRemoval ? (
              <pre className="font-[var(--mono,monospace)] text-[10.5px] whitespace-pre-wrap text-[var(--text)] m-0 bg-[var(--elev)] border border-[var(--border)] rounded-[5px] px-[8px] py-[5px] leading-[1.5] block">
                <em className="not-italic text-[var(--muted)]">{removalLabel}</em>
              </pre>
            ) : (
              <div className="relative">
                <pre
                  className={`font-[var(--mono,monospace)] text-[10.5px] whitespace-pre-wrap text-[var(--text)] m-0 bg-[var(--elev)] border border-[var(--border)] rounded-[5px] px-[8px] py-[5px] leading-[1.5] block${isLong && !isExpanded ? ' max-h-[185px] overflow-hidden' : ''}`}
                >
                  {value}
                </pre>
                {isLong && !isExpanded && (
                  <div className="absolute bottom-0 left-0 right-0 h-[36px] bg-gradient-to-t from-[var(--bg)] to-transparent rounded-b-[5px] pointer-events-none" />
                )}
                {isLong && (
                  <div className="flex justify-end mt-[4px]">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(rowId)}
                      className="px-[8px] py-[2px] text-[10.5px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[5px] cursor-pointer hover:opacity-90"
                    >
                      {isExpanded ? '▴ show less' : '▾ show more'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Core send logic ───────────────────────────────────────────────────────
  async function doSend(
    text: string,
    dryRun = false,
    citedSectionKeys?: string[],
    citedConfigKeys?: string[],
  ) {
    setIsInFlight(true);
    setCapPrompt(null);
    onChatStart();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Prior turns for conversational context — real dialogue only (excludes
    // client-side notices like dry-run/error/cancelled bubbles). Sent as-is;
    // the server caps how much of it is actually used (settings.chatHistoryTurns).
    const history = messages
      .filter((m) => !m.synthetic)
      .map((m) => ({ role: m.role, message: m.text }));

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          instruction: text,
          ...(dryRun ? { dryRun: true } : {}),
          ...(citedSectionKeys && citedSectionKeys.length > 0 ? { citedSectionKeys } : {}),
          ...(citedConfigKeys && citedConfigKeys.length > 0 ? { citedConfigKeys } : {}),
          ...(history.length > 0 ? { history } : {}),
        }),
        signal: controller.signal,
      });

      if (response.status === 499) return;

      // Parse body once — needed for dry-run check BEFORE !response.ok (§5.2, §7.2)
      const body = (await response.json().catch(() => ({ error: 'unknown' }))) as {
        error?: string;
        dryRun?: boolean;
        logId?: string | null;
        proposal?: {
          message: string;
          modifications: PendingProposal['modifications'];
          warnings: string[];
        };
        limit?: number;
        windowSeconds?: number;
        retryAfterSeconds?: number;
        canDryRun?: boolean;
      };

      // Per-user LLM cap reached (§3.9)
      if (response.status === 429 && body.error === 'llm_cap_reached') {
        setCapPrompt({
          instruction: text,
          retryAfterSeconds: body.retryAfterSeconds ?? 60,
          canDryRun: body.canDryRun ?? true,
          citedSectionKeys,
          citedConfigKeys,
        });
        return;
      }

      // Dry-run blocked: render as assistant notice bubble with link (§5.2)
      if (body.dryRun) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: 'Live LLM calls are off — no changes were made.',
            dryRunLogId: body.logId ?? null,
            synthetic: true,
          },
        ]);
        return;
      }

      if (!response.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `Error: ${body.error ?? response.statusText}`, synthetic: true },
        ]);
        return;
      }

      // ── 200 success — new propose-only contract (Plan 08 Phase 1) ──────────
      const proposal = body.proposal;
      if (!proposal) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: 'Error: unexpected response shape from server.', synthetic: true },
        ]);
        return;
      }

      const mods = proposal.modifications ?? {};
      const changedSectionKeys = Object.keys(mods.sections ?? {});
      const changedConfigKeys = Object.keys(mods.config ?? {});
      const hasDescriptionChange = mods.description !== undefined;
      const hasModifications =
        changedSectionKeys.length > 0 || changedConfigKeys.length > 0 || hasDescriptionChange;

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: proposal.message,
          changedSectionKeys: changedSectionKeys.length > 0 ? changedSectionKeys : undefined,
          changedConfigKeys: changedConfigKeys.length > 0 ? changedConfigKeys : undefined,
          hasDescriptionChange: hasDescriptionChange || undefined,
          modifications: hasModifications ? mods : undefined,
        },
      ]);

      if (hasModifications) {
        // Report proposal upward — WorkbenchShell writes to proposalStore (§6.2)
        onProposalReceived(proposal.message, mods, proposal.warnings ?? []);
      }
      // Empty modifications → question-only turn; no card, no lock (§5.4)

      setTimeout(scrollToBottom, 50);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Network error. Please try again.', synthetic: true },
      ]);
    } finally {
      abortControllerRef.current = null;
      setIsInFlight(false);
      onChatEnd();
    }
  }

  async function handleSend() {
    if (!canSend) return;
    const trimmed = instruction.trim();
    if (!trimmed) return;

    // Decision F (§5.4): sending while a proposal is pending discards it first.
    if (pendingProposal) {
      onDiscardProposal?.();
      setApplyError(null);
      setAppliedTransient(false);
    }

    // Capture citations for this message, then clear — a citation applies
    // to the message it was visible for, not to whatever's sent next (2026-07-31).
    const secKeys = citedItems.filter((c) => c.type === 'section').map((c) => c.key);
    const cfgKeys = citedItems.filter((c) => c.type === 'config').map((c) => c.key);
    onClearCited();

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInstruction('');
    await doSend(
      trimmed,
      false,
      secKeys.length > 0 ? secKeys : undefined,
      cfgKeys.length > 0 ? cfgKeys : undefined,
    );
  }

  /** "Preview without sending" — re-sends the blocked instruction as dry-run (§3.9) */
  async function handleCapPreview() {
    if (!capPrompt) return;
    const { instruction: text, citedSectionKeys, citedConfigKeys } = capPrompt;
    setCapPrompt(null);
    await doSend(text, true, citedSectionKeys, citedConfigKeys);
  }

  function handleCapDismiss() {
    setCapPrompt(null);
  }

  function handleCancel() {
    if (!abortControllerRef.current) return;
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    setIsInFlight(false);
    onChatEnd();
    setMessages((prev) => [...prev, { role: 'assistant', text: '(Cancelled)', synthetic: true }]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    /* .chat */
    <div data-chat-panel className="flex flex-col h-full">
      {/* Message scroll area — .chat-scroll */}
      <div className="flex-1 min-h-0 overflow-auto px-[14px] pt-[14px] pb-[6px] flex flex-col gap-3">

        {/* Standalone proposal card — restore case: no messages in this session yet */}
        {messages.length === 0 && (pendingProposal || appliedTransient) && (
          <div className="self-start w-full max-w-[92%]">
            <span className="text-[10px] text-[var(--faint)] tracking-[.04em] mb-[4px] block">
              ✦ Prometheus
            </span>
            {renderProposalCard()}
          </div>
        )}

        {messages.length === 0 && !capPrompt && !pendingProposal && !appliedTransient && (
          <p className="text-[12px] text-[var(--faint)] text-center pt-8">
            Edit {agentName}…
            <br />
            <span className="opacity-60">(↵ to send)</span>
          </p>
        )}

        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
          return (
            /* .msg */
            <div
              key={i}
              className={`flex flex-col gap-1 max-w-[92%] ${
                msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'
              }`}
            >
              {/* .who */}
              <span className="text-[10px] text-[var(--faint)] tracking-[.04em] flex items-center gap-[6px]">
                {msg.role === 'user' ? 'You' : '✦ Prometheus'}
              </span>

              {/* .bubble */}
              <div
                className={`px-[11px] py-[8px] rounded-[10px] text-[12px] leading-[1.5] ${
                  msg.role === 'user'
                    ? 'bg-[var(--accent)] text-white rounded-br-[3px]'
                    : 'bg-[var(--elev)] border border-[var(--border)] text-[var(--text)] rounded-bl-[3px]'
                }`}
              >
                {msg.text}

                {/* Dry-run notice link (§5.2) */}
                {msg.role === 'assistant' && msg.dryRunLogId !== undefined && (
                  <div className="mt-[6px] text-[11px] text-[var(--muted)]">
                    {msg.dryRunLogId ? (
                      <Link
                        href={`/settings?log=${msg.dryRunLogId}`}
                        className="text-[var(--accent)] hover:underline"
                      >
                        View log entry →
                      </Link>
                    ) : (
                      <span className="text-[var(--faint)]">(log entry could not be written)</span>
                    )}
                    {' · '}
                    <Link href="/settings" className="text-[var(--accent)] hover:underline">
                      Open Settings
                    </Link>
                  </div>
                )}

                {/* Target chips: ◆ section · <key>, ◆ config · <key>, ◆ description */}
                {msg.role === 'assistant' &&
                  (msg.changedSectionKeys?.length ||
                    msg.changedConfigKeys?.length ||
                    msg.hasDescriptionChange) && (
                    <div className="flex flex-wrap gap-[4px] mt-[6px]">
                      {msg.changedSectionKeys?.map((k) => (
                        <span
                          key={`s:${k}`}
                          className="inline-flex items-center gap-[5px] text-[10.5px] text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[6px] px-[7px] py-[2px]"
                        >
                          ◆ section · {k}
                        </span>
                      ))}
                      {msg.changedConfigKeys?.map((k) => (
                        <span
                          key={`c:${k}`}
                          className="inline-flex items-center gap-[5px] text-[10.5px] text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[6px] px-[7px] py-[2px]"
                        >
                          ◆ config · {k}
                        </span>
                      ))}
                      {msg.hasDescriptionChange && (
                        <span className="inline-flex items-center gap-[5px] text-[10.5px] text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[6px] px-[7px] py-[2px]">
                          ◆ description
                        </span>
                      )}
                    </div>
                  )}

                {/* Reopenable read-only detail — for any turn that had a proposal, once
                    it's no longer the live actionable one (2026-08-07, at the user's
                    request). Skipped while this exact message is still the pending
                    proposal shown by renderProposalCard() below, to avoid two toggles
                    for the same thing. No Apply/Discard here, and no "show current"
                    comparison — the agent may have changed since this turn, so today's
                    live value isn't a trustworthy "before" for a past proposal. */}
                {msg.role === 'assistant' &&
                  msg.modifications &&
                  !(isLastAssistant && pendingProposal) && (
                    <details className="mt-[6px] border border-[var(--border)] rounded-[9px] overflow-hidden bg-[var(--bg)]">
                      <summary className="flex items-center gap-[7px] px-[10px] py-[5px] bg-[var(--panel)] border-b border-[var(--border)] list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none">
                        <span className="text-[10.5px] text-[var(--accent-ink)] hover:underline">
                          View proposed changes
                        </span>
                        <span className="text-[10px] text-[var(--faint)] ml-auto">▾</span>
                      </summary>
                      {msg.modifications.description !== undefined &&
                        renderContentRow(
                          `msg${i}:description`,
                          'Description',
                          msg.modifications.description,
                          false,
                          null,
                        )}
                      {Object.entries(msg.modifications.sections ?? {}).map(([key, content]) => {
                        const isRemoval = content === null;
                        return renderContentRow(
                          `msg${i}:section:${key}`,
                          `Section · ${key}`,
                          isRemoval ? '' : content,
                          isRemoval,
                          null,
                          'Remove this section',
                        );
                      })}
                      {Object.entries(msg.modifications.config ?? {}).map(([key, rawValue]) => {
                        const { isNull, text } = formatConfigValue(rawValue);
                        return renderContentRow(`msg${i}:config:${key}`, `Config · ${key}`, text, isNull, null);
                      })}
                    </details>
                  )}

                {/* Proposal card — inside the last assistant bubble (§6.2) */}
                {isLastAssistant && renderProposalCard()}
              </div>
            </div>
          );
        })}

        {/* Cap-reached prompt (§3.9) — two actions instead of an error */}
        {capPrompt && (
          <div className="self-start max-w-[92%]">
            <span className="text-[10px] text-[var(--faint)] tracking-[.04em] mb-1 block">
              ✦ Prometheus
            </span>
            <div className="bg-[var(--elev)] border border-[var(--warn)] rounded-[10px] rounded-bl-[3px] px-[11px] py-[8px] text-[12px] leading-[1.5] space-y-2">
              <p className="text-[var(--text)] font-medium">Hourly call limit reached</p>
              <p className="text-[var(--muted)]">
                You&apos;ve reached the hourly AI call limit. A slot frees up in approximately{' '}
                <strong>{humanizeSecs(capPrompt.retryAfterSeconds)}</strong>.
              </p>
              {capPrompt.canDryRun && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleCapPreview}
                    className="px-3 py-1 text-[11px] font-medium bg-[var(--accent)] text-white rounded-[6px] hover:opacity-90 cursor-pointer"
                  >
                    Preview without sending
                  </button>
                  <button
                    onClick={handleCapDismiss}
                    className="px-3 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    Wait
                  </button>
                </div>
              )}
              {!capPrompt.canDryRun && (
                <button
                  onClick={handleCapDismiss}
                  className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}

        {isInFlight && (
          <div className="self-start max-w-[92%]">
            <div className="animate-pulse px-[11px] py-[8px] rounded-[10px] bg-[var(--elev)] border border-[var(--border)] text-[12px] text-[var(--faint)] rounded-bl-[3px]">
              Thinking…
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Prompt bar — .prompt */}
      <div className="flex-none border-t border-[var(--border)] p-[10px] bg-[var(--elev)]">
        {/* Citation chips — what's cited for the next message (2026-07-31) */}
        {citedItems.length > 0 && (
          <div className="flex flex-wrap gap-[4px] mb-[6px]">
            {citedItems.map((item) => (
              <button
                key={`${item.type}-${item.key}`}
                type="button"
                onClick={() => onRemoveCite(item)}
                title={`Remove ${item.label} from this message's citation`}
                className="inline-flex items-center gap-[5px] text-[10.5px] text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[6px] px-[7px] py-[2px] cursor-pointer hover:opacity-80"
              >
                ◆ {item.type} · {item.label}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
        {interactionLock === 'edit' && (
          <p className="text-[11px] text-[var(--warn)] mb-[6px]">
            Chat disabled — a section has unsaved edits.
          </p>
        )}
        <div className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-[9px] px-[10px] py-[8px] focus-within:border-[var(--accent)] focus-within:[box-shadow:0_0_0_3px_var(--accent-wash)]">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isInFlight || interactionLock === 'edit'}
            placeholder={`Edit ${agentName}…  e.g. "make Mode B stricter about scope"`}
            className="flex-1 border-0 bg-transparent text-[var(--text)] font-[inherit] text-[12px] outline-none placeholder:text-[var(--faint)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          {canCancel ? (
            <button
              onClick={handleCancel}
              className="w-[26px] h-[26px] rounded-[7px] border-0 bg-[var(--err)] text-white cursor-pointer grid place-items-center flex-none text-[12px]"
              title="Cancel"
            >
              ✕
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="w-[26px] h-[26px] rounded-[7px] border-0 bg-[var(--accent)] text-white cursor-pointer grid place-items-center flex-none disabled:cursor-not-allowed disabled:opacity-50"
              title="Send"
            >
              →
            </button>
          )}
        </div>
        <div className="mt-[6px] text-[var(--faint)] text-[10px] pl-[2px]">
          Targets the selected agent · proposes changes · Apply or Discard to apply
        </div>
      </div>
    </div>
  );
}
