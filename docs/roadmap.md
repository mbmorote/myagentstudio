# MyAgentStudio — Roadmap

A plain-language view of where the workbench stands. This page is a curated summary of **capabilities** — things you can use or that materially change what the platform offers.

**Internal tasks** (deploying, test coverage, QA, security hardening, refactors) stay in `plans/roadmap.md`. This page focuses on *what the product does*, not *how it gets built*.

---

## How to Read This Page

Each row shows:
- **Capability** — A specific feature or improvement you can use
- **Category** — `Feature` (user-facing), `Resource` (infrastructure), `Fix` (correction/risk reduction)
- **Importance** — `Major` (materially changes what the platform does) or `Minor` (real improvement, not essential)

**No priority ordering within a tier** — items in the same tier (Today / Coming next / Planned) are not ranked. Only the tier itself matters: Today (shipped) → Coming next (soon) → Planned (decided, timing TBD).

---

## Available Today

Live and ready to use.

| Capability | Category | Importance | What it does |
|---|---|---|---|
| **Import — Structural & Strict** | Feature | Major | Bring in an existing `.md` agent file. Structural mode reorganizes it into the canonical section layout; Strict mode labels existing headings without rewriting content. |
| **AI chat editing** | Feature | Major | Describe a change in plain language; review a proposed edit side-by-side with the current version, then apply or discard it — nothing is written automatically. |
| **Structured view & manual editing** | Feature | Major | Every agent's sections (Role, Behavior, Guardrails, Output, and any optional or custom sections) are always visible and directly editable. |
| **Library** | Feature | Major | Every imported or created agent, listed and searchable in one place. |
| **Export** | Feature | Major | A live, always-accurate preview of the exported `.md` file, with one-click download. |
| **Multi-user accounts & Google sign-in** | Feature | Major | Invite-gated accounts, sign in by password or Google, admin/user roles. |
| **Settings & cost controls** | Resource | Major | An admin activity log of every AI call, a dry-run mode that blocks real API spend, and a per-user hourly call cap. |
| **Pre-login landing page** | Feature | Major | A public explainer page (`/welcome`) for visitors without an account — how it works, feature highlights, and a "Request access" form for anyone without an invite code. |
| **Company branding on the platform** | Feature | Minor | The workbench's own visual identity, in the footer of the main app and the landing page. |
| **First-login guided tour** | Feature | Minor | A short, skippable in-app walkthrough of the four panels for anyone signing in for the first time. |
| **Beta & sensitive-data notice** | Fix | Minor | A one-time popup after signup, plus a persistent reminder near the chat and import inputs, that this is an early, unencrypted-at-rest beta — don't paste passwords, API keys, or other sensitive data. |
| **A second AI provider** | Resource | Major | An additional, non-Anthropic model option behind the same interface — so the platform isn't locked to one vendor. Live-verified against a real NVIDIA NIM account. |

## Coming Next

Starting in the next release — decided and ready to build.

| Item | Category | Importance | What it is |
|---|---|---|---|
| **Console MCP access** | Feature | Major | Lets a console/CLI AI tool (like Claude Code) list, read, pull, and — with permission — push your own agents from the terminal, authenticated by a personal access token you generate yourself. Built; pending final verification. |
| **AI chat history that survives a reload** | Feature | Major | Conversations currently live only in the browser tab for the current session. |
| **Export to other platforms** | Feature | Major | Translating an agent to formats beyond Claude's, starting with Copilot. |
| **Account email delivery** | Resource | Minor | Automated emails for account actions — an admin-generated invite code, and account-related notifications — instead of being sent or handled by hand. |
| **Sharing agents** | Feature | Minor | Letting one user hand an agent to another to fork their own copy from it. |

## Planned

Decided and wanted — timing not yet committed.

| Item | Category | Importance | What it is |
|---|---|---|---|
| **A Skill module** | Feature | Major | A second library entity alongside Agent, for Claude's `SKILL.md` files — its own import/export and structured view. |
| **Group organization** | Feature | Minor | Filing agents into groups (an agent can belong to several at once) and switching between a flat and grouped Library view. The underlying data model and API already exist; a review is needed before the on-screen controls come back, since a few real gaps (like a limit on how many groups you can create) turned up on a closer look. |

---

*Full technical backlog (including internal-only items): [`plans/roadmap.md`](../plans/roadmap.md)*
