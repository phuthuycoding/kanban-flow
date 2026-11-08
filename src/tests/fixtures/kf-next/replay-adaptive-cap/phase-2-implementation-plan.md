---
feature: "adaptive-developer-cap"
context: "harness"
created: "20261102_1646"
status: planning
---

# Implementation Plan

## Feature
adaptive-developer-cap

## Objective
Replace the fixed developer cap of 4 with a live cap the controller scales itself: start at min(2, ceiling), +1 per clean parallel wave decided in wave order, halve on a contention-shaped verify failure followed by one re-run, bounded by the configurable ceiling `harness.developers.max` (default 6) that `kf tasks --json` reports. Add the `worktree.domains` switch (default true) so a project can turn the `.test` domain layer off: no infra probes, the direct `127.0.0.1:<port>` URL shown, routes still registered for port uniqueness.

## Implementation Scope
### Implement Now
- `harness.developers.max` validation in `validateHarness` and the `developers` field in `kf tasks <f> --json` (TASK-001).
- The live-cap rules in the implement skill and its task-loop reference (TASK-002).
- A `kf loop-stats` fixture proving a live-cap ledger parses with unchanged figures (TASK-003).
- The plan skill's `Execution:` line at wave width (TASK-004).
- `worktree.domains` config + probes gated (TASK-006); direct-URL output and no `KFW_WORKTREE_DOMAIN` when off (TASK-007).
- README, Pages site, workflow docs, skills/agent domain wording and this repo's config (TASK-005).

### Supporting Features
- Issue #126 body rewritten to the chosen design and #129's body given the task checklist — done by the controller with `gh issue edit` after approval, not a code task.

### Future Features
- Carrying the reached N from one work item to the next (a peak column in `.works/loop-metrics.md`).
- Measuring the 5-hour usage window.

### Explicitly Not Implemented
- A config key for the start value or the step rules.
- `developers` in `kf tasks --graph --json` (the controller reads `--json`; the graph output keeps its key set).
- Any change to `src/workflow/loop-stats.ts`.
- Skipping route registration or making `.kfw.json` `domain` optional when domains are off.
- Edits to the released CHANGELOG 0.14.0 section or to historical canonical docs of parallel-developers and loop-throughput.

## Task Breakdown

