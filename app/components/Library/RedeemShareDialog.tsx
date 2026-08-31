'use client';

/**
 * app/components/Library/RedeemShareDialog.tsx
 *
 * Plan 15 — Share Agent, §4.9 surface D. Modelled on ImportDialog.tsx's shape (a
 * shadcn Dialog, one field, inline error/status messages) but much smaller — one text
 * input for the share code, one submit action.
 *
 * POST /api/agents/redeem never accepts an agentId, only the code — the server
 * resolves it (§4.5, confused-deputy note in the route's own doc comment).
 * Constraint 6 (non-disclosure): the route collapses unknown/expired/disabled codes
 * into one 404 { error: 'invalid_code' } — this dialog shows one generic message for
 * all of them, never distinguishing.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiFetch';

interface RedeemShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RedeemResponseBody {
  agentId?: string;
  agentName?: string;
  access?: 'owner' | 'shared';
  alreadyHadAccess?: boolean;
  error?: string;
}

export function RedeemShareDialog({ open, onOpenChange }: RedeemShareDialogProps) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleClose() {
    if (submitting) return;
    onOpenChange(false);
  }

  async function handleSubmit() {
    const trimmed = code.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const response = await apiFetch('/api/agents/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const body = (await response.json()) as RedeemResponseBody;

      if (!response.ok || !body.agentId) {
        setError('Invalid or expired code. Double-check it and try again.');
        return;
      }

      onOpenChange(false);
      setCode('');
      router.push(`/agents/${body.agentId}`);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--panel)] border-[var(--border)] text-[var(--text)] max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[var(--text)] font-semibold text-[15px]">
            Redeem a share code
          </DialogTitle>
          <DialogDescription className="text-[var(--faint)] text-[12px]">
            Paste the code someone gave you. Once redeemed, their agent appears in your library under
            &ldquo;Shared with me&rdquo; — a live reference, not a copy, until you choose to copy it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <input
            autoFocus
            value={code}
            disabled={submitting}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
            placeholder="shr_…"
            className="w-full font-mono text-[12px] border border-[var(--border)] rounded-[7px] px-3 py-2 bg-[var(--bg)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />

          {error && (
            <p className="text-[12px] text-[var(--err)] bg-[var(--elev)] border border-[var(--err)] rounded-[6px] px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={handleClose}
              disabled={submitting}
              className="px-4 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSubmit()}
              disabled={!code.trim() || submitting}
              className="px-4 py-1.5 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[7px] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Redeeming…' : 'Redeem'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
