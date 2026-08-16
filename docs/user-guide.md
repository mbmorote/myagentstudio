# MyAgent User Guide

MyAgent is a local workbench for building Claude Code subagents. You import existing `.md` agent files, edit them with AI assistance or directly, organize them into groups, and export them back to `.md` when you are done.

---

## Signing in

MyAgent requires an account. Go to `/login` and enter your email and password.

If you do not have an account yet, ask the admin (the person who runs this deployment) for an invite code. With that code in hand, go to `/signup` and create your account. Every new account starts private by default — the first time you land on the workbench after signing up, a one-time popup offers to also share your activity-log content with the admin; dismissing it (or choosing "Keep private") leaves the private default in place, and you can change your mind anytime from your Account page. See the **Activity log** section below for what this choice means.

When your session expires (default 7 days, may be shorter or longer on this deployment), you will be redirected to `/login` with your intended destination preserved — signing back in returns you to the page you were on.

### Signing in with Google

If this deployment has Google sign-in enabled, a **Continue with Google** button appears on `/login` and `/signup`. It is a second way to prove who you are, not a second way to get in — **an invite code is still required** the first time you sign in with Google, exactly as with a password account. On `/signup`, the button stays disabled until you've entered a code; the activity-log privacy choice happens later, in the one-time popup described above, not on the signup page itself.

If you already have a password account and later sign in with Google using the same, Google-verified email address, MyAgent links the two automatically — you land in your existing account, no second account is created, and no invite code is spent. Your original password keeps working afterward.

A few things worth knowing:

- Google is told nothing about MyAgent beyond the standard sign-in request — no access to your contacts, Drive, or profile picture, and no ongoing access after you sign in.
- MyAgent is told your Google account's email address and nothing else.
- **Revoking MyAgent's access from your Google account settings does not end an active MyAgent session.** The two are independent — if you want to sign out of MyAgent, use the sign-out button here.
- An account created via Google has no password. If you'd rather sign in with a password later, that isn't available yet — see the admin if you need this.

### Admin vs. user

There are two roles:

- **Admin** — the account created during initial setup. Has access to **System Settings** (`/settings`): the Live LLM calls toggle, the activity log, invite-code generation, and usage limits. The admin is exempt from the per-user hourly LLM call cap.
- **User** — any account created via invite code. Has access to all workbench features and to their own **Account** page (`/account`). Cannot see System Settings.

Both roles have a **Topbar** link to **Account** (your personal settings) and, for admins only, **⚙ System Settings**.

---

## Inviting someone

Only the admin can generate invite codes. Open **⚙ System Settings** in the Topbar and scroll to the **Invite codes** section. Click **Generate** to create a new code (you can add an optional label like "for Alice"). Copy the code and send it to the person directly — codes are displayed plaintext so you can re-read them if needed.

A code can only be redeemed once. Once redeemed or once the `maxUsers` cap is reached, the code is inert. You can revoke an unredeemed code from the same panel.

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

**Chat proposes — it never writes directly.** ✦ Prometheus (the chat agent) reads the agent's current description, sections, and config, and replies with a natural-language message plus a **proposal**: a card listing exactly what it wants to change. Nothing is written to the agent until you click **Apply** on that card.

**Examples of instructions that work:**

- "Tighten the guardrails — make them more specific and fewer words."
- "Add a Sources section listing the files this agent typically reads."
- "Switch the model to opus and update the description to match."
- "The Output section is missing a table format — add one."
- "What do you think of my tools list?" — a pure question produces just a reply, no proposal card, and does not lock editing.

**What Prometheus can and cannot propose:**

- **Editable via chat:** any number of sections, the description, and config values (model, tools, and every other config key) in one turn.
- **Never editable via chat:** the agent's **name** — this is enforced by the server at Apply time, not just by a prompt instruction, so it can't be bypassed even by an unusual request.
- It will not invent sections that are not there (adding or removing a section is not possible via chat today), and it will not silently drop content from parts the instruction did not ask to change.
- It has no tools and cannot read files, call other agents, or reach anything outside the current agent's content.
- Each proposed value is a **complete replacement**, never a partial diff — a config change updates only the keys it names, everything else survives untouched.

**Reviewing and applying a proposal:** the card is collapsed by default (one line per changed part when expanded — description, each section, each config key), with a "show current" toggle per row to compare against what's there today before you commit. Click **Apply** to write every changed part in the proposal at once (there's no way to apply only part of it), or **Discard** to drop it. Sending a new chat message before applying or discarding also discards the pending proposal — only the latest turn's proposal is ever actionable. **Apply is last-write-wins**: if you've made no other changes since the proposal was returned (guaranteed by the lock below), there's nothing to conflict with.