| Task | Description | Area | Dependencies | Expected output | FR / UC references | Files |
|---|---|---|---|---|---|---|
| TASK-001 | `HarnessConfig` gains `developers?: { max?: number }`; `validateHarness` rejects a non-object `harness.developers` (`harness.developers must be an object { max? }`) and a `max` that is not an integer 1..16 (`harness.developers.max must be an integer from 1 to 16`), leaving legacy keys carried through. Export `DEFAULT_DEVELOPER_MAX = 6`. `cmdTasks --json` (plain, not `--graph`) reads the project config and emits `{feature, tasks, developers: {max, source}}`, `source` `"config"` when the key is set, else `"default"`; an invalid config fails the command with the validation message. | CLI / config | - | Validated key, additive JSON field, tests green | FR-004 / UC-005 | src/project/harness-config.ts, src/cli/commands/tasks.ts, src/tests/harness-config.test.ts, src/tests/tasks-command.test.ts |
| TASK-002 | Rewrite the cap rules in the implement skill and the task-loop reference: live cap N (same seats counted), start `Ruling: developer cap <N> — start`, ceiling read from `kf tasks <f> --json` `developers.max`; step up in wave order once a wave and every earlier wave are complete, parallel waves only, bounded by the ceiling and the widest incomplete wave, ruling grammar; contention signatures (exact list), which verify runs count, halving once per contention event, `Note TASK-NNN: verify rerun — contention <signature>`, dispatch hold until fewer than N in flight, one re-run, then fix loop or the other-task routing; wait line `TASK-NNN: developer waits — <N> developers in flight` in grammar, example and the waiting-developers paragraph; resume rules (a)–(d) incl. a lowered ceiling; rationalisation row. "next 4 tasks" (test-writers ahead) stays. Update the surface tests that pin the old wording and add `src/tests/adaptive-cap-surface.test.ts` for the new rules. | Skills | - | Skill prose + surface tests green | FR-001, FR-002, FR-003, FR-004, FR-005 / UC-001, UC-002, UC-003 | skills/implement/SKILL.md, skills/implement/references/task-loop.md, src/tests/loop-parallel-surface.test.ts, src/tests/loop-ledger-surface.test.ts, src/tests/adaptive-cap-surface.test.ts |
| TASK-003 | Add fixture `adaptive-cap.ledger.md` (wait lines `2 developers in flight` and `3 developers in flight`, `Ruling: developer cap 2 — start`, `Ruling: developer cap 2 → 3 — wave 1 clean`, `Ruling: developer cap 3 → 1 — EADDRINUSE in TASK-004 verify`, `Note TASK-004: verify rerun — contention EADDRINUSE`, a re-run `verify started`/`verify done exit=0`) with `adaptive-cap.expected.json`, and a `kf loop-stats` test asserting the expected figures and an empty unparsed list. | Tests | - | Fixture test green, no loop-stats code change | FR-005 / UC-003 | src/tests/loop-stats.test.ts, src/tests/fixtures/loop-stats/adaptive-cap.ledger.md, src/tests/fixtures/loop-stats/adaptive-cap.expected.json |
| TASK-004 | `skills/plan/SKILL.md`: `Execution: wave <w> parallel, <N> developers` with N = the wave width (no clamp), the line is the most the wave can use and the live cap decides how many run; the approval summary says the cap starts at min(2, `harness.developers.max`) and scales itself. Update `src/tests/inline-execution.test.ts` (`min(wave width, 4)` → the new phrase). | Skills | - | Plan prose + test green | FR-006 / UC-004 | skills/plan/SKILL.md, src/tests/inline-execution.test.ts |
| TASK-006 | `WorktreeConfig` gains `domains: boolean`; `parseWorktreeConfig` rejects a non-boolean (`worktree.domains must be boolean`); `worktreeConfig` defaults it to `true`. `kf validate` (inspect.ts) and `kf doctor` run `probeDomainInfra` only when `enabled && domains`. Tests: parse/default cases, validate and doctor with `domains:false` emit no infra finding (probe stubbed or unreachable), with `domains:true` unchanged. | Config / CLI | - | Switch parsed, probes gated | FR-009, FR-010 / UC-006 | src/worktree/config.ts, src/cli/commands/inspect.ts, src/cli/commands/doctor.ts, src/tests/worktree-domains.test.ts |
| TASK-007 | With `domains:false`: `status.ts` and `transition.ts` print `Direct:   http://127.0.0.1:<port>` instead of the `Domain:` line; `kf worktree create`/`list` print `direct:` only, no `domain:`; `lifecycle.ts` hook env omits `KFW_WORKTREE_DOMAIN` (keeps PATH/PORT/BRANCH); route registration and port allocation unchanged; JSON outputs (`kf status --json`, `kf worktree list --json`) unchanged. With `domains:true` text output byte-identical to today. Tests over each output and the env. | CLI / worktree | TASK-006 | Direct URL output when off | FR-011 / UC-006 | src/workflow/status.ts, src/workflow/transition.ts, src/cli/commands/worktree.ts, src/worktree/lifecycle.ts, src/tests/worktree-domains-output.test.ts |
| TASK-005 | User-facing docs: README.md (loop paragraph ~271, harness block ~216 adds `developers.max`), `.github/pages/index.html` (~158), `docs/workflow/harness.md` (harness block documents `harness.developers.max`; :42 `N = min(wave width, 4)` → wave width; :44 loop paragraph and wait line), `docs/workflow/lifecycle.md` (~67), `docs/workflow/cli-reference.md` (`kf tasks --json` row gains `developers`; :46 loop-stats row `4 developers in flight` → `<N> developers in flight`). Update `src/tests/open-source-surface.test.ts` :418-420 and :436 to the live-cap wording; :469 (released 0.14.0 CHANGELOG text) stays. Domain switch: README (~158-160 and the config block) and `docs/workflow/autoconfig.md` (:68 `worktree_infra_missing`) and the Pages site document `worktree.domains`; `skills/implement/SKILL.md` (:26), `skills/test/SKILL.md` (:28,36), `skills/review/SKILL.md` (:26), `skills/implement/references/automation-writer-brief.md` (:22,45) and `agents/automation-writer.md` (:17,32,66) say to use `http://127.0.0.1:<port>` when `worktree.domains` is false in `.kf/config.json` (JSON outputs still carry `domain`); `docs/workflow/autoconfig.md` (:68, :94) and `docs/workflow/cli-reference.md` (:54,64,66) say `KFW_WORKTREE_DOMAIN` and the domain exist only when domains are on; `src/cli/args.ts` (:234) help mentions the switch; this repo's `.kf/config.json` sets `"domains": false`; `src/tests/worktree-domains-surface.test.ts` pins that wording. | Docs | TASK-001, TASK-002, TASK-006, TASK-007 | Docs and Pages consistent, surface tests green | FR-007, FR-011, FR-012 / UC-001, UC-005, UC-006 | README.md, .github/pages/index.html, docs/workflow/harness.md, docs/workflow/lifecycle.md, docs/workflow/cli-reference.md, docs/workflow/autoconfig.md, skills/implement/SKILL.md, skills/test/SKILL.md, skills/review/SKILL.md, skills/implement/references/automation-writer-brief.md, agents/automation-writer.md, .kf/config.json, src/cli/args.ts, src/tests/open-source-surface.test.ts, src/tests/worktree-domains-surface.test.ts |

