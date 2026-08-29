'use client';

/**
 * app/components/CustomViz/ConfigZone.tsx
 *
 * Plan 15 (D1, §6 step 8.5) — extracted from AgentView.tsx's Zone 1 ("[Config]
 * Keys"), the file's actual bulk (originally ~25 of ~35 state vars and ~730 of
 * ~830 render-helper lines). Behavior-preserving extraction — see
 * plans/15-share-agent.md §8 (D1) for the full analysis that drove this split.
 *
 * `configError` is passed in (not owned here) — it's genuinely shared with
 * ModelEffortControl (a model-save failure surfaces in THIS zone's error
 * paragraph, not near the model popover) via the useAgentConfigSave hook AgentView
 * owns a single instance of. See that hook's doc comment for why.
 *
 * `resolveEditorRef` is the same shared ref SectionsZone threads into every
 * SectionBlock — this zone's initial-prompt/custom-JSON-block editors resolve an
 * open SectionBlock editor before opening (resolveAllEditors), but a SectionBlock
 * opening does NOT resolve an editor here — that asymmetry is pre-existing
 * behavior from the monolith, not something this extraction changes.
 */

import { useState, useMemo } from 'react';
import type { AgentDTO, ConfigDefLite } from '@/lib/db/repository';
import type { InteractionLock, CitedItem } from '@/app/components/WorkbenchShell';
import { useOutsideClick } from '@/app/hooks/useOutsideClick';

// ─────────────────────────  Constants  ──────────────────────────────────────

const SCALAR_KEY_ORDER = ['permissionMode', 'maxTurns', 'memory', 'background', 'isolation', 'color'];
const LIST_KEY_ORDER = ['tools', 'disallowedTools', 'skills'];
const INITIAL_PROMPT_KEY = 'initialPrompt';
// Shared "⌘" badge hint (Agent(...) tools-pill + initialPrompt) — one string so a wording
// change only has to happen here. Keep in sync with the mirrored constant in
// reference/layout/Layout-Workbench.html (MAIN_AGENT_ONLY_HINT).
const MAIN_AGENT_ONLY_HINT = 'Only applies when this agent runs as the main agent';

const COLOR_HEX: Record<string, string> = {
  red: '#e05252',
  blue: '#4c8bf5',
  green: '#43a047',
  yellow: '#d4b106',
  purple: '#9b59b6',
  orange: '#e08b2f',
  pink: '#e0629c',
  cyan: '#29b6c6',
};

// List-item cap (prototyped 2026-07-29) — confirmed real gap: a `dev`-style agent with
// ~40 MCP tools rendered as an unbroken wrap with no cap at all. Applies to every list
// key (tools/disallowedTools/skills), not just tools.
const LIST_ITEM_CAP = 14;

// MCP tool display shortening (prototyped 2026-07-29) — an item's full qualified name
// (mcp__server or mcp__server__tool) is still what's stored/matched/removed; this only
// shortens what's shown on the pill, with the full name moved into its tooltip.
const MCP_DISPLAY_RE = /^mcp__([\w.-]+?)(?:__([\w.-]+))?$/;
function mcpDisplayOf(item: string): { server: string; tool?: string } | null {
  const m = item.match(MCP_DISPLAY_RE);
  if (!m) return null;
  const [, server, tool] = m;
  return { server, tool };
}

// ─────────────────────────  Helpers  ───────────────────────────────────────

/**
 * Normalizes a list-datatype config value into display items.
 * Handles both real JSON arrays and comma-separated strings (some imported agents
 * store lists as plain comma-separated frontmatter strings).
 */
function listItemsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * First-level entry names out of a datatype:'json' config value, for the compact
 * view-mode pill row (mcpServers, hooks) — view only, editing still opens the full
 * raw-JSON block unchanged.
 */
function customBlockEntryNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const k = Object.keys(item as Record<string, unknown>)[0];
        if (k) return k;
      }
      return JSON.stringify(item);
    });
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
}

/**
 * Catalog-derived lookups (tools def, recognized-tool checks, unknown-key set),
 * computed from the `configCatalog` prop instead of a static import (2026-07-29 —
 * closes catalog seed drift).
 *
 * Three-shape tools validation (item 9):
 *   1. One of the known built-in tool names (from the DB-sourced `tools` def)
 *   2. mcp__<server> or mcp__<server>__<tool> (MCP tools, per-project — open namespace)
 *   3. Agent or Agent(types) (restricts subagent spawning — only meaningful as main agent)
 */
function makeCatalogHelpers(configCatalog: ConfigDefLite[]) {
  const toolsDef = configCatalog.find((d) => d.key === 'tools') ?? null;
  const builtinTools = new Set((toolsDef?.allowedValues ?? []) as readonly string[]);
  const catalogKeySet: Set<string> = new Set(configCatalog.map((d) => d.key));
  const jsonKeys: Set<string> = new Set(
    configCatalog.filter((d) => d.datatype === 'json').map((d) => d.key),
  );

  function getCatalogDef(key: string): ConfigDefLite | null {
    return configCatalog.find((d) => d.key === key) ?? null;
  }

  function isRecognizedTool(item: string): boolean {
    return (
      builtinTools.has(item) ||
      item === 'Agent' ||
      /^Agent\([^)]*\)$/.test(item) ||
      /^mcp__[\w.-]+(__[\w.-]+)?$/.test(item)
    );
  }

  function isBadListItem(propKey: string, item: string): boolean {
    if (propKey === 'tools' || propKey === 'disallowedTools') return !isRecognizedTool(item);
    return false; // skills: open vocabulary, no closed list to check against
  }

  return { builtinTools, catalogKeySet, jsonKeys, getCatalogDef, isBadListItem };
}

// ─────────────────────────  Props  ──────────────────────────────────────────

