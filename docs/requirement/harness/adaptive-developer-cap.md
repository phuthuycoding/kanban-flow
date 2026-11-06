---
feature: adaptive-developer-cap
context: harness
created: 20261102_1605
kind: feature
status: archived
---
# Spec Requirement

## Feature
adaptive-developer-cap

## Objective
Replace the fixed developer cap of 4 in the in-session task loop with a live cap that the controller raises and lowers during the run, from what the run itself shows. A project sets only the ceiling (`harness.developers.max`, default 6). Implements issue #126 with the design the human chose instead of the issue's config key. The same item adds an on/off switch `worktree.domains` for the worktree domain layer, so a project that has no app to serve needs no `.test` DNS + proxy infrastructure (`sudo kf worktree setup`) and gets no warning about it.

## Problem Statement
`skills/implement/SKILL.md` and `references/task-loop.md` fix the cap at 4 developer seats per worktree, and `skills/plan/SKILL.md` writes `Execution: wave <w> parallel, <N> developers` with N = min(wave width, 4). The 4 comes from one probe on this repository (4 full suites in one worktree passed, about 1.8× the throughput of one). A project whose tests share a database, bind fixed ports or run Playwright can break at 2; a project with a light suite is held back at 4. Issue #126 proposed a `harness.parallel.developers` key, but the human does not want a fixed number at all, and `harness.parallel` is already a removed key in `LEGACY_HARNESS_KEYS` (`src/project/harness-config.ts`), which `kf doctor` reports as `harness_legacy_key`.

## Scope
### In Scope
- A live developer cap N per work item, kept by the controller, starting at min(2, ceiling).
- Additive increase: N + 1 after a wave completes with no contention-shaped failure, up to the configurable ceiling.
- A configurable ceiling `harness.developers.max` (default 6), validated and reported by `kf tasks --json`.
- Multiplicative decrease: N halved (rounded down, never below 1) on a contention-shaped verify or suite failure.
- A contention-shaped failure is re-run once at the lowered cap before it counts as a fix round.
- Every change of N ledgered as a `Ruling:` line in one grammar; the cap wait line carries the current N.
- Resume rebuilds N from the ledger.
- The plan's `Execution:` line for a parallel wave stops clamping to 4.
- Docs, README and Pages site wording that states "up to 4" / "cap of 4" updated; the surface tests that pin that wording updated.
- Issue #126 body updated to the chosen design.

- `worktree.domains` (boolean, default true): when false, no domain-infra probes in `kf validate`/`kf doctor`, no domain URL printed or exported, the direct `http://127.0.0.1:<port>` shown instead; worktrees, ports and route registration unchanged. This repository sets it to false.

### Out of Scope
- Removing the route registration when domains are off (it keeps ports unique machine-wide); making `domain` optional in `.kfw.json`.
- A config key for the start value or a fixed cap — the human rejected a fixed per-project number; only the ceiling is configurable (FR-004). `harness.parallel` stays a legacy key.
- Carrying N from one work item to the next (each item starts at min(2, max)) — no store holds it today (`.works/loop-metrics.md` has no peak column) and it can be added later from `kf loop-stats` data.
- Measuring the 5-hour usage window — the ceiling only bounds it.
- New `kf loop-stats` figures for cap changes; it keeps parsing the wait line it already parses (`/^\d+ developers in flight/`).
- Rewriting historical canonical docs of earlier features (`docs/requirement/harness/parallel-developers.md` and its use cases/test plan) — they record what those features shipped.

## Affected surfaces
- `skills/implement/SKILL.md`
- `skills/implement/references/task-loop.md`
- `skills/plan/SKILL.md`
- `docs/workflow/harness.md`
- `docs/workflow/lifecycle.md`
- `docs/workflow/cli-reference.md`
- `README.md`
- `.github/pages/index.html`
- `.kf/config.json` schema (`harness.developers.max`)
- `kf tasks --json` output (`developers` field)
- `CHANGELOG.md`
- GitHub issue #126 body
- `worktree.domains` in `.kf/config.json`
- `kf status` / `kf worktree` output
- `skills/test/SKILL.md`
- `skills/review/SKILL.md`
- `agents/automation-writer.md`
- `docs/workflow/autoconfig.md`

## Actors
- Controller session: runs `kf:implement` and keeps the live cap.
- Developer seats: the subagents the cap counts.
- Human: reads the cap rulings in the final message and the ledger.

