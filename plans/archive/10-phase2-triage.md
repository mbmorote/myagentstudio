# Plan 10 — Phase 2 Triage (Gate 1 material)

> **Phase 3 executed 2026-08-12 — see §7 at the end of this file for the full
> completion record.** Sequencing amendment (also 2026-08-12, user request): a
> **general code-quality review** (correctness/security/efficiency — never run
> as part of this plan's Tracks A/B/C, confirmed by a background check) is now
> inserted **before Phase 4** (doc writing) starts, so the new docs describe a
> code base that's been checked for bugs, not just organized/documented/tested.

Produced from Phase 1's three findings lists. Nothing here is applied yet — this is the
**Gate 1** review artifact: the fix-now/defer split for Track B/C, and the Rules
Index + Deferred Decisions exit-triage mapping (§0.4 of Plan 10). Sign off here before
Phase 3 (code/test fixes) or Phase 4 (doc writing) starts.

---

## 1. Track B (code organization) — fix-now / defer split

| # | Finding | Split | Notes |
|---|---|---|---|
| 1 | `architecture/audits/` is gitignored; Phase 5 moves files there | **✅ RESOLVED, no action — 2026-08-12** | **Confirmed intentional**: `architecture/audits/` is meant to be local-only historic material, deliberately never in git. Phase 5 proceeds unchanged — files moved there stay untracked by design, not by oversight. Only open item: the 4 untracked files already sitting there (`instructions maybe .txt`, `0708 Copilot Roadmap.md`, `Evaluation-Review-2026-08-07.md`, `Commercial-Evaluation-2026-08-07.md`) — since "track them" is off the table now, the remaining choice is just fold-any-still-useful-content-into-docs vs. leave-as-is. |
| 2 | `daedalus-new.md` — tracked, undocumented, unwired draft | **✅ RESOLVED — 2026-08-12** | Confirmed accidental (own commit message says "not wired into `scripts/build-prompts.ts`"), stale pre-rename naming (`RULES`/`SOURCES` vs. live `GUARDRAILS`/`INPUT`). Deleted, staged (`git rm`), not yet committed. Also confirmed `ImportTestAgent/` is already untracked + gitignored (`.gitignore:37`) from an earlier commit today (`30a9c29`) — no action needed there. |
| 3 | Root `CLAUDE.md` "01–06" stale plan range | **✅ RESOLVED — 2026-08-12, no separate action.** | Trivial, automatically swept up by Phase 5's full root `CLAUDE.md` rewrite. Same underlying issue Track A flagged. |
| 4 | Root `CLAUDE.md` omits `lib/auth/`, `lib/db/`, `lib/blueprint/` | **✅ RESOLVED — 2026-08-12, sequenced into Phase 5** | Decided by real size/cost comparison, not just convention: `lib/auth/` (12 files, ~25 Rules Index rows) and `lib/db/` (12 files, schema+6 migrations+6 repositories) get **their own new `CLAUDE.md` files**, matching `lib/ai/`'s precedent — merging them into root would blow it up to 800-1000+ lines that auto-load into *every* session regardless of relevance. `lib/blueprint/` (only 4 files, one real gotcha — see #6 below) **folds into root's map instead**, no separate file. This is the single biggest gap for `system-about.md`. |
| 5 | `AgentDTO.validation` computed, never read (**A2**) | **✅ Decision resolved: wire it up (not drop). ⏸ Implementation deferred out of this Phase 3 batch — 2026-08-12.** | Delivers on Concept.md's original "review feature" pitch (descriptionMissing / unknownConfigKeys / outdatedOrUnknownValues flags). Needs a UI design discussion before building — scheduled as its own follow-up, not part of the straight-through Phase 3 pass. |
| 6 | `lib/blueprint/` has no `CLAUDE.md` | **✅ RESOLVED — 2026-08-12: no separate file, fold into root's map.** | Only 4 files — too thin to warrant its own doc. Capture its one real gotcha (CONFIG_DEFS still code-owned while SECTION_DEFS already migrated to the DB) as a short paragraph directly in root `CLAUDE.md`'s folder-map entry for `lib/blueprint/`, done in Phase 5 alongside the map rewrite. |
| 7 | `lib/ai/CLAUDE.md` file table missing `prometheus.test.ts` | **✅ RESOLVED — 2026-08-12, no separate action.** | Trivial, swept up automatically when `lib/ai/CLAUDE.md` is corrected during Phase 5. |
| 8 | `architecture/.claude/settings.local.json` — stale, references a deleted file | **✅ RESOLVED — 2026-08-12, deleted.** | Correction to the original finding: this was never git-tracked at all (matched by the user's *global* gitignore, `**/.claude/settings.local.json` — not this repo's `.gitignore`). Plain filesystem delete, no git operation needed. The now-empty `architecture/.claude/` folder was removed too. |
| 9 | Stale "chat mediator" naming in `lib/blueprint/prompt.ts` JSDoc | **✅ RESOLVED — 2026-08-12: fix-now, Phase 3.** | Rename to "Prometheus." Real code-comment edit, applied when Phase 3 runs (not yet applied). |
| 10 | Stale gitignored build artifacts in `lib/ai/prompts/generated/` | **✅ RESOLVED — 2026-08-12, deleted.** | Confirmed `chat-mediator.ts`, `import-instructions.ts`, `import-instructions-structural.ts` (Aug 5, pre-rename) unused — `build-prompts.ts`'s AGENTS list only produces `hermes.ts`/`daedalus.ts`/`prometheus.ts` (Aug 12). Plain filesystem delete, folder is gitignored. |

---

## 2. Track C (test structure) — fix-now / defer split

**Test-file organization — ✅ RESOLVED, 2026-08-12: keep colocated `__tests__/`, no migration
to a centralized `tests/` tree.** Current pattern is 100% consistent (confirmed by Track C:
no orphans, no misplacement) — moving to a centralized tree would touch every existing test
file's relative imports for zero functional gain, pure churn against a working pattern. Any
new tests added below follow the existing colocated convention.

| Finding | Split | Notes |
|---|---|---|
| `app/components/**` — zero test coverage (22 files) | **✅ RESOLVED — 2026-08-12: defer → TODO** (not FUTURE — user wants this prioritized sooner) | Component/UI tests (React Testing Library + `jsdom`), not unit or E2E — zero infrastructure exists today (current Vitest config is `node`-only, no `@testing-library/react`). Real scope: new tooling/config split + choosing which of the 22 components warrant it (`ChatPanel`, `ImportDialog`, `AgentView`, `SignupForm`/`ConsentPopup`, `WorkbenchShell` are the highest-value candidates). Consolidates with `P04g` in the Deferred Decisions table — one item, not two. |
**✅ Blanket policy set 2026-08-12: going forward, a missing-test finding defaults to
fix-now (include it) rather than being litigated item-by-item — unless it's genuinely its
own project (tooling/infra investment), which gets flagged separately like `app/components`
was.** Applying that closes out everything below except one flagged item:

| `lib/blueprint/` — zero tests (4 files) | **✅ Fix-now** | Small, well-bounded surface; validation rules are worth locking down before the docs describe them as tested/trustworthy. |
| `lib/auth/consentPopupFlag.ts` — untested | **✅ Fix-now** | High-value given it's the exact logic behind the A1a doc bug — the flow is confusing enough that a test earns its keep. |
| `lib/auth/rateLimit.ts` — untested | **✅ Fix-now** | Security-relevant. |
| `lib/env.ts` — untested | **✅ Fix-now** | Small, validates load-bearing bounds-checking logic Track A already confirmed as correct — worth pinning down. |
| `lib/ai/*` internals (`daedalus.ts`, `hermes.ts`, `anthropicProvider.ts`, `provider.ts`) only indirectly tested via mocked boundaries | **✅ RESOLVED — 2026-08-12: defer → TODO**, same bucket as `app/components` | Direct unit tests need real fixtures for streaming responses, truncation, error mapping — a real investment, not a quick add. |
| `lib/apiFetch.ts`, `lib/proposalStore.ts`, `lib/settings.ts` — untested | **✅ Fix-now** | Logic-bearing, small, worth covering. |
| `lib/utils.ts`, `lib/db/client.ts`, `lib/db/seed.ts`, `lib/db/sectionDefsSeed.ts`, `lib/db/repository/index.ts` — untested | **✅ Fix-now (flipped by blanket policy)** | Thin wrappers / seed scripts — low individual effort even if low-drama; blanket "include if missing" covers these too. |
| AI-mock compliance | **No action** | Fully compliant, nothing to fix. |
| Stale tests | **No action** | None found. |

---

## 2b. Test-quality review (existing tests, not coverage) — 2026-08-12

Separate pass requested mid-triage: not "is X untested" (Track C, above) but "are the
existing ~502 tests actually any good." Result: **suite verdict is strong overall**
(39 files, consistent colocated structure, real dated regression tests, correct mock-boundary
placement almost everywhere) — two real bugs found, two trivial nits. **All four: ✅ fix-now,
Phase 3, no code changes yet.**

| # | Finding | Split |
|---|---|---|
| 1 | `lib/import/__tests__/import.test.ts:765-789` — "overlapping blockIds" test mocks `callHermes` to reject, then calls the mock directly and asserts it rejects. Circular — the real overlap-validation logic is never invoked. | **Fix-now, Phase 3** — rewrite to mock one layer down and call the real route handler, matching the project's own correct pattern already used in `chat.test.ts`'s truncation test / `import-dryrun.test.ts`. |
| 2 | `lib/import/__tests__/structural.test.ts:255-277` — same anti-pattern: mocks `callDaedalus` to reject with `DaedalusTruncatedError`, then calls the mock and checks it rejects. The real `422 structural_truncated` route-level handling is never exercised. | **Fix-now, Phase 3** — same fix approach as #1. |
| 3 | `app/api/__tests__/account.test.ts:128-138` — test name overclaims ("a body that mentions another user ID has no effect"); the route doesn't accept a user-id field at all. Test itself is valid, just misnamed. | **Fix-now, Phase 3** — rename only. |
| 4 | `app/api/__tests__/route-guard.test.ts:11-12` — stale comment says an assertion is "skipped until apiFetch migration is complete"; it actually runs unconditionally now (migration is done). | **Fix-now, Phase 3** — update/remove the stale comment. |

Not found: no skipped/disabled tests, no genuine duplicate coverage, no broken/no-op
assertions outside #1–2, no implementation-detail brittleness.

---

## 3. Track A (docs accuracy) — how findings get applied

Per Plan 10 §3.2: Track A findings mostly don't get fixed in the old files (they're being
retired) — they feed Phase 4 (new docs) directly. Exceptions are the two files that
survive: `README.md` and `docs/user-guide.md`, corrected in place during Phase 4/5.

