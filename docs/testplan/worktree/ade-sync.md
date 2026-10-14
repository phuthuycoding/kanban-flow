---
feature: ade-sync
context: worktree
created: 20261014_2112
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | ade-sync |
| Context | worktree |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest; `src/tests/helpers/fake-cli.ts` PATH shadowing for `orca`/`herdr`; worktree fixtures from `src/tests/worktree.test.ts` |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 9 | 9 | adapters via fake CLI argv + orchestration semantics + prefix chain |
| Integration | 6 | 6 | command-layer create/remove/sync end-to-end |
| UI / E2E | 0 | 0 | CLI-only feature, no UI surface |
| **Total** | **15** | **15** | All cases must pass |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-003, FR-004, FR-008 | TC-001, TC-003, TC-004, TC-005, TC-006, TC-008, TC-011, TC-012 | 8 | all pass |
| UC-002 | FR-001, FR-007 | TC-002, TC-010 | 2 | all pass |
| UC-003 | FR-006 | TC-007 | 1 | all pass |
| UC-004 | FR-005 | TC-009 | 1 | all pass |
| UC-005 | FR-002 | TC-013 | 1 | all pass |
| UC-006 | FR-001, FR-009 | TC-014, TC-015 | 2 | all pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001, UC-002 | TC-001, TC-002, TC-008 | yes | — |
| FR-002 | UC-005 | TC-013 | yes | — |
| FR-003 | UC-001 | TC-003, TC-004 | yes | — |
| FR-004 | UC-001 | TC-005, TC-006 | yes | — |
| FR-005 | UC-004 | TC-009 | yes | — |
| FR-006 | UC-003 | TC-007, TC-008 | yes | — |
| FR-007 | UC-002 | TC-010 | yes | — |
| FR-008 | UC-001 | TC-011, TC-012 | yes | — |
| FR-009 | UC-006 | TC-014, TC-015 | yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Registry contains stub adapters marked available |
| Input | `attachWorktreeToAdes(root, feature, wt)` |
| Steps | See steps table below |
| Expected outcome | Every available adapter's `attach` invoked once with the worktree context; unavailable adapters skipped |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Register stub adapters A (available) and B (unavailable) | — |
| 2 | Call `attachWorktreeToAdes` | A.attach called once; B.attach never called |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Registry adapters all report unavailable |
| Input | `attachWorktreeToAdes(...)` |
| Steps | See steps table below |
| Expected outcome | Empty result list; caller prints nothing extra |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | All `isAvailable()` → false | — |
| 2 | Call `attachWorktreeToAdes` | Returns `[]`, no adapter subprocess invoked |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | `herdr` fake on PATH; `FAKE_HERDR_*` scenario returns `worktree_opened` JSON |
| Input | `herdrAdapter.attach({root, feature:"demo", worktree})` |
| Steps | See steps table below |
| Expected outcome | Fake receives argv `worktree open --path <wt> --branch <b> --label demo --no-focus`; result ok with workspace detail |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Configure fake `herdr` to answer status running + open JSON | — |
| 2 | Call `attach` | argv file contains the exact open command; `{ ok:true }` |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Fake `herdr` returns `already_open: true` |
| Input | `herdrAdapter.attach(...)` |
| Steps | See steps table below |
| Expected outcome | `{ ok:true }`, detail notes already-open — no error, no duplicate action |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Fake open returns `{"result":{"already_open":true}}` | — |
| 2 | Call `attach` | ok result marked idempotent |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | `orca` fake: `status --json` reachable; `repo add` returns repo id; `worktree list` includes the worktree path |
| Input | `orcaAdapter.attach({root, worktree})` |
| Steps | See steps table below |
| Expected outcome | `repo add --path <root>` invoked; membership check finds path; `{ ok:true, detail: "visible in Orca" }`-style result |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Fake `repo add` → `{"ok":true,"result":{"repo":{"id":"r1"}}}` | — |
| 2 | Fake `worktree list` → entry `id:"r1::<wtpath>"` | — |
| 3 | Call `attach` | ok; argv shows `repo add` then `worktree list` |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-004 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | `orca` fake: repo add ok; `worktree list` does NOT contain the path |
| Input | `orcaAdapter.attach(...)` |
| Steps | See steps table below |
| Expected outcome | Result has a warning naming the external-worktree visibility setting |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Fake list returns worktrees without our path | — |
| 2 | Call `attach` | warning mentions enabling external worktrees for the repo in Orca |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-006 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Stub adapter A throws in `attach`; stub adapter B succeeds |
| Input | `attachWorktreeToAdes(...)` |
| Steps | See steps table below |
| Expected outcome | Result for A carries warning; B still ran; orchestration does not throw |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | A.attach throws; B.attach returns ok | — |
| 2 | Call orchestration | `[{ok:false,warning…}, {ok:true}]`, no exception |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-001, FR-006 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Test repo + work item fixture; `orca`+`herdr` fakes on PATH configured available |
| Input | `cmdWorktreeCreate` / `kf worktree create <f>` |
| Steps | See steps table below |
| Expected outcome | stdout contains worktree info plus one sync line per ADE; when a fake fails, line becomes `⚠` and exit stays 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run create with both fakes happy | stdout has `Herdr:` and `Orca:` lines |
| 2 | Make `herdr` exit 1; rerun | `⚠ Herdr:` line, exit 0 |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Fake `herdr` `worktree list` reports our path with `open_workspace_id: "w9"` |
| Input | `teardownWorktree(...)` via `kf worktree remove` |
| Steps | See steps table below |
| Expected outcome | `workspace close w9` invoked; failure would surface in warnings |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Fake list JSON with open_workspace_id | — |
| 2 | Remove worktree | `herdr workspace close w9` in argv log |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-007 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Machine config file with `"adeSync": false` |
| Input | `attachWorktreeToAdes` / `detachWorktreeFromAdes` |
| Steps | See steps table below |
| Expected outcome | Zero adapter invocations (fake argv files absent) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Write machine config `{"adeSync":false}` to a temp file; point reader at it | — |
| 2 | Call attach | No adapter touched |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-008 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Temp git repo with controllable `git config user.name` |
| Input | `worktreeConfig(root, raw)` variants |
| Steps | See steps table below |
| Expected outcome | Priority: explicit `branchPrefix` > `gitconfigName` > `git user.name` (slugified) > `"kf/"` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `branchPrefix:"x/"` + all others set | `x/` wins |
| 2 | `gitconfigName:"Phu Thuy"` + user.name set | `phu-thuy/` |
| 3 | Only `git config user.name=phuthuycoding` | `phuthuycoding/` |
| 4 | No options, no user.name | `kf/` |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-008 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repo with unmanaged worktrees on both `kf/` and resolved `<user>/` prefixes |
| Input | `listWorktrees(root, cfg)` |
| Steps | See steps table below |
| Expected outcome | Both orphans reported — prefix change must not hide `kf/` leftovers |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Create unmanaged worktree on `kf/old` and `<user>/new` branches | — |
| 2 | `listWorktrees` | Two `unmanaged-worktree` orphans |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-002 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Registry accepts a test stub adapter |
| Input | Stub adapter appended to registry; run create + remove paths |
| Steps | See steps table below |
| Expected outcome | Stub's attach/detach invoked through the real call sites; zero lifecycle code touched by the "new ADE" |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Register stub adapter | — |
| 2 | Run create then remove | stub attach + detach recorded |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-009 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | A linked git worktree NOT registered in `.works`; cwd inside it; `herdr`/`orca` fakes available |
| Input | `kf worktree sync` (no args) |
| Steps | See steps table below |
| Expected outcome | Both adapters attach the cwd worktree with a branch/dir-derived label; `.works` untouched; exit 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `git worktree add` a foreign checkout of the fixture repo | — |
| 2 | cd into it, run sync | fake `herdr worktree open --path <cwd-wt>` recorded; orca repo-add ran |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-009 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Fixture with two registered worktrees; fakes available |
| Input | `kf worktree sync <feature>` then bare `kf worktree sync` at root |
| Steps | See steps table below |
| Expected outcome | Named form attaches only that worktree; bare form attaches every registered worktree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `sync feature-a` | only feature-a's path appears in adapter argv |
| 2 | bare `sync` at root | both registered paths attached |
