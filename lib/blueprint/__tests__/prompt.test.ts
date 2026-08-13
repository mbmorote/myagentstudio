/**
 * lib/blueprint/__tests__/prompt.test.ts
 *
 * Unit tests for renderBlueprintForPrompt — a pure string-building function.
 * No I/O, no mocks.
 */

import { describe, expect, it } from 'vitest';
import { renderBlueprintForPrompt } from '../prompt.js';
import type { SectionDefLite } from '../../db/repository/agents.js';

const FAKE_SECTION_DEFS: SectionDefLite[] = [
  {
    key: 'role',
    defaultHeading: '# ROLE',
    isCore: true,
    defaultOrder: 1,
    template: 'You are a…',
    helpText: 'Identity + mandate.',
  },
  {
    key: 'boundaries',
    defaultHeading: '# BOUNDARIES',
    isCore: false,
    defaultOrder: 99,
    template: '- Do not…',
    helpText: 'Assumptions the agent must not make.',
  },
];

describe('renderBlueprintForPrompt', () => {
  it('includes the Configuration fields section by default', () => {
    const text = renderBlueprintForPrompt(FAKE_SECTION_DEFS);
    expect(text).toContain('### Configuration fields (YAML frontmatter)');
    expect(text).toContain('**model**');
  });

  it('omits the Configuration fields section when includeConfig is false', () => {
    const text = renderBlueprintForPrompt(FAKE_SECTION_DEFS, { includeConfig: false });
    expect(text).not.toContain('### Configuration fields (YAML frontmatter)');
    expect(text).not.toContain('**model**');
  });

  it('lists every passed-in section def with its heading and core tag', () => {
    const text = renderBlueprintForPrompt(FAKE_SECTION_DEFS);
    expect(text).toContain('**role** [core] — heading: `# ROLE`');
    expect(text).toContain('**boundaries** — heading: `# BOUNDARIES`');
    // Non-core sections must not carry the [core] tag.
    expect(text).not.toContain('**boundaries** [core]');
  });

  it('includes each section def helpText', () => {
    const text = renderBlueprintForPrompt(FAKE_SECTION_DEFS);
    expect(text).toContain('Assumptions the agent must not make.');
  });

  it('renders an empty Body sections block when given no section defs', () => {
    const text = renderBlueprintForPrompt([]);
    expect(text).toContain('### Body sections');
    expect(text).not.toContain('heading:');
  });

  it('includes the fixed section-labeling notes', () => {
    const text = renderBlueprintForPrompt(FAKE_SECTION_DEFS);
    expect(text).toContain('sectionKey: "custom"');
  });
});
