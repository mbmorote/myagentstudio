/**
 * lib/ai/__tests__/prometheus.test.ts
 *
 * Unit tests for parsePrometheusResponse() — plans/07-prometheus-propose-apply.md §6.2.
 *
 * The generated prompt module is mocked so this suite never depends on
 * `npm run dev` / `npm run build` having run first (§13.1 note on module loading).
 * callPrometheus itself is NOT tested here — route-level tests cover it via the
 * full mock of lib/ai/prometheus.js.
 */

import { describe, expect, it, vi } from 'vitest';

// ── Mock the generated prompt so the suite runs without a prior build ─────────
vi.mock('../prompts/generated/prometheus.js', () => ({
  PROMETHEUS_PROMPT: '<test prompt>',
}));

// ── Import the parser and error class under test ──────────────────────────────
import {
  parsePrometheusResponse,
  PrometheusInvalidResponseError,
} from '../prometheus.js';

// ─────────────────────────────  Extraction tests  ─────────────────────────────

describe('parsePrometheusResponse — JSON extraction (§4.2)', () => {
  it('parses a bare JSON object (normal model output)', () => {
    const raw = JSON.stringify({
      message: 'Done.',
      modifications: { sections: { role: 'New role content.' } },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('Done.');
    expect(result.modifications.sections?.role).toBe('New role content.');
  });

  it('parses a JSON object wrapped in ```json code fences', () => {
    const raw =
      '```json\n' +
      JSON.stringify({ message: 'Fenced.', modifications: {} }) +
      '\n```';
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('Fenced.');
    expect(result.modifications).toEqual({});
  });

  it('parses a JSON object preceded by stray prose (greedy slice)', () => {
    const inner = JSON.stringify({ message: 'Prose before.', modifications: {} });
    const raw = `Here is my answer: ${inner} That is all.`;
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('Prose before.');
  });

  it('throws PrometheusInvalidResponseError when all three extraction attempts fail', () => {
    expect(() => parsePrometheusResponse('this is not JSON at all', 1)).toThrow(
      PrometheusInvalidResponseError,
    );
  });

  it('throws PrometheusInvalidResponseError when the extracted text is not valid JSON', () => {
    expect(() => parsePrometheusResponse('{ bad json {{{ }}', 1)).toThrow(
      PrometheusInvalidResponseError,
    );
  });

  it('throws when the root is a JSON array instead of an object', () => {
    expect(() => parsePrometheusResponse('[1, 2, 3]', 1)).toThrow(
      PrometheusInvalidResponseError,
    );
  });

  it('throws when the root is a JSON string', () => {
    expect(() => parsePrometheusResponse('"just a string"', 1)).toThrow(
      PrometheusInvalidResponseError,
    );
  });

  it('throws when the root is JSON null', () => {
    expect(() => parsePrometheusResponse('null', 1)).toThrow(
      PrometheusInvalidResponseError,
    );
  });
});

// ─────────────────────────────  Tolerance table (§4.3)  ──────────────────────

describe('parsePrometheusResponse — tolerance table (§4.3)', () => {
  it('message missing → empty string + one warning; modifications still parsed', () => {
    const raw = JSON.stringify({
      modifications: { sections: { role: 'New.' } },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/no message/i);
    expect(result.modifications.sections?.role).toBe('New.');
  });

  it('message is null → empty string + warning', () => {
    const raw = JSON.stringify({ message: null, modifications: {} });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('');
    expect(result.warnings.some((w) => /no message/i.test(w))).toBe(true);
  });

  it('message is a number → empty string + warning', () => {
    const raw = JSON.stringify({ message: 42, modifications: {} });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('');
    expect(result.warnings.some((w) => /no message/i.test(w))).toBe(true);
  });

  it('modifications missing → {} + one warning; message still parsed', () => {
    const raw = JSON.stringify({ message: 'Just a question answer.' });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.message).toBe('Just a question answer.');
    expect(result.modifications).toEqual({});
    expect(result.warnings.some((w) => /no modifications/i.test(w))).toBe(true);
  });

  it('modifications is an array → treated as missing + warning', () => {
    const raw = JSON.stringify({ message: 'Hi', modifications: [1, 2] });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications).toEqual({});
    expect(result.warnings.some((w) => /no modifications/i.test(w))).toBe(true);
  });

  it('modifications.description non-string → dropped + warning', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { description: 123 },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications.description).toBeUndefined();
    expect(result.warnings.some((w) => /non-string description/i.test(w))).toBe(true);
  });

  it('modifications.sections not a plain object → whole sections key dropped + warning', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { sections: 'not an object' },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications.sections).toBeUndefined();
    expect(result.warnings.some((w) => /invalid sections/i.test(w))).toBe(true);
  });

  it('a single sections[key] value that is not a string → that key dropped + warning; sibling keys survive', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: {
        sections: {
          role: 'Good string content.',
          output: 9999,
        },
      },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications.sections?.role).toBe('Good string content.');
    expect(result.modifications.sections?.output).toBeUndefined();
    expect(result.warnings.some((w) => /non-string value for sections\["output"\]/i.test(w))).toBe(
      true,
    );
  });

  it('modifications.config not a plain object → whole config key dropped + warning', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { config: 'bad' },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications.config).toBeUndefined();
    expect(result.warnings.some((w) => /invalid config/i.test(w))).toBe(true);
  });

  it('modifications.name present → dropped + warning; other keys survive', () => {
    const raw = JSON.stringify({
      message: 'renamed!',
      modifications: {
        name: 'evil-new-name',
        sections: { role: 'Content.' },
      },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect((result.modifications as Record<string, unknown>).name).toBeUndefined();
    expect(result.warnings.some((w) => /name change/i.test(w))).toBe(true);
    // Other keys still present
    expect(result.modifications.sections?.role).toBe('Content.');
  });

  it('an empty string sections value is kept (emptying a section is a valid edit)', () => {
    const raw = JSON.stringify({
      message: 'cleared it',
      modifications: { sections: { guardrails: '' } },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications.sections?.guardrails).toBe('');
  });
});

// ─────────────────────────────  Config value types  ──────────────────────────

describe('parsePrometheusResponse — config value types pass through (§4.3)', () => {
  it('string config value passes through', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { config: { model: 'claude-opus-5' } },
    });
    expect(parsePrometheusResponse(raw, 1).modifications.config?.model).toBe('claude-opus-5');
  });

  it('number config value passes through', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { config: { maxTurns: 20 } },
    });
    expect(parsePrometheusResponse(raw, 1).modifications.config?.maxTurns).toBe(20);
  });

  it('boolean config value passes through', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { config: { debug: true } },
    });
    expect(parsePrometheusResponse(raw, 1).modifications.config?.debug).toBe(true);
  });

  it('array config value passes through', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { config: { tools: ['Read', 'Write'] } },
    });
    expect(parsePrometheusResponse(raw, 1).modifications.config?.tools).toEqual([
      'Read',
      'Write',
    ]);
  });

  it('nested object config value passes through', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: {
        config: { hooks: { PreToolUse: 'check.sh' } },
      },
    });
    expect(parsePrometheusResponse(raw, 1).modifications.config?.hooks).toEqual({
      PreToolUse: 'check.sh',
    });
  });

  it('null config value passes through as the delete sentinel (§4.1)', () => {
    const raw = JSON.stringify({
      message: 'removed tools',
      modifications: { config: { tools: null } },
    });
    const result = parsePrometheusResponse(raw, 1);
    // null must be preserved — it is the delete sentinel
    expect('tools' in (result.modifications.config ?? {})).toBe(true);
    expect(result.modifications.config?.tools).toBeNull();
  });
});

