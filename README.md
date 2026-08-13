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

# Session lifetime — optional, defaults to 7 days (604800 seconds). Bounds: 60–7776000
# seconds (60s–90d). An invalid value refuses to start the process rather than silently
# falling back to the default.
SESSION_TTL_SECONDS=604800

# Google sign-in — optional. All three must be set together, or none at all; a partial
# set refuses to start. See "Google OAuth setup" below.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
OAUTH_REDIRECT_BASE_URL=http://localhost:3000
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

### Session lifetime

`SESSION_TTL_SECONDS` changes the lifetime baked into **newly issued** tokens only — it is not revocation. A JWT's expiry is set at signing time, so shortening the TTL does nothing to anyone already signed in; they keep their original lifetime until it expires on its own. If a session must be killed right now, the only immediate options are deleting or altering that user's row in `myagent.db` (`getSession()` re-reads the DB on every request), or rotating `JWT_SECRET`, which invalidates every session at once.

### Google OAuth setup (optional)

MyAgent can offer "Continue with Google" alongside password sign-in. It is entirely optional — leave the three `GOOGLE_*`/`OAUTH_REDIRECT_BASE_URL` variables unset and the button never renders. Signing in with Google still requires a valid invite code on first use; it is a second way to prove who you are, not a second way to get admitted.

To enable it:

1. Create an OAuth 2.0 client in the [Google Cloud console](https://console.cloud.google.com/apis/credentials) (Web application type).
2. Register this exact redirect URI, built from `OAUTH_REDIRECT_BASE_URL` (no trailing slash, no path):
   ```
   <OAUTH_REDIRECT_BASE_URL>/api/auth/oauth/google/callback
   ```
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `OAUTH_REDIRECT_BASE_URL` in `.env.local`. All three are required together — setting only some of them refuses to start the process rather than half-working.
4. In production, `OAUTH_REDIRECT_BASE_URL` must be `https://` (Google rejects non-HTTPS redirect URIs except for `localhost`).
5. For a closed beta, keep the Google Cloud consent screen in **Testing** mode and list your invite-gated users as test users — this restricts who can even reach the consent screen, on top of the invite-code gate on the MyAgent side.

Google is told nothing beyond the standard OpenID Connect `openid email profile` scopes — no ongoing access, no refresh token is requested, and nothing Google issues is ever stored.

## Settings

Two settings are configurable from **System Settings** (`/settings`, admin only):

| Setting | Default | Notes |
|---|---|---|
| `maxUsers` | `5` | Maximum number of accounts (including the admin). Lowering it below the current count blocks new signups but does not remove anyone. |
| `maxLlmCallsPerUserPerHour` | `15` | Per-user hourly LLM call cap (rolling 60-minute window). The admin is always exempt. When a user hits the cap they are offered a dry-run preview instead of a hard block. |

## The workbench layout

The UI is a four-pane IDE layout:

- **Library** (left, foldable) — your agent list. Import files from the action bar at the bottom. (Grouping agents into collapsible groups is built underneath but not yet enabled in this release.)
- **Custom Visualization** (center top) — the currently selected agent split into its named sections (Role, Behavior, Guardrails, Output, and any optional or custom sections). Each section can be expanded, collapsed, or edited in place.
- **AI Chat** (center bottom) — type an instruction and ✦ Prometheus proposes a change to the description, sections, and/or config. Review the proposal card and click Apply (or Discard) — nothing lands until you do.
- **Raw** (right, foldable) — a live read-only export preview of the agent as it would be written to a `.md` file. Updates after every save.

All four panels resize via drag gutters. Library and Raw fold to rails to reclaim space.

## Documentation

- **[User guide](docs/user-guide.md)** — how to import, edit, organize, and export agents.
- **[Project explanation](docs/project-explanation.md)** — the product story: the problem, who it's for, how it works, how it was built.
- **[System About](docs/system-about.md)** — the engineering reference: stack, architecture, data model, design principles.
- **[Roadmap](docs/roadmap.md)** — what's available today, coming next, and planned.
