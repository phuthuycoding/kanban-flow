---
feature: "archive-after-merge"
context: "cli"
created: "20261011_1108"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | archive-after-merge |
| Context | cli |
| Test level | unit |
| UI scope | none (CLI feature — spec's Test Strategy: `Level: unit`, `UI Tests: none`) |
| Tools / commands | vitest (`npm test`), stubbed `gh` via PATH script logging argv, fake `.kfw.json`/repo env |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 22 | 22 | Merge gate, finalization order, reconcile, visibility, removals, sync sweep |
| Integration | 0 | 0 | Only external system is `gh`, stubbed at PATH level |
| UI / E2E | 0 | 0 | No UI |
| **Total** | **22** | **22** | |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---|---|
| UC-001 | FR-001 | TC-001…TC-006 | 6 | Every non-MERGED/unverifiable state refuses with zero side effects |
| UC-002 | FR-002, FR-006 | TC-007…TC-010, TC-021, TC-022 | 6 | Full finalization order, flag last, delivered apparatus removed |
| UC-003 | FR-003 | TC-011…TC-013 | 3 | No-PR proceed, no-issue warn, bug parity |
| UC-004 | FR-004 | TC-014, TC-015 | 2 | Idempotent reconcile incl. legacy flag honored |
| UC-005 | FR-005, FR-007 | TC-016…TC-018 | 3 | status/doctor hints, docs assertions |
| UC-006 | FR-001, FR-002 | TC-019, TC-020 | 2 | Sweep archives merged only, tolerates per-item failure |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001, UC-006 | TC-001…TC-006, TC-019, TC-020 | yes | — |
| FR-002 | UC-002, UC-006 | TC-007…TC-010, TC-019 | yes | — |
| FR-003 | UC-003 | TC-011…TC-013 | yes | — |
| FR-004 | UC-004 | TC-014, TC-015 | yes | — |
| FR-005 | UC-005 | TC-016, TC-017 | yes | — |
| FR-006 | UC-002 | TC-008, TC-021, TC-022 | yes | — |
| FR-007 | UC-005 | TC-018 | yes | docs assertions via filesystem grep |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Review-stage feature with PASS reports; `meta.pr` linked; `repository` set; stubbed `gh pr view` returns `OPEN` |
| Input | `kf archive <f>` |
| Steps | See steps table below |
| Expected outcome | Exit 1; folder stays in review; no hook ran; `.kfw.json`, docs, board untouched |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `cmdArchive` on PR-open item | Exit 1, refusal names the PR + state |
| 2 | Inspect `.works/` tree + `.kfw.json` + stub log | Nothing moved, no meta write, no hook/`gh` mutation calls |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | As TC-001; stubbed `gh` returns `CLOSED` (unmerged) |
| Input | `kf archive <f>` |
| Steps | Run archive |
| Expected outcome | Exit 1, zero side effects |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `cmdArchive` on closed-unmerged PR item | Refusal |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | As TC-001; `gh` stub fails (nonzero) or returns garbage; variant: `repository` unset while `pr` recorded |
| Input | `kf archive <f>` |
| Steps | Run archive under each unverifiable variant |
| Expected outcome | Exit 1 for each variant; zero side effects |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `gh` exits nonzero | Refusal |
| 2 | `gh` prints unparseable output | Refusal |
| 3 | `repository` missing | Refusal naming the config |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | As TC-001 with `OPEN` PR |
| Input | `kf archive <f> --force` |
| Steps | Run archive with force |
| Expected outcome | Same refusal — merge gate has no `--force` escape |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cmdArchive` with `force: true` | Exit 1, identical refusal |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Dones-stage item (legacy), `meta.pr` OPEN |
| Input | `kf archive <f>` |
| Steps | Run reconcile archive |
| Expected outcome | Exit 1; no docs resync, no hook, no flag |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `cmdArchive` on dones item with open PR | Refusal before any reconcile side effect |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `kind: bug` item in review, PASS reports, `meta.pr` OPEN |
| Input | `kf archive <bug>` |
| Steps | Run archive |
| Expected outcome | Exit 1 — bug kind does not exempt the gate |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `cmdArchive` on bug with open PR | Refusal |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Review-stage feature, PASS reports, `meta.pr` MERGED, seeded dones hook stub recording invocation |
| Input | `kf archive <f>` |
| Steps | Run archive |
| Expected outcome | Exit 0; folder in dones; canonical docs written; hook ran once; `delivered`/`deliveredAt` present in final `.kfw.json` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `gh` stub returns MERGED; run archive | Exit 0 |
| 2 | Read moved item's `.kfw.json` | `delivered: true`, `deliveredAt` ISO timestamp, `status: archived` |
| 3 | Check canonical docs + hook log | Docs synced; `dones` hook invoked |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-002, FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Packaged `kanban-flow/github-hooks/dones.sh` under test with stubbed `gh` logging argv |
| Input | `dones.sh` with KFW_* env, linked issue |
| Steps | Run packaged dones.sh |
| Expected outcome | Script invokes `close_issue_done` (issue close comment "Work item archived in kf.") and `sync_project_status dones`; `delivered.sh` absent from pack dir and `GITHUB_HOOK_PACK` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Execute packaged `dones.sh` | `gh issue close` argv logged alongside board sync |
| 2 | `ls kanban-flow/github-hooks/` + read doctor's `GITHUB_HOOK_PACK` | No `delivered.sh` in either |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | As TC-007; canonical docs write forced to fail |
| Input | `kf archive <f>` |
| Steps | Run archive with failing docs write |
| Expected outcome | Exit 1 with rollback; item restored to review; `delivered` NOT written; re-run succeeds |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Trigger docs-sync failure mid-archive | Rollback: folder back in review, docs/meta restored |
| 2 | Check `.kfw.json` | No `delivered` flag |
| 3 | Re-run archive | Completes cleanly |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-001, FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Review-stage item, `meta.pr` OPEN |
| Input | `kf stage <f> dones` |
| Steps | Run stage move into dones |
| Expected outcome | Routed through cmdArchive → same merge-gate refusal, item stays in review |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cmdStage(f, "dones")` with open PR | Refusal identical to `kf archive` |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Review-stage feature, PASS, no `pr`, `issue` linked |
| Input | `kf archive <f>` |
| Steps | Run archive |
| Expected outcome | Exit 0 — human run is the confirmation; full finalization incl. flag |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Archive no-`pr` item | Delivered successfully |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | As TC-011 but no `issue` linked either |
| Input | `kf archive <f>` |
| Steps | Run archive |
| Expected outcome | Exit 0; output warns no linked issue; flag still stamped |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Archive no-`pr`/no-`issue` item | Succeeds with warning |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `kind: bug`, review stage, PASS, no `pr` |
| Input | `kf archive <bug>` |
| Steps | Run archive |
| Expected outcome | Exit 0; bug delivered (no canonical docs — unchanged) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Archive no-`pr` bug | Delivered |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | Dones-stage item without `delivered`; `issue` linked; hook stub recording |
| Input | `kf archive <f>` |
| Steps | Run reconcile |
| Expected outcome | Docs resynced; `dones` hook re-ran (board+close idempotent); `delivered`/`deliveredAt` written |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Re-archive legacy dones item | Docs + hook + flag all refreshed |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-004 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Dones-stage item already `delivered` (0.8.0 flow) |
| Input | `kf archive <f>` run twice |
| Steps | Reconcile twice |
| Expected outcome | Both runs exit 0; no duplicate effects beyond idempotent resync; "already delivered" note |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Reconcile delivered item | Exit 0, side effects re-checked |
| 2 | Run again | Same — flag never gates re-execution |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-005 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Review-stage item, PASS review report, `issue` linked |
| Input | `kf status --change <f>` and `kf status --all` |
| Steps | Render status |
| Expected outcome | Output contains awaiting-merge hint "run `kf archive`"; absent without PASS or issue |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Render status for awaiting item | "awaiting merge — run kf archive" line |
| 2 | Render for non-PASS review item | No hint |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-005 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | (a) dones item without `delivered`; (b) config with `statusMap.delivered` key |
| Input | `kf doctor` |
| Steps | Run doctor |
| Expected outcome | WARNING for undelivered dones item → action `kf archive`; WARNING for inert `statusMap.delivered` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Doctor on legacy dones item | Finding points at `kf archive` |
| 2 | Doctor with `statusMap.delivered` in config | "dead config" warning, no parse failure |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-007 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Docs + skills updated |
| Input | Filesystem assertions on `skills/` + `docs/workflow/` |
| Steps | Grep content |
| Expected outcome | `kanban-archive`/`kanban-flow`/`cli-reference.md` teach archive-as-delivery; no `kf issues done` instruction outside deprecation notes; recommended statusMap = `dones → "Done"` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Assert skill + doc content | New semantics documented, stale refs gone |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-001, FR-002 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | Two review items with `meta.pr` (one MERGED, one OPEN) + one no-`pr` item; stubbed `gh` |
| Input | `kf sync` |
| Steps | Run sweep |
| Expected outcome | MERGED item archived via the same path; OPEN skipped + reported; no-`pr` item untouched |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `cmdSync` over mixed items | Only merged delivered; per-item report correct |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-001 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | (a) no `repository`; (b) `gh` fails on one item, succeeds on another; (c) one archive fails mid-sweep |
| Input | `kf sync` per variant |
| Steps | Run variants |
| Expected outcome | (a) exit 1 config error; (b) failed item skipped+warned, other archived; (c) failure reported, sweep continues, exit 1 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Sync without repository | Refusal with config guidance |
| 2 | Sync with one unverifiable item | Skip+warn, others processed |
| 3 | Sync with one failing archive | Reported, sweep continues |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | `issues done` removed as a command; alias retained |
| Input | `kf issues done <f>` |
| Steps | Run the deprecated alias |
| Expected outcome | Deprecation warning printed; forwards to `cmdArchive` — same gates, same finalization |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Invoke `issues done` on deliverable item | Warns + archives |
| 2 | Invoke on unmerged-PR item | Same refusal as archive |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Hook env construction; config parsing |
| Input | `runHook` env; `readProjectConfig` with `statusMap.delivered` |
| Steps | Inspect env + parse |
| Expected outcome | `KFW_PROJECT_STATUS_DELIVERED` never emitted; `statusMap.delivered` parses without throwing (inert); `cmdDone` symbol gone |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run hook with project config | Env lacks `KFW_PROJECT_STATUS_DELIVERED` default |
| 2 | Parse config containing `statusMap.delivered` | No error |
