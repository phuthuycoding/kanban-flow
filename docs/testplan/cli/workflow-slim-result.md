---
feature: "workflow-slim"
context: "cli"
tested: "20261101_0806"
execution: "97b3923b-2dd7-40eb-a52b-d64822d4ba92"
status: PASS
---

# Testing Result

## Feature
workflow-slim

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0
- Tooling: vitest 2.1.9 with @vitest/coverage-v8; checks, suite, coverage and focused groups run in the item worktree at HEAD b1f2775 (script /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/run.sh, summary all.log). Behaviour runs are carried forward from execution f0101163 (CLI = `node dist/index.js` built at 7efa5eb, wrapper …/scratchpad/t3/bin/kf): they ran in scratch git repos under /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t12 with `HOME` redirected, `repository: "o/r"` in .kf/config.json, a local bare origin, and a `gh` stub (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t12/ghbin/gh) that logs every call, answers `pr list` with `[]`, and fails every call when `GH_FAIL` is set; TC-027 read-only `gh` checks from execution 05dd5d76 (nothing on GitHub changed since)

## Execution Time
2026-11-01 08:06–08:21 (re-test at b1f2775 after the test-only fix for the CI test (22) race in src/tests/drive.test.ts; the f0101163 PASS report at 7efa5eb is kept as reviews/f0101163-c056-46ee-bb45-3794e27c5d9b/phase-4-testing-result.f0101163.md)

Change since f0101163 (`git diff 7efa5eb b1f2775 --stat`, run in the worktree):

```
 src/tests/drive.test.ts | 3 ++-
 1 file changed, 2 insertions(+), 1 deletion(-)
```

No production code changed: the test "one of two concurrent drives starts; --stop ends it and keeps worktrees" now waits until `git worktree list` shows `demo.tasks/task-001` as well as TASK-001 running before it sends `--stop`.

## Summary
| Metric | Result |
|---|---:|
| Total | 36 |
| Passed | 36 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