Execution: wave 1 parallel, 5 developers
Execution: wave 2 inline
Execution: wave 3 inline

## Complexity
- Level: medium
- Reason: one small code change (config + additive JSON) and a precise rewrite of prose contracts pinned by about six surface-test files; the risk is wording consistency, not algorithmic.

## Impact Analysis

| Area | Impact |
|---|---|
| Backend | `validateHarness` gains one optional block; `cmdTasks --json` reads the project config (new failure path on an invalid config). |
| Frontend | None. |
| Database | None. |
| API | `kf tasks --json` gains `developers` (additive); `.kf/config.json` gains optional `harness.developers.max`. |
| Infrastructure | None. |
| Security | None; the value is an integer bounded 1..16. |
| Performance | Runtime throughput of the task loop changes: start at 2 instead of 4, growth up to the ceiling. |
| Regression (domains) | `domains` absent or true must keep every probe and output byte-identical; route writes and port allocation untouched. |
| Regression | Byte-exact `tasks --json` test (tasks-command.test.ts:222-237), surface tests pinning "cap of 4" / "4 developers in flight" / "min(wave width, 4)"; `harness.parallel` must stay a legacy key. |
| Dependencies | None added. |

## Risks and Mitigation

| Risk | Impact | Mitigation / rollback |
|---|---|---|
| An invalid `harness.developers` now makes `kf tasks` fail (it never read config before) | Controller cannot read overlaps until the config is fixed | The message names the field; documented in harness.md; same behaviour every other command already has on an invalid config |
| A `verify rerun` line shaped `TASK-NNN: verify …` would be read by `kf loop-stats` as unparsed | Noise in loop-stats output | Rerun is a `Note TASK-NNN:` line; TASK-003 asserts an empty unparsed list |
| Removing the literal "cap of 4" breaks 5 test files at once | Red suite mid-loop | TASK-002 owns loop-parallel and loop-ledger surface tests, TASK-005 owns open-source-surface; no task touches another's tests |
| Prose rules read differently by two controllers | Different N from one ledger | Rules keyed only to ledger lines (wave order, cap rulings, Note rerun); TASK-002 surface tests pin each rule phrase |
| `domains:false` but routes still written to the machine routes file | A stale route if the proxy ever runs | Intended: keeps ports unique across repos (scout manager.ts:90); `kf worktree list` already reports stale routes |
| `.kfw.json` `domain` is a required field | Making it optional would ripple to 6 readers | Keep computing and storing it; only output and env change |
| `unreleased()` in open-source-surface reads the released 0.14.0 section | Editing CHANGELOG would rewrite history | CHANGELOG untouched in this item; entry written at release |