- **A1a (consent popup)** → correct in `docs/user-guide.md` (Phase 4/5) and `README.md` if
  it repeats the claim; describe the actual post-signup dismissible-popup flow.
- **A1b (OAuth Phase 6 status contradiction)** → **✅ RESOLVED, checked against actual
  code/docs, 2026-08-12.** Ground truth: Plan 06 Phase 5.0–5.3 done, live-verified against
  real Google endpoints 2026-07-31; only 5.4 remains, already tracked as its own
  `plans/roadmap.md` NEXT item. Phase 6 (all 5 doc-sync steps: TechDesign.md, README.md,
  user-guide.md, roadmap.md, CHANGELOG.md) is fully done — confirmed against each file
  directly. **Root `CLAUDE.md` is the stale one** ("not started" on both, false); `TechDesign.md`'s
  "in progress" was closer but also stale (it's done). No standalone fix needed — Plan 10
  §0.2 already retires this whole status-narrative paragraph when root `CLAUDE.md` becomes
  a pure map in Phase 5. `P06a`'s Deferred Decisions row should restate as "done except 5.4,
  which is its own NEXT item" when triaged into the new docs (Exit 2, see §5 below).
- **A2** → same decision as Track B finding #5 above (one decision, two tracks flagged it).
- Minor "01–06" stale range → same as Track B finding #3.

---

## 4. Rules Index — exit triage (§0.4 three-exit model)

Legend: **Exit 1** = still true/wanted → restated as System About prose. **Exit 2** = still
wanted, not built (or partially built) → becomes a roadmap item. **Exit 3** = superseded/no
longer wanted → dropped from living docs, stays only in the retired file + git history.

**Exit 1 (restate as current-system prose) — the large majority:** rules #1, 2, 3, 4, 5, 6,
7, 8a, 9, 10, 11a, 11b, 12, 15, 17, 21, 22, 23, 24, 25, 27, 29 *(rename "chat mediator" →
Prometheus when restated)*, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
70, 71, 72 *(carries the reviewed-and-accepted OAuth auto-link risk statement — keep the
"this is a decision, not a default" framing intact)*, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82,
83, 84, 85, 86, 87.

**Exit 2 (→ roadmap item, flag for your confirm)**

| # | Rule (short) | Roadmap destination |
|---|---|---|
| 8b | Storage dialect (Postgres/Azure) choice | FUTURE — unchanged, matches existing roadmap framing |
| 13 | Catalog evolution: "never known" vs "was known, changed" | FUTURE — needs catalog versioning first |
| 14 | Manual-edit save frequency (per-save vs debounced revision) | **✅ Exit 1, not Exit 2 — confirmed already decided + built, verified 2026-08-12.** `SectionBlock.tsx` already implements the decided behavior (explicit Save/Cancel, no autosave/debounce) — closed as roadmap TODO item, no code change needed. Restate as current behavior, drop from deferred list. |
| 16 | `AgentSnapshot(kind:'export')` capture + diff-view UI | **✅ Verified 2026-08-12: still genuinely deferred, Exit 2 confirmed correct.** `GET /api/agents/[id]/export` itself is built/shipped (docstring: "read-only — no AgentSnapshot row is written... still deferred to a later export-UX plan"); confirmed no code writes `kind: 'export'` and no diff-view UI exists anywhere. **Distinction for Phase 4 docs: "Export" the feature is done; this specific snapshot-capture+diff capability is not — don't conflate the two.** |
| 18 | Admin catalog UI + platform-aware `lib/blueprint/rules.ts`/`prompt.ts` | FUTURE — schema half-done already |
| 20 | Model display-label lookup (short name in UI) | NEXT — small, UI-only |
| 26 | `build-prompts.ts` readable template-literal output | Already tracked in roadmap per Plan 10's own header ("Defer roadmap TODO item 1") — **just confirm the pointer, don't duplicate** |
| 30 | AI-assisted config-key mapping (messy frontmatter keys) | FUTURE — explicitly speculative until real-world imports show it's a problem |

**Exit 3 (drop from living docs, historical only)**

| # | Rule | Why |
|---|---|---|
| 19 | Old `model.allowedValues` = full IDs only | Explicitly superseded by #37; the ledger says so itself |
| 28 | Removed `propKey`/Stage-2-config-classification capability | Describes a removal; current behavior (Stage 2 = sectionKey only) is already covered by #5/#6's Exit-1 restatement, no separate mention needed |

---

## 5. Deferred Decisions table — exit triage

Most rows here are 1:1 pointers to a Rules Index number already triaged above — those just
inherit that row's exit and aren't re-listed. The rows below are the ones that stand alone
or need their own call.

**Already-resolved pointer rows → Exit 3 (drop the row, the fact lives in the Exit-1 prose already):**
19, 27, 40, and the unlabeled "Propose-preview" row (→ Rule #24), P05a, P05b, P06b.

**Genuinely open, still deferred → Exit 2, become roadmap FUTURE/NEXT items:**

| Row | Item | Suggested roadmap bucket | Note |
|---|---|---|---|
| — | Skill module (`SKILL.md` second entity type) | FUTURE | Large — sequenced after Blueprint refresh per its own trigger |
| P04a | Second LLM provider | **Already the next roadmap item after this plan** (Plan 10 §8.8) | Don't duplicate — just confirm the pointer |
| P04b | Incremental streaming | FUTURE | |
| P04c | Log retention/pruning/pagination | FUTURE | Trigger-based (row size or DB size) |
| P04d | Cost estimation in currency | FUTURE | |
| P04e | Replay a dry-run request | FUTURE | |
| P04f | Settings modal instead of full-page nav | **✅ Exit 1, not Exit 2 — already built, 2026-08-06** | Confirmed via `Topbar.tsx`: "⚙ System Settings" already opens `SettingsModal` (roadmap TODO item 6, done 2026-08-06), not a `/settings` navigation. The 2026-08-12 "Account modal" commit mirrored this same already-solved pattern onto `/account`. Restate as current behavior in System About, drop from deferred list. |
| P04g | Component/UI tests (`ImportDialog`/`ChatPanel`) | **✅ RESOLVED — 2026-08-12: TODO**, not FUTURE (user wants this prioritized sooner) | Consolidates with Track C's `app/components/**` zero-coverage finding above — **one roadmap item, not two**. Scope: RTL + jsdom + config split (new infra) + `ChatPanel`/`ImportDialog`/`AgentView`/`SignupForm`/`ConsentPopup`/`WorkbenchShell` as the priority candidates, not all 22 files uniformly |
| P04h | Compliance-grade (non-droppable) logging | FUTURE | |
| P05c | In-place re-login modal | FUTURE | |
| P05d | Per-individual LLM quotas | FUTURE | |
| P05e | Per-user LLM spend/cost caps | FUTURE | |
| P05f | Server-side session revocation | FUTURE | |
| P05g | Sliding session refresh / "remember me" | FUTURE | |
| P05h | Password reset flow | FUTURE | |
| P05i | Organizations/teams (`ownerId` remodel) | FUTURE | Also appears at data-model level (§ Deferred, not-in-model-yet) — one item, not two |
| P05j | User self-service (email/password change, delete account) | FUTURE | |
| P05k | Per-user activity-log view | FUTURE | |
| P05l | Retention/purge policy for `llm_call_log` | FUTURE | |
| P05m | Constant-time login | FUTURE | Trigger: only matters if self-service signup opens |
| P05n | Distributed/persistent rate limiting | FUTURE | |
| P05o | Hashing invite codes at rest | FUTURE | |
| P05p | Invite-code expiry | FUTURE | |
| P05q | CSRF tokens | FUTURE | |
| P05r | Agent ownership transfer UI | FUTURE | Manual SQL documented as the interim already |
| P05s | GDPR export/deletion workflow | FUTURE | |
| P05t | Argon2id instead of bcrypt | FUTURE | Blocked on native-build constraint |
| P06a | OAuth Phase 5 (live verification) + Phase 6 (doc sync) | **Exit 1, mostly** | **Resolved via A1b (§3 above):** Phase 5.0–5.3 done + live-verified 2026-07-31; Phase 6 fully done. Restate as current-system fact in System About/roadmap, not a deferred row. Only the genuinely open piece — **5.4** (session-TTL live test) — carries forward as a small Exit-2 NEXT item (already tracked in `plans/roadmap.md`, just confirm the pointer). The OAuth auto-link residual-risk revisit trigger (tied to Rule #72) stays live regardless. |
| P06c | Second OAuth provider | FUTURE | |
| P06d | Manual link/unlink OAuth from `/account` | FUTURE | |
| P06e | Admin toggle for auto-linking | **✅ RESOLVED — 2026-08-12: keep, Exit 2, FUTURE.** | Proposed and declined once for complexity reasons, not because it's wrong — kept as the pre-scoped contingency answer for Rule #72's revisit trigger (Google Workspace domain-takeover risk), so a ready fix exists if that trigger ever fires. |
| P06f | Storing OAuth provider tokens | FUTURE | Explicitly not wanted unless a real feature need arises |
| P06g | Domain-restricted sign-in / OAuth-callback-specific rate limit | FUTURE | |
| P08a | Wiring a declared model for Prometheus | NEXT | Same trigger as #26 (`build-prompts.ts` touch) |
| P08b | Add/delete sections via chat | **✅ Exit 1, not Exit 2 — fully built, verified 2026-08-12** | Corrected via spot-check: add closed 2026-08-11, delete closed 2026-08-12 (today) — `lib/ai/CLAUDE.md` confirms "chat-driven section add/edit/delete are all implemented now." Restate as current behavior, drop from deferred list entirely — this was wrongly filed as Exit 2 in the original draft. |
| P08c | Dynamic per-request Prometheus prompt | FUTURE | |
| P08d | Atomic (single-transaction) apply | FUTURE | Trigger: an actual partial-apply observed |
| P08e | Audit trail for config changes | FUTURE | |
| P08f | Cross-tab proposal sync beyond `storage` event | FUTURE | Low priority — already free today for the common case |

**From the "Deferred (not in the data model yet)" list (§ Data model, lines 479–487):**

| Item | Exit | Note |
|---|---|---|
| AI chat persistence (`Conversation`/`Message`) | Exit 2 → FUTURE | |
| Export adapters (Copilot/other platforms) | Exit 2 → FUTURE | |
| Sharing/forking agents between users | Exit 2 → FUTURE | |
| Organizations/teams | **Exit 3 (merge)** | Duplicate of P05i above — drop this copy, keep one |
| `OAuthAccount` entity | **Exit 1** | This is now **built** (Plan 06) — the deferred note is stale; restate as current schema in System About, don't carry forward as deferred |

---

## 7b. Phase 3.5 — code-quality review findings, applied (2026-08-12)

All 10 correctness findings from the whole-project `/code-review` pass reviewed; 1, 2, 4,
5, 6, 7, 8 implemented, plus **#3** (the LLM-cap race condition) after explicit go-ahead.
9 and 10 (UX/minor) — **not fixed, tracked below with concrete fix suggestions** so they
have a real home instead of just being mentioned in chat.

- **#1** `lib/import/assemble.ts` — merge-group primary resolution excludes headingless
  blocks (the real data-loss bug). New regression test in `import.test.ts` reproducing the
  exact scenario directly via `assemble()`.
- **#2** `lib/ai/hermes.ts` + `import/route.ts` — new `HermesTruncatedError`, checked after
  the gateway call, mapped to `422 strict_truncated`.
- **#3** LLM-cap race — `lib/db/repository/llmCallLog.ts` gained `reserveCallSlot()` +
  `finalizeCallLog()` (the one sanctioned exception to this file's append-only invariant,
  documented in its own header). `gateway.ts`'s live path now reserves the slot
  synchronously *before* the network call instead of writing the log row only after —
  closes the TOCTOU window. New repository-level tests for both functions, updated the
  stale "no update/delete" test, added both to the `lib/db/repository/index.ts` barrel,
  and added a real concurrency regression test (`gateway-cap.test.ts`) firing 4 concurrent
  requests at a cap of 2 and asserting exactly 2 succeed.
- **#4** `agents.ts` `updateAgent` — same UNIQUE-constraint catch `createAgent` already uses.
- **#5** OAuth callback route — rate-limited like login/signup. **Caught and fixed a real
  test regression this introduced**: `oauth-callback.test.ts` made 25 calls with no
  `x-forwarded-for` header, which would have shared one rate-limit key — fixed the test
  helper to give each call a distinct IP.
- **#6** `demoteSplitLevelHeadings` — fence-aware, ported from `splitBody.ts`.
- **#7** `LlmUserCapReachedError.kind` — real call kind, threaded through
  `LlmGatewayResult`'s `llm_cap_reached` arm properly (kept the field per user request,
  didn't drop it).
- **#8** cap gate — fails closed on a missing policy row.

Verified against the existing suite by reading (not running — standing rule 5 still
applies): no test constructs `llm_cap_reached` result objects directly (only narrows on
`result.reason`, unaffected by the new `kind` field); `gateway.test.ts`'s Case 7 never
actually mocked `writeCallLog` (its own comment admits this), so it's unaffected by the
reserve/finalize split; no route reads `.kind` off `LlmUserCapReachedError` today, so #7
is a pure internal-correctness fix with no visible behavior change yet.

### Not fixed — #9 and #10, plus the deferred `AgentDTO.validation` UI, filed to the roadmap

**✅ RESOLVED — 2026-08-12: deferred to `plans/roadmap.md` NEXT (items 20-22), does not
block Phase 3.5 or Phase 4.** Not just "held for a follow-up" in this doc — given real
roadmap entries so they're actually tracked, not lost to chat scrollback.

| # | Finding | Roadmap destination |
|---|---|---|
| 9 | `AgentView.tsx:580` raw `fetch()` bypasses `apiFetch()` | NEXT item 20 |
| 10 | `assemble.ts` `toScalar()` silently blanks malformed name/description | NEXT item 21 (bundled with 22) |
| — | `AgentDTO.validation` UI wiring (decision already made in §6 — wire up, not drop; implementation was the one item deferred out of the Phase 3 straight-through pass) | NEXT item 22 |

Items 21 and 22 are explicitly bundled in the roadmap entry — both extend the same
validation-flag surface, worth one design pass rather than two.

---

## 7. Phase 3 — execution record (2026-08-12)

All 17 tracked items done, straight-through per your go-ahead (item 7/validation-UI
deferred out, see §1 finding 5).

**Trivial fixes:**
- `lib/blueprint/prompt.ts` — "chat mediator" → "Prometheus" (JSDoc).
- `app/api/__tests__/account.test.ts` — renamed the overclaiming test (§2b #3).
- `app/api/__tests__/route-guard.test.ts` — fixed the stale "skipped" comment (§2b #4).

**Test-quality rewrites (§2b #1–#2):**
- `lib/ai/hermes.ts` — exported `parseHermesLabels` (previously private) so it can be
  unit-tested directly. `lib/import/__tests__/import.test.ts`'s A4 test now calls the
  real validator via `vi.importActual`, not a mock's own configured return value.
- `lib/import/__tests__/structural.test.ts` — removed the vacuous truncation test (the
  real check lives inside `callDaedalus`, which this file mocks entirely — nothing
  meaningful to assert at this layer). Replaced with a genuine end-to-end test:
  **new file** `app/api/agents/__tests__/import-structural-truncation.test.ts`, which
  mocks the provider (one layer down, real caller/gateway/route pattern already used by
  `tenancy.test.ts`/`import-dryrun.test.ts`) and confirms the real truncation check runs
  *and* the route correctly returns `422 structural_truncated` with zero DB writes.

**New test coverage (blanket "include if missing" policy):**
- `lib/blueprint/__tests__/{catalog,rules,prompt,index}.test.ts` — all 4 files.
- `lib/auth/__tests__/consentPopupFlag.test.ts` — file is just 2 constants (the real
  popup-gating logic lives in the deferred `app/components` layer); tested what's
  actually there (stability/distinctness), not invented scope.
- `lib/auth/__tests__/rateLimit.test.ts` — full window/reset/per-IP/per-route coverage
  via `vi.useFakeTimers()`.
- `lib/__tests__/env.test.ts` — everything except `SESSION_TTL_SECONDS` (already
  covered by the existing `sessionTtl.test.ts`, not duplicated).
- `lib/__tests__/apiFetch.test.ts` — including the "redirects and never resolves"
  case, asserted via side effects without ever awaiting the hanging promise.
- `lib/__tests__/proposalStore.test.ts` — full coverage including cross-tab storage
  events, quota-exceeded fallback, and corruption handling; uses `vi.resetModules()`
  per test for a fresh module instance (the module has private mutable state with no
  reset export).
- `lib/__tests__/settings.test.ts` — all 5 typed accessors' fail-safe defaults.
- `lib/__tests__/utils.test.ts` — `cn()`.
- `lib/db/__tests__/sectionDefsSeed.test.ts` — structural sanity on the static catalog.
- `lib/db/repository/__tests__/index.test.ts` — barrel re-export smoke test.

**Two legitimate skips (not corner-cutting — documented why):**
- **`lib/db/client.ts`** — opens a real connection to the actual `myagent.db` file at a
  hardcoded, non-overridable path. No safe way to import it in a test without touching
  real data. Its construction logic is already exercised implicitly by every one of the
  ~500+ tests that use `lib/db/__tests__/test-db.ts`, which mirrors it exactly (same WAL/
  foreign_keys pragmas) against `:memory:`.
- **`lib/db/seed.ts`** — same problem, plus it's a script with a top-level side effect
  (`seed().catch(...)` runs immediately on import, including a real `process.exit(1)` on
  failure) — importing it in a test would immediately write to the real DB file. Testing
  it safely would need refactoring into an injectable function first, which is a design
  change beyond "add a test" — flagged rather than silently done, per Phase 3's own
  behavior-preserving constraint.

---

## 6. Open decisions needed from you before Phase 3/4 start

1. ~~`architecture/audits/` gitignore~~ — **✅ resolved 2026-08-12: intentional, local-only historic, no change.**
2. ~~The 4 untracked files currently sitting in `architecture/audits/`~~ — **✅ resolved 2026-08-12: stay local-only, untouched, and unreferenced.** No fold into `docs/`, no mention in `CLAUDE.md` or any new doc. Same treatment as the audits folder itself.
3. ~~`daedalus-new.md`~~ — **✅ resolved 2026-08-12: confirmed abandoned, deleted (staged, uncommitted).**
4. ~~`AgentDTO.validation` (A2)~~ — **✅ resolved 2026-08-12: wire it up in Phase 3.**
5. ~~A1b — OAuth Phase 6 status~~ — **✅ resolved 2026-08-12: neither, both stale — see §3 above for ground truth.**
6. ~~`architecture/.claude/settings.local.json`~~ — **✅ resolved 2026-08-12: deleted.**
7. ~~P04f (Settings modal)~~ — **✅ resolved 2026-08-12: already built 2026-08-06, confirmed in code. No longer a deferred item.**
8. ~~P06e (admin auto-link toggle)~~ — **✅ resolved 2026-08-12: keep, Exit 2/FUTURE, as the named contingency for Rule #72's revisit trigger.**

Everything else above is a proposed default (fix-now bias per §3.1) — flag anything you want to move to the other bucket.
