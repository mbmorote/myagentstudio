/**
 * lib/blueprint/index.ts
 *
 * The only import surface for blueprint consumers.
 * Re-exports catalog data, rule functions, and the prompt renderer.
 */

export { PLATFORM_DEFS, CONFIG_DEFS, SECTION_DEFS } from './catalog.js';
export type { ConfigDefEntry, SectionDefEntry, PlatformDefEntry } from './catalog.js';

export {
  validateName,
  renderHeading,
  computeValidation,
  configDatatypeFor,
  sectionDefFor,
} from './rules.js';
export type { ValidationResult, AgentForValidation } from './rules.js';

export { renderBlueprintForPrompt } from './prompt.js';
