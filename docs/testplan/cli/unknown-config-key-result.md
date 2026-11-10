---
feature: "unknown-config-key"
context: "cli"
tested: "20261110_1241"
execution: "05c67c47-804d-41ec-bfe1-bf378e64811d"
status: PASS
---

# Testing Result

## Feature
unknown-config-key

## Summary

| Metric | Result |
|---|---:|
| Total | 7 |
| Passed | 7 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | Unit | PASS | `worktrees` → WARNING with `did you mean "worktree"?` | as expected | src/tests/doctor.test.ts "hints the known key when an unknown key is its plural" |
| TC-002 | Unit | PASS | `notes` → keep-as-a-note action | as expected | "offers the keep-as-a-note action when no known key is near" |
| TC-003 | Unit | PASS | fresh config and legacy ship/stack/defaultContext → no finding | as expected | "stays silent for a fresh config and for the legacy …" |
| TC-004 | Unit | PASS | invalid JSON, shape-refused, missing → no finding, existing finding reported | as expected | "reports nothing when the config is invalid JSON, shape-refused or missing" |
| TC-005 | Unit | PASS | foos, Worktree, context, ships in order; only context hints | as expected | "warns per key in file order, hinting only near matches of non-legacy keys" |
| TC-006 | Integration | PASS | text and --json list the warning; exit 0 | as expected | "lists the warning in text and --json output and still exits 0" |
| TC-007 | Integration | PASS | --fix rewrites (drops stack), keeps worktrees, still reported | as expected | "leaves an unknown key in the file under --fix and still reports it afterwards" |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| npm test | 0 | 129 files, 3241 passed, 0 failed (at 7df6b01) |
| npm run typecheck | 0 | no diagnostics |
| npm run lint | 0 | 0 errors (2 pre-existing warnings in other test files) |
| npm run build | 0 | dist built at 7df6b01 |
| kf verify unknown-config-key --task TASK-001 --commits 7df6b01 | 0 | every changed file inside TASK-001's Files; 1 task verify command passed |
| node dist/index.js verify unknown-config-key --wave 1 | 0 | All 2 stage verify command(s) passed; Stage verify: PASS 7df6b01 at HEAD |
| npx vitest run src/tests/doctor.test.ts --coverage (include doctor.ts, config.ts) | 0 | doctor.ts 81.97% statements / 80.55% branches; config.ts 88.43% / 80.18%; all files 83.95% |

## Behaviour run

- Real run on a fresh project (`kf init --defaults` in a temp git repo, then `worktrees` and `notes` added to `.kf/config.json`): `node dist/index.js doctor` printed `[WARNING] .kf/config.json: unknown_config_key: "worktrees" is not a kf config key and is ignored.` with `→ did you mean "worktree"? rename or remove it`, and the `notes` warning with `→ remove it, or keep it as a note (kf ignores it)`; `--json` carried both as `{level, area, message, action}`. That run exited 1 because of an unrelated ERROR (`Claude Code plugin: plugin kf@kanban-flow path is stale`, from running kf out of the item worktree); TC-006 pins exit 0 when only warnings are present.

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| none | — | — | — |

## Coverage

Target 80% (spec Test Strategy). Measured with src/tests/doctor.test.ts on the changed sources: src/project/doctor.ts 81.97% statements, 80.55% branches; src/project/config.ts 88.43% / 80.18%; the new `checkUnknownConfigKeys` and `PROJECT_CONFIG_KEYS` are fully exercised by TC-001..TC-007.

Changed behaviour no test touches: none — the docs rows (cli-reference, autoconfig, CHANGELOG) are checked at review.

## Conclusion

PASS: 7/7 test cases, full suite 3241/3241, lint/typecheck 0, coverage above 80% on the changed sources, stage record PASS at 7df6b01.