interface ConfigZoneProps {
  agent: AgentDTO;
  configCatalog: ConfigDefLite[];
  canEdit: boolean;
  interactionLock: InteractionLock;
  citedItems: CitedItem[];
  onToggleCite: (item: CitedItem, additive: boolean) => void;
  resolveEditorRef: React.MutableRefObject<(() => void) | null>;
  configError: string | null;
  setConfigError: (error: string | null) => void;
  currentConfigPairs: () => { propKey: string; value: unknown }[];
  saveConfig: (rows: { propKey: string; value: unknown }[]) => Promise<void>;
  saveConfigKey: (key: string, value: unknown) => Promise<void>;
  removeConfigKey: (key: string) => Promise<void>;
}

// ─────────────────────────  Component  ──────────────────────────────────────

export function ConfigZone({
  agent,
  configCatalog,
  canEdit,
  interactionLock,
  citedItems,
  onToggleCite,
  resolveEditorRef,
  configError,
  setConfigError,
  currentConfigPairs,
  saveConfig,
  saveConfigKey,
  removeConfigKey,
}: ConfigZoneProps) {
  const { builtinTools, catalogKeySet, jsonKeys, getCatalogDef, isBadListItem } =
    useMemo(() => makeCatalogHelpers(configCatalog), [configCatalog]);
  const configMap = new Map(agent.config.map((c) => [c.propKey, c.value]));

  const setKeys = new Set(agent.config.map((c) => c.propKey));
  const setScalarKeys = SCALAR_KEY_ORDER.filter((k) => configMap.has(k));
  const setListKeys = LIST_KEY_ORDER.filter((k) => configMap.has(k));
  const hasInitialPrompt = configMap.has(INITIAL_PROMPT_KEY);

  // Custom-block keys (2026-08-06, roadmap TODO item 1): catalog keys with
  // datatype:'json' that are set (hooks, mcpServers) PLUS any key on the agent that
  // isn't in the standard catalog at all.
  const customBlockKeys = agent.config
    .map((c) => c.propKey)
    .filter((k) => jsonKeys.has(k) || !catalogKeySet.has(k));

  const unsetCatalogKeys = configCatalog.filter(
    (d) => !setKeys.has(d.key) && d.key !== 'model' && d.key !== 'effort',
  );

  // ── Scalar editing state ──────────────────────────────────────────────────
  const [editingScalarKey, setEditingScalarKey] = useState<string | null>(null);
  const [intDraft, setIntDraft] = useState('');

  // ── List item state ───────────────────────────────────────────────────────
  const [addingItemKey, setAddingItemKey] = useState<string | null>(null);
  const [addItemDraft, setAddItemDraft] = useState('');
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [toolPickerFilter, setToolPickerFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<{ key: string; item: string } | null>(null);
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>({});
  const [editingRestriction, setEditingRestriction] = useState(false);
  const [restrictionDraft, setRestrictionDraft] = useState('');

  // ── Special block state ───────────────────────────────────────────────────
  // promptExpanded doubles as "is editing" (matches SectionBlock's isEditing) —
  // promptCollapsed is the separate chevron state.
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptCollapsed, setPromptCollapsed] = useState(true);
  // Custom JSON blocks (hooks, mcpServers) — drafts keyed per key, not a single
  // "which one is open" slot (still only one edited at a time in practice — see
  // resolveConfigEditors).
  const [customJsonDrafts, setCustomJsonDrafts] = useState<Record<string, string>>({});
  const [customJsonErrors, setCustomJsonErrors] = useState<Record<string, string | null>>({});
  const [customCollapsed, setCustomCollapsed] = useState<Record<string, boolean>>({});

  // ── Zone / menu state ─────────────────────────────────────────────────────
  const [keysCollapsed, setKeysCollapsed] = useState(false);
  const [addKeyMenuOpen, setAddKeyMenuOpen] = useState(false);

  // ── Outside-click close/confirm logic ─────────────────────────────────────

  function closePromptEditor() {
    const original = (configMap.get(INITIAL_PROMPT_KEY) as string) ?? '';
    if (promptDraft !== original) {
      if (window.confirm('Save changes to Initial prompt?')) {
        void saveConfigKey(INITIAL_PROMPT_KEY, promptDraft);
      }
    }
    setPromptExpanded(false);
  }

  // Same "confirm if changed" pattern as closePromptEditor, but invalid JSON stays
  // open with the error shown rather than silently discarding a typo the user asked
  // to keep (matches reference/layout/Layout-Workbench.html's __cfgOutsideCloseCustom).
  function closeCustomBlock(key: string) {
    const draftText = customJsonDrafts[key];
    if (draftText === undefined) return;
    const raw = configMap.get(key);
    const original = raw !== undefined ? JSON.stringify(raw, null, 2) : '{}';
    if (draftText === original) {
      clearCustomDraft(key);
      return;
    }
    if (window.confirm(`Save changes to ${getCatalogDef(key)?.label ?? key}?`)) {
      try {
        const parsed: unknown = JSON.parse(draftText);
        void saveConfigKey(key, parsed);
        clearCustomDraft(key);
      } catch (err) {
        setCustomJsonErrors((prev) => ({ ...prev, [key]: `Invalid JSON: ${(err as Error).message}` }));
      }
    } else {
      clearCustomDraft(key);
    }
  }

  // ── Outside-click listeners ───────────────────────────────────────────────

  // Not needed for int — it closes via blur instead.
  const editingScalarDef = editingScalarKey ? getCatalogDef(editingScalarKey) : null;
  useOutsideClick(
    !!editingScalarKey && editingScalarDef?.datatype !== 'int',
    `[data-scalar-pick="${editingScalarKey}"]`,
    () => setEditingScalarKey(null),
  );

  useOutsideClick(promptExpanded, '[data-cfg-block="initialPrompt"]', closePromptEditor);

  // At most one custom key is ever being edited at a time (openCustomBlock
  // resolves any other editor first).
  const editingCustomKey = Object.keys(customJsonDrafts)[0] ?? null;
  useOutsideClick(
    !!editingCustomKey,
    `[data-cfg-block="${editingCustomKey}"]`,
    () => editingCustomKey && closeCustomBlock(editingCustomKey),
  );

  // Deselect a selected list-item pill on ANY click — no element to scope
  // against, hence selector: null.
  useOutsideClick(!!selectedItem, null, () => setSelectedItem(null));

  useOutsideClick(toolPickerOpen, '[data-tool-picker]', () => {
    setToolPickerOpen(false);
    setToolPickerFilter('');
  });

  useOutsideClick(addKeyMenuOpen, '[data-addkey-anchor]', () => setAddKeyMenuOpen(false));

  // ── Config editor resolution helpers ─────────────────────────────────────

  /** Resolve any open config editor (prompt block, a custom-JSON block) before opening
   *  another — same "confirm if changed" behavior as their outside-click handlers. */
  function resolveConfigEditors() {
    if (promptExpanded) closePromptEditor();
    const editingKey = Object.keys(customJsonDrafts)[0];
    if (editingKey) closeCustomBlock(editingKey);
  }

  /** Resolve every open editor (config + current section). */
  function resolveAllEditors() {
    resolveConfigEditors();
    if (resolveEditorRef.current) {
      resolveEditorRef.current();
      resolveEditorRef.current = null;
    }
  }

  // ── Scalar editing ────────────────────────────────────────────────────────

  function openScalarPick(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    if (!canEdit) return;
    resolveConfigEditors();
    if (editingScalarKey === key) {
      setEditingScalarKey(null);
      return;
    }
    setEditingScalarKey(key);
    if (getCatalogDef(key)?.datatype === 'int') {
      setIntDraft(String(configMap.get(key) ?? ''));
    }
  }

  async function saveScalar(key: string, value: unknown) {
    await saveConfigKey(key, value);
    setEditingScalarKey(null);
  }

  async function saveInt(key: string, raw: string) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) await saveConfigKey(key, n);
    setEditingScalarKey(null);
  }

  // ── List item editing ─────────────────────────────────────────────────────

  async function addListItem(key: string, item: string) {
    const trimmed = item.trim().replace(/,$/, '');
    if (!trimmed) return;
    const current = listItemsOf(configMap.get(key) ?? []);
    if (!current.includes(trimmed)) {
      await saveConfigKey(key, [...current, trimmed]);
    }
    setAddingItemKey(null);
    setAddItemDraft('');
  }

  async function removeListItem(key: string, item: string) {
    const current = listItemsOf(configMap.get(key) ?? []);
    const updated = current.filter((i) => i !== item);
    if (updated.length === 0) {
      await removeConfigKey(key);
    } else {
      await saveConfigKey(key, updated);
    }
    setSelectedItem(null);
  }

  async function pickTool(tool: string) {
    const trimmed = tool.trim();
    if (!trimmed) return;
    const current = listItemsOf(configMap.get('tools') ?? []);
    if (!current.includes(trimmed)) {
      await saveConfigKey('tools', [...current, trimmed]);
    }
    setToolPickerOpen(false);
    setToolPickerFilter('');
  }

  async function saveRestriction(raw: string) {
    const trimmed = raw.trim();
    const items = listItemsOf(configMap.get('tools') ?? []);
    const idx = items.findIndex((t) => t === 'Agent' || /^Agent\(.*\)$/.test(t));
    const newItem = trimmed ? `Agent(${trimmed})` : 'Agent';
    if (idx >= 0) {
      const updated = [...items];
      updated[idx] = newItem;
      await saveConfigKey('tools', updated);
    }
    setEditingRestriction(false);
  }

  // ── Add key ───────────────────────────────────────────────────────────────

  function addKey(key: string) {
    if (!canEdit) return;
    setAddKeyMenuOpen(false);
    const def = getCatalogDef(key);
    if (!def) return;
    let initialValue: unknown;
    if (def.datatype === 'list') initialValue = [];
    else if (def.datatype === 'bool') initialValue = false;
    else if (def.datatype === 'int') initialValue = 10;
    else if (def.datatype === 'enum') initialValue = (def.allowedValues as readonly string[])[0];
    else if (def.datatype === 'string') initialValue = '';
    // json: mcpServers is naturally a list of server entries; other json keys (hooks)
    // default to an empty object.
    else if (def.datatype === 'json') initialValue = key === 'mcpServers' ? [] : {};
    else initialValue = {};

    saveConfig([
      ...currentConfigPairs().filter((c) => c.propKey !== key),
      { propKey: key, value: initialValue },
    ]).then(() => {
      // Open the relevant editor after the key is saved
      if (jsonKeys.has(key)) {
        // Custom JSON blocks render always-open — nothing to do here, it just appears.
      } else if (key === INITIAL_PROMPT_KEY) {
        setPromptExpanded(true);
        setPromptDraft(initialValue as string);
      } else if (def.datatype === 'list') {
        if (key === 'tools') {
          setToolPickerOpen(true);
          setToolPickerFilter('');
        } else {
          setAddingItemKey(key);
          setAddItemDraft('');
        }
      }
      // Scalar keys auto-focus their popover on the next open click — no auto-open needed
    });
  }

  /** "+ custom key…" (roadmap TODO item 1, 2026-08-06) — a genuinely nonstandard key,
   *  not in configCatalog at all. Saves with an empty-object value; the new key then
   *  appears via customBlockKeys/renderCustomBlock, same as any other custom block —
   *  no separate open-editor step needed (mirrors addKey's jsonKeys branch above). */
  function addCustomKey() {
    if (!canEdit) return;
    setAddKeyMenuOpen(false);
    const raw = window.prompt('Custom key name (a nonstandard config field, saved as raw JSON):');
    const name = raw?.trim();
    if (!name) return;
    if (configMap.has(name)) {
      setConfigError(`'${name}' already exists on this agent.`);
      return;
    }
    if (catalogKeySet.has(name)) {
      setConfigError(`'${name}' is a standard config key — use the list above instead of "custom key…" for it.`);
      return;
    }
    void saveConfig([...currentConfigPairs(), { propKey: name, value: {} }]);
  }

  // ── Custom JSON block ────────────────────────────────────────────────────
  //
  // Content is always visible (no "N entries" summary, no click-to-view step —
  // 2026-07-31 redesign), but starts read-only: an explicit "Edit" click is what
  // enters edit mode (textarea + Save/Cancel). A key is "in edit mode" exactly
  // when it has an entry in customJsonDrafts.

  function isCustomEditing(key: string): boolean {
    return key in customJsonDrafts;
  }

  /** Enters edit mode: seeds the draft from the stored value. */
  function openCustomBlock(key: string) {
    if (!canEdit) return;
    resolveAllEditors();
    setCustomDraft(key, getCustomDraft(key));
  }

  /** The block's current draft text — the live edit if one exists, else the stored value. */
  function getCustomDraft(key: string): string {
    if (key in customJsonDrafts) return customJsonDrafts[key];
    const raw = configMap.get(key);
    return raw !== undefined ? JSON.stringify(raw, null, 2) : '{}';
  }

  function setCustomDraft(key: string, text: string) {
    setCustomJsonDrafts((prev) => ({ ...prev, [key]: text }));
    setCustomJsonErrors((prev) => ({ ...prev, [key]: null }));
  }

  /** Drops the key's draft/error — the block then re-derives its text from the stored value. */
  function clearCustomDraft(key: string) {
    setCustomJsonDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCustomJsonErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function saveCustomJson(key: string) {
    try {
      const parsed: unknown = JSON.parse(getCustomDraft(key));
      await saveConfigKey(key, parsed);
      clearCustomDraft(key);
    } catch (err) {
      setCustomJsonErrors((prev) => ({ ...prev, [key]: 'Invalid JSON: ' + (err as Error).message }));
    }
  }

  // ── Initial prompt block ──────────────────────────────────────────────────

  function openPrompt(e: React.MouseEvent) {
    e.stopPropagation();
    if (!canEdit) return;
    resolveAllEditors();
    setPromptExpanded(true);
    setPromptDraft((configMap.get(INITIAL_PROMPT_KEY) as string) ?? '');
  }

  async function savePrompt() {
    await saveConfigKey(INITIAL_PROMPT_KEY, promptDraft);
    setPromptExpanded(false);
  }

  function cancelPrompt() {
    setPromptExpanded(false);
  }

  // ─────────────────────────────────  RENDER  ────────────────────────────────

  // ── Render: scalar row (in the 2-col grid) ────────────────────────────────
  function renderScalarRow(key: string) {
    const def = getCatalogDef(key);
    if (!def) return null;
    const value = configMap.get(key);
    const isInt = def.datatype === 'int';
    const isBool = def.datatype === 'bool';
    const isEnum = def.datatype === 'enum';
    const allowedValues = def.allowedValues as readonly string[] | null;
    const isValidEnum = isEnum && allowedValues ? allowedValues.includes(value as string) : true;
    // "Invalid" (red, structurally malformed) is a distinct, more severe tier from
    // "outdated" (yellow, unrecognized-but-well-formed) — confirmed with the user
    // 2026-07-29. Icon: ✕ (confirmed, vs. the ⚠ used for the yellow tier below). Only
    // int (maxTurns) has a concrete real-app case right now: a non-numeric value can only
    // reach here via import or manual raw-edit — this UI's own edit path (saveInt) only
    // ever writes a valid positive integer.
    const isInvalidInt = isInt && !(typeof value === 'number' && Number.isFinite(value) && value > 0);

    const pillClasses = `inline-flex items-center gap-[5px] text-[10.5px] font-mono px-[8px] py-[2px] rounded-full cursor-pointer select-none border ${
      isInvalidInt
        ? 'border-[var(--err)] text-[var(--err)] bg-[var(--elev)]'
        : !isValidEnum
        ? 'border-[var(--warn)] text-[var(--warn)] bg-[var(--elev)]'
        : 'border-[var(--border)] text-[var(--text)] bg-[var(--elev)] hover:border-[var(--accent)]'
    }`;

    const valueStr = isBool ? (value ? 'true' : 'false') : String(value ?? '');
    const colorSwatch =
      key === 'color' && COLOR_HEX[valueStr]
        ? <span style={{ background: COLOR_HEX[valueStr] }} className="inline-block w-[9px] h-[9px] rounded-full border border-black/15 flex-none" />
        : null;
    const warnPrefix = isInvalidInt
      ? <span className="text-[10px]">✕</span>
      : !isValidEnum
      ? <span className="text-[10px]">⚠</span>
      : null;
    const title = isInvalidInt
      ? `'${valueStr}' is not a valid ${key} — must be a positive whole number. Click to fix.`
      : !isValidEnum
      ? `'${valueStr}' is not a recognized ${key} value.${allowedValues ? ` Recognized: ${allowedValues.join(', ')}.` : ''}`
      : `${key} · ${def.datatype}`;

    // Int: inline input on click; enum/bool: popover
    let pillEl: React.ReactNode;
    if (isInt && editingScalarKey === key) {
      pillEl = (
        <input
          autoFocus
          type="number"
          value={intDraft}
          onChange={(e) => setIntDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void saveInt(key, intDraft);
            if (e.key === 'Escape') setEditingScalarKey(null);
          }}
          onBlur={() => void saveInt(key, intDraft)}
          className="font-mono text-[10.5px] border border-[var(--accent)] rounded-full px-[8px] py-[2px] bg-[var(--bg)] text-[var(--text)] outline-none w-[80px]"
        />
      );
    } else {
      pillEl = (
        <button
          type="button"
          title={title}
          onClick={(e) => openScalarPick(e, key)}
          className={pillClasses}
        >
          {warnPrefix}
          {colorSwatch}
          {valueStr}
        </button>
      );
    }

    // Popover for enum/bool
    const popover =
      (isBool || isEnum) && editingScalarKey === key ? (
        <div className="absolute z-30 top-full left-0 mt-[6px] min-w-[150px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)] overflow-hidden">
          <div className="py-[4px]">
            {(isBool
              ? [{ value: true, label: 'true' }, { value: false, label: 'false' }]
              : allowedValues?.map((v) => ({ value: v, label: v })) ?? []
            ).map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={(e) => { e.stopPropagation(); void saveScalar(key, opt.value); }}
                className="flex items-center justify-between gap-2 w-full px-[12px] py-[7px] text-[12px] font-mono text-left text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer"
              >
                {key === 'color' && COLOR_HEX[opt.label] && (
                  <span style={{ background: COLOR_HEX[opt.label] }} className="inline-block w-[9px] h-[9px] rounded-full border border-black/15 flex-none" />
                )}
                <span className="flex-1 text-left">{opt.label}</span>
                {String(opt.value) === String(value) && (
                  <span className="text-[var(--accent)] font-bold font-sans">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : null;

    return (
      <div
        key={key}
        className="group flex items-center gap-2 rounded-[8px] mx-[-6px] px-[6px] py-[4px] transition-colors hover:bg-[rgba(179,128,28,0.09)]"
      >
        <span
          className="flex-none text-right text-[10px] text-[var(--accent-ink)] opacity-80 w-[104px]"
          title={'hint' in def ? String(def.hint) : undefined}
        >
          {def.label}
        </span>
        <div
          data-scalar-pick={editingScalarKey === key ? key : undefined}
          className="flex-1 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {pillEl}
          {popover}
        </div>
        {/* Required badge or hover-reveal × */}
        {def.required ? (
          <span className="flex-none text-[9px] font-bold uppercase tracking-[.03em] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[7px] py-[2px]">
            required
          </span>
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Remove ${def.label}`}
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove ${def.label} from this agent?`)) void removeConfigKey(key); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-none w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0 disabled:cursor-not-allowed"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // ── Render: one list-item pill ────────────────────────────────────────────
  function renderItemPill(propKey: string, item: string) {
    const bad = isBadListItem(propKey, item);
    const dashed = propKey === 'disallowedTools';
    const isSelected = selectedItem?.key === propKey && selectedItem?.item === item;
    const isAgent = propKey === 'tools' && (item === 'Agent' || /^Agent\(.*\)$/.test(item));
    const restriction = isAgent && item.startsWith('Agent(') ? item.slice(6, -1) : '';

    // Agent pill with restriction editing
    if (isAgent) {
      if (editingRestriction && isSelected) {
        return (
          <span key={item} className="inline-flex items-center">
            <input
              autoFocus
              value={restrictionDraft}
              placeholder="worker, researcher (blank = unrestricted)"
              onChange={(e) => setRestrictionDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveRestriction(restrictionDraft);
                if (e.key === 'Escape') setEditingRestriction(false);
              }}
              onBlur={() => void saveRestriction(restrictionDraft)}
              className="font-mono text-[10.5px] border border-[var(--accent)] rounded-full px-[8px] py-[2px] bg-[var(--bg)] text-[var(--text)] outline-none w-[200px]"
            />
          </span>
        );
      }
      return (
        <span
          key={item}
          title="Agent tool · restricts which subagent types this agent may spawn — only when THIS agent runs as the MAIN session agent"
          onClick={(e) => { e.stopPropagation(); setSelectedItem({ key: propKey, item }); }}
          className={`inline-flex items-center gap-[4px] text-[10.5px] font-mono px-[8px] py-[2px] rounded-full border cursor-pointer select-none ${
            isSelected ? 'border-[var(--text)]' : 'border-[var(--border)]'
          } text-[var(--text)] bg-[var(--elev)]`}
        >
          {item}
          <span
            className="text-[9px] font-bold text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[5px] py-[1px] cursor-pointer"
            onClick={(e) => { e.stopPropagation(); if (!canEdit) return; setRestrictionDraft(restriction); setEditingRestriction(true); setSelectedItem({ key: propKey, item }); }}
            title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `${MAIN_AGENT_ONLY_HINT} · click to edit`}
          >
            ⌘
          </span>
          <button
            type="button"
            disabled={!canEdit}
            onClick={(e) => { e.stopPropagation(); void removeListItem(propKey, item); }}
            className="opacity-60 hover:opacity-100 font-bold ml-[1px] disabled:cursor-not-allowed"
            title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Remove ${item}`}
          >
            ×
          </button>
        </span>
      );
    }

    // Normal item pill
    const mcp = mcpDisplayOf(item);
    const displayText = mcp ? `mcp:${mcp.tool || mcp.server}` : item;
    const pillTitle = bad
      ? `'${item}' is not a recognized ${propKey} value.`
      : mcp
      ? `${item} · MCP tool on server "${mcp.server}"${mcp.tool ? '' : ' · whole server'}`
      : `${propKey} · list item`;
    return (
      <span
        key={item}
        title={pillTitle}
        onClick={(e) => { e.stopPropagation(); setSelectedItem({ key: propKey, item }); }}
        className={`inline-flex items-center gap-[4px] text-[10.5px] font-mono px-[8px] py-[2px] rounded-full border cursor-pointer select-none ${
          bad
            ? "border-[var(--warn)] text-[var(--warn)] bg-[var(--elev)]"
            : dashed
            ? `border-dashed border-[var(--border)] text-[var(--text)] bg-[var(--elev)] ${isSelected ? '!border-[var(--text)]' : ''}`
            : `border-[var(--border)] text-[var(--text)] bg-[var(--elev)] ${isSelected ? '!border-[var(--text)]' : ''}`
        }`}
      >
        {bad && <span className="text-[10px]">⚠</span>}
        {displayText}
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => { e.stopPropagation(); void removeListItem(propKey, item); }}
          className="opacity-60 hover:opacity-100 font-bold ml-[1px] disabled:cursor-not-allowed"
          title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Remove ${item}`}
        >
          ×
        </button>
      </span>
    );
  }

  // ── Render: tool picker popover ───────────────────────────────────────────
  function renderToolPicker() {
    const existing = new Set(listItemsOf(configMap.get('tools') ?? []));
    const remaining = Array.from(builtinTools).filter(
      (t) => !existing.has(t) && t.toLowerCase().includes(toolPickerFilter.toLowerCase()),
    );
    return (
      <div
        data-tool-picker
        className="absolute z-20 top-full left-0 mt-[4px] bg-[var(--elev)] border border-[var(--border)] rounded-[8px] shadow-[0_6px_20px_rgba(0,0,0,.15)] w-[230px]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={toolPickerFilter}
          placeholder="Filter, or type mcp__… / Agent(…)"
          onChange={(e) => setToolPickerFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void pickTool(toolPickerFilter);
            if (e.key === 'Escape') { setToolPickerOpen(false); setToolPickerFilter(''); }
          }}
          className="w-full font-inherit text-[11.5px] px-[9px] py-[7px] border-b border-[var(--border)] bg-transparent text-[var(--text)] outline-none"
        />
        <div className="px-[9px] pt-[6px] text-[10px] text-[var(--faint)]">
          Built-ins below, or type mcp__server / mcp__server__tool / Agent(types) and press Enter
        </div>
        <div className="max-h-[170px] overflow-y-auto">
          {remaining.length ? (
            remaining.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => void pickTool(t)}
                className="block w-full text-left px-[9px] py-[6px] text-[11.5px] font-mono text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer"
              >
                {t}
              </button>
            ))
          ) : (
            <div className="px-[9px] py-[8px] text-[11px] text-[var(--faint)] italic">
              No built-in matches — Enter adds as typed
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: list row (full-width) ─────────────────────────────────────────
  function renderListRow(key: string) {
    const def = getCatalogDef(key);
    if (!def) return null;
    const items = listItemsOf(configMap.get(key) ?? []);
    const isDisallowed = key === 'disallowedTools';
    const capped = items.length > LIST_ITEM_CAP && !listExpanded[key];
    const visibleItems = capped ? items.slice(0, LIST_ITEM_CAP) : items;

    const addControl =
      key === 'tools' ? (
        <span className="relative inline-block" data-tool-picker-anchor>
          <button
            type="button"
            disabled={!canEdit}
            onClick={(e) => { e.stopPropagation(); setToolPickerOpen((v) => !v); setToolPickerFilter(''); }}
            title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : 'Add a tool'}
            className="inline-flex items-center gap-[4px] text-[10.5px] font-sans font-semibold px-[8px] py-[2px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + add
          </button>
          {toolPickerOpen && renderToolPicker()}
        </span>
      ) : addingItemKey === key ? (
        <input
          autoFocus
          value={addItemDraft}
          placeholder="type, Enter to add"
          onChange={(e) => setAddItemDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); void addListItem(key, addItemDraft); }
            if (e.key === 'Escape') { setAddingItemKey(null); setAddItemDraft(''); }
          }}
          onBlur={() => { setAddingItemKey(null); setAddItemDraft(''); }}
          className="font-mono text-[10.5px] border border-[var(--accent)] rounded-full px-[8px] py-[2px] bg-[var(--bg)] text-[var(--text)] outline-none w-[130px]"
        />
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={(e) => { e.stopPropagation(); setAddingItemKey(key); setAddItemDraft(''); }}
          title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Add ${key} item`}
          className="inline-flex items-center gap-[4px] text-[10.5px] font-sans font-semibold px-[8px] py-[2px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + add
        </button>
      );

    return (
      <div
        key={key}
        className="group flex items-start gap-2 rounded-[8px] mx-[-6px] px-[6px] py-[4px] transition-colors hover:bg-[rgba(179,128,28,0.09)]"
      >
        <span
          className="flex-none text-right text-[10px] text-[var(--accent-ink)] opacity-80 w-[104px] pt-[4px]"
          title={'hint' in def ? String(def.hint) : undefined}
        >
          {isDisallowed && <span className="mr-[2px]">⊘</span>}
          {def.label}
        </span>
        <div className="flex-1 flex flex-wrap gap-[5px] items-center">
          {visibleItems.map((item) => renderItemPill(key, item))}
          {items.length > LIST_ITEM_CAP && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setListExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
              }}
              className="inline-flex items-center text-[10.5px] font-sans font-semibold px-[8px] py-[2px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)] cursor-pointer"
            >
              {capped ? `+${items.length - LIST_ITEM_CAP} more ▾` : 'show less ▴'}
            </button>
          )}
          {!capped && addControl}
        </div>
        {/* Row-level × to remove the entire key */}
        {def.required ? (
          <span className="flex-none opacity-0 group-hover:opacity-100 text-[9px] font-bold uppercase tracking-[.03em] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[7px] py-[2px]">
            required
          </span>
        ) : (
          <button
            type="button"
            disabled={!canEdit}
            title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Remove ${def.label}`}
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove ${def.label} from this agent?`)) void removeConfigKey(key); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-none w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0 mt-[2px] disabled:cursor-not-allowed"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // ── Render: initialPrompt block ───────────────────────────────────────────
  // Same chevron/header/body split as SectionBlock.tsx: chevron toggles the body's
  // visibility only, never edit mode; Edit/Save+Cancel live top-right in the header,
  // same slot either way. Citation: click the body cites, double-click edits, border
  // turns accent when cited.
  function renderInitialPromptBlock() {
    if (!hasInitialPrompt && !promptExpanded) return null;
    const def = getCatalogDef(INITIAL_PROMPT_KEY)!;
    const currentValue = (configMap.get(INITIAL_PROMPT_KEY) as string) ?? '';
    const hint = 'hint' in def ? String(def.hint) : '';
    const editing = promptExpanded;
    const collapsed = !editing && promptCollapsed;
    const isCited = citedItems.some((c) => c.type === 'config' && c.key === INITIAL_PROMPT_KEY);

    return (
      <div
        data-cfg-block="initialPrompt"
        data-citable
        className={`mt-[14px] border rounded-[9px] bg-[var(--elev)] overflow-hidden group ${
          isCited ? 'border-[var(--accent)]' : 'border-[var(--border)]'
        }`}
      >
        <div
          className="flex items-center gap-[7px] text-[10px] text-[var(--faint)] uppercase tracking-[.06em] font-bold px-[12px] py-[9px] cursor-pointer hover:bg-[var(--bg)]"
          onClick={() => { if (!editing) setPromptCollapsed((v) => !v); }}
        >
          <span className="text-[var(--faint)] text-[10px] normal-case">{collapsed ? '▸' : '▾'}</span>
          <span title={hint}>{def.label}</span>
          <span title={MAIN_AGENT_ONLY_HINT} className="text-[9px] font-bold text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[5px] py-[1px]">⌘</span>
          {editing ? (
            <span onClick={(e) => e.stopPropagation()} className="ml-auto flex items-center gap-[6px] normal-case tracking-normal">
              <button
                type="button"
                onClick={() => void savePrompt()}
                className="rounded-[6px] px-[9px] py-[3px] text-[10.5px] font-semibold bg-[var(--accent)] text-white border-none cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelPrompt}
                className="rounded-[6px] px-[9px] py-[3px] text-[10.5px] bg-transparent text-[var(--muted)] border-none cursor-pointer"
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-[6px] normal-case tracking-normal">
              <button
                type="button"
                disabled={!canEdit}
                onClick={(e) => { e.stopPropagation(); setPromptCollapsed(false); openPrompt(e); }}
                title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Edit ${def.label}`}
                className="rounded-[6px] px-[9px] py-[3px] text-[10.5px] font-semibold text-[var(--accent-ink)] bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={!canEdit}
                title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : 'Remove Initial prompt'}
                onClick={(e) => { e.stopPropagation(); if (window.confirm('Remove Initial prompt from this agent?')) void removeConfigKey(INITIAL_PROMPT_KEY); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0 disabled:cursor-not-allowed"
              >
                ×
              </button>
            </span>
          )}
        </div>
        <div className="px-[12px] pb-[9px]" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <textarea
              autoFocus
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              className="w-full min-h-[90px] font-mono text-[11.5px] border border-[var(--accent)] rounded-[7px] p-[8px] bg-[var(--bg)] text-[var(--text)] outline-none resize-y"
            />
          ) : (
            <p
              onClick={(e) => { e.stopPropagation(); onToggleCite({ type: 'config', key: INITIAL_PROMPT_KEY, label: def.label }, e.ctrlKey || e.metaKey); }}
              onDoubleClick={(e) => { e.stopPropagation(); openPrompt(e); }}
              title={collapsed ? 'Click ▾ to see the full prompt' : 'Click to cite in chat · double-click to edit'}
              className={`m-0 font-mono text-[12px] text-[var(--muted)] cursor-alias whitespace-pre-wrap hover:text-[var(--text)] hover:bg-[var(--accent-wash)] ${collapsed ? 'line-clamp-2' : ''}`}
            >
              {currentValue || <em>(empty)</em>}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Render: custom JSON block (any datatype:'json' key — hooks, mcpServers) ────
  //
  // Three tiers, not two: collapsed = pill row (compact glance), expanded-not-editing
  // = the full JSON read-only, editing = the textarea. The chevron only ever toggles
  // between the first two — it never opens edit mode. Clicking the pill row OR the
  // full-JSON view cites the whole block; double-click either one to edit.
  function renderCustomBlock(key: string) {
    if (!configMap.has(key)) return null;
    // Falls back to a synthesized def for a genuinely nonstandard key — one not in
    // configCatalog at all, whether created via "+ custom key…" or left over from
    // an import.
    const def = getCatalogDef(key) ?? {
      key,
      label: key,
      datatype: 'json',
      allowedValues: null,
      required: false,
      isCore: false,
      exportable: true,
      hint: 'Custom key — not in the standard config catalog. Saved as raw JSON.',
    };
    const hint = 'hint' in def ? String(def.hint) : '';
    const draft = getCustomDraft(key);
    const error = customJsonErrors[key] ?? null;
    const editing = isCustomEditing(key);
    const collapsed = !editing && (customCollapsed[key] ?? true);

    const customNote = (
      <span className="font-normal text-[var(--faint)] text-[10px] normal-case tracking-normal ml-[4px]">
        · custom · saved as-is
      </span>
    );

    const removeButton = (
      <button
        type="button"
        disabled={!canEdit}
        title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Remove ${def.label}`}
        onClick={() => { if (window.confirm(`Remove ${def.label} from this agent?`)) void removeConfigKey(key); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0 disabled:cursor-not-allowed"
      >
        ×
      </button>
    );

    const isCited = citedItems.some((c) => c.type === 'config' && c.key === key);

    return (
      <div
        key={key}
        data-cfg-block={key}
        data-citable
        className={`mt-[14px] border rounded-[9px] bg-[var(--elev)] overflow-hidden group ${
          isCited ? 'border-[var(--accent)]' : 'border-[var(--border)]'
        }`}
      >
        <div
          className="flex items-center gap-[7px] text-[10px] text-[var(--faint)] uppercase tracking-[.06em] font-bold px-[12px] py-[9px] cursor-pointer hover:bg-[var(--bg)]"
          onClick={() => { if (!editing) setCustomCollapsed((prev) => ({ ...prev, [key]: !(prev[key] ?? true) })); }}
        >
          <span className="text-[var(--faint)] text-[10px] normal-case">{collapsed ? '▸' : '▾'}</span>
          <span title={hint}>{def.label}</span>
          {customNote}
          {editing ? (
            <span onClick={(e) => e.stopPropagation()} className="ml-auto flex items-center gap-[6px] normal-case tracking-normal">
              <button
                type="button"
                onClick={() => void saveCustomJson(key)}
                className="rounded-[6px] px-[9px] py-[3px] text-[10.5px] font-semibold bg-[var(--accent)] text-white border-none cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => clearCustomDraft(key)}
                className="rounded-[6px] px-[9px] py-[3px] text-[10.5px] bg-transparent text-[var(--muted)] border-none cursor-pointer"
              >
                Cancel
              </button>
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-[6px] normal-case tracking-normal">
              <button
                type="button"
                disabled={!canEdit}
                onClick={(e) => { e.stopPropagation(); setCustomCollapsed((prev) => ({ ...prev, [key]: false })); openCustomBlock(key); }}
                title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : `Edit ${def.label}`}
                className="rounded-[6px] px-[9px] py-[3px] text-[10.5px] font-semibold text-[var(--accent-ink)] bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Edit
              </button>
              {removeButton}
            </span>
          )}
        </div>
        <div className="px-[12px] pb-[9px]" onClick={(e) => e.stopPropagation()}>
          {editing ? (
            <>
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setCustomDraft(key, e.target.value)}
                className="w-full min-h-[130px] font-mono text-[11.5px] border border-[var(--accent)] rounded-[7px] p-[8px] bg-[var(--bg)] text-[var(--text)] outline-none resize-y"
              />
              {error && <p className="mt-[6px] mb-0 text-[11px] text-[var(--err)]">{error}</p>}
            </>
          ) : collapsed ? (
            // Pill row — the compact tier. No "+ add" pill — adding an entry here
            // always meant opening the same full-block editor as "Edit".
            <div
              onClick={(e) => { e.stopPropagation(); onToggleCite({ type: 'config', key, label: def.label }, e.ctrlKey || e.metaKey); }}
              onDoubleClick={(e) => { e.stopPropagation(); openCustomBlock(key); }}
              title="Click to cite in chat · double-click to edit the full block"
              className="flex flex-wrap items-center gap-[6px] cursor-alias hover:bg-[var(--accent-wash)] rounded-[6px] p-[3px]"
            >
              {customBlockEntryNames(configMap.get(key)).map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="inline-flex items-center text-[10.5px] font-mono px-[8px] py-[2px] rounded-full border border-[var(--border)] text-[var(--text)] bg-[var(--elev)] select-none"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            // Expanded, not editing — the full tier: the whole JSON, read-only.
            <pre
              onClick={(e) => { e.stopPropagation(); onToggleCite({ type: 'config', key, label: def.label }, e.ctrlKey || e.metaKey); }}
              onDoubleClick={(e) => { e.stopPropagation(); openCustomBlock(key); }}
              title="Click to cite in chat · double-click to edit"
              className="m-0 w-full font-mono text-[11.5px] whitespace-pre-wrap break-words text-[var(--muted)] cursor-alias hover:bg-[var(--accent-wash)] rounded-[6px] p-[3px]"
            >
              {draft}
            </pre>
          )}
        </div>
      </div>
    );
  }

  // ── Render: add-key "+" button and menu ───────────────────────────────────
  function renderAddKeyButton() {
    return (
      <span data-addkey-anchor className="relative inline-block ml-[6px]">
        <button
          type="button"
          disabled={!canEdit}
          title={!canEdit ? (interactionLock === 'proposal' ? 'A proposal is pending — apply or discard it first' : 'Chat is in progress') : 'Add a config key'}
          onClick={(e) => { e.stopPropagation(); setAddKeyMenuOpen((v) => !v); }}
          className="w-[16px] h-[16px] rounded-[5px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[12px] font-bold grid place-items-center cursor-pointer hover:text-[var(--text)] hover:border-[var(--text)] p-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          +
        </button>
        {addKeyMenuOpen && (
          <div
            className="absolute z-30 top-full left-0 mt-[4px] min-w-[200px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)] overflow-hidden py-[4px]"
            onClick={(e) => e.stopPropagation()}
          >
            {unsetCatalogKeys.length ? (
              unsetCatalogKeys.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => addKey(d.key)}
                  className="flex items-center gap-[6px] w-full px-[12px] py-[7px] text-[12px] font-sans text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer text-left"
                >
                  {d.label}
                  {jsonKeys.has(d.key) && (
                    <span className="text-[10px] text-[var(--faint)] ml-[4px]">custom</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-[12px] py-[10px] text-[11.5px] text-[var(--faint)] italic">
                All catalog keys are set
              </div>
            )}
            {/* "+ custom key…" — always present, regardless of how many catalog keys
                remain: a genuinely nonstandard key should still be addable. */}
            <button
              type="button"
              onClick={addCustomKey}
              className="flex items-center gap-[6px] w-full px-[12px] py-[7px] text-[12px] font-sans text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer text-left border-t border-[var(--border)]"
            >
              + custom key…
              <span className="text-[10px] text-[var(--faint)] ml-[4px]">arbitrary, raw JSON</span>
            </button>
          </div>
        )}
      </span>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Zone label: [Config] Keys ▾ [+button] ─────── */}
      <div
        className="flex items-center gap-[8px] mt-[18px] mb-[9px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase cursor-pointer select-none"
        onClick={() => setKeysCollapsed((v) => !v)}
        title={keysCollapsed ? 'Expand config keys' : 'Collapse config keys'}
      >
        <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] text-[9px] tracking-[.03em]">
          Config
        </span>
        Keys
        <span className="text-[var(--faint)] text-[9px]">{keysCollapsed ? '▸' : '▾'}</span>
        {renderAddKeyButton()}
        <span className="flex-1 h-px bg-[var(--border)]" />
      </div>

      {!keysCollapsed && (
        <div>
          {/* 2-column scalar grid (only keys that are set) */}
          {setScalarKeys.length > 0 && (
            <div className="grid grid-cols-2 gap-x-[18px] gap-y-[2px] mb-[10px]">
              {setScalarKeys.map((k) => renderScalarRow(k))}
            </div>
          )}

          {/* Full-width list rows (only keys that are set) */}
          {setListKeys.length > 0 && (
            <div className="flex flex-col gap-[2px] mt-[4px]">
              {setListKeys.map((k) => renderListRow(k))}
            </div>
          )}

          {/* Empty state */}
          {setScalarKeys.length === 0 && setListKeys.length === 0 &&
           !hasInitialPrompt && customBlockKeys.length === 0 && (
            <p className="text-[12px] text-[var(--faint)] italic">
              No config keys set — use + to add one.
            </p>
          )}
        </div>
      )}

      {/* initialPrompt block: always visible (outside collapse, per design decision 3) */}
      {renderInitialPromptBlock()}

      {/* Custom JSON blocks: always visible. Covers datatype:'json' catalog keys
          (hooks, mcpServers) and any genuinely nonstandard key — see
          customBlockKeys above. */}
      {customBlockKeys.map((k) => renderCustomBlock(k))}

      {/* Config save error */}
      {configError && (
        <p className="mt-[6px] text-[11px] text-[var(--err)]">{configError}</p>
      )}
    </div>
  );
}