// ─────────────────────────────  Split-level demotion  ────────────────────────

describe('parsePrometheusResponse — split-level demotion applied at propose time (§4.4)', () => {
  it('demotes a # heading in sections content when splitLevel=1', () => {
    const raw = JSON.stringify({
      message: 'done',
      modifications: {
        sections: {
          role: '# Split-level heading\nSome content below.',
        },
      },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.modifications.sections?.role).toBe(
      '## Split-level heading\nSome content below.',
    );
  });

  it('demotes a ## heading in sections content when splitLevel=2', () => {
    const raw = JSON.stringify({
      message: 'done',
      modifications: {
        sections: {
          output: '## Top-level in this file\nContent.',
        },
      },
    });
    const result = parsePrometheusResponse(raw, 2);
    expect(result.modifications.sections?.output).toBe(
      '### Top-level in this file\nContent.',
    );
  });

  it('does not demote headings that are already one level deeper', () => {
    const raw = JSON.stringify({
      message: 'done',
      modifications: {
        sections: {
          role: '## Already deeper\nContent.',
        },
      },
    });
    const result = parsePrometheusResponse(raw, 1);
    // ## is one level deeper than the splitLevel=1 # prefix — not demoted
    expect(result.modifications.sections?.role).toBe('## Already deeper\nContent.');
  });
});

// ─────────────────────────────  Scoped mode (§5.4)  ──────────────────────────

describe('parsePrometheusResponse — scoped mode filters (§5.4)', () => {
  it('in section-scoped mode: out-of-scope section is dropped + warning', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: {
        sections: {
          role: 'Updated role.',
          output: 'Sneaky output change.',
        },
      },
    });
    const result = parsePrometheusResponse(raw, 1, ['role'], undefined);
    // 'role' is in scope — kept
    expect(result.modifications.sections?.role).toBe('Updated role.');
    // 'output' is outside the cited set — dropped
    expect(result.modifications.sections?.output).toBeUndefined();
    expect(result.warnings.some((w) => /output.*not included/i.test(w))).toBe(true);
  });

  it('in config-scoped mode: out-of-scope config key is dropped + warning', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: {
        config: {
          model: 'claude-opus-5',
          tools: ['Read'],
        },
      },
    });
    const result = parsePrometheusResponse(raw, 1, undefined, ['model']);
    // 'model' is in scope — kept
    expect(result.modifications.config?.model).toBe('claude-opus-5');
    // 'tools' is outside the cited set — dropped
    expect(result.modifications.config?.tools).toBeUndefined();
    expect(result.warnings.some((w) => /tools.*not included/i.test(w))).toBe(true);
  });

  it('in scoped mode: description is kept even when not cited (§5.4)', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: {
        description: 'Updated description.',
        sections: { output: 'Should be dropped.' },
      },
    });
    // Only 'role' cited — 'output' should be dropped, but description kept
    const result = parsePrometheusResponse(raw, 1, ['role'], undefined);
    expect(result.modifications.description).toBe('Updated description.');
    expect(result.modifications.sections?.output).toBeUndefined();
  });

  it('in section-scoped mode: in-scope section passes through', () => {
    const raw = JSON.stringify({
      message: 'ok',
      modifications: { sections: { role: 'Cited section updated.' } },
    });
    const result = parsePrometheusResponse(raw, 1, ['role'], undefined);
    expect(result.modifications.sections?.role).toBe('Cited section updated.');
    expect(result.warnings.filter((w) => /not included/i.test(w))).toHaveLength(0);
  });

  it('unscoped mode: no section or config key is filtered', () => {
    const raw = JSON.stringify({
      message: 'full agent update',
      modifications: {
        sections: { role: 'A', output: 'B' },
        config: { model: 'opus', tools: ['Read'] },
      },
    });
    const result = parsePrometheusResponse(raw, 1, undefined, undefined);
    expect(result.modifications.sections?.role).toBe('A');
    expect(result.modifications.sections?.output).toBe('B');
    expect(result.modifications.config?.model).toBe('opus');
    expect(result.modifications.config?.tools).toEqual(['Read']);
    expect(result.warnings.filter((w) => /not included/i.test(w))).toHaveLength(0);
  });
});

// ─────────────────────────────  Warnings are arrays  ─────────────────────────

describe('parsePrometheusResponse — warnings', () => {
  it('returns an empty warnings array when no issues are found', () => {
    const raw = JSON.stringify({
      message: 'All good.',
      modifications: {},
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.warnings).toEqual([]);
  });

  it('accumulates multiple warnings in one parse', () => {
    const raw = JSON.stringify({
      // No message (1 warning), plus a name change (1 warning)
      modifications: { name: 'bad', description: 42 },
    });
    const result = parsePrometheusResponse(raw, 1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });
});
