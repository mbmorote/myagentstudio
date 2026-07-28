'use client';

/**
 * app/components/Chat/ChatPanel.tsx
 *
 * Phase 4.4 — Agent-aware chat panel.
 *
 * Sends { agentId, instruction } to POST /api/chat via a client-side AbortController
 * (Rules Index #23). The server loads all section content from the DB — no section
 * selection, no content from the client (§7 Draft D, Rules Index #7).
 *
 * Interaction lock (§6 rule 12, §7, Rules Index #22):
 *   - While a request is in flight: calls onChatStart() → WorkbenchShell sets lock
 *     to 'chat', disabling every section's raw-edit toggle and the send button.
 *   - On response (success, conflict, or error): calls onChatEnd() → lock released.
 *   - "Cancel" button calls controller.abort() → lock released immediately, no DB writes
 *     (safe by construction — apply-then-history means nothing is written until the
 *     mediator fully resolves, Rules Index #23).
 *   - While interactionLock === 'edit', the send button is disabled.
 *
 * Ephemeral in-memory history: messages are stored in component state only (no
 * persistence — TechDesign "Deferred"). Each turn shows the instruction sent and
 * the sections that changed (or conflict notices).
 *
 * On response, calls onSectionsUpdated() with the server's result map so the
 * CustomViz pane re-renders only the changed blocks.
 */

import { useState, useRef, useCallback } from 'react';
import type { InteractionLock, SectionUpdateResult } from '@/app/components/WorkbenchShell';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Sections updated in this turn (for display purposes) */
  sections?: Record<string, SectionUpdateResult>;
}

interface ChatPanelProps {
  agentId: string;
  agentName: string;
  interactionLock: InteractionLock;
  onChatStart: () => void;
  onChatEnd: () => void;
  onSectionsUpdated: (updates: Record<string, SectionUpdateResult>) => void;
}

export function ChatPanel({
  agentId,
  agentName,
  interactionLock,
  onChatStart,
  onChatEnd,
  onSectionsUpdated,
}: ChatPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isInFlight, setIsInFlight] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const canSend = !isInFlight && interactionLock !== 'edit' && instruction.trim().length > 0;
  const canCancel = isInFlight;

  async function handleSend() {
    if (!canSend) return;
    const trimmed = instruction.trim();
    if (!trimmed) return;

    // Add user message to history
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInstruction('');
    setIsInFlight(true);
    onChatStart(); // Engage interaction lock

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, instruction: trimmed }),
        signal: controller.signal,
      });

      if (response.status === 499) {
        // Cancelled by user — already handled in handleCancel; just clean up
        return;
      }

      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: 'unknown' }))) as {
          error: string;
        };
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: `Error: ${err.error ?? response.statusText}`,
          },
        ]);
        return;
      }

      const result = (await response.json()) as {
        sections: Record<string, SectionUpdateResult>;
      };

      // Build a summary for the assistant message
      const changedKeys = Object.keys(result.sections);
      const successKeys = changedKeys.filter(
        (k) => !('conflict' in result.sections[k]),
      );
      const conflictKeys = changedKeys.filter(
        (k) => 'conflict' in result.sections[k],
      );

      let summary = '';
      if (successKeys.length > 0) {
        summary += `Updated: ${successKeys.join(', ')}.`;
      }
      if (conflictKeys.length > 0) {
        summary += ` Conflict on: ${conflictKeys.join(', ')} (another edit landed mid-turn — showing current server content).`;
      }
      if (changedKeys.length === 0) {
        summary = 'No sections changed.';
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: summary, sections: result.sections },
      ]);

      // Propagate section updates to the CustomViz pane
      onSectionsUpdated(result.sections);
      setTimeout(scrollToBottom, 50);
    } catch (err) {
      // Abort error from handleCancel — suppress (cancel already handled the UI)
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Network error. Please try again.' },
      ]);
    } finally {
      abortControllerRef.current = null;
      setIsInFlight(false);
      onChatEnd(); // Release interaction lock
    }
  }

  function handleCancel() {
    if (!abortControllerRef.current) return;
    abortControllerRef.current.abort();
    // Don't wait for the fetch to settle — release the lock immediately
    // (safe by construction: apply-then-history means nothing is written
    // until the mediator fully resolves, so cancelling at any point is safe,
    // Rules Index #23).
    abortControllerRef.current = null;
    setIsInFlight(false);
    onChatEnd();
    setMessages((prev) => [
      ...prev,
      { role: 'assistant', text: '(Cancelled)' },
    ]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Chat
        </p>
        <p className="text-sm font-medium">{agentName}</p>
      </div>

      {/* ── Message history ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center pt-8">
            Type an instruction to edit this agent.
            <br />
            <span className="text-muted-foreground/60">(⌘↩ or Ctrl↩ to send)</span>
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`rounded-md px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'ml-8 bg-primary text-primary-foreground'
                : 'mr-8 bg-muted text-foreground'
            }`}
          >
            {msg.text}
          </div>
        ))}
        {isInFlight && (
          <div className="mr-8 animate-pulse rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            Thinking…
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div className="border-t border-border p-3 space-y-2">
        {interactionLock === 'edit' && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Chat disabled — a section has unsaved edits.
          </p>
        )}
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isInFlight || interactionLock === 'edit'}
          rows={3}
          placeholder="Give an instruction to edit this agent…"
          className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground/60">⌘↩ to send</span>
          <div className="flex gap-2">
            {canCancel && (
              <button
                onClick={handleCancel}
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!canSend}
              className="rounded bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
