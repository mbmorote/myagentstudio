# MyAgent — Roadmap

A plain-language view of where the workbench stands: what's working today, what's coming
next, and what's planned further out. This page is a curated summary, refreshed
deliberately when a user-visible capability changes — it doesn't track day-to-day task
detail. For the full, current technical backlog, see `plans/roadmap.md` in the repository.

---

## Available today

| Capability | What it does |
|---|---|
| **Import — Structural & Strict** | Bring in an existing `.md` agent file. Structural mode reorganizes it into the canonical section layout; Strict mode labels existing headings without rewriting content. |
| **AI chat editing** | Describe a change in plain language; review a proposed edit side-by-side with the current version, then apply or discard it — nothing is written automatically. |
| **Structured view & manual editing** | Every agent's sections (Role, Behavior, Guardrails, Output, and any optional or custom sections) are always visible and directly editable. |
| **Library** | Every imported or created agent, listed and searchable in one place. |
| **Export** | A live, always-accurate preview of the exported `.md` file, with one-click download. |
| **Multi-user accounts & Google sign-in** | Invite-gated accounts, sign in by password or Google, admin/user roles. |
| **Settings & cost controls** | An admin activity log of every AI call, a dry-run mode that blocks real API spend, and a per-user hourly call cap. |

## Coming next

| Item | What it is |
|---|---|
| **Group organization** | Filing agents into groups (an agent can belong to several at once) and switching between a flat and grouped Library view. The underlying data model and API are already built; only the on-screen controls are being re-enabled. |
| **A second AI provider** | An additional, non-Anthropic model option behind the same interface — so the platform isn't locked to one vendor. |
| **Company branding on the platform** | The workbench's own visual identity, placed in the footer and sign-in pages. |
| **First-login guided tour** | A short, skippable in-app walkthrough of the four panels for anyone signing in for the first time. |
| **Database backup & restore** | A documented, repeatable way to snapshot and recover the live database. |
| **Public deployment** | Making the workbench reachable outside the local network for the first time. |

## Planned

| Item | What it is |
|---|---|
| **Automated component/UI tests** | Test coverage for the on-screen interface, on top of the existing coverage for import, editing, and account logic. |
| **AI chat history that survives a reload** | Conversations currently live only in the browser tab for the current session. |
| **A Skill module** | A second library entity alongside Agent, for Claude's `SKILL.md` files — its own import/export and structured view. |
| **Export to other platforms** | Translating an agent to formats beyond Claude's, starting with Copilot. |
| **Sharing & forking agents** | Letting one user hand an agent to another to fork their own copy from it. |
| **Organizations & teams** | Agents owned jointly by a group of people, not just by one account. |