## Functional Requirements
### FR-001
- Requirement: **Live cap.** The implement skill replaces the fixed cap of 4 with a live cap N that counts the same seats as today (a task's developer, a fix-round developer, a resume-commit developer). A work item's loop starts at N = min(2, ceiling of FR-004) and ledgers `Ruling: developer cap <N> — start — cost if wrong: <…>` before its first developer dispatch.
- Priority: must
- Notes: 2 is the smallest value that still runs anything in parallel; a project that breaks at 2 steps down to 1 on its first contention failure.

### FR-002
- Requirement: **Step up, in wave order.** A wave is the wave of `kf tasks <f> --graph`; a verify failure belongs to the wave of the task whose verify failed. Wave w is **clean** when none of its tasks had a contention-shaped failure (FR-003). Only parallel waves step up; an inline wave never changes N. The step-up for wave w is decided once wave w and every earlier wave are complete, in wave order, never in the order waves finish: if w is clean, N rises by 1 and the controller ledgers `Ruling: developer cap <old> → <new> — wave <w> clean — cost if wrong: <…>`. N never rises above the ceiling (FR-004) nor above the width of the widest wave not yet complete; a step-up blocked by either is not ledgered. Fix-round and resume-commit seats count against N whatever the wave width.
- Priority: must
- Notes: additive increase; one step per clean parallel wave, decided from the ledger alone so two controllers reach the same N.

### FR-003
- Requirement: **Step down, then re-run once.** Only the controller's ledgered verify runs count (`TASK-NNN: verify started` … `verify done exit=1`); a developer's own test runs and `kf verify --stage` do not. A failure is **contention-shaped** when its output contains one of these strings: `EADDRINUSE`, `index.lock`, `database is locked`, `SQLITE_BUSY`, `Lock wait timeout exceeded`, `ETIMEDOUT`, `ECONNREFUSED`, `Test timed out`, `Hook timed out`. On such a failure the controller:
  1. halves N to max(1, ⌊N/2⌋) and ledgers `Ruling: developer cap <old> → <new> — <signature> in TASK-NNN verify — cost if wrong: <…>`, **unless** N already dropped since that verify started (another failure of the same contention event), in which case N is left as it is;
  2. ledgers `Note TASK-NNN: verify rerun — contention <signature>` (a note line, so `kf loop-stats` does not read it as an unparsed `verify` shape);
  3. dispatches no new developer, and runs the re-run, only once fewer than N developer seats are in flight;
  4. re-runs that verify once (`verify started` / `verify done`). A pass completes the check with no fix round; a failure is an ordinary failure and goes to the fix loop or to the other-task routing rule (`kf:implement` § A verify failure in another task's Files), which applies only after the re-run.
- Priority: must
- Notes: multiplicative decrease, halving at most once per contention event; the re-run is how contention is told apart from a real failure without a solo run of the whole suite. A real hang that prints `Test timed out` costs one re-run before it reaches the fix loop.

### FR-004
- Requirement: **Configurable ceiling.** N never exceeds the ceiling `harness.developers.max` from `.kf/config.json`: an integer from 1 to 16, default 6 when the key is absent. `validateHarness` in `src/project/harness-config.ts` rejects any other value with the field name (`harness.developers.max must be an integer from 1 to 16`), and rejects `harness.developers` that is not an object. `kf tasks <f> --json` reports the validated ceiling and where it came from as `developers: { "max": <n>, "source": "config" | "default" }`, and the controller reads it there. The start value of FR-001 is min(2, max). The start value and the step rules are not configurable.
- Priority: must
- Notes: the human asked for a configurable ceiling. `harness.parallel` stays a legacy key (`LEGACY_HARNESS_KEYS`), so the new key lives under `harness.developers`. The default 6 sits above the probed 4 so a light suite can grow past it; max 1 makes the loop sequential.

### FR-005
- Requirement: **Wait line and resume.** The cap wait line reads `TASK-NNN: developer waits — <N> developers in flight` with the N in force when it is written. On resume the controller (a) takes N from the latest `Ruling: developer cap` line, or min(2, max) when there is none, and caps it at the current max (a lowered max is ledgered as a cap ruling); (b) treats a `Note TASK-NNN: verify rerun` line with no later `verify started` of that task as a pending re-run — run it, never a fix round; (c) treats a latest `verify done exit=1` whose output is contention-shaped and that has no later `Note TASK-NNN: verify rerun` line as owing steps 1–4 of FR-003; (d) decides, in wave order, the step-up of every complete wave that has no step-up decided yet. Seats in flight above a lowered N finish; they are never cancelled.
- Priority: must
- Notes: `kf loop-stats` already reads `/^\d+ developers in flight/`, and a `Note …` line is an other-timed line to it, so its parsing does not change.

### FR-006
- Requirement: **Plan line.** The plan skill writes `Execution: wave <w> parallel, <N> developers` with N = the wave width (no clamp to 4); the line states the most the wave can use, and the live cap decides how many run. The approval summary says that the cap starts at 2 and adapts.
- Priority: must
- Notes: keeps FR-017 of researcher-agent's line shape.

### FR-007
- Requirement: **Docs and tests.** Every user-facing statement of a fixed "cap of 4" / "up to 4 developers" in the Affected surfaces describes the live cap instead, and the surface tests that pin the wording (`src/tests/loop-parallel-surface.test.ts`, `loop-ledger-surface.test.ts`, `open-source-surface.test.ts`, and the `kf loop-stats` fixtures where they need it) assert the new wording: the start at min(2, max), the step-up rule, the step-down rule with its signatures, the re-run once, the configurable ceiling and the cap ruling grammar.
- Priority: must
- Notes: the skills are prose contracts; their surface tests are the executable check.

### FR-008
- Requirement: **Issues #126 and #129.** The #126 body is updated to the chosen design (live cap starting at min(2, max), step up per clean parallel wave, halve on contention with one re-run, configurable ceiling `harness.developers.max` default 6, no `harness.parallel` key); #129 carries the task checklist; the PR body says `Closes #126` and `Closes #129`.
- Priority: should
- Notes: the human asked for this design in place of the issue's proposal.

### FR-009
- Requirement: **Domain switch.** `.kf/config.json` accepts `worktree.domains` (boolean, default `true`); `parseWorktreeConfig` rejects any other type with `worktree.domains must be boolean`, and `worktreeConfig` returns `domains` with the default applied.
- Priority: must
- Notes: requested by the human at the planning gate: a project without an app should not need the `.test` DNS + proxy infra.

### FR-010
- Requirement: **No infra probes when off.** With `worktree.enabled: true` and `worktree.domains: false`, `kf validate` emits no `worktree_infra_missing` finding and `kf doctor` runs no `worktree infra (…)` probe; with `domains` true or absent both behave as today.
- Priority: must
- Notes: the probes are the only thing that asks for `sudo kf worktree setup`.

### FR-011
- Requirement: **Direct URL when off.** With `worktree.domains: false`, `kf status --change`, the transition note of `kf stage`/`kf approve`, `kf worktree create` and `kf worktree list` print the direct `http://127.0.0.1:<port>` and no `http://<domain>` line, and the worktree hooks get no `KFW_WORKTREE_DOMAIN` (they keep `KFW_WORKTREE_PORT`). Route registration and port allocation are unchanged, so ports stay unique across repositories. The implement, test and review skills and the automation-writer brief/agent say to use the direct URL when no domain is shown.
- Priority: must
- Notes: `.kfw.json` keeps its `domain` field (the registration guard requires it); only the text output and the env var change. JSON outputs (`kf status --json`, `kf worktree list --json`) keep `domain` unchanged; the skills decide from `worktree.domains` in `.kf/config.json`, not from the presence of `domain`.

### FR-012
- Requirement: **This repository opts out.** `.kf/config.json` of kanban-flow sets `"worktree": { "enabled": true, "domains": false }`, and the README, `docs/workflow/autoconfig.md` and the Pages site document the key.
- Priority: should
- Notes: kanban-flow is a CLI with nothing to serve.

## Non-Functional Requirements
- No new dependency. Existing configs without `harness.developers` load unchanged; `kf doctor` reports nothing new for them.
- Ledger lines stay parseable by the current `kf loop-stats` grammar.
- `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass.

## Main Use Cases
- UC-001 Start the loop at cap 2 and step up after a clean wave
- UC-002 Step down on a contention-shaped verify failure and re-run once
- UC-003 Resume rebuilds the live cap from the ledger
- UC-004 Plan records parallel waves at wave width
- UC-005 Set the ceiling in config and read it from `kf tasks --json`
- UC-006 Turn the worktree domain layer off

## Constraints
- The skills are prose read by the controller model; the rules must be unambiguous enough that two controllers reach the same N from the same ledger.
- `harness.parallel` must not reappear as a config key; the `kf tasks --json` change is additive (no existing field changes).

## Assumptions
- A wave is the wave of `kf tasks <f> --graph`, as in FR-017 of researcher-agent.
- The start value 2 replaces the "start from the last recorded peak" option, because no store holds a peak today; the human confirms this at the gate.
- Signature matching is done by the controller reading the verify output; no new CLI command classifies failures.
- Each work item starts at min(2, max); carry-over between items is a later decision.

## Acceptance Criteria
- [ ] `skills/implement/SKILL.md` and `references/task-loop.md` contain no fixed "cap of 4" and state the start at min(2, max), the step up per clean wave, the halving on a contention-shaped failure with its signatures, the single re-run, the configurable ceiling and the `Ruling: developer cap` grammar. (FR-001..FR-004)
- [ ] The skills state that step-ups are decided in wave order once a wave and every earlier wave are complete, that inline waves never change N, that one contention event halves N once, the exact signature list, which verify runs count, and the `Note TASK-NNN: verify rerun` line. (FR-002, FR-003)
- [ ] The cap wait line in the grammar and example reads `<N> developers in flight`, and the resume rules (a)–(d) of FR-005 are stated. (FR-005)
- [ ] `kf loop-stats` reports the same figures for an existing ledger and parses a ledger whose wait lines say `2 developers in flight` and `3 developers in flight`. (FR-005)
- [ ] `skills/plan/SKILL.md` writes N = wave width with no clamp to 4, and its approval summary mentions the adaptive cap. (FR-006)
- [ ] README, Pages site and the workflow docs no longer state a fixed cap of 4; the surface tests assert the new wording. (FR-007)
- [ ] `harness.developers.max` accepts 1..16, rejects 0, 17, 2.5, "4" and a non-object `harness.developers` with the field name; `kf tasks <f> --json` reports `developers.max` 6 / `source: "default"` without the key and the configured value / `source: "config"` with it; the skills read the ceiling there and start at min(2, max). (FR-001, FR-004)
- [ ] Issue #126 body states the chosen design. (FR-008)
- [ ] `worktree.domains` accepts booleans, rejects `"no"` with the field name, defaults to true. (FR-009)
- [ ] With `domains: false`, `kf validate` has no `worktree_infra_missing` and `kf doctor` no `worktree infra` line; with `domains: true` the warning still appears when the infra is missing. (FR-010)
- [ ] With `domains: false`, status, transition note, `kf worktree create` and `list` show `http://127.0.0.1:<port>` and no `.test` URL; hooks get no `KFW_WORKTREE_DOMAIN`; the route is still written. (FR-011)
- [ ] This repo's `.kf/config.json` sets `domains: false`; README, autoconfig.md and Pages document the key. (FR-012)
- [ ] `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` pass.

## Edge Cases
- A failure with both a contention signature and an assertion failure: it is contention-shaped, gets the one re-run, and the second failure goes to the fix loop.
- N is 1 and a contention failure arrives: N stays 1, the re-run still happens.
- A step down while 4 seats are in flight and N becomes 2: the 4 finish; no new developer starts until fewer than 2 are in flight.
- A wave with a step down never steps up at its end, even if its re-runs passed.
- The ceiling is reached: further clean waves ledger nothing.
- `harness.developers.max` is 1: the loop starts at 1 and never steps up.
- `harness.developers.max` is lowered between sessions below the N in the ledger: on resume N becomes min(ledger N, max), ledgered as a cap ruling.
- A ledger from before this feature (no cap ruling, waits saying `4 developers in flight`): resume starts at min(2, max) and loop-stats still parses the old lines.
- Inline waves (one task) never change N.
- Wave 3 completes before wave 2: wave 3's step-up waits until wave 2 is complete and its own step-up is decided.
- Three verifies fail from one port clash while N = 4: N becomes 2 once; each of the three gets its one re-run.

- `worktree.domains: false` with an item provisioned earlier while domains were on: its route stays; output follows the current setting.
- `worktree.domains: false` with `worktree.enabled: false`: nothing changes (no worktree at all).

## Open Questions
- None. Confirmed by the human on 2026-11-02: the loop starts at 2 by default and scales itself (up per clean wave, halved on contention) between 1 and the ceiling; the ceiling defaults to 6 and is set with `harness.developers.max`.

## Test Strategy
- Level: unit+integration
- UI Tests: none
- Tools: vitest (`npm test`, `vitest.config.ts`) — surface tests over the skill and doc text, `validateHarness` unit tests, a `kf tasks --json` CLI test, `kf loop-stats` fixture tests
- Coverage Target: 80%