TC-027 passes on its allowed BLOCKED branch; TC-029 with the recorded `gh pr merge <n>` deviation. Every TC was re-run at b1f2775 through the focused groups below (all exit 0) and the full suite (1180/1180). Behaviour-run evidence in the Actual column is carried forward from f0101163 and earlier executions; no production code changed since then.

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | 8 stages, done=6, cancelled=-1, review → done/implementation/planning | as expected; shipping/dones only in LEGACY_STAGE_NAMES | schema, transition tests (group TC-001..004) |
| TC-002 | Integration | PASS | `kf stage <f> shipping` / `dones` exit 1 with hint, item unchanged | as expected | ship, transition tests |
| TC-003 | Integration | PASS | dones → done, shipping → review/done, once only | as expected; behaviour run: `good` migrated from .works/dones to .works/done; round 3 (193c67fb): a legacy dir left with dotfiles only (.DS_Store) is removed by `kf status` (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t6/legacy.log); round 4 (4515efc5): .works/dones with a user's .notes.md plus .DS_Store is kept and doctor names .notes.md (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t7/legacy.log) | migrate tests; 05dd5d76 status.log and /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t4/status.log |
| TC-004 | Unit | PASS | legacy statusMap keys mapped/dropped and flagged; hook env DONE only | as expected; round 2 adds legacy harness.stages keys (dones read as done, shipping dropped) | repository, hooks, harness-config tests |
| TC-005 | Integration | PASS | approve moves to implementation and creates the worktree | as expected | approve tests |
| TC-006 | Integration | PASS | failing implementation hook → exit 1, stays in planning, approval restored | as expected | approve-failures tests |
| TC-007 | Integration | PASS | `--backlog` parks the item | as expected | approve tests |
| TC-008 | Unit | PASS | no start-now / ship-or-archive wording | as expected | autoconfig, status, agents-file, skill-scope tests |
| TC-009 | Integration | PASS | PASS with `ci: red` refused | `review_ci_red` | reports tests |
| TC-010 | Integration | PASS | `review_pr_missing` / `review_landing_missing` | as expected; also seen in behaviour run on a legacy PASS report | reports tests; 05dd5d76 status.log and /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t4/status.log |
| TC-011 | Integration | PASS | stale-execution PASS never closes | `review_stale` | auto-close tests |
| TC-012 | Unit | PASS | review skill order, ci-watch under kanban-review, template fields, kanban-ship gone | as expected; round 2 ci-watch (cancelled runs superseded only by a later green run of the same workflow); round 3 (193c67fb): ci-watch keys cancelled-run supersede on the workflow id and exits 4 with its own line on an unsettled finished set (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t6/ci.log) | open-source-surface (21/21), ci-watch tests |
| TC-013 | Integration | PASS | merged PR → `kf status --change` closes: hook, worktree, branches, docs | as expected; round 3 (193c67fb): every close (`kf stage done`, `--force` included, `kf archive`) refuses under a live worker run and names the run record (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t6/liverun.log); round 4 (4515efc5): `kf stage <f> done --force` under a live run: first line names the run record, hint is `kf stage <f> done --force` (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t7/liverun.log) | auto-close tests |
| TC-014 | Integration | PASS | dirty worktree refuses close | as expected | auto-close tests |
| TC-015 | Integration | PASS | primary behind origin → docs on an unpushed docs branch | as expected; round 2: a docs branch counts as landed only with merge proof; round 5 (b4504f1a): the close records docsBranch and docsCommit in .kfw.json (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t8/land-squash.log); round 6 (27ab1060): a done-item `kf archive` re-lands never-landed docs through the same target: new docs branch from origin/main on a stale primary, working tree on a clean current one (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t9/s2.log, s3.log); round 7 (e3d69dce): a gone docs branch on a done-item `kf archive` re-lands only on a fresh docs branch from origin/main, also from a clean current primary; refused when origin/HEAD is unset (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t10/a.log, b.log) | archive-docs, doctor tests |
| TC-016 | Integration | PASS | open PR → Next names merge; closed unmerged → refuse | as expected | auto-close, sync tests |
| TC-017 | Integration | PASS | `landing: none`: 0 commits closes, commits refuse | as expected | auto-close, sync tests |
| TC-018 | Integration | PASS | `kf ship` exit 1, deprecation text, writes nothing | as expected | ship tests |
| TC-019 | Unit | PASS | done.sh in both hook packs, no shipping.sh/dones.sh | as expected | doctor, hooks tests |
| TC-020 | Unit | PASS | resolveDriveConfig worktree → origin → primary | as expected | harness-config tests |
| TC-021 | Integration | PASS | drive uses the worktree copy; changed copy stops | as expected; behaviour run: changed worktree verify argv refused, `--accept-config` resumes and records; round 4 (4515efc5): origin/HEAD retargeted to the item branch → primary copy is the base and the warning says so (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t7/drive2.log) | drive, drive-config-accept tests; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t3/drive.log (05dd5d76, at 7abd578) |
| TC-022 | Unit | PASS | travel skill surface | as expected | travel-surface tests |
| TC-023 | Unit | PASS | amended learning cases | as expected | travel-estimates tests |
| TC-024 | Unit | PASS | measure appends the row | as expected | travel-estimates tests |
| TC-025 | Unit | PASS | stats budget, hit rate, bias, throughput, calibration | as expected | travel-estimates tests |
| TC-026 | Unit | PASS | default budget; week-over-week warning | as expected | travel-estimates tests |
| TC-027 | Integration | PASS (allowed BLOCKED branch) | Epic created, or API refusal recorded, #100 open, no label | read-only re-check today: owner type User, repo issue types Task/Bug/Feature (no Epic), #100 OPEN, #95 type null, labels [enhancement]; create refusal (HTTP 404) recorded in execution 36fa0885 and not re-sent | live gh read-only; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/test/tc027.log |
| TC-028 | Unit | PASS | overlap → sequential/parallel | as expected | travel-estimates tests |
| TC-029 | Integration | PASS (deviation noted) | `kf status --all` buckets; C row shows `gh pr merge 7 --squash` | buckets Needs you / Waiting to merge / Running and --json as expected, but the C row is `gh pr merge 7` with no method. Deliberate (FINDING-034, loop/progress.md "Repair round 2"); the approved TC text was not edited and needs re-approval to match; round 3 (193c67fb): never-pushed docs branch shows `awaiting push` with no gh call; pushed-but-unproven shows a one-line reason (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t6/docsbranch.log); round 4 (4515efc5): docs branch pushed without -u then pruned, merged PR at the tip → no Waiting line; branch gone everywhere → `remove docsBranch from …`; unverifiable merge gate keeps the full text under Needs you (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t7/docsbranch.log, mergegate.log); round 5 (b4504f1a): docs branch proven landed by a squash-merged PR at docsCommit → docsLanded, no line, second poll 0 gh calls; stale same-name PR → Needs you `canonical docs for demo never landed …`; gh timeout skips the next lookup (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t8/land-*.log, timeout.log); round 6 (27ab1060): a live unpushed docs branch is left alone by `kf archive`; legacy items without docsCommit are proven by content with 0 gh calls (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t9/s1.log, s45.log); round 8 (1384196e): gone branch with docsCommit and origin/HEAD unset → set-head remedy, 0 gh calls; no origin → `git remote add origin <url>`; gh failing → same rerun step in `kf status --all` and doctor (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t11/r8.log); round 9: no check could run → `not proven landed` in status text/JSON and doctor, 0 gh; lookup found nothing → `never landed`; gh failing → JSON entry `kind: lookup-rerun` + `next`, text prints next (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t12/r9.log) | auto-close test "kf status --all ends with Needs you, Waiting to merge and Running" asserts `c — <PR>: gh pr merge 7`; status-buckets tests |
| TC-030 | Unit | PASS | reviewer surface | as expected | review-agents-surface tests |
| TC-031 | Integration | PASS | doctor `statusmap_legacy` + `--fix` | as expected | doctor tests |
| TC-032 | Integration | PASS | `docs_branch_unpushed` until pushed | as expected; round 2 message names why the branch is not proven merged; round 3 (193c67fb): doctor message for a never-pushed branch drops the unproven reason (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t6/docsbranch.log); round 5 (b4504f1a): after `kf archive` on the done item the never-landed docs are rewritten into the working tree and docsRelanded replaces the record (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t8/land-stale.log); round 6 (27ab1060): the tree re-land keeps the record and Needs you shows until the docs reach origin/main, then `kf status --all` records docsLanded by content (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t9/s3.log); round 7 (e3d69dce): doctor and `kf status --all` print `git remote set-head origin -a` as the remedy when origin/HEAD is unset (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t10/a.log); round 8 (1384196e): re-land after a lookup that could not run says `not proven landed (<reason>)` and adds the do-not-merge line (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t11/r8.log); round 9: no-origin `kf archive` refusal names `git remote add origin <url>`; gh-failing re-land shows the ⚠ do-not-merge warning (/private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t12/r9.log) | doctor, auto-close tests |
| TC-033 | Integration | PASS | refusing done hook keeps worktree and branch | as expected | auto-close tests |
| TC-034 | Integration | PASS | worker log streams; status/heartbeat/tail readable | as expected (fake runner); drive.test.ts run 5 times at b1f2775: 42/42 each | drive, drive-watch, drive-log tests; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/drive1.out … drive5.out |
| TC-035 | Integration | PASS | worker error text in task and stop reasons | as expected | drive tests |
| TC-036 | Integration | PASS | usage limit stops without spending a run; resume same session | as expected | drive tests (fake 429 runner) |

