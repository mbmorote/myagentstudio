'use client';

/**
 * app/components/Library/ImportDialog.tsx
 *
 * Plan 03 Phase D, D.3/D.4 — Import .md dialog.
 *
 * Built on the shadcn Dialog from D.1 (added via `npx shadcn add dialog`).
 *
 * Contains (D.3):
 *   - A <textarea> for pasted .md content
 *   - A file <input type="file" accept=".md"> that reads via FileReader and fills the textarea
 *   - Mode radio: Structural (default, R7) | Strict
 *   - Submit button: disabled on empty input
 *
 * Response handling (D.4):
 *   - Success → close dialog, navigate to /agents/{dto.id}
 *   - warnings present (Structural mode, Rules Index #31) → show inline warnings
 *   - {skipped: 'unchanged'} (Rules Index #36) → "already up to date" notice, no navigation
 *   - Error codes (400/422/502) → inline message keyed off error code vocabulary from lib/import
 *   - Dialog stays open on error (user's pasted text preserved)
 *
 * Plan 05 Phase 4.1 — fetch → apiFetch (§5.4).
 * Plan 05 Phase 4.7 — cap-reached 429 handling (§3.9): two-action prompt
 *   "Preview without sending" (re-sends with dryRun:true) or "Wait" (dismiss).
 *
 * Gate D: build and wire only — do NOT submit the form during build/verification.
 * The user explicitly decides when to run a real import.
 */

import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiFetch';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ImportMode = 'structural' | 'strict';

type ImportResponseBody = {
  id?: string;
  name?: string;
  skipped?: 'unchanged';
  warnings?: string[];
  error?: string;
  // Dry-run (§7.2, §5.1): present when "Live LLM calls" is off
  dryRun?: boolean;
  kind?: string;
  model?: string;
  logId?: string | null;
  message?: string;
  // Cap-reached (§3.9)
  limit?: number;
  windowSeconds?: number;
  retryAfterSeconds?: number;
  canDryRun?: boolean;
};

/** State for a cap-reached prompt (§3.9) */
interface CapState {
  retryAfterSeconds: number;
  canDryRun: boolean;
}

/** Human-readable error messages for the import route's error codes. */
function errorMessage(code: string): string {
  switch (code) {
    case 'missing_name': return 'The .md file has no name in its frontmatter.';
    case 'invalid_body': return 'The request body was malformed.';
    case 'parse_failed': return 'Could not parse the .md file. Check its frontmatter format.';
    case 'stage2_failed': return 'The AI import step failed. Try again.';
    case 'ai_error': return 'The AI service returned an error. Try again later.';
    case 'coverage_failed': return 'Structural import: section coverage check failed.';
    default: return `Import failed: ${code}.`;
  }
}

function humanizeSecs(secs: number): string {
  if (secs < 60) return `${secs} second${secs !== 1 ? 's' : ''}`;
  const m = Math.floor(secs / 60);
  return `${m} minute${m !== 1 ? 's' : ''}`;
}

