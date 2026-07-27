/**
 * lib/serialize/index.ts
 *
 * The only import surface for serialize consumers.
 * Provides: parse, exportAgent, and the StructuredAgent type family.
 */

export { parse } from './importParse.js';
export { exportAgent } from './export.js';
export type { StructuredAgent, FrontmatterEntry, BodyBlock } from './types.js';
