---
feature: "ade-sync"
context: "worktree"
tested: "20261014_2154"
execution: "1484fa2b-9e50-4a12-9772-b8aee1a4f220"
status: PASS
---

# Testing Result

## Feature
ade-sync

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0, vitest 2.1.9
- Tooling: fake `orca`/`herdr` CLIs via PATH shadowing (`KF_FAKE_DIR` response files); live machine had a running Herdr 0.9.3 server for the manual smoke check

## Execution Time
~19s (`npm test`, 33 files / 535 tests)

## Summary
| Metric | Result |
|---|---:|
| Total | 15 |
| Passed | 15 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 attach only reachable adapters | Unit | PASS | available adapter's `attach` runs once, unavailable skipped | `["up"]` called, `down` never | `adapter registry + orchestration` spec |
| TC-002 all unavailable → empty result | Unit | PASS | `[]`, no subprocess | `[]` returned | same spec |
| TC-003 herdr `worktree open` argv | Integration | PASS | `worktree open --path <wt> --label demo --no-focus --branch t/demo` | exact argv match | `herdr adapter` spec |
| TC-004 `already_open` is success | Unit | PASS | ok + "already open" detail | `{ok:true, detail:"workspace 'demo' already open"}` | same spec |
| TC-005 orca `repo add` + list verify | Integration | PASS | repo registered, worktree found in list | `{ok:true, detail:"visible…"}`, argv `repo add --path <root>` then `worktree list` | `orca adapter` spec |
| TC-006 orca hidden → visibility warning | Unit | PASS | warning naming external-worktree visibility | warning matches `/external worktree/i` | same spec |
| TC-007 throwing adapter → warning, siblings run | Unit | PASS | `{ok:false,warning}` + second adapter still ok | both results, no throw | registry spec |
| TC-008 `kf worktree create` emits ADE lines; failure → `⚠` + exit 0 | Integration | PASS | `Herdr:`/`Orca:` lines; failing herdr → `⚠ Herdr:` | both verified | command-layer spec |
| TC-009 remove closes bound Herdr workspace | Integration | PASS | `workspace close w9` invoked | argv recorded | same spec |
| TC-010 `adeSync:false` → zero adapter calls | Unit | PASS | no adapter invoked | `[]`, `adeSyncEnabled` false | registry spec |
| TC-011 prefix chain order | Unit | PASS | branchPrefix > gitconfigName > user.name > `kf/` | `x/` `phu-thuy/` `t/` `kf/` all correct | prefix spec |
| TC-012 legacy `kf/` orphans still flagged | Unit | PASS | `t/loose` + `kf/loose` both orphans, `other/` ignored | verified | orphan spec |
| TC-013 stub adapter through real orchestration | Unit | PASS | attach+detach invoked, no lifecycle edits | `["attach:feat-x","detach:feat-x"]` | registry spec |
| TC-014 `sync` inside foreign worktree | Integration | PASS | attach cwd checkout, no `.works` write | `herdr open --path <foreign>` recorded | sync spec |
| TC-015 `sync <feature>` vs bare `sync` | Integration | PASS | named → one path; bare → all | alpha-only argv, then alpha+beta lines | sync spec |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run src/tests/ade-sync.test.ts` | 0 | 23 tests passed |
| `npm test` | 0 | 33 files, 535 tests passed |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint clean |
| `npm run build` | 0 | dist built |
| `node dist/index.js worktree sync` inside `/tmp/ade-sync-live` (foreign detached worktree of this repo) | 0 | live output: `ade-sync-live:` + `Herdr: opened workspace 'ade-sync-live'`; Orca absent (app uninstalled mid-session — detection failed closed correctly); workspace + checkout cleaned via `herdr worktree remove` |

## Notes
- Live-run also verified the GNOME-reader guard indirectly: when `orca` resolves to a broken symlink (ENOENT), the adapter is skipped silently rather than erroring.