**Follow-ups remember the conversation:** Prometheus sees your recent back-and-forth in the same session, not just the instruction you just sent — so "make that shorter" or "no, keep the tone but trim it" refers correctly to what you just discussed. This is dialogue only (your instructions and Prometheus's replies); it never resends a past proposal's actual content — that always comes from the agent's current, real state instead. How many prior messages are kept is admin-configurable (**Chat history turns** in System Settings, default 10). Client-only notices (dry-run/error/cancelled messages) are never included. This history exists only in your browser tab for the current session — it does not persist across a reload.

**Cancellation:** click the ✕ button, or close the tab. Nothing is ever written by the chat call itself — cancelling just stops waiting for a reply that would have produced a proposal, same as any other interrupted request.

**Interaction lock:** while a chat request is in flight, or while a proposal is pending review, every manual editor is disabled — section raw-edit, the name, and every config control (model/effort, tools, lists, JSON blocks). While you have an unsaved manual edit open, the Chat input is disabled. The three states (chat in flight / proposal pending / manual edit open) never overlap. A pending proposal survives a page reload (it's kept in your browser until you apply or discard it) and stays in sync across multiple tabs open on the same agent.

---

## Editing a section manually (raw edit)

In the Visualization pane, each section is shown as a collapsible block. Click the header to expand or collapse it. With a section expanded, click the **Edit** button on the right of the header.

The section body opens as a monospace text area with its raw markdown content. Edit freely — the heading is not shown in the editor, only the body below it.

Click **Save** to write the change. The server checks that no other edit arrived since you opened the editor (optimistic concurrency). If it did, you will see a conflict notice with the current version number — reload and retry.

Click **Cancel** to discard your changes and close the editor without saving.

The Edit button is grayed out while a chat request is in progress, or while a chat proposal is pending review (see above).

---

## Groups (coming soon)

The Library is designed to let you file an agent into any number of groups at once — a
group is a label, not a folder, so one agent can appear under several group headings
without being duplicated. This is built underneath but not yet switched on in this
release: the Library shows a single flat list of every agent for now, with no group
controls. This will be enabled in a coming update.

---

## Exporting an agent

The **Raw** panel on the right shows the current state of the selected agent as it would be written to a `.md` file. This is a live preview — it updates after every save, whether from the AI chat or a manual edit.

Frontmatter lines are dimmed; top-level section headings are highlighted. The filename band at the top shows `<name>.md`.

Click **⇩ Download** at the top of the Raw panel to save `<name>.md` directly, then move it into your `.claude/agents/` directory. Alternatively, select all text in the panel and copy it if you just want the content.

The export format is deterministic and semantically faithful: frontmatter keys are written in their original insertion order, YAML values are normalized (no type coercion, no added quotes beyond what is necessary for round-trip safety), and section bodies are written byte-for-byte as stored. Group memberships are platform metadata and are not written into the exported file.

---

## System Settings: dry-run mode and the activity log

System Settings is accessible only to the admin. Click **⚙ System Settings** in the Topbar to open it.

### Live LLM calls toggle

The **Live LLM calls** toggle controls whether AI calls (import, chat) are actually sent to the Anthropic API.

- **On (default):** normal behavior — AI calls are made, billed, and logged.
- **Off (dry-run mode):** every AI call is recorded and blocked before any network request is made. No response is produced, no money is spent, and no changes are written to any agent.

When the toggle is off and you try to import a file or send a chat instruction, you will see a notice in the dialog or chat panel. The notice includes a link to the matching entry in the activity log. Turn the toggle back on and try again to make a real call.

The toggle takes effect immediately — the next AI call observes the new value without a server restart.

### Per-user hourly LLM cap

Each non-admin user may make up to **15 AI calls per rolling 60 minutes** (configurable as `maxLlmCallsPerUserPerHour` in System Settings). The admin is always exempt.

When you hit the cap, the import dialog or chat panel shows two options instead of an error:

- **Preview without sending** — re-sends the exact same request in dry-run mode, so you can see what the AI *would* have done without spending a call. The result looks exactly like the normal dry-run output.
- **Wait** — dismisses the message and shows how many seconds until your oldest in-window call ages out and a slot frees up.

Nothing was sent and nothing was charged either way.

### Chat history turns

Controls how much of the recent chat conversation (configurable as `chatHistoryTurns` in System Settings, default **10** messages — user and assistant combined) Prometheus is shown on each new instruction, so follow-ups stay coherent. Setting it to **0** disables memory entirely — every instruction is sent standalone, as if it were the first message. This has no effect on the agent content itself (sections/config), which is always sent fresh regardless of this setting.

### Activity log

The activity log (admin only) lists every AI call attempt, whether live or dry-run. Each row shows the timestamp, kind (Import/Chat), agent name, status (OK / Dry-run / Error), model, and duration.

**Status meanings:**
- **OK** — the call succeeded and the response was applied.
- **Dry-run** — the call was blocked because "Live LLM calls" was off. No response was produced.
- **Error** — the call reached the provider but failed (e.g. network error, auth failure, truncation).

Click any row to expand it and see the full request payload (system prompt + messages) and, for live successful calls, the response payload. Dry-run rows always show a null response payload — that is correct by design.

#### What the admin can and cannot see

This deployment uses a single shared API key paid for by the admin. To audit that key's usage, the admin can always see every call's **metadata** — who made it, which agent, when, how many tokens, whether it succeeded — for all users. This is the minimum needed to answer "who is spending what."

What the admin **cannot** see by default is the **content** of your instructions and the AI's replies. That is private unless you actively choose to share it.

**Sharing is opt-in and chosen by you.** During signup you are asked to make an explicit choice: share your prompt and response content with the admin, or keep it private. There is no pre-selected answer and no way to submit the form without choosing. The default is **private**.

**This choice is not retroactive in either direction.** If you start private and later turn sharing on (at `/account`), the admin sees your prompt text from that point forward — not from before. If you turn sharing back off, the admin loses access to future calls — not to the ones you already shared. Each log row permanently records the consent you had at the moment the call was made, so neither direction can surprise you.

A log row whose content is private shows a "content hidden" marker in the activity log. The admin sees that the call happened, what agent it was for, and what it cost — but not what was said.

You can filter the log by **All / Dry-run / Live** using the buttons above the table.

**Deep links:** the notices shown in `ImportDialog` and `ChatPanel` after a dry-run block include a "View log entry →" link that opens `/settings?log=<id>`, which scrolls directly to and highlights that row in the activity log.

---

## Your Account page

Click **Account** in the Topbar (always visible, for both admins and users) to open your personal settings at `/account`.

**Log sharing with the admin.** The consent toggle mirrors the choice you made at signup: on = share your prompt and response content; off = private. You can flip it at any time. **The change is not retroactive in either direction** — past rows keep the consent value they were written with, and changing your preference only affects future calls.

Your signed-in email, role, and how you sign in (password, or Google with the linked email) are shown as read-only. There is currently no self-service way to link or unlink a Google account from this page.

**API tokens (MCP access).** The same Account page has a panel for generating Personal Access Tokens — the credential a console MCP client (Claude Code and similar tools) uses to read and import your agents from outside the browser. See the next section for how to use one.

---

## Connecting a console MCP client

MyAgent runs an MCP (Model Context Protocol) server so a **console/CLI client** — Claude Code, or an equivalent tool that accepts a custom HTTP header — can list, read, export, and import your own agents from your terminal. **This is for console clients only.** Claude Desktop's GUI connector is not supported (it requires a different authentication flow this server doesn't implement).

**1. Generate a token.** Go to **Account** → **API tokens (MCP access)** → **New token**. Give it a name (e.g. "laptop Claude Code") and pick a scope:

- **read** — list, read, and export your agents. Cannot write anything. This is the safer default.
- **write** — everything read can, plus `import_agent` (see below).

The token's full value is shown **exactly once**, right after you create it. Copy it immediately — MyAgent never stores it in a form that can be shown to you again, not even to an admin. If you lose it, revoke it and generate a new one.

**2. Add the server to your client.** For Claude Code:

```
claude mcp add --transport http myagent https://<your-myagent-host>/api/mcp \
  --header "Authorization: Bearer <the token you copied>"
```

**3. Use it.** Once connected, four tools are available:

| Tool | What it does |
|---|---|
| `list_agents` | Lists your agents (id, name, description). |
| `get_agent` | Returns one agent's full structured content — sections, config, and any validation flags. |
| `export_agent` | Returns the same deterministic markdown the web UI's Export button produces. |
| `import_agent` | Imports a markdown document — creates a new agent, or updates an existing one if the name matches. **Requires a write-scoped token.** |

A natural round trip: `export_agent` an agent → edit the markdown in your terminal (by hand, or by asking the console client's own model to revise it) → `import_agent` it back. That reuses the exact same import pipeline the web UI's Import dialog uses, including the same safety net — a snapshot is taken before and after an update, so a bad import is recoverable the same way a bad web import is.

**What `import_agent` cannot do:** there is no tool for editing a single section or config value directly — the only write is "import this whole document." A submitted document **replaces** the agent's sections to match what's in the file; a section that existed before but is missing from your document gets removed (its history is kept, but it's gone from the live agent). If you only want to tweak one section, export first, edit that one section in the file, and import the whole file back — don't hand-write a partial document.

**Why writes might be refused.** Three independent switches all have to be "on" for `import_agent` to work: your token needs `write` scope, the server admin needs to have turned on MCP writes in Settings (off by default), and you need to be under your hourly AI-call limit (the same limit that applies to everything you do in the browser). If any of these is off, you get a clear, named error explaining which one — never a silent failure.

**If your token leaks:** revoke it immediately from the Account page (one click, takes effect instantly). Treat an MCP token like a password to your agent library — anyone holding it can do whatever that token's scope allows, with no browser session or second factor in the way.

---

## Manual admin operations

The following require direct database access (no UI — run these as SQL against `myagent.db`):

| Action | SQL |
|---|---|
| Promote a user to admin | `UPDATE user SET role='admin' WHERE email='them@example.com';` |
| Delete a user | First delete their agents/groups (they become unreachable orphans otherwise): `DELETE FROM agent WHERE owner_id='<id>';` `DELETE FROM "group" WHERE owner_id='<id>';` then `DELETE FROM user WHERE id='<id>';` |
| Transfer an agent to another user | `UPDATE agent SET owner_id='<new-owner-id>' WHERE id='<agent-id>';` |
