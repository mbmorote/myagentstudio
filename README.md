# MyAgent — Agent Workbench

A local-first workbench for building and managing AI agents. An **agent-aware AI chat** sits next to an **always-visible structured view** of the agent it is editing, so you never edit blind. The platform targets Claude Code's `.claude/agents/*.md` subagent format and runs entirely on your machine using your own Anthropic API key.

## Quick start

```bash
npm install
```

Create a `.env.local` file in the project root and add your key:

```
ANTHROPIC_API_KEY=sk-ant-...

# Auth — required (see "Auth setup" below)
JWT_SECRET=<at-least-32-random-characters>

# Only needed for the one-time bootstrap command (see below)
BOOTSTRAP_USER_EMAIL=you@example.com
BOOTSTRAP_USER_PASSWORD=<your-admin-password>
```

Optionally override the default model (defaults to `claude-opus-4-8`):

```
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Auth setup (first run / new database)

The app requires a login session. On a fresh database, run the migration and bootstrap the admin account:

```bash
# 1. Run the migration + seed (also runs automatically on every npm run dev)
npm run db:seed

# 2. Set the admin's email and password (run once; re-run with --force to change credentials)
BOOTSTRAP_USER_EMAIL=you@example.com BOOTSTRAP_USER_PASSWORD=yourpassword npm run auth:bootstrap
```

After that, go to [http://localhost:3000/login](http://localhost:3000/login), sign in as the admin, and generate invite codes from **System Settings** to let others sign up.

> **HTTPS required for deployed instances.** The session cookie is `secure: true` in production, which means it is only sent over HTTPS. An `http://` deployment will silently drop the cookie and every request will appear unauthenticated.

## Settings

Two settings are configurable from **System Settings** (`/settings`, admin only):

| Setting | Default | Notes |
|---|---|---|
| `maxUsers` | `5` | Maximum number of accounts (including the admin). Lowering it below the current count blocks new signups but does not remove anyone. |
| `maxLlmCallsPerUserPerHour` | `15` | Per-user hourly LLM call cap (rolling 60-minute window). The admin is always exempt. When a user hits the cap they are offered a dry-run preview instead of a hard block. |

## The workbench layout

The UI is a four-pane IDE layout:

- **Library** (left, foldable) — your agent list, organized into collapsible groups. Drag an agent onto a group to add it as a member. Create groups and import files from the action bar at the bottom.
- **Custom Visualization** (center top) — the currently selected agent split into its named sections (Role, Behavior, Guardrails, Output, and any optional or custom sections). Each section can be expanded, collapsed, or edited in place.
- **AI Chat** (center bottom) — type an instruction and the mediator rewrites whichever sections the instruction requires. Changes appear immediately in the Visualization pane above.
- **Raw** (right, foldable) — a live read-only export preview of the agent as it would be written to a `.md` file. Updates after every save.

All four panels resize via drag gutters. Library and Raw fold to rails to reclaim space.

## Documentation

- **[User guide](docs/user-guide.md)** — how to import, edit, organize, and export agents.
- **[Concept](architecture/Concept.md)** — the what and why: problem statement, design decisions, agent schema.
- **[Technical design](architecture/TechDesign.md)** — the how: data model, import pipeline, Blueprint catalog, Rules Index.
