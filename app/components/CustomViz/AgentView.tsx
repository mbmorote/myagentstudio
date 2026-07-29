'use client';

/**
 * app/components/CustomViz/AgentView.tsx
 *
 * 2026-07-29 — Full editable config zone redesign (design decisions 1–17).
 *
 * Config zone (Zone 1 — "Keys"):
 *   - Zone label: [Config] badge + "Keys" text + collapse chevron + "+" add-key button.
 *   - Two-column scalar grid for set scalar fields (permissionMode/maxTurns/memory/
 *     background/isolation/color): label left, value pill right, hover-reveal × to remove.
 *   - Enum/bool scalars open a popover (not native <select>); int (maxTurns) uses inline
 *     input; color shows a small swatch in the pill.
 *   - Full-width list rows (tools/disallowedTools/skills): label + pills + "+ add" control.
 *     tools uses a searchable picker; disallowedTools/skills use inline text input.
 *     List-item pills: click pill body = select (highlight); only × removes the item.
 *     tools/disallowedTools recognize three valid shapes: 43 built-ins, mcp__* patterns,
 *     and Agent / Agent(types) (which gets a "main-agent only" badge).
 *   - No category-hue coloring (decision 4) — only warn (yellow) for unrecognized values,
 *     dashed border for disallowedTools entries.
 *   - Unset keys have no row; set via the "+" add-key button.
 *   - initialPrompt: click-to-expand textarea block with Save/Cancel and outside-click-confirm.
 *   - hooks / mcpServers: raw-JSON textarea blocks (same expand/save/confirm pattern).
 *   - Unknown config keys (not in catalog): shown as warn pills.
 *
 * Model+effort header control (decision 12):
 *   - Combined trigger button (top-right of card header): "model effort ▾"
 *   - Opens a popover: search box + model list + "Effort" footer row.
 *   - Effort footer opens a side panel (floats left, mirrored from the trigger position).
 *   - Picking a model saves immediately; picking effort saves immediately.
 *
 * Sections zone (Zone 2 — "Body"):
 *   - Zone label: [Sections] badge + "Body" text + collapse chevron.
 *   - SectionBlocks: click header/chevron to collapse, click body text to edit.
 *   - Outside-click-confirm (in SectionBlock) and cross-editor coordination via resolveEditorRef.
 *
 * Persistence: PATCH /api/agents/[id] with full-replace config array (same semantics as
 * the existing model save — see WorkbenchShell and the PATCH route). Returns full AgentDTO;
 * onAgentUpdated propagates it to WorkbenchShell.
 *
 * DEFERRED: custom key creation (item 11's "+ custom key…" option) — flagged for
 * resolution. If a user creates a custom key, Rules.computeValidation would immediately
 * flag it as unknownConfigKeys, which contradicts the UX intent. Needs a design decision
 * on how to distinguish "user-created custom keys" from "stale/unrecognized keys" before
 * implementing. The catalog key picker (standard keys only) is implemented.
 */

import { useState, useEffect, useRef } from 'react';
import type { AgentDTO, GroupDTO } from '@/lib/db/repository';
import type { InteractionLock } from '@/app/components/WorkbenchShell';
import { SectionBlock } from '@/app/components/CustomViz/SectionBlock';
import { CONFIG_DEFS } from '@/lib/blueprint/catalog';

// ─────────────────────────  Catalog-derived constants  ─────────────────────

const MODEL_DEF = CONFIG_DEFS.find((d) => d.key === 'model')!;
const TOOLS_DEF = CONFIG_DEFS.find((d) => d.key === 'tools')!;
const BUILTIN_TOOLS = new Set(TOOLS_DEF.allowedValues as readonly string[]);

// Display order for scalar fields in the 2-column grid
const SCALAR_KEY_ORDER = ['permissionMode', 'maxTurns', 'memory', 'background', 'isolation', 'color'];
// Display order for list-row fields (full-width)
const LIST_KEY_ORDER = ['tools', 'disallowedTools', 'skills'];
// Keys rendered as raw-JSON textarea blocks
const CUSTOM_BLOCK_KEYS = new Set(['hooks', 'mcpServers']);
// Keys handled in the header (not in the config zone)
const HEADER_KEYS = new Set(['model', 'effort']);
const INITIAL_PROMPT_KEY = 'initialPrompt';
// All catalog keys (for "unknown key" detection). Typed as Set<string> so
// `.has(propKey: string)` doesn't require a narrowed literal type.
const CATALOG_KEY_SET: Set<string> = new Set(CONFIG_DEFS.map((d) => d.key));

// Color hex values for the `color` field swatch
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

