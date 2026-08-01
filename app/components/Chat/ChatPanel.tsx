'use client';

/**
 * app/components/Chat/ChatPanel.tsx
 *
 * Plan 03 Phase B, B.10 — Restyled with message bubbles and section target chips.
 *
 * Matches the mockup's .msg/.bubble/.who layout:
 *   - User messages: right-aligned, accent background
 *   - Assistant messages: left-aligned, elev background with border
 *
 * Target chips (R13): each section the mediator actually changed gets a
 * `◆ section · <sectionKey>` chip. Only section changes are chipped — never
 * config, regardless of what the mockup's demo dialogue shows. (The real
 * mediator doesn't edit config; this plan does not add that capability.)
 *
 * Sends { agentId, instruction } to POST /api/chat via AbortController (Rules Index #23).
 * Interaction lock (§6 rule 12, Rules Index #22):
 *   - In flight: onChatStart() → lock='chat', edit disabled.
 *   - Done: onChatEnd() → lock released.
 *   - Cancel: abort() → lock released immediately.
 *   - lock='edit': send disabled.
 *
 * Plan 05 Phase 4.1 — fetch → apiFetch (§5.4).
 * Plan 05 Phase 4.7 — cap-reached 429 handling (§3.9): two-action prompt
 *   "Preview without sending" (re-sends with dryRun:true) or "Wait" (dismiss).
 */

import { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { InteractionLock, SectionUpdateResult, CitedItem } from '@/app/components/WorkbenchShell';
import { apiFetch } from '@/lib/apiFetch';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Sections that were actually changed in this turn */
  changedSectionKeys?: string[];
  /** Non-null when this message is a dry-run notice (§5.2) */
  dryRunLogId?: string | null;
}

/** State for a cap-reached prompt, shown in place of a message bubble (§3.9). */
interface CapPrompt {
  /** The instruction that was blocked, so we can re-send it as dry-run */
  instruction: string;
  /** Human-readable time until a slot frees up */
  retryAfterSeconds: number;
  /** Whether the preview fallback is available (should always be true here, but guard it) */
  canDryRun: boolean;
  /** Preserves the citation the blocked attempt used, for the "Preview" retry (2026-07-31) */
  citedSectionKeys?: string[];
}

interface ChatPanelProps {
  agentId: string;
  agentName: string;
  interactionLock: InteractionLock;
  /** Sections/config blocks currently cited (WorkbenchShell) — display-only here. */
  citedItems: CitedItem[];
  onRemoveCite: (item: CitedItem) => void;
  /** Called once the citation has been captured for an outgoing message. */
  onClearCited: () => void;
  onChatStart: () => void;
  onChatEnd: () => void;
  onSectionsUpdated: (updates: Record<string, SectionUpdateResult>) => void;
}

