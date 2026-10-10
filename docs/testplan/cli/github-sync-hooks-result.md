---
feature: "github-sync-hooks"
context: "cli"
created: "20261010_1217"
execution: "3bd6aff0-542b-4501-80a6-4ff8e3531a09"
status: PASS
tested: "2026-10-10"
---

# Testing Result

## Feature
github-sync-hooks

## Environment
Local checkout on the work branch; vitest suite; a live `kf issues sync` against issues #14/#15 on this repository; `bash -n` on every pack file.

## Execution Time
2026-10-10

## Summary
Config validation, the KFW_PROJECT_* hook env, `kf issues sync` and the doctor repairs all carry unit coverage. `kf issues sync` was also verified live: it rewrote issue #14 and #15 bodies from the filled requirements. Every pack file passes `bash -n`. One honest gap: board status sync could not be exercised live because this token lacks the `project` scope — the commands are the same ones monitoring runs daily, generalized to env.

## Test Results
| Test case | Result | Evidence |
|---|---|---|
| TC-001 | PASS | vitest: project block accepted/rejected, KFW_PROJECT_* asserted in a probe hook |
| TC-002 | PASS | `kf issues sync github-sync-hooks` → issue #14 body now carries the spec; refusals covered |
| TC-003 | PASS (partial) | `bash -n` clean on all 9 pack files; doctor restore test; board sync untested — gh lacks `project` scope |
| TC-004 | PASS | vitest: opted-in pack restored by --fix; divergence only warns; silent when uninstalled |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run` (full suite) | 0 | 26 files, 433 tests, 0 fail |
| `bash -n kanban-flow/github-hooks/*.sh` | 0 | all 9 files parse |
| `kf issues sync github-sync-hooks` | 0 | `Synced requirement → …/issues/14` |
| `kf issues sync release-on-tag` | 0 | `Synced requirement → …/issues/15` |
| `gh issue view 14 --json body` | 0 | body starts with the spec's Objective section |
| `npm run typecheck`, `npm run lint`, `npm run build` | 0 | clean |

## Failures and Blockers
The `project` gh scope is missing on this token, so `gh project field-list` — and therefore live board sync — was not exercised. This is an auth precondition, not a code failure: every `gh project` call degrades to a warn inside the pack by design. Verify on monitoring after `gh auth refresh -s project`.

## Coverage
FR-001/002 (config + env) — unit. FR-003 (`kf issues sync`) — unit refusals + live write. FR-004 (pack) — syntax + doctor + design-port; the gh calls themselves are proven on monitoring. FR-005 (init/doctor) — unit; TTY prompt not scriptable, `--defaults` path seeds when a repository is detected.

## Regression
The pack deliberately lives outside `resolveHook`'s package path — a first test draft put it there and every repository-linked project would have gained the AC gate uninvited. `resolveHook` still returns null on projects without the files, proven by the existing resolveHook test.

## Conclusion
Every claim that can be proven locally is proven; the one that cannot (live board API) is a scoped-out auth precondition with a proven reference implementation behind it.
