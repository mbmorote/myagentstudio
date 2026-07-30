# MyAgent User Guide

MyAgent is a local workbench for building Claude Code subagents. You import existing `.md` agent files, edit them with AI assistance or directly, organize them into groups, and export them back to `.md` when you are done.

---

## Importing an agent

Click **⇪ Import .md** in the Library panel's action bar. A dialog opens.

You can either pick a `.md` file from disk or paste the file content directly into the text area. Both paths populate the same text area — once the content is loaded, you choose an import mode before submitting.

### Import modes

**Structural (recommended, default)** — the AI reads the full file content and reorganizes it into the canonical section structure (Role → Behavior → Guardrails → Output, plus any optional sections the file warrants). Use this for files from other tools, hand-edited files with nonstandard headings, or any file whose structure you want normalized.

**Strict (verbatim)** — the AI sees only heading text, never the body content. It classifies each existing heading into a canonical section key without touching the words. Use this when your file is already structured correctly and you want headings labeled without any rewriting.

Both modes share the same deterministic frontmatter parse. `name`, `description`, `model`, `tools`, and all other frontmatter fields are extracted directly from the YAML header in both modes — the AI never handles frontmatter.

### What happens after you click Import

- If the agent `name` in the file matches one already in the platform, the file is imported as an update. The existing agent's sections and config are replaced; its edit history is preserved.
- If the name is new, a fresh agent is created.
- If the file is byte-for-byte identical to the last import of that agent, the import is skipped and you see "Already up to date."
- In Structural mode, the response may include coverage warnings if the AI dropped or significantly rewrote content from a source block. These are notices, not errors — the import still completes and you can review the result in the Visualization pane.

### Error cases

| Error shown | What it means |
|---|---|
| "The .md file has no name in its frontmatter." | Add a `name:` line inside the `---` block. |
| "Could not parse the .md file. Check its frontmatter format." | Malformed YAML (duplicate keys, tab indentation, unsupported nested objects). |
| "The AI import step failed. Try again." | The Anthropic API returned an error. Your pasted content is preserved — retry. |

---

## Editing an agent with AI chat

Select an agent in the Library panel to open it. Type an instruction in the **AI Chat** panel at the bottom of the center column and press Enter (or click Send).

The mediator reads the full current content of every section, decides which ones the instruction actually requires changing, and rewrites only those. Changes appear immediately in the Visualization pane.

**Examples of instructions that work:**

- "Tighten the guardrails — make them more specific and fewer words."
- "Add a Sources section listing the files this agent typically reads."
- "Rename the agent to code-reviewer and update the Role section to match."
- "The Output section is missing a table format — add one."

**What the mediator will and will not do:**

- It may rewrite any number of sections a single instruction genuinely requires. An instruction that touches Role and Guardrails simultaneously is fine.
- It will not invent sections that are not there, and it will not silently drop content from sections the instruction did not ask to change.
- It has no tools and cannot read files, call other agents, or reach anything outside the current agent's content.

**Cancellation:** If a chat request is in flight and you want to stop it, close the browser tab or navigate away. Nothing is written until the mediator completes and the server applies its response, so a cancelled request leaves the agent unchanged.

**Interaction lock:** While a chat request is in progress, the "Edit" button on each section is disabled. While you have an unsaved manual edit open, the Chat input is disabled. The two editing paths cannot overlap.

---

## Editing a section manually (raw edit)

In the Visualization pane, each section is shown as a collapsible block. Click the header to expand or collapse it. With a section expanded, click the **Edit** button on the right of the header.

The section body opens as a monospace text area with its raw markdown content. Edit freely — the heading is not shown in the editor, only the body below it.

Click **Save** to write the change. The server checks that no other edit arrived since you opened the editor (optimistic concurrency). If it did, you will see a conflict notice with the current version number — reload and retry.

Click **Cancel** to discard your changes and close the editor without saving.

The Edit button is grayed out while a chat request is in progress.

---

## Groups

Groups are labels, not folders. An agent can belong to multiple groups at once. Adding an agent to a group does not move it — it just appears under that group heading in the Library panel. Removing a group membership does not delete the agent.

### Adding an agent to a group

Drag any agent from the Library list onto a group header. A drag overlay shows the agent name while dragging; release over the group to add the membership.

### Creating a group

Click **＋ New group** at the bottom of the Library action bar. Type a name and press Enter or click Create group. Group names must be unique.

### Removing an agent from a group

Each agent row inside a group section shows a small **×** button. Click it to remove that membership. The agent stays in "All agents" and "Ungrouped" (if it has no other memberships).

### Deleting a group

Each group header has a delete control. Deleting a group removes the group and all its memberships. The agents themselves are not deleted.

### "All agents" and "Ungrouped"

These are always-present read-only views below the real groups. "All agents" lists every agent in the platform. "Ungrouped" lists only agents with no group memberships. Both can be collapsed by clicking their headers.

---

## Exporting an agent

The **Raw** panel on the right shows the current state of the selected agent as it would be written to a `.md` file. This is a live preview — it updates after every save, whether from the AI chat or a manual edit.

Frontmatter lines are dimmed; top-level section headings are highlighted. The filename band at the top shows `<name>.md`.

Click **⇩ Download** at the top of the Raw panel to save `<name>.md` directly, then move it into your `.claude/agents/` directory. Alternatively, select all text in the panel and copy it if you just want the content.

The export format is deterministic and semantically faithful: frontmatter keys are written in their original insertion order, YAML values are normalized (no type coercion, no added quotes beyond what is necessary for round-trip safety), and section bodies are written byte-for-byte as stored. Group memberships are platform metadata and are not written into the exported file.

---

## Settings: dry-run mode and the activity log

Click **⚙ Settings** in the top bar to open the Settings page.

### Live LLM calls toggle

The **Live LLM calls** toggle controls whether AI calls (import, chat) are actually sent to the Anthropic API.

- **On (default):** normal behavior — AI calls are made, billed, and logged.
- **Off (dry-run mode):** every AI call is recorded and blocked before any network request is made. No response is produced, no money is spent, and no changes are written to any agent.

When the toggle is off and you try to import a file or send a chat instruction, you will see a notice in the dialog or chat panel. The notice includes a link to the matching entry in the activity log. Turn the toggle back on and try again to make a real call.

The toggle takes effect immediately — the next AI call observes the new value without a server restart.

### Activity log

The activity log lists every AI call attempt, whether live or dry-run. Each row shows the timestamp, kind (Import/Chat), agent name, status (OK / Dry-run / Error), model, and duration.

**Status meanings:**
- **OK** — the call succeeded and the response was applied.
- **Dry-run** — the call was blocked because "Live LLM calls" was off. No response was produced.
- **Error** — the call reached the provider but failed (e.g. network error, auth failure, truncation).

Click any row to expand it and see the full request payload (system prompt + messages) and, for live successful calls, the response payload. Dry-run rows always show a null response payload — that is correct by design.

You can filter the log by **All / Dry-run / Live** using the buttons above the table.

**Deep links:** the notices shown in `ImportDialog` and `ChatPanel` after a dry-run block include a "View log entry →" link that opens `/settings?log=<id>`, which scrolls directly to and highlights that row in the activity log.