// Effort options for the model+effort header control
const EFFORT_OPTS: { value: string | null; label: string; hint?: string }[] = [
  { value: null, label: 'Default', hint: 'Model default — removes the effort key' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

// ─────────────────────────  Helpers  ───────────────────────────────────────

/** Two-character monogram from an agent name. */
function monogram(name: string): string {
  const parts = name.trim().split(/[\s_-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toLowerCase();
  }
  return name.slice(0, 2).toLowerCase();
}

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
 * Three-shape tools validation (item 9):
 *   1. One of the 43 known built-in tool names
 *   2. mcp__<server> or mcp__<server>__<tool> (MCP tools, per-project — open namespace)
 *   3. Agent or Agent(types) (restricts subagent spawning — only meaningful as main agent)
 */
function isRecognizedTool(item: string): boolean {
  return (
    BUILTIN_TOOLS.has(item) ||
    item === 'Agent' ||
    /^Agent\([^)]*\)$/.test(item) ||
    /^mcp__[\w.-]+(__[\w.-]+)?$/.test(item)
  );
}

function isBadListItem(propKey: string, item: string): boolean {
  if (propKey === 'tools' || propKey === 'disallowedTools') return !isRecognizedTool(item);
  return false; // skills: open vocabulary, no closed list to check against
}

// List-item cap (prototyped 2026-07-29) — confirmed real gap: a `dev`-style agent with
// ~40 MCP tools rendered as an unbroken wrap with no cap at all. Applies to every list
// key (tools/disallowedTools/skills), not just tools.
const LIST_ITEM_CAP = 14;

// MCP tool display shortening (prototyped 2026-07-29) — an item's full qualified name
// (mcp__server or mcp__server__tool) is still what's stored/matched/removed; this only
// shortens what's shown on the pill, with the full name moved into its tooltip. Without
// this, an MCP-heavy tools list is "too much info" per pill even under the cap above.
const MCP_DISPLAY_RE = /^mcp__([\w.-]+?)(?:__([\w.-]+))?$/;
function mcpDisplayOf(item: string): { server: string; tool?: string } | null {
  const m = item.match(MCP_DISPLAY_RE);
  if (!m) return null;
  const [, server, tool] = m;
  return { server, tool };
}

function getCatalogDef(key: string) {
  return CONFIG_DEFS.find((d) => d.key === key) ?? null;
}

// ─────────────────────────  Props  ─────────────────────────────────────────

interface AgentViewProps {
  agent: AgentDTO;
  groups: GroupDTO[];
  interactionLock: InteractionLock;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSectionSaved: (sectionId: string, content: string, newVersion: number) => void;
  onNameSaved: (name: string) => void;
  /** Called after any config PATCH — provides the full updated DTO from the server. */
  onAgentUpdated: (agent: AgentDTO) => void;
}

// ─────────────────────────  Component  ─────────────────────────────────────

export function AgentView({
  agent,
  groups,
  interactionLock,
  onEditStart,
  onEditEnd,
  onSectionSaved,
  onNameSaved,
  onAgentUpdated,
}: AgentViewProps) {

  // ── Derived data ──────────────────────────────────────────────────────────
  const agentGroups = groups.filter((g) => g.memberAgentIds.includes(agent.id));
  const configMap = new Map(agent.config.map((c) => [c.propKey, c.value]));

  const modelValue = (configMap.get('model') as string) ?? 'inherit';
  const effortValue = configMap.has('effort') ? (configMap.get('effort') as string) : null;
  const effortLabel = EFFORT_OPTS.find((o) => o.value === effortValue)?.label ?? effortValue ?? 'Default';
  const modelOptions = MODEL_DEF.allowedValues as readonly string[];
  const modelBad = !modelOptions.includes(modelValue);

  // Which config keys are actually set (for "add key" menu and display logic)
  const setKeys = new Set(agent.config.map((c) => c.propKey));

  // Scalar keys that are set on this agent (in display order)
  const setScalarKeys = SCALAR_KEY_ORDER.filter((k) => configMap.has(k));
  // List keys that are set
  const setListKeys = LIST_KEY_ORDER.filter((k) => configMap.has(k));
  // Custom JSON block keys that are set
  const setCustomKeys = Array.from(CUSTOM_BLOCK_KEYS).filter((k) => configMap.has(k));
  const hasInitialPrompt = configMap.has(INITIAL_PROMPT_KEY);

  // Unknown keys: in agent config but not in any known category
  const unknownConfigKeys = agent.config
    .map((c) => c.propKey)
    .filter((k) => !CATALOG_KEY_SET.has(k));

  // Catalog keys that are unset (for the "+" add-key menu)
  const unsetCatalogKeys = CONFIG_DEFS.filter(
    (d) => !setKeys.has(d.key) && d.key !== 'model' && d.key !== 'effort',
  );

  // ── Interaction lock ──────────────────────────────────────────────────────
  const canEdit = interactionLock !== 'chat';

  // ── Name editing state ────────────────────────────────────────────────────
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // ── Model + effort popover state ──────────────────────────────────────────
  const [meOpen, setMeOpen] = useState(false);
  const [meFilter, setMeFilter] = useState('');
  const [meEffortOpen, setMeEffortOpen] = useState(false);

  // ── Scalar editing state ──────────────────────────────────────────────────
  const [editingScalarKey, setEditingScalarKey] = useState<string | null>(null);
  const [intDraft, setIntDraft] = useState('');

  // ── List item state ───────────────────────────────────────────────────────
  const [addingItemKey, setAddingItemKey] = useState<string | null>(null);
  const [addItemDraft, setAddItemDraft] = useState('');
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const [toolPickerFilter, setToolPickerFilter] = useState('');
  const [selectedItem, setSelectedItem] = useState<{ key: string; item: string } | null>(null);
  // list-item cap expand state, per key — prototyped 2026-07-29
  const [listExpanded, setListExpanded] = useState<Record<string, boolean>>({});
  const [editingRestriction, setEditingRestriction] = useState(false);
  const [restrictionDraft, setRestrictionDraft] = useState('');

  // ── Special block state ───────────────────────────────────────────────────
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [expandedCustomKey, setExpandedCustomKey] = useState<string | null>(null);
  const [customJsonDraft, setCustomJsonDraft] = useState('');
  const [customJsonError, setCustomJsonError] = useState<string | null>(null);

  // ── Zone / menu state ─────────────────────────────────────────────────────
  const [keysCollapsed, setKeysCollapsed] = useState(false);
  const [sectionsCollapsed, setSectionsCollapsed] = useState(false);
  const [addKeyMenuOpen, setAddKeyMenuOpen] = useState(false);

  // ── Config save state ─────────────────────────────────────────────────────
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // ── Cross-editor coordination ref (passed to every SectionBlock) ──────────
  const resolveEditorRef = useRef<(() => void) | null>(null);

  // ── Stable outside-click handler refs (updated every render) ─────────────
  const meOutsideRef = useRef<() => void>(() => {});
  const promptOutsideRef = useRef<() => void>(() => {});
  const customOutsideRef = useRef<() => void>(() => {});

  meOutsideRef.current = () => {
    setMeOpen(false);
    setMeEffortOpen(false);
  };

  promptOutsideRef.current = () => {
    const original = (configMap.get(INITIAL_PROMPT_KEY) as string) ?? '';
    if (promptDraft !== original) {
      if (window.confirm('Save changes to Initial prompt?')) {
        void saveConfigKey(INITIAL_PROMPT_KEY, promptDraft);
      }
    }
    setPromptExpanded(false);
  };

  customOutsideRef.current = () => {
    if (!expandedCustomKey) return;
    const original = JSON.stringify(configMap.get(expandedCustomKey), null, 2);
    if (customJsonDraft !== original) {
      const def = getCatalogDef(expandedCustomKey);
      if (window.confirm(`Save changes to ${def?.label ?? expandedCustomKey}?`)) {
        try {
          const parsed: unknown = JSON.parse(customJsonDraft);
          void saveConfigKey(expandedCustomKey, parsed);
        } catch {
          // Invalid JSON — just close without saving rather than losing the original
        }
      }
    }
    setExpandedCustomKey(null);
    setCustomJsonError(null);
  };

  // ── Effects: outside-click listeners ─────────────────────────────────────

  // Close model+effort panel on outside click
  useEffect(() => {
    if (!meOpen) return;
    const handler = (e: MouseEvent) => {
      const area = document.querySelector('[data-me-area]');
      if (area && !area.contains(e.target as Node)) meOutsideRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [meOpen]);

  // Close scalar popover on outside click (not needed for int — it closes via blur)
  useEffect(() => {
    if (!editingScalarKey) return;
    const def = getCatalogDef(editingScalarKey);
    if (!def || def.datatype === 'int') return;
    const handler = (e: MouseEvent) => {
      const el = document.querySelector(`[data-scalar-pick="${editingScalarKey}"]`);
      if (el && !el.contains(e.target as Node)) setEditingScalarKey(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingScalarKey]);

  // Close initialPrompt block on outside click (confirm if changed)
  useEffect(() => {
    if (!promptExpanded) return;
    const handler = (e: MouseEvent) => {
      const el = document.querySelector('[data-cfg-block="initialPrompt"]');
      if (el && !el.contains(e.target as Node)) promptOutsideRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [promptExpanded]);

  // Close custom JSON block on outside click (confirm if changed)
  useEffect(() => {
    if (!expandedCustomKey) return;
    const handler = (e: MouseEvent) => {
      const el = document.querySelector(`[data-cfg-block="${expandedCustomKey}"]`);
      if (el && !el.contains(e.target as Node)) customOutsideRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [expandedCustomKey]);

  // Deselect selected list-item pill on any click
  useEffect(() => {
    if (!selectedItem) return;
    const handler = () => setSelectedItem(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedItem]);

  // Close tool picker on outside click
  useEffect(() => {
    if (!toolPickerOpen) return;
    const handler = (e: MouseEvent) => {
      const el = document.querySelector('[data-tool-picker]');
      if (el && !el.contains(e.target as Node)) {
        setToolPickerOpen(false);
        setToolPickerFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [toolPickerOpen]);

  // Close add-key menu on outside click
  useEffect(() => {
    if (!addKeyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const el = document.querySelector('[data-addkey-anchor]');
      if (el && !el.contains(e.target as Node)) setAddKeyMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addKeyMenuOpen]);

  // ── Config editor resolution helpers ─────────────────────────────────────

  /** Resolve any open config editor (prompt or custom JSON block) before opening another. */
  function resolveConfigEditors() {
    if (promptExpanded) promptOutsideRef.current();
    if (expandedCustomKey) customOutsideRef.current();
  }

  /** Resolve every open editor (config + current section). */
  function resolveAllEditors() {
    resolveConfigEditors();
    if (resolveEditorRef.current) {
      resolveEditorRef.current();
      resolveEditorRef.current = null;
    }
  }

  // ── Config PATCH helpers ──────────────────────────────────────────────────

  function currentConfigPairs(): { propKey: string; value: unknown }[] {
    return agent.config.map((c) => ({ propKey: c.propKey, value: c.value }));
  }

  async function saveConfig(newRows: { propKey: string; value: unknown }[]): Promise<void> {
    setIsSavingConfig(true);
    setConfigError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newRows }),
      });
      if (res.ok) {
        const dto = (await res.json()) as AgentDTO;
        onAgentUpdated(dto);
      } else {
        setConfigError('Save failed. Please try again.');
      }
    } catch {
      setConfigError('Network error. Please try again.');
    } finally {
      setIsSavingConfig(false);
    }
  }

  async function saveConfigKey(key: string, value: unknown): Promise<void> {
    const without = currentConfigPairs().filter((c) => c.propKey !== key);
    await saveConfig([...without, { propKey: key, value }]);
  }

  async function removeConfigKey(key: string): Promise<void> {
    await saveConfig(currentConfigPairs().filter((c) => c.propKey !== key));
  }

  // ── Name editing ──────────────────────────────────────────────────────────

  function startNameEdit() {
    if (!canEdit || isEditingName) return;
    setNameDraft(agent.name);
    setNameError(null);
    setIsEditingName(true);
    onEditStart();
  }

  function cancelNameEdit() {
    setIsEditingName(false);
    setNameDraft(agent.name);
    setNameError(null);
    onEditEnd();
  }

  async function saveNameEdit() {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === agent.name) {
      cancelNameEdit();
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const response = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (response.ok) {
        onNameSaved(trimmed);
        setIsEditingName(false);
        onEditEnd();
      } else if (response.status === 409) {
        setNameError('An agent with that name already exists.');
      } else {
        setNameError('Save failed. Please try again.');
      }
    } catch {
      setNameError('Network error. Please try again.');
    } finally {
      setNameSaving(false);
    }
  }

  // ── Model + effort ────────────────────────────────────────────────────────

  async function saveModel(newModel: string) {
    if (newModel === modelValue) return;
    const without = currentConfigPairs().filter((c) => c.propKey !== 'model');
    await saveConfig([...without, { propKey: 'model', value: newModel }]);
    setMeOpen(false);
    setMeEffortOpen(false);
  }

  async function saveEffort(newEffort: string | null) {
    if (newEffort === null) {
      await removeConfigKey('effort');
    } else {
      await saveConfigKey('effort', newEffort);
    }
    setMeEffortOpen(false);
    setMeOpen(false);
  }

  // ── Scalar editing ────────────────────────────────────────────────────────

  function openScalarPick(e: React.MouseEvent, key: string) {
    e.stopPropagation();
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
    setAddKeyMenuOpen(false);
    const def = getCatalogDef(key);
    if (!def) return;
    let initialValue: unknown;
    if (def.datatype === 'list') initialValue = [];
    else if (def.datatype === 'bool') initialValue = false;
    else if (def.datatype === 'int') initialValue = 10;
    else if (def.datatype === 'enum') initialValue = (def.allowedValues as readonly string[])[0];
    else if (def.datatype === 'string') initialValue = '';
    else initialValue = {}; // 'any' → hooks gets {}

    // For mcpServers (stored as list but rendered as JSON block): use []
    if (key === 'mcpServers') initialValue = [];

    saveConfig([
      ...currentConfigPairs().filter((c) => c.propKey !== key),
      { propKey: key, value: initialValue },
    ]).then(() => {
      // Open the relevant editor after the key is saved
      if (CUSTOM_BLOCK_KEYS.has(key)) {
        setExpandedCustomKey(key);
        setCustomJsonDraft(JSON.stringify(initialValue, null, 2));
        setCustomJsonError(null);
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

  // ── Custom JSON block ─────────────────────────────────────────────────────

  function openCustomBlock(e: React.MouseEvent, key: string) {
    e.stopPropagation();
    resolveAllEditors();
    setExpandedCustomKey(key);
    const raw = configMap.get(key);
    setCustomJsonDraft(raw !== undefined ? JSON.stringify(raw, null, 2) : '{}');
    setCustomJsonError(null);
  }

  async function saveCustomJson(key: string) {
    try {
      const parsed: unknown = JSON.parse(customJsonDraft);
      await saveConfigKey(key, parsed);
      setExpandedCustomKey(null);
      setCustomJsonError(null);
    } catch (err) {
      setCustomJsonError('Invalid JSON: ' + (err as Error).message);
    }
  }

  // ── Initial prompt block ──────────────────────────────────────────────────

  function openPrompt(e: React.MouseEvent) {
    e.stopPropagation();
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
          className="flex-none text-right text-[10px] text-[var(--faint)] w-[104px]"
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
            title={`Remove ${def.label}`}
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove ${def.label} from this agent?`)) void removeConfigKey(key); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-none w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0"
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
            className="text-[9px] font-bold uppercase tracking-[.03em] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[5px] py-[1px] cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setRestrictionDraft(restriction); setEditingRestriction(true); setSelectedItem({ key: propKey, item }); }}
            title="Click to edit subagent type restrictions"
          >
            ⌘ main-agent only
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void removeListItem(propKey, item); }}
            className="opacity-60 hover:opacity-100 font-bold ml-[1px]"
            title={`Remove ${item}`}
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
          onClick={(e) => { e.stopPropagation(); void removeListItem(propKey, item); }}
          className="opacity-60 hover:opacity-100 font-bold ml-[1px]"
          title={`Remove ${item}`}
        >
          ×
        </button>
      </span>
    );
  }

  // ── Render: tool picker popover ───────────────────────────────────────────
  function renderToolPicker() {
    const existing = new Set(listItemsOf(configMap.get('tools') ?? []));
    const remaining = Array.from(BUILTIN_TOOLS).filter(
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
            onClick={(e) => { e.stopPropagation(); setToolPickerOpen((v) => !v); setToolPickerFilter(''); }}
            className="inline-flex items-center gap-[4px] text-[10.5px] font-sans font-semibold px-[8px] py-[2px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)] cursor-pointer"
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
          onClick={(e) => { e.stopPropagation(); setAddingItemKey(key); setAddItemDraft(''); }}
          className="inline-flex items-center gap-[4px] text-[10.5px] font-sans font-semibold px-[8px] py-[2px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)] cursor-pointer"
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
          className="flex-none text-right text-[10px] text-[var(--faint)] w-[104px] pt-[4px]"
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
            title={`Remove ${def.label}`}
            onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove ${def.label} from this agent?`)) void removeConfigKey(key); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-none w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0 mt-[2px]"
          >
            ×
          </button>
        )}
      </div>
    );
  }

  // ── Render: initialPrompt block ───────────────────────────────────────────
  function renderInitialPromptBlock() {
    if (!hasInitialPrompt && !promptExpanded) return null;
    const def = getCatalogDef(INITIAL_PROMPT_KEY)!;
    const currentValue = (configMap.get(INITIAL_PROMPT_KEY) as string) ?? '';
    const hint = 'hint' in def ? String(def.hint) : '';

    if (!promptExpanded) {
      const truncated = currentValue.length > 110 ? currentValue.slice(0, 110) + '…' : currentValue;
      return (
        <div
          data-cfg-block="initialPrompt"
          onClick={openPrompt}
          className="mt-[14px] border border-[var(--border)] rounded-[9px] bg-[var(--elev)] px-[12px] py-[9px] cursor-pointer group"
        >
          <div className="flex items-center gap-[7px] text-[10px] text-[var(--faint)] uppercase tracking-[.06em] font-bold mb-[4px]">
            <span title={hint}>{def.label}</span>
            <span className="text-[9px] font-bold uppercase tracking-[.03em] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[5px] py-[1px]">⌘ main-agent only</span>
            <span className="ml-auto text-[var(--accent-ink)] font-semibold normal-case tracking-normal text-[10.5px]">⌯ expand</span>
            {/* Row-level × */}
            <button
              type="button"
              title="Remove Initial prompt"
              onClick={(e) => { e.stopPropagation(); if (window.confirm('Remove Initial prompt from this agent?')) void removeConfigKey(INITIAL_PROMPT_KEY); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0"
            >
              ×
            </button>
          </div>
          <p className="m-0 text-[12px] font-mono text-[var(--muted)]">
            {truncated || <em>(empty)</em>}
          </p>
        </div>
      );
    }

    return (
      <div
        data-cfg-block="initialPrompt"
        onClick={(e) => e.stopPropagation()}
        className="mt-[14px] border border-[var(--border)] rounded-[9px] bg-[var(--elev)] px-[12px] py-[9px]"
      >
        <div className="flex items-center gap-[7px] text-[10px] text-[var(--faint)] uppercase tracking-[.06em] font-bold mb-[4px]">
          <span title={hint}>{def.label}</span>
          <span className="text-[9px] font-bold uppercase tracking-[.03em] text-[var(--muted)] bg-[var(--bg)] border border-[var(--border)] rounded-[5px] px-[5px] py-[1px]">⌘ main-agent only</span>
        </div>
        <textarea
          autoFocus
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          className="w-full min-h-[90px] font-mono text-[11.5px] border border-[var(--accent)] rounded-[7px] p-[8px] bg-[var(--bg)] text-[var(--text)] outline-none resize-y"
        />
        <div className="mt-[7px] flex gap-[8px] items-center">
          <button
            type="button"
            onClick={() => void savePrompt()}
            className="rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold bg-[var(--accent)] text-white border-none cursor-pointer"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelPrompt}
            className="rounded-[6px] px-[11px] py-[5px] text-[11px] bg-transparent text-[var(--muted)] border-none cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Render: custom JSON block (hooks, mcpServers) ─────────────────────────
  function renderCustomBlock(key: string) {
    if (!configMap.has(key) && expandedCustomKey !== key) return null;
    const def = getCatalogDef(key)!;
    const hint = 'hint' in def ? String(def.hint) : '';
    const value = configMap.get(key);
    const isExpanded = expandedCustomKey === key;

    const customNote = (
      <span className="font-normal text-[var(--faint)] text-[10px] normal-case tracking-normal ml-[4px]">
        · custom · saved as-is
      </span>
    );

    if (!isExpanded) {
      const summary =
        key === 'hooks'
          ? `${Object.keys((value as Record<string, unknown>) ?? {}).length} event(s) configured`
          : Array.isArray(value)
          ? `${(value as unknown[]).length} entries`
          : `${Object.keys((value as Record<string, unknown>) ?? {}).length} entries`;

      return (
        <div
          key={key}
          data-cfg-block={key}
          onClick={(e) => openCustomBlock(e, key)}
          className="mt-[14px] border border-[var(--border)] rounded-[9px] bg-[var(--elev)] px-[12px] py-[9px] cursor-pointer group"
        >
          <div className="flex items-center gap-[7px] text-[10px] text-[var(--faint)] uppercase tracking-[.06em] font-bold mb-[4px]">
            <span title={hint}>{def.label}</span>
            {customNote}
            <span className="ml-auto text-[var(--accent-ink)] font-semibold normal-case tracking-normal text-[10.5px]">⌯ view / edit JSON</span>
            <button
              type="button"
              title={`Remove ${def.label}`}
              onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove ${def.label} from this agent?`)) void removeConfigKey(key); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity w-[16px] h-[16px] rounded-[4px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[11px] grid place-items-center cursor-pointer hover:text-[var(--err)] hover:border-[var(--err)] p-0"
            >
              ×
            </button>
          </div>
          <p className="m-0 text-[12px] font-mono text-[var(--muted)]">{summary}</p>
        </div>
      );
    }

    return (
      <div
        key={key}
        data-cfg-block={key}
        onClick={(e) => e.stopPropagation()}
        className="mt-[14px] border border-[var(--border)] rounded-[9px] bg-[var(--elev)] px-[12px] py-[9px]"
      >
        <div className="flex items-center gap-[7px] text-[10px] text-[var(--faint)] uppercase tracking-[.06em] font-bold mb-[4px]">
          <span title={hint}>{def.label}</span>
          {customNote}
        </div>
        <textarea
          autoFocus
          value={customJsonDraft}
          onChange={(e) => { setCustomJsonDraft(e.target.value); setCustomJsonError(null); }}
          className="w-full min-h-[130px] font-mono text-[11.5px] border border-[var(--accent)] rounded-[7px] p-[8px] bg-[var(--bg)] text-[var(--text)] outline-none resize-y"
        />
        <div className="mt-[7px] flex gap-[8px] items-center">
          <button
            type="button"
            onClick={() => void saveCustomJson(key)}
            className="rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold bg-[var(--accent)] text-white border-none cursor-pointer"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setExpandedCustomKey(null); setCustomJsonError(null); }}
            className="rounded-[6px] px-[11px] py-[5px] text-[11px] bg-transparent text-[var(--muted)] border-none cursor-pointer"
          >
            Cancel
          </button>
          {customJsonError && (
            <span className="text-[11px] text-[var(--err)]">{customJsonError}</span>
          )}
        </div>
      </div>
    );
  }

  // ── Render: model+effort header control ───────────────────────────────────
  function renderModelEffort() {
    const filteredModels = modelOptions.filter((m) =>
      m.toLowerCase().includes(meFilter.toLowerCase()),
    );
    // Include current model even if it doesn't match the filter (and it's not in the list)
    const modelsToShow =
      !modelOptions.includes(modelValue) && !filteredModels.includes(modelValue)
        ? [...filteredModels, modelValue]
        : filteredModels;

    return (
      <div data-me-area className="relative flex-none ml-auto">
        {/* Trigger button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMeOpen((v) => !v); setMeFilter(''); setMeEffortOpen(false); }}
          title={modelBad ? `'${modelValue}' is not a current recognized model value.` : 'Model & effort'}
          className={`flex items-center gap-[8px] font-mono text-[11px] border rounded-[7px] px-[10px] py-[5px] bg-[var(--elev)] cursor-pointer appearance-none ${
            modelBad
              ? 'border-[var(--warn)] text-[var(--warn)]'
              : 'border-[var(--border)] text-[var(--text)]'
          }`}
        >
          {modelBad && <span>⚠ </span>}
          {modelValue}
          <span className="text-[var(--faint)] font-sans text-[10px]">{effortLabel}</span>
          <span className="text-[var(--faint)] text-[9px] ml-[2px]">▾</span>
        </button>

        {/* Model panel */}
        {meOpen && (
          <div
            className="absolute z-30 top-full right-0 mt-[6px] w-[260px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)] text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={meFilter}
              placeholder="Search models"
              onChange={(e) => setMeFilter(e.target.value)}
              className="w-full box-border font-inherit text-[12px] px-[12px] py-[9px] border-b border-[var(--border)] bg-transparent text-[var(--text)] outline-none rounded-t-[10px]"
            />
            <div className="max-h-[220px] overflow-y-auto py-[4px]">
              {modelsToShow.length ? (
                modelsToShow.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void saveModel(m)}
                    className="flex items-center justify-between gap-2 w-full px-[12px] py-[7px] text-[12px] font-mono text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer"
                  >
                    <span>{m}</span>
                    {m === modelValue && <span className="text-[var(--accent)] font-bold font-sans">✓</span>}
                  </button>
                ))
              ) : (
                <div className="px-[12px] py-[10px] text-[11.5px] text-[var(--faint)] italic">No matches</div>
              )}
            </div>
            {/* Effort footer row */}
            <div
              className="relative flex items-center justify-between px-[12px] py-[9px] border-t border-[var(--border)] bg-[var(--bg)] rounded-b-[10px] cursor-pointer text-[var(--text)] hover:bg-[var(--accent-wash)]"
              onClick={(e) => { e.stopPropagation(); setMeEffortOpen((v) => !v); }}
            >
              <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-[var(--faint)]">Effort</span>
              <span className="flex items-center gap-[5px] text-[12px] font-sans text-[var(--muted)]">{effortLabel} ›</span>

              {/* Effort side panel — floats to the LEFT of the model panel */}
              {meEffortOpen && (
                <div
                  className="absolute z-31 right-full bottom-0 mr-[6px] w-[230px] bg-[var(--elev)] border border-[var(--border)] rounded-[10px] shadow-[0_10px_30px_rgba(0,0,0,.18)]"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-[12px] pt-[10px] pb-[4px] text-[11px] text-[var(--faint)] leading-[1.4]">
                    How thoroughly Claude responds; lower effort saves tokens.
                  </div>
                  <div className="py-[4px]">
                    {EFFORT_OPTS.map((opt) => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => void saveEffort(opt.value)}
                        className="flex items-center w-full px-[12px] py-[7px] text-[12px] font-sans text-[var(--text)] hover:bg-[var(--accent-wash)] cursor-pointer gap-[6px]"
                      >
                        <span className="flex-1 text-left">{opt.label}</span>
                        {opt.hint && <span className="text-[10.5px] text-[var(--faint)]">{opt.hint}</span>}
                        {opt.value === effortValue && <span className="text-[var(--accent)] font-bold">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: add-key "+" button and menu ───────────────────────────────────
  function renderAddKeyButton() {
    return (
      <span data-addkey-anchor className="relative inline-block ml-[6px]">
        <button
          type="button"
          title="Add a config key"
          onClick={(e) => { e.stopPropagation(); setAddKeyMenuOpen((v) => !v); }}
          className="w-[16px] h-[16px] rounded-[5px] border border-[var(--border)] bg-[var(--elev)] text-[var(--faint)] text-[12px] font-bold grid place-items-center cursor-pointer hover:text-[var(--text)] hover:border-[var(--text)] p-0"
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
                  {CUSTOM_BLOCK_KEYS.has(d.key) && (
                    <span className="text-[10px] text-[var(--faint)] ml-[4px]">custom</span>
                  )}
                </button>
              ))
            ) : (
              <div className="px-[12px] py-[10px] text-[11.5px] text-[var(--faint)] italic">
                All catalog keys are set
              </div>
            )}
            {/* Custom key creation is deferred — see file header DEFERRED note */}
          </div>
        )}
      </span>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-[14px_16px_20px] space-y-0">

      {/* ── Agent header ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 mb-[14px]">
        {/* Monogram avatar */}
        <div className="w-[40px] h-[40px] rounded-[9px] bg-[var(--accent)] text-white flex-none grid place-items-center font-bold text-[17px]">
          {monogram(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          {isEditingName ? (
            <div>
              <input
                autoFocus
                value={nameDraft}
                disabled={nameSaving}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveNameEdit()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveNameEdit();
                  if (e.key === 'Escape') cancelNameEdit();
                }}
                className="m-0 w-full text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)] bg-[var(--bg)] border border-[var(--accent)] rounded-[6px] px-[6px] py-[1px] outline-none"
              />
              {nameError && (
                <p className="text-[11px] text-[var(--err)] mt-[3px]">{nameError}</p>
              )}
            </div>
          ) : (
            <h1
              onClick={startNameEdit}
              title={canEdit ? 'Click to rename' : 'Chat is in progress — rename disabled'}
              className={`m-0 text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)] rounded-[6px] px-[6px] py-[1px] -mx-[6px] ${
                canEdit ? 'cursor-text hover:bg-[var(--bg)]' : ''
              }`}
            >
              {agent.name}
            </h1>
          )}
          <div className="text-[var(--muted)] text-[12px] mt-[2px]">
            {agent.description || <span className="italic text-[var(--err)]">description missing</span>}
            {' · '}
            <span>{agent.source === 'imported' ? 'imported into platform' : 'created in platform'}</span>
          </div>
          {/* Group membership pills */}
          {agentGroups.length > 0 && (
            <div className="flex flex-wrap gap-[6px] mt-[9px]">
              {agentGroups.map((g) => (
                <span
                  key={g.id}
                  className="inline-flex items-center gap-[6px] text-[11px] px-[9px] py-[3px] rounded-full border border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-wash)]"
                >
                  ◆ {g.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Model + effort header control (decision 12) */}
        {renderModelEffort()}
      </div>

      {/* ── Zone 1: Config Keys ──────────────────────────────────────────── */}
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
            {/* Unknown config keys — warn pills (for stale/unrecognized keys from imports) */}
            {unknownConfigKeys.length > 0 && (
              <div className="flex flex-wrap gap-[6px] mb-[10px]">
                {unknownConfigKeys.map((k) => {
                  const value = agent.config.find((r) => r.propKey === k)?.value;
                  return (
                    <span
                      key={k}
                      title={`'${k}' is not a recognized config key in the current Claude Code catalog. This may be a renamed or custom key.`}
                      className="inline-flex items-center gap-[6px] text-[11px] px-[9px] py-[3px] rounded-full border border-[var(--warn)] text-[var(--warn)] bg-[var(--elev)] before:content-['⚠'] before:text-[10px]"
                    >
                      {k}
                      {value !== undefined && (
                        <b className="font-mono text-[10.5px] mx-[3px]">{String(value)}</b>
                      )}
                    </span>
                  );
                })}
              </div>
            )}

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
             !hasInitialPrompt && setCustomKeys.length === 0 &&
             unknownConfigKeys.length === 0 && (
              <p className="text-[12px] text-[var(--faint)] italic">
                No config keys set — use + to add one.
              </p>
            )}
          </div>
        )}

        {/* initialPrompt block: always visible (outside collapse, per design decision 3) */}
        {renderInitialPromptBlock()}

        {/* Custom JSON blocks (hooks, mcpServers): also always visible */}
        {Array.from(CUSTOM_BLOCK_KEYS).map((k) => renderCustomBlock(k))}

        {/* Config save error */}
        {configError && (
          <p className="mt-[6px] text-[11px] text-[var(--err)]">{configError}</p>
        )}
      </div>

      {/* ── Zone 2: Sections Body ────────────────────────────────────────── */}
      <div>
        {/* Zone label: [Sections] Body ▾ ─────── */}
        <div
          className="flex items-center gap-[8px] mt-[18px] mb-[9px] text-[var(--faint)] text-[10px] font-bold tracking-[.09em] uppercase cursor-pointer select-none"
          onClick={() => setSectionsCollapsed((v) => !v)}
          title={sectionsCollapsed ? 'Expand sections' : 'Collapse sections'}
        >
          <span className="text-[var(--accent)] border border-[var(--accent)] rounded-[4px] px-[5px] text-[9px] tracking-[.03em]">
            Sections
          </span>
          Body
          <span className="text-[var(--faint)] text-[9px]">{sectionsCollapsed ? '▸' : '▾'}</span>
          <span className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {!sectionsCollapsed && (
          <div className="space-y-[9px]">
            {agent.sections.map((section) => (
              <SectionBlock
                key={section.id}
                agentId={agent.id}
                section={section}
                interactionLock={interactionLock}
                onEditStart={onEditStart}
                onEditEnd={onEditEnd}
                resolveEditorRef={resolveEditorRef}
                onSaved={(content, newVersion) =>
                  onSectionSaved(section.id, content, newVersion)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