export function ImportDialog({ open, onOpenChange }: ImportDialogProps) {
  const [mdText, setMdText] = useState('');
  const [mode, setMode] = useState<ImportMode>('structural');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [dryRunBlock, setDryRunBlock] = useState<{ logId: string | null } | null>(null);
  const [capState, setCapState] = useState<CapState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setMdText(text);
        setError(null);
        setWarnings(null);
        setUpToDate(false);
        setCapState(null);
      }
    };
    reader.readAsText(file, 'utf-8');
    // Reset file input so the same file can be re-selected if needed
    e.target.value = '';
  }, []);

  async function doSubmit(dryRun = false) {
    if (!mdText.trim() || submitting) return;

    setSubmitting(true);
    setError(null);
    setWarnings(null);
    setUpToDate(false);
    setDryRunBlock(null);
    setCapState(null);

    try {
      const response = await apiFetch('/api/agents/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ md: mdText, mode, ...(dryRun ? { dryRun: true } : {}) }),
      });

      const body = (await response.json()) as ImportResponseBody;

      // Per-user LLM cap reached (§3.9) — offer two actions
      if (response.status === 429 && body.error === 'llm_cap_reached') {
        setCapState({
          retryAfterSeconds: body.retryAfterSeconds ?? 60,
          canDryRun: body.canDryRun ?? true,
        });
        return;
      }

      // skipped: 'unchanged' (Rules Index #36) → no navigation, just notice
      if (body.skipped === 'unchanged') {
        setUpToDate(true);
        return;
      }

      // Dry-run blocked (§5.1, §7.2) — MUST be checked before !response.ok
      // (409 would otherwise fall into the generic error branch)
      if (body.dryRun) {
        setDryRunBlock({ logId: body.logId ?? null });
        return; // Dialog stays open; pasted text preserved
      }

      if (!response.ok) {
        setError(errorMessage(body.error ?? 'unknown'));
        return; // Keep dialog open so user's text is not lost
      }

      // Warnings from Structural mode (Rules Index #31) — show inline
      if (body.warnings && body.warnings.length > 0) {
        setWarnings(body.warnings);
      }

      // Success — navigate to the agent
      if (body.id) {
        onOpenChange(false);
        setMdText('');
        router.push(`/agents/${body.id}`);
        router.refresh();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    await doSubmit(false);
  }

  /** "Preview without sending" — re-run as dry-run (§3.9) */
  async function handleCapPreview() {
    setCapState(null);
    await doSubmit(true);
  }

  function handleCapDismiss() {
    setCapState(null);
  }

  function handleClose() {
    if (submitting) return; // Don't allow close while submitting
    onOpenChange(false);
  }

  const canSubmit = mdText.trim().length > 0 && !submitting;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)] text-[var(--text)] max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[var(--text)] font-semibold text-[15px]">
            Import .md agent file
          </DialogTitle>
          <DialogDescription className="text-[var(--faint)] text-[12px]">
            Paste the content of an agent .md file or pick a file. The import pipeline
            will read its frontmatter and sections.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* File picker */}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
              Pick a file
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md"
              onChange={handleFileChange}
              className="block w-full text-[12px] text-[var(--muted)] file:mr-3 file:py-1 file:px-3 file:rounded-[6px] file:border file:border-[var(--border)] file:bg-[var(--bg)] file:text-[var(--text)] file:text-[11px] file:font-medium cursor-pointer"
            />
          </div>

          {/* Textarea */}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-1">
              Or paste content
            </label>
            <textarea
              value={mdText}
              onChange={(e) => {
                setMdText(e.target.value);
                setError(null);
                setWarnings(null);
                setUpToDate(false);
                setDryRunBlock(null);
                setCapState(null);
              }}
              rows={12}
              placeholder="---&#10;name: my-agent&#10;description: ...&#10;---&#10;&#10;# ROLE&#10;..."
              className="w-full border border-[var(--border)] rounded-[7px] px-3 py-2 font-mono text-[12px] bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
            />
          </div>

          {/* Mode picker (R7: Structural default) */}
          <div>
            <label className="block text-[11px] font-semibold text-[var(--muted)] uppercase tracking-[.05em] mb-2">
              Import mode
            </label>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed bg-[var(--bg)] border border-[var(--border)] rounded-[7px] px-3 py-2 mb-3">
              <strong className="text-[var(--text)]">Name, description, and every config value</strong> (model,
              tools, permissions, maxTurns, etc.) always come straight from your file&apos;s frontmatter — in{' '}
              <strong className="text-[var(--text)]">both</strong> modes, never rewritten or reviewed by AI. Only
              how the <strong className="text-[var(--text)]">body</strong> content is handled differs below:
            </p>
            <div className="space-y-2">
              {(['structural', 'strict'] as ImportMode[]).map((m) => (
                <label
                  key={m}
                  className={[
                    'flex flex-col gap-1 cursor-pointer text-[12px] text-[var(--text)] border rounded-[7px] px-3 py-2',
                    mode === m ? 'border-[var(--accent)] bg-[var(--accent-wash)]' : 'border-[var(--border)]',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="import-mode"
                      value={m}
                      checked={mode === m}
                      onChange={() => setMode(m)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="font-semibold">{m === 'structural' ? 'Daedalus' : 'Hermes'}</span>
                    <span className="text-[var(--faint)]">
                      {m === 'structural' ? '— Structural (recommended)' : '— Strict (verbatim)'}
                    </span>
                  </span>
                  <span className="text-[11px] text-[var(--faint)] ml-[22px] leading-relaxed">
                    {m === 'structural'
                      ? "AI reorganizes the body into the platform's recognized sections — best for files from other tools that don't already follow this structure."
                      : 'Keeps your body content byte-for-byte; AI only labels which existing headings map to which section — best for files that already follow this structure.'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Status messages */}
          {/* Cap-reached prompt (§3.9) */}
          {capState && (
            <div className="bg-[var(--elev)] border border-[var(--warn)] rounded-[6px] px-3 py-3 space-y-2">
              <p className="text-[12px] font-medium text-[var(--text)]">Hourly call limit reached</p>
              <p className="text-[12px] text-[var(--muted)]">
                You&apos;ve reached the hourly AI call limit. A slot frees up in approximately{' '}
                <strong>{humanizeSecs(capState.retryAfterSeconds)}</strong>.
              </p>
              {capState.canDryRun && (
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleCapPreview}
                    disabled={submitting}
                    className="px-3 py-1 text-[11px] font-medium bg-[var(--accent)] text-white rounded-[6px] hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
              {!capState.canDryRun && (
                <button
                  onClick={handleCapDismiss}
                  className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
          {dryRunBlock && (
            <div className="text-[12px] text-[var(--muted)] bg-[var(--elev)] border border-[var(--border)] rounded-[6px] px-3 py-2 space-y-1">
              <p className="font-medium text-[var(--text)]">Live LLM calls are off</p>
              <p>
                The import was recorded but not sent — no changes were made.{' '}
                {dryRunBlock.logId ? (
                  <a
                    href={`/settings?log=${dryRunBlock.logId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    View log entry →
                  </a>
                ) : (
                  <span className="text-[var(--faint)]">(log entry could not be written)</span>
                )}
              </p>
              <p className="text-[11px] text-[var(--faint)]">
                Turn on &ldquo;Live LLM calls&rdquo; in{' '}
                <a href="/settings" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                  System Settings
                </a>{' '}
                to run the import.
              </p>
            </div>
          )}
          {upToDate && (
            <p className="text-[12px] text-[var(--ok)] bg-[var(--elev)] border border-[var(--ok)] rounded-[6px] px-3 py-2">
              ✓ Already up to date — no changes were made.
            </p>
          )}
          {error && (
            <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
              {error}
            </p>
          )}
          {warnings && warnings.length > 0 && (
            <div className="text-[12px] text-[var(--warn)] bg-[var(--elev)] border border-[var(--warn)] rounded-[6px] px-3 py-2">
              <p className="font-semibold mb-1">Import warnings:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={handleClose}
              disabled={submitting}
              className="px-4 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-1.5 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[7px] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