## Architecture Constraints
- `validateHarness` keeps carrying legacy keys through unvalidated (`e88fd61`, #115).
- `harness.parallel` stays in `LEGACY_HARNESS_KEYS`; the new key lives under `harness.developers`.

## Implementation Constraints
- No change to `src/workflow/loop-stats.ts`.
- `kf tasks --graph --json` key set unchanged.
- The "next 4 tasks" test-writer window is a separate constant and stays.

## Global Constraints
- The loop starts at N = min(2, ceiling) and ledgers `Ruling: developer cap <N> — start — cost if wrong: <…>`.
- Ceiling: `harness.developers.max`, integer 1..16, default 6; the start value and step rules are not configurable.
- Step up: +1 per clean parallel wave, decided in wave order once that wave and every earlier wave are complete; inline waves never change N; never above the ceiling nor the widest incomplete wave.
- Contention signatures, exactly: `EADDRINUSE`, `index.lock`, `database is locked`, `SQLITE_BUSY`, `Lock wait timeout exceeded`, `ETIMEDOUT`, `ECONNREFUSED`, `Test timed out`, `Hook timed out`.
- Step down: N = max(1, ⌊N/2⌋) at most once per contention event, then `Note TASK-NNN: verify rerun — contention <signature>` and one re-run once fewer than N developer seats are in flight.
- Wait line: `TASK-NNN: developer waits — <N> developers in flight`.
- Only the controller's ledgered verify runs count; `kf verify --stage` and developers' own runs do not.
- `harness.parallel` must not reappear as a config key; the `kf tasks --json` change is additive.
- `worktree.domains` is a boolean, default `true`; with it absent or true every probe, output and env var is unchanged.
- With `worktree.domains: false`, route registration and port allocation are unchanged and `.kfw.json` still stores `domain`.

## Review Focus
- `harness.developers` present with only legacy keys elsewhere: `validateHarness` still carries `parallel` etc. through and `kf doctor` still warns on them, not on `developers`.
- `harness.developers: {}` (no max): `kf tasks --json` reports `max: 6, source: "default"` (TASK-001 test).
- A ledger with no `Ruling: developer cap` line (pre-feature): resume starts at min(2, max) — stated in TASK-002 prose and pinned by its surface test.
- Wave 3 complete before wave 2: no step-up ruling for wave 3 until wave 2's is decided — pinned by TASK-002 surface test on "wave order".
- `harness.developers.max: 1`: start 1, never steps up — pinned by TASK-002 surface test on min(2, max).

- Old registration created with domains on, config now `domains:false`: status prints the direct URL only (TASK-007 test).

## Testing Strategy
- Unit: `validateHarness` cases (accept 1, 16; reject 0, 17, 2.5, "4", non-object `developers`; legacy keys still carried); surface tests over the skill and plan text for every Global Constraint line.
- Integration: `kf tasks <f> --json` CLI run with and without the key, and with an invalid value; `kf loop-stats` over the live-cap fixture.
- Domains switch: unit tests for `parseWorktreeConfig`/`worktreeConfig` and the hook env (TC-012, TC-015); integration runs of `kf validate`, `kf doctor`, `kf status`, `kf stage`/`kf approve` transition note and `kf worktree create|list` with `domains` off and on (TC-013, TC-014); surface test over skills, agent, docs and this repo's config (TC-016).
- E2E: none (no UI).
- Coverage target: >= 80%

## Documentation Impact
- `README.md`, `.github/pages/index.html`, `docs/workflow/harness.md`, `docs/workflow/lifecycle.md`, `docs/workflow/cli-reference.md` — TASK-005.
- `.kf/config.json` schema (`harness.developers.max`) documented in the harness block of `docs/workflow/harness.md` and README — TASK-005.
- `kf tasks --json` output (`developers` field) documented in `docs/workflow/cli-reference.md` — TASK-005.
- `skills/implement/SKILL.md`, `skills/implement/references/task-loop.md` — TASK-002; `skills/plan/SKILL.md` — TASK-004.
- `worktree.domains` in `.kf/config.json`, `kf status` / `kf worktree` output, `skills/test/SKILL.md`, `skills/review/SKILL.md`, `agents/automation-writer.md`, `docs/workflow/autoconfig.md` — TASK-005 (output itself TASK-007).
- `CHANGELOG.md` — written at release (the 0.14.0 section is released and stays as is).
- GitHub issue #126 body — rewritten by the controller with `gh issue edit` after approval; #129 body gets the task checklist.

## Definition of Done
- [ ] Implementation complete
- [ ] Unit tests
- [ ] Integration tests where applicable
- [ ] Coverage meets the agreed target
- [ ] E2E tests when required by the agreed Test Level
- [ ] All test cases pass
- [ ] Review passes
- [ ] Documentation updated
- [ ] Feature report generated