## Behaviour run

Carried forward from execution f0101163 (run at 7efa5eb). Not re-run: the only change since is the test file shown above, so the CLI under test is the same code.

Script /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t12/r9.sh, output r9.log (shared setup in common.sh). All CLI runs used the 7efa5eb build, after the test runs finished. Each case closes a review item `demo` with the primary 2 commits behind origin/main (so the close records docsBranch docs/app-demo and a docsCommit), then deletes the never-pushed local branch. "Counts" = occurrences of the phrase in the `kf status --all` text, its `--json` output and `kf doctor`.

1. docsCommit, origin/HEAD unset (`git remote set-head origin -d`):
- `kf status --all` → exit 0; Needs you: `demo — run git remote set-head origin -a first, then re-run kf status --all: canonical docs for demo are not proven landed (… origin/HEAD is not set …)`. `--json` → exit 0, the same text as the needsYou decision. `kf doctor` → exit 0, `… which is gone here, and are not proven landed (…)` → `git remote set-head origin -a, then re-run kf doctor`.
- Counts "never landed" 0 / 0 / 0, "not proven landed" 1 / 1 / 1. **0 gh calls** over the three commands.

2. docsCommit, origin/HEAD set, the lookup runs and finds no merged PR (stub `[]`):
- `kf status --all` → Needs you: `demo — canonical docs for demo never landed (… no merged PR has docs/app-demo as its head): re-land them on a fresh docs branch for a PR with kf archive demo, or leave them`; `--json` same; `kf doctor` → `… nothing proves they landed (…)` → `canonical docs for demo never landed: re-land them …`.
- Counts "never landed" 1 / 1 / 1, "not proven landed" 0 / 0 / 0. 3 gh calls (one per command).

3. gh failing (`GH_FAIL=1`), primary current and clean:
- `kf status --all` → Waiting to merge: `demo — docs/app-demo not proven merged (… gh pr list failed: …): re-run kf status --all once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive demo`.
- `kf status --all --json` → waitingToMerge entry `{"feature":"demo","docsBranch":"docs/app-demo","command":"kf status --all","reason":"…","kind":"lookup-rerun","next":"re-run kf status --all once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive demo"}`: the text line prints exactly `next`.
- `kf doctor` → `→ nothing to push; re-run kf doctor once the merged-PR lookup can run, or re-land them …`. Neither phrase ("never landed" / "not proven landed") appears, which fits: this case is "not proven merged", waiting on a lookup.