export function ChatPanel({
  agentId,
  agentName,
  interactionLock,
  citedItems,
  onRemoveCite,
  onClearCited,
  onChatStart,
  onChatEnd,
  onSectionsUpdated,
}: ChatPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isInFlight, setIsInFlight] = useState(false);
  const [capPrompt, setCapPrompt] = useState<CapPrompt | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const canSend = !isInFlight && interactionLock !== 'edit' && instruction.trim().length > 0;
  const canCancel = isInFlight;

  /** Core send logic — separated so it can be called both for normal sends and
   *  the dry-run re-send on cap-reached "Preview" (§3.9). */
  async function doSend(text: string, dryRun = false, citedSectionKeys?: string[]) {
    setIsInFlight(true);
    setCapPrompt(null);
    onChatStart();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          instruction: text,
          ...(dryRun ? { dryRun: true } : {}),
          ...(citedSectionKeys && citedSectionKeys.length > 0 ? { citedSectionKeys } : {}),
        }),
        signal: controller.signal,
      });

      if (response.status === 499) return;

      // Parse body once — needed for dry-run check BEFORE !response.ok (§5.2, §7.2)
      const body = (await response.json().catch(() => ({ error: 'unknown' }))) as {
        error?: string;
        dryRun?: boolean;
        logId?: string | null;
        sections?: Record<string, SectionUpdateResult>;
        limit?: number;
        windowSeconds?: number;
        retryAfterSeconds?: number;
        canDryRun?: boolean;
      };

      // Per-user LLM cap reached (§3.9) — offer two choices instead of showing an error
      if (response.status === 429 && body.error === 'llm_cap_reached') {
        setCapPrompt({
          instruction: text,
          retryAfterSeconds: body.retryAfterSeconds ?? 60,
          canDryRun: body.canDryRun ?? true,
          citedSectionKeys,
        });
        return;
      }

      // Dry-run blocked: render as assistant notice bubble with link (§5.2)
      // The finally block still runs → interaction lock is released.
      if (body.dryRun) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: 'Live LLM calls are off — no changes were made.',
            dryRunLogId: body.logId ?? null,
          },
        ]);
        return;
      }

      if (!response.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: `Error: ${body.error ?? response.statusText}` },
        ]);
        return;
      }

      const result = { sections: body.sections ?? {} } as {
        sections: Record<string, SectionUpdateResult>;
      };

      const changedKeys = Object.keys(result.sections);
      const successKeys = changedKeys.filter((k) => !('conflict' in result.sections[k]));
      const conflictKeys = changedKeys.filter((k) => 'conflict' in result.sections[k]);

      let summary = '';
      if (successKeys.length > 0) {
        summary += `Updated: ${successKeys.join(', ')}.`;
      }
      if (conflictKeys.length > 0) {
        summary += ` Conflict on: ${conflictKeys.join(', ')} (showing current server content).`;
      }
      if (changedKeys.length === 0) {
        summary = 'No sections changed.';
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: summary,
          // R13: only section keys go in chips — never config
          changedSectionKeys: successKeys,
        },
      ]);

      onSectionsUpdated(result.sections);
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Network error. Please try again.' },
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

    // Capture the citation for this message, then clear it — a citation applies
    // to the message it was visible for, not to whatever's sent next (2026-07-31).
    const citedSectionKeys = citedItems.filter((c) => c.type === 'section').map((c) => c.key);
    onClearCited();

    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInstruction('');
    await doSend(trimmed, false, citedSectionKeys);
  }

  /** "Preview without sending" — re-sends the blocked instruction as dry-run (§3.9) */
  async function handleCapPreview() {
    if (!capPrompt) return;
    const text = capPrompt.instruction;
    const citedSectionKeys = capPrompt.citedSectionKeys;
    setCapPrompt(null);
    await doSend(text, true, citedSectionKeys);
  }

  /** "Wait" — dismiss the cap prompt */
  function handleCapDismiss() {
    setCapPrompt(null);
  }

  function handleCancel() {
    if (!abortControllerRef.current) return;
    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    setIsInFlight(false);
    onChatEnd();
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', text: '(Cancelled)' },
    ]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function humanizeSecs(secs: number): string {
    if (secs < 60) return `${secs} second${secs !== 1 ? 's' : ''}`;
    const m = Math.floor(secs / 60);
    return `${m} minute${m !== 1 ? 's' : ''}`;
  }

  return (
    /* .chat */
    <div data-chat-panel className="flex flex-col h-full">
      {/* Message scroll area — .chat-scroll */}
      <div className="flex-1 min-h-0 overflow-auto px-[14px] pt-[14px] pb-[6px] flex flex-col gap-3">
        {messages.length === 0 && !capPrompt && (
          <p className="text-[12px] text-[var(--faint)] text-center pt-8">
            Edit {agentName}…
            <br />
            <span className="opacity-60">(↵ to send)</span>
          </p>
        )}

        {messages.map((msg, i) => (
          /* .msg */
          <div
            key={i}
            className={`flex flex-col gap-1 max-w-[92%] ${
              msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'
            }`}
          >
            {/* .who */}
            <span className="text-[10px] text-[var(--faint)] tracking-[.04em] flex items-center gap-[6px]">
              {msg.role === 'user' ? 'You' : '✦ Mediator'}
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

              {/* R13: target chips — sections only, never config */}
              {msg.role === 'assistant' && msg.changedSectionKeys && msg.changedSectionKeys.length > 0 && (
                <div className="flex flex-wrap gap-[4px] mt-[6px]">
                  {msg.changedSectionKeys.map((key) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-[5px] text-[10.5px] text-[var(--accent-ink)] bg-[var(--accent-wash)] border border-[var(--accent)] rounded-[6px] px-[7px] py-[2px]"
                    >
                      ◆ section · {key}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Cap-reached prompt (§3.9) — two actions instead of an error */}
        {capPrompt && (
          <div className="self-start max-w-[92%]">
            <span className="text-[10px] text-[var(--faint)] tracking-[.04em] mb-1 block">✦ Mediator</span>
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
        {/* Citation chips — what's cited for the next message, not its content (2026-07-31) */}
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
        <div
          className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-[9px] px-[10px] py-[8px] focus-within:border-[var(--accent)] focus-within:[box-shadow:0_0_0_3px_var(--accent-wash)]"
        >
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
          Targets the selected agent · changes land in the panels above
        </div>
      </div>
    </div>
  );
}