5. gh-failing re-land (same repo): `kf archive demo` → exit 0, `Canonical docs not proven landed (… gh pr list failed: …); committed again to docs/app-demo …` + 6 docs, then `  ⚠ If the earlier PR did merge, this PR reverts later edits to these docs: do not merge it.` (indented ⚠ warning, capitalised; the 1384196e cosmetic observation is resolved), the hooks note and the push line. 1 gh call.

4. No origin remote (`git remote remove origin`): `kf archive demo` → exit 1 (asserted with `test $? -eq 1`), stderr `docs target`: `Cannot archive 'demo': there is no origin to cut a docs branch from (add it: git remote add origin <url>), and the docs branch docs/app-demo is gone and nothing proves its docs landed, so the rewrite must show in a PR diff.` Tree, HEAD and meta unchanged; 0 gh calls.

Not run: a close whose `git push origin --delete` hangs; real GitHub; `hasRemote` throwing on a git failure (unit-tested in has-remote.test.ts); the travel skill reading `next` (skill text, surface test only).

Changed behaviour no test touches (checked by hand only, or not at all):
- Wording consistency across the three surfaces in each case, counted by hand above.
- Round-9 skill and doc text (travel SKILL.md, daily-plan.md, docs/workflow/cli-reference.md): surface tests and file reads only.
- From earlier executions, still hand-only: `kf run` warning ordering as a real process; seeded AGENTS.md wording (TC-008); `kf drive --watch --tail` as a process.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `git diff 7efa5eb b1f2775 --stat` (worktree) | 0 | `src/tests/drive.test.ts \| 3 ++-`, 1 file changed, 2 insertions(+), 1 deletion(-) |
| `npm run typecheck` (worktree, HEAD b1f2775) | 0 | /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/tc.out |
| `npm run lint` (oxlint src) | 0 | /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/lint.out |
| `npm run build` | 0 | /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/build.out |
| `npm test` | 0 | 79 files, 1180 tests, 1180 passed; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/npmtest.out |
| `npx vitest run --coverage --coverage.provider=v8 --coverage.reporter=json-summary --coverage.reporter=text …` (full suite, NODE_V8_COVERAGE set) | 0 | 79 files, 1180/1180; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/cov/run.log, /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/cov/out/coverage-summary.json |
| `node …/scratchpad/test/cov2/est.js /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/cov/v8 skills/travel/scripts/estimates` | 0 | lines 232/233, functions 60/60, branch ranges 145/158 |
| `npx vitest run src/tests/drive.test.ts` × 5 | 0 | each of the 5 runs exit 0, 1 file, 42/42 (run 1 42/42, run 2 42/42, run 3 42/42, run 4 42/42, run 5 42/42); /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/drive1.out … drive5.out |
| `npx vitest run` schema, ship, transition, migrate, repository, hooks, doctor, doctor-upgrade | 0 | 8 files, 148/148 (TC-001..004) |
| `npx vitest run` approve, approve-failures | 0 | 2 files, 20/20 (TC-005..007) |
| `npx vitest run` autoconfig, status, agents-file, skill-scope | 0 | 4 files, 57/57 (TC-008) |
| `npx vitest run` reports, auto-close, workflow, archive-delivery, archive-docs, cancel, cancel-item | 0 | 7 files, 239/239 (TC-009..017) |
| `npx vitest run` open-source-surface | 0 | 1 file, 21/21 (TC-012) |
| `npx vitest run` auto-close, ship, archive-delivery, harness-config, drive, install (5 files), sync | 0 | 11 files, 228/228 (TC-017..021) |
| `npx vitest run` travel-estimates, travel-surface, init-gitignore | 0 | 3 files, 67/67 (TC-022..028) |
| `npx vitest run` auto-close, doctor, drive, drive-watch, review-agents-surface, harness-run, status-buckets | 0 | 7 files, 180/180 (TC-029..036) |
| `npx vitest run` auto-close, docs-landed-proof, doctor, status-buckets, status-docs-branch-gone, archive-docs, archive-item, git | 0 | 8 files, 157/157; group log /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/groups.log |
| `npx vitest run` has-remote, travel-surface, status-buckets, status-docs-branch-gone, docs-landed-proof (round-9 files) | 0 | 5 files, 41/41; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/grp-r9.out |
| `kf status --all`, `kf status --all --json`, `kf doctor` (1: origin/HEAD unset; carried forward from f0101163, as are the four rows below) | 0 | not proven landed everywhere, 0 gh calls; /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t12/r9.log |
| same three (2: lookup found nothing) | 0 | never landed everywhere |
| same three (3: gh failing) | 0 | JSON `kind: lookup-rerun` + `next`; text prints next |
| `kf archive demo` (5: gh failing) | 0 | ⚠ do-not-merge warning |
| `kf archive demo; test $? -eq 1` (4: no origin; the CLI exits 1 by design) | 0 | refusal names `git remote add origin <url>` |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| CI test (22): drive.test.ts "one of two concurrent drives starts; --stop ends it and keeps worktrees" | `--stop` could land after the task was claimed but before its worktree was added | test-only race; fixed in b1f2775 | none: 5 of 5 local runs of drive.test.ts pass (42/42); CI re-run not observed here |
| Review 1384196e REJECT (2 MEDIUM) | repaired in round 9 (7efa5eb) | the paths the coordinator named were run for real (carried forward) and behave as specified | none |
| Earlier executions (05dd5d76 FAIL BR-DOCTOR-01; review findings of 9aeae490 … e3d69dce; the 1384196e do-not-merge layout observation) | fixed in earlier rounds | covered by the suite at b1f2775 | none |
| TC-029 wording | approved TC expects `gh pr merge 7 --squash`; CLI prints `gh pr merge 7` (FINDING-034, deliberate) | wording only | re-approve the TC text at the next contract edit |
| TC-027 (Epic create) | GitHub issue types are org-level; owner is a User account (HTTP 404 recorded earlier) | Epic cannot be created; #95 untyped; #100 open | human: GitHub-side change or move the repo under an organization |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| New helpers, lines (schema, migrate, approve, project config, drive claim, archive, validate-reports, install, hooks) | 80% | every file ≥ 90.2%: schema 100, migrate 98.57, approve 90.21, config 95.23, claim 95.1, archive 95.53, validate-reports 95.45, install 92.12, hooks 100 | /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/cov/out/coverage-summary.json |
| Same files, functions | 80% | 100% each | same |
| Same files, branches (informational) | N/A — the target does not name a branch metric | approve 79.31, hooks 76.08 (below 80); migrate 85.71, claim 89.75, archive 88.18, install 89.84, validate-reports 93.96, config 96.64, schema 100 | same |
| Round-9 files, lines / branches / functions (informational) | N/A — outside the approved target | commands/archive.ts 98.9 / 86.9 / 100; inspect.ts 84.16 / 84.7 / 91.66; doctor.ts 96.08 / 88.48 / 100; git.ts 97 / 86.33 / 100; canonical-docs.ts 93.75 / 87.17 / 100; status.ts 97.06 / 91.9 / 100 | same |
| travel estimates script (child-process V8 dumps, own merge — approximate) | 80% | 99.6% lines (232/233), 100% functions; ~91.8% branch ranges | est.js output |
| Overall code coverage | N/A — the approved target covers the new helpers only | informational: 89.92% lines, 86.51% branches, 96.15% functions | /private/tmp/claude-501/-Volumes-Labs-Code-projects-kaban-flow/6fd2dae8-44e9-4d5b-a60b-7ed529e3a020/scratchpad/t13/cov/out/coverage-summary.json |

## Regression
Full suite 1180/1180 at b1f2775, twice (plain and coverage run), 79 files, the same counts as f0101163 at 7efa5eb (the fix changes one assertion's wait, not the test count). drive.test.ts 42/42 on 5 of 5 runs. Focused groups re-run for every TC range, all exit 0, the same counts as f0101163. Coverage figures are the same as f0101163. Earlier failures stay fixed. Worktree `git status --short` empty after all runs.

## Conclusion
- PASS: all 36 approved test cases pass at b1f2775 (TC-027 on its allowed BLOCKED branch, TC-029 with the deliberate no-method merge command). typecheck, lint and build exit 0, the full suite passes 1180/1180 (plain and coverage), drive.test.ts passes 42/42 on 5 of 5 runs after the race fix, and line and function coverage of the target helpers is above 80%. Carried forward from f0101163 (no production change since, see the diff stat): the round-9 paths were run for real: with origin/HEAD unset, status text, JSON and doctor say "not proven landed" (never "never landed") with 0 gh calls; after a lookup that found nothing they say "never landed"; with gh failing the JSON entry carries `kind: lookup-rerun` and `next`, printed verbatim in the text; the no-origin `kf archive` refusal names `git remote add origin <url>`; the gh-failing re-land shows the ⚠ do-not-merge warning. Open for review: branch coverage of approve.ts and hooks.ts below 80% (informational).
