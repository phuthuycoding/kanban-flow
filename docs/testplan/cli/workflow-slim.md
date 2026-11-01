---
feature: workflow-slim
context: cli
created: 20261031_0912
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

This is the planned contract: execution outcomes belong in the testing-result report.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | workflow-slim |
| Context | cli |
| Test level | unit+integration |
| UI scope | N/A |
| Tools / commands | vitest (`npm test`, `npx vitest run <file>`); git fixtures with a bare origin (`src/tests/helpers/git-fixture.ts`); stubbed `gh` on PATH for merge state and issue types; `node skills/travel/scripts/estimates` spawned from tests; one live `gh api` run for TC-027 recorded in the testing report |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 16 | 16 | schema, config, validators, migration, estimates script, surface tests, doctor fix |
| Integration | 17 | 16 | git-fixture CLI runs; TC-027 is live GitHub and may end BLOCKED with the named URL (UC-006 E1) |
| UI / E2E | 0 | 0 | CLI only; the spec's Test Level is unit+integration |
| **Total** | **33** | **32** | **TC-027 may be BLOCKED by GitHub without failing the feature** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002 | TC-005, TC-006, TC-007, TC-008 | 4 | approve moves to implementation or backlog; failed move restores approval; no decision prompt text |
| UC-002 | FR-003, FR-004 | TC-009, TC-010, TC-011, TC-012, TC-030 | 5 | the three new validator codes fire and clear correctly; the skill text carries the PR, reviewer and CI steps |
| UC-003 | FR-001, FR-005, FR-007 | TC-001, TC-002, TC-003, TC-004, TC-013, TC-014, TC-015, TC-016, TC-017, TC-018, TC-019, TC-029, TC-031, TC-032, TC-033 | 15 | stage list, hints, migration, auto-close with the hook-before-delete order, branch and docs handling, awaiting merge buckets, legacy statusMap fix, ship deprecation |
| UC-004 | FR-006 | TC-020, TC-021 | 2 | resolver order and `config_changed` on the resolved source |
| UC-005 | FR-008, FR-009, FR-011, FR-012, FR-013 | TC-022, TC-023, TC-024, TC-025, TC-026 | 5 | skill text, size rule, measure line, stats and budget |
| UC-006 | FR-010 | TC-027 | 1 | Epic in the live catalog and on #95, or the named blocker |
| UC-007 | FR-014, FR-015 | TC-022, TC-028, TC-029 | 3 | progress block headings and dispatch rule; `kf status --all` buckets; overlap marks sequential |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001, UC-003 | TC-001, TC-002, TC-003, TC-004, TC-019, TC-031 | Yes | — |
| FR-002 | UC-001 | TC-005, TC-006, TC-007, TC-008 | Yes | — |
| FR-003 | UC-002 | TC-010, TC-012, TC-030 | Yes | PR opening itself is `gh` behaviour; tests cover the gate, the reviewer dispatch and the skill text |
| FR-004 | UC-002 | TC-009, TC-011 | Yes | — |
| FR-005 | UC-003 | TC-003, TC-013, TC-014, TC-015, TC-016, TC-017, TC-029, TC-032, TC-033 | Yes | — |
| FR-006 | UC-004 | TC-020, TC-021 | Yes | — |
| FR-007 | UC-003 | TC-016, TC-018 | Yes | — |
| FR-008 | UC-005 | TC-022 | Yes | skill-text surface test; behaviour is agent-run |
| FR-009 | UC-005 | TC-022 | Yes | as above, plus the ownership rule text in kanban-flow/implement |
| FR-010 | UC-006 | TC-027 | Yes | live; may be BLOCKED |
| FR-011 | UC-005 | TC-023 | Yes | — |
| FR-012 | UC-005 | TC-024 | Yes | — |
| FR-013 | UC-005 | TC-025, TC-026 | Yes | — |
| FR-014 | UC-007 | TC-022, TC-029 | Yes | progress block in the skill text; `kf status --all` buckets by integration test |
| FR-015 | UC-007 | TC-028 | Yes | — |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | `src/workflow/schema.ts` built |
| Input | `STAGES`, `STAGE_INDEX`, `TRANSITIONS`, `PHASE_NAMES`, `STAGE_GATES` |
| Steps | See steps table below |
| Expected outcome | `STAGES` equals `[brainstorm, planning, backlog, implementation, testing, review, done, cancelled]`; no key `shipping` or `dones` anywhere; `STAGE_INDEX.done === 6`, `cancelled === -1`; `TRANSITIONS.review` equals `[done, implementation, planning]`; `TRANSITIONS.done` is empty |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Import schema and compare `STAGES` to the literal list | Deep equal |
| 2 | Assert `"shipping"`/`"dones"` are not keys of any exported record | Absent |
| 3 | Assert index contiguity 0..6 for the linear stages | Holds |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Fixture project with an item in review carrying a PASS review report |
| Input | `kf stage demo shipping`; `kf stage demo dones` |
| Steps | See steps table below |
| Expected outcome | Both exit 1; stdout of the first contains exactly `shipping is gone: open the PR at review, merge on GitHub, kf status closes the item`; the second contains exactly `the stage is now done: a review PASS item closes on merge via kf status, kf sync or kf archive`; the item stays in review; `.kfw.json` unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `cmdStage` with `shipping` | code 1, hint text |
| 2 | Run `cmdStage` with `dones` | code 1, hint text |
| 3 | Re-read the feature | stage `review`, meta byte-identical |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-001, FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Fixture with `.works/dones/a_<ts>` (meta stage `dones`, history with `shipping`), `.works/shipping/merged_<ts>` (meta.pr, stub `gh` says MERGED), `.works/shipping/open_<ts>` (meta.pr, stub says OPEN) |
| Input | `kf status --all` twice |
| Steps | See steps table below |
| Expected outcome | First run prints three migration lines; `.works/done/a_*` and `.works/done/merged_*` exist with meta stage `done`; `.works/shipping` is empty or gone; `.works/review/open_*` exists with stage `review`; second run prints no migration line and leaves everything unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run status | Moves printed |
| 2 | Inspect folders and meta | As expected |
| 3 | Run status again | Idempotent |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | `parseProjectBlock` (src/project/config.ts) |
| Input | `statusMap: { dones: "Done" }`; `statusMap: { done: "Done" }`; `statusMap: { shipping: "X", done: "Done" }`; `statusMap: { bogus: "X" }` |
| Steps | See steps table below |
| Expected outcome | Legacy `dones` parses, `statusMap.done === "Done"`, `statusMapLegacy` true; `done` parses with no flag; legacy `shipping` is dropped, the rest kept, `statusMapLegacy` true; an unknown key is still rejected with the config error naming it; hook env from the legacy config yields `KFW_PROJECT_STATUS_DONE=Done` and no `_DONES`/`_SHIPPING` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Parse the three configs | As expected |
| 2 | Build hook env from the legacy one | `KFW_PROJECT_STATUS_DONE` present, no `_DONES` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Git fixture, `worktree.enabled: true`, item in planning with a complete contract |
| Input | `kf approve demo` |
| Steps | See steps table below |
| Expected outcome | Exit 0; stage `implementation`; `meta.approval.status === "approved"` with the contract hash; `meta.worktree` set and the worktree directory exists on branch `<prefix>/demo`; stdout has `→ implementation` and a `Worktree:` line; no "start" or "backlog" prompt text |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `cmdApprove` | code 0 |
| 2 | Read feature and worktree | As expected |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | As TC-005 plus `.kf/hooks/implementation.sh` that exits 1 |
| Input | `kf approve demo` |
| Steps | See steps table below |
| Expected outcome | Exit 1; stdout names the refused hook and says the approval was not kept; stage still `planning`; `meta.approval` equals its pre-run value (pending); no worktree created |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Record meta before | Baseline |
| 2 | Run approve | code 1 |
| 3 | Compare meta | Restored |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item in planning with a complete contract |
| Input | `kf approve demo --backlog`, then `kf stage demo implementation` |
| Steps | See steps table below |
| Expected outcome | After approve: stage `backlog`, approval valid, no worktree; `kf status` Next is `kf stage demo implementation`; after the stage command: implementation with the worktree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Approve with `--backlog` | backlog |
| 2 | Status | Next line as expected |
| 3 | Stage to implementation | implementation |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Built CLI and skills |
| Input | `renderStatus` for a planning item (approved and pending), `kf approve --help`, `kf autoconfig` guide text, the seeded `AGENTS.md`, `skills/kanban-plan/SKILL.md`, `skills/kanban-flow/SKILL.md`, `skills/kanban-bug/SKILL.md` |
| Steps | See steps table below |
| Expected outcome | None of them contains "start now or" / "start-now vs backlog" / "ship or archive" / "ready for ship decision" (the drive's `READY_REASON` in `src/harness/drive/claim.ts` reads "ready — review PASS: merge the PR, kf status closes the item"); help lists `--backlog`; status Next for an approved planning item never appears (approve moves the item) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Grep the rendered strings and files | No matches |
| 2 | Assert `--backlog` in help | Present |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item in review, testing report PASS for the current execution, `meta.pr` recorded |
| Input | Review report `status: PASS`, `ci: red`, `landing: pr` |
| Steps | See steps table below |
| Expected outcome | `kf validate` reports ERROR `review_ci_red`; the direction gate refuses review → done; with `ci: green` the error is gone |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Validate with `ci: red` | review_ci_red |
| 2 | Validate with `ci: green` | clean |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Item in review, testing PASS, `meta.pr` empty |
| Input | Review report `status: PASS`, `ci: green`, `landing: pr`; then the same with `landing: none`; then without a `landing` field |
| Steps | See steps table below |
| Expected outcome | First: ERROR `review_pr_missing`; second: clean; third: ERROR `review_landing_missing` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Validate the three variants | Codes as expected |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item that went review → implementation after a FAIL, then back to testing (new execution id) |
| Input | A review report PASS carrying the OLD execution id |
| Steps | See steps table below |
| Expected outcome | `kf stage demo done` is refused (stale execution); `kf status` does not auto-close; after a PASS testing report and a PASS review report on the new id with `ci: green` and a merged PR, the close proceeds |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Attempt close with the stale report | Refused |
| 2 | Write current reports | Close proceeds |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Skills on disk |
| Input | `skills/kanban-review/SKILL.md`, `skills/kanban-review/references/ci-watch.md`, `kanban-flow/templates/phase-5-review-report.md` |
| Steps | See steps table below |
| Expected outcome | The review skill contains the PR step (`gh pr create`, `kf issues link … --pr`) and it appears after the `Agent(code-reviewer)` dispatch and its PASS condition in the document order, with the sentence that a PR is opened for reviewed code only; it references `ci-watch.md`, names `ci:` and `landing:`; `ci-watch.md` exists under kanban-review and no longer under kanban-ship; the template frontmatter has `ci:` and `landing:` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read and assert the strings | Present / absent as expected |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Git fixture with a bare origin; item in review on worktree branch `kf/demo` pushed to origin; PASS reports (`ci: green`, `landing: pr`); `meta.pr` recorded; stub `gh pr view` returns MERGED; `.kf/hooks/done.sh` that records its env; project `statusMap.done` |
| Input | `kf status --change demo` |
| Steps | See steps table below |
| Expected outcome | Stdout contains `✓ done`; folder in `.works/done/`; `meta.delivered === true`; worktree directory removed; branch `kf/demo` absent locally and on the bare origin; hook ran with `KFW_PROJECT_STATUS_DONE`; canonical docs written (checkout on main, clean, not behind) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run status | Close printed |
| 2 | Inspect filesystem, git and hook record | As expected |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | As TC-013 but the item worktree has an uncommitted change |
| Input | `kf status --change demo`; `kf archive demo` |
| Steps | See steps table below |
| Expected outcome | Both refuse naming the dirty worktree; stage stays review; branch and worktree untouched; nothing deleted on origin |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run both commands | Refused, no side effects |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | As TC-013 but the primary checkout is two commits behind `origin/main` (or checked out on a branch named in `.claude/deploy-branches`-style config: use "behind origin" as the fixture) |
| Input | `kf status --change demo` |
| Steps | See steps table below |
| Expected outcome | Item closes; no file under `docs/` changes in the primary working tree; a branch `docs/cli-demo` exists with one commit `docs(cli): sync canonical docs for demo` containing the canonical files, based on `origin/main`; the branch is not pushed; stdout names the branch |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run status | Closed |
| 2 | `git status` in the primary; `git log docs/cli-demo` | Clean primary; one docs commit |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-005, FR-007 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | As TC-013 but stub `gh pr view` returns OPEN; a second variant returns CLOSED (not merged) |
| Input | `kf status --change demo`; `kf sync` |
| Steps | See steps table below |
| Expected outcome | OPEN: item stays review, stdout `Next: merge <PR URL> on GitHub, then kf status`, nothing deleted; CLOSED: stays review, stdout names the closed PR and asks the human; `kf sync` leaves both alone |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | OPEN variant | Awaiting merge text |
| 2 | CLOSED variant | Closed-PR text |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item in review with PASS reports and `landing: none`, no `meta.pr`; variant A: the worktree branch has 0 commits ahead of its base; variant B: the branch has 2 commits ahead |
| Input | `kf status --change demo` on each variant |
| Steps | See steps table below |
| Expected outcome | A: item closes to `done` without calling `gh`; worktree removed; the empty branch deleted locally; stdout says "nothing to land". B: refused, stage stays review, stdout `landing: none but the branch has 2 commits — open a PR or cancel`, nothing deleted |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Variant A with a `gh` stub that fails if invoked | Closed, stub never called |
| 2 | Variant B | Refused with the count |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-007 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Any item |
| Input | `kf ship demo`; `kf feature ship demo` |
| Steps | See steps table below |
| Expected outcome | Exit 1; stdout "kf ship is deprecated: review opens the PR; merge on GitHub; kf status closes the item"; `.kfw.json` unchanged; `src/ship/` no longer exists in the tree |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run both spellings | code 1, pointer text |
| 2 | Compare meta | Unchanged |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository tree |
| Input | `.kf/hooks/`, `kanban-flow/github-hooks/`, `src/project/doctor.ts` GITHUB_HOOK_PACK |
| Steps | See steps table below |
| Expected outcome | `done.sh` exists in both hook dirs and calls `sync_project_status … done`; no `shipping.sh` or `dones.sh` remains; `GITHUB_HOOK_PACK` equals `STAGES.map(s => s + ".sh")` (every stage, `cancelled.sh` included, as today), so it lists `done.sh` and not `shipping.sh` or `dones.sh` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | List and read the hook files | As expected |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-006 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | `resolveDriveConfig(root, feature)` with an injectable `git show` |
| Input | (a) worktree has `.kf/config.json`; (b) no worktree config, `git show origin/main:.kf/config.json` returns one; (c) neither, primary has one; (d) none parsable |
| Steps | See steps table below |
| Expected outcome | Sources `worktree`, `origin`, `primary` respectively, each with the matching config; (d) throws the drive refusal naming the three places |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the four cases | As expected |

## TC-021

| Field | Detail |
|---|---|
| Test case ID | TC-021 |
| Requirement reference | FR-006 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Drive fixture where the primary `.kf/config.json` has no `harness` block and the item worktree's copy has the full harness |
| Input | `kf drive demo`; then edit the worktree copy's `harness.verify` mid-drive; separately edit only the primary copy |
| Steps | See steps table below |
| Expected outcome | The drive starts; `runs/drive-<id>.jsonl` has `config_source: worktree` and `--status` shows it; editing the worktree copy stops `config_changed`; editing only the primary copy does not stop the drive |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Start and read the log | Started, source worktree |
| 2 | Edit worktree copy | config_changed |
| 3 | Fresh drive, edit primary copy | Keeps running |

## TC-022

| Field | Detail |
|---|---|
| Test case ID | TC-022 |
| Requirement reference | FR-008, FR-009, FR-014 |
| Use case reference | UC-005, UC-007 |
| Test type | Unit |
| Priority | High |
| Preconditions | `skills/travel/SKILL.md` and its references on disk; `skills/kanban-flow/SKILL.md`, `skills/kanban-implement/SKILL.md` |
| Input | File contents |
| Steps | See steps table below |
| Expected outcome | Travel skill has frontmatter name `travel`; contains the progress block headings `Needs you`, `Running`, `Waiting to merge`, the line `running: A/SLOTS`, `slots=N`, `date +%F`, `carry-over`, `waiting-to-merge`, `blocked`, `estimates.md`, `progress.md`, the words "wait for the human to approve", "do not pass `--watch`", the dispatch rule ("`sequential` pair is never dispatched in the same tick", "two independent items run in two worktrees"), the Waiting to merge entry for a docs branch awaiting push (`docsBranch`), and the forbidden list `kf approve`, `kf archive`, `kf stage`, merge; it contains no `kf travel` and names no external orchestration CLI; `kanban-flow` and `kanban-implement` contain the ownership rule ("driving" / "blocked" line is owned) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Assert the strings | Present / absent |

## TC-023

| Field | Detail |
|---|---|
| Test case ID | TC-023 |
| Requirement reference | FR-011 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | `node skills/travel/scripts/estimates size <minutes> <files> [<estimates.md> <kind>]`; fixture rows are measured `feature` rows with `est M`, `actual M`, files 4 and an `estmin` |
| Input | No history: (4, 3) → S; (12, 4) → M; (12, 12) → L (files win); (70, 2) → XL (time wins); (30, 31) → XL. Learning, kind `feature`: 20 rows with `estmin` 10 and `work` 20 (factor 2): (15, 4) → L; 20 rows with `estmin` 40 and `work` 20 (factor 0.5): (30, 4) → M and (30, 12) → L (files not corrected); 20 rows with ratio 5: (10, 2) → L (factor clamped to 3); 20 rows with ratio 0.2: (50, 2) → L (factor clamped to 0.5); 19 rows with `estmin` plus 25 old 13-field rows without it: (15, 4) → M with the defaults; 25 rows at ratio 3 then 20 at ratio 1: factor 1 (median of the last 30 only); 20 `feature` rows at ratio 1 beside 20 `bug` rows at ratio 3: the `feature` factor is 1 |
| Steps | See steps table below |
| Expected outcome | Outputs exactly `S`, `M`, `L`, `XL`, `XL` with third line `defaults (0 rows measured)`; then `L` with `learned: 15 min × 2 = 30 min (feature, last 20 rows)`; `M` with `learned: 30 min × 0.5 = 15 min (feature, last 20 rows)` and `L` for 12 files; `L` with `learned: 10 min × 3 (clamped from 5) = 30 min (feature, last 20 rows)`; `L` with `learned: 50 min × 0.5 (clamped from 0.2) = 25 min (feature, last 20 rows)`; `M` with `defaults (19 feature rows with estmin)` and exit 0; `learned: 15 min × 1 = 15 min (feature, last 30 rows)`; the second line carries the points (1, 2, 4, 8) and XL output carries `should split`. Sizing and measuring a stable item (estmin 10, work 15) 30 more times leaves its factor at 1.5 (no feedback loop) |
| Amended | Amended 2026-10-31 (human decision): fixture and expected values for learning from the minutes error; the 75th-percentile learning and its "nearest-rank" label are dropped |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Spawn the script per case | Exact output |

## TC-024

| Field | Detail |
|---|---|
| Test case ID | TC-024 |
| Requirement reference | FR-012 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | `estimates measure --file <tmp> --id t1 --feature demo --kind feature --est M --work 14 --review 1 --files 6 --rounds 1 --path implementation→review --tier T1` |
| Input | The flags above; a second call with `--cancelled` |
| Steps | See steps table below |
| Expected outcome | One line appended: `2026-… · t1 · demo · feature · M · M · 14 · 1 · 6 · 1 · implementation→review · T1 · 0` (actual = higher of work-size M and files-size M; gap 0); the cancelled call appends `actual -` and `stats` excludes it |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run measure twice, read the file | Two lines, fields in FR-012 order |

## TC-025

| Field | Detail |
|---|---|
| Test case ID | TC-025 |
| Requirement reference | FR-013 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Fixture `estimates.md` with rows on 3 days: day totals 6, 10, 8 points; est=actual on 4 of 6 rows; 1 over, 1 under |
| Input | `estimates stats <file>` |
| Steps | See steps table below |
| Expected outcome | `budget: 8 points (median of 3 days)`; `hit rate: 4/6`; `bias: 1 over, 1 under`; `throughput: 24 points / 3 days`; calibration line lists the three dates it rests on |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run stats | Exact lines |

## TC-026

| Field | Detail |
|---|---|
| Test case ID | TC-026 |
| Requirement reference | FR-013 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Fixture with 2 days of rows; a second fixture with 14 days where this week's hit rate is 2/8 and last week's 6/8 |
| Input | `estimates stats <file>` on each |
| Steps | See steps table below |
| Expected outcome | 2 days: `budget: 10 tasks (default — fewer than 3 days measured)`, calibration `none yet`; 14 days: a `warning: hit rate fell` line comparing the two weeks |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run stats on both | Default budget; week warning |

## TC-027

| Field | Detail |
|---|---|
| Test case ID | TC-027 |
| Requirement reference | FR-010 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Live GitHub, `gh` authenticated as the repository owner; executed once during the work item, recorded with command and output in the testing report |
| Input | `gh api repos/phuthuycoding/kanban-flow/issue-types`; the create call; `gh issue view 95 --json ... ` (type); a probe `gh issue create --type Epic` closed afterwards |
| Steps | See steps table below |
| Expected outcome | PASS: the catalog lists `Epic`, #95 `type.name == "Epic"`, the probe was created with the type and closed. BLOCKED (allowed): the API refused on the user-owned repository; the report carries the exact error and the settings URL; #100 stays open; no label was added |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read catalog | Epic absent or present |
| 2 | Create type / set #95 / probe | As expected or named blocker |

## TC-028

| Field | Detail |
|---|---|
| Test case ID | TC-028 |
| Requirement reference | FR-015 |
| Use case reference | UC-007 |
| Test type | Unit |
| Priority | High |
| Preconditions | `estimates overlap "<filesA>" "<filesB>"` using the plan `Files` semantics (a directory allows everything under it; a glob that matches a directory allows its subtree) |
| Input | (`src/workflow/schema.ts, src/cli/args.ts`, `src/cli/args.ts`) ; (`src/*`, `src/x/y.ts`) ; (`src/a.ts`, `docs/b.md`) ; (``, `src/a.ts`) |
| Steps | See steps table below |
| Expected outcome | `sequential`, `sequential`, `parallel`, `sequential` (unknown files run alone) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the four cases | Exact outputs |

## TC-029

| Field | Detail |
|---|---|
| Test case ID | TC-029 |
| Requirement reference | FR-014, FR-005 |
| Use case reference | UC-007, UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | Fixture with: item A in brainstorm (spec pending), item B in planning (approval pending), item C in review with PASS reports and an unmerged PR (stub `gh` OPEN, PR number 7), item D in review with `meta.docsBranch: docs/cli-d` and no upstream, item E with a live drive record |
| Input | `kf status --all` |
| Steps | See steps table below |
| Expected outcome | Output ends with `Needs you` listing A ("confirm spec") and B ("approve plan (or --backlog)"), `Waiting to merge` listing C with its PR URL and `gh pr merge 7 --squash` and D with `docs/cli-d awaiting push`, and `Running: 1`; items with nothing pending appear in neither bucket; `--json` carries the same buckets |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run status --all (text and --json) | Buckets as expected |

## TC-030

| Field | Detail |
|---|---|
| Test case ID | TC-030 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Skills and templates on disk |
| Input | `skills/kanban-review/SKILL.md`, `agents/code-reviewer.md`, `kanban-flow/templates/phase-5-review-report.md` |
| Steps | See steps table below |
| Expected outcome | The review skill names `Agent(code-reviewer)` as the step that produces findings and states the orchestrator writes no finding beyond the mechanical facts; the template has the `## Reviewer` section with the dispatch fields; `agents/code-reviewer.md` exists with `name: code-reviewer` and no write tool |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Assert the strings and frontmatter | Present |

## TC-031

| Field | Detail |
|---|---|
| Test case ID | TC-031 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `kf doctor` on a project whose `.kf/config.json` has `statusMap: { dones: "Done", shipping: "Ship" }` |
| Input | `kf doctor`; `kf doctor --fix`; `kf doctor` again |
| Steps | See steps table below |
| Expected outcome | First run: one finding `statusmap_legacy` naming both keys with the `--fix` action; `--fix` rewrites the file to `statusMap: { done: "Done" }` (shipping dropped) and reports it; third run: no finding |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | doctor, fix, doctor | Finding, rewrite, clean |

## TC-032

| Field | Detail |
|---|---|
| Test case ID | TC-032 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | The fixture of TC-015 after the close (item in `done` with `meta.docsBranch: docs/cli-demo`, branch unpushed) |
| Input | `kf doctor`; then push the branch to the bare origin and run `kf doctor` again |
| Steps | See steps table below |
| Expected outcome | First: finding `docs_branch_unpushed` naming `docs/cli-demo` and the push command; after the push: no finding |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | doctor before and after the push | Finding, then clean |

## TC-033

| Field | Detail |
|---|---|
| Test case ID | TC-033 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | High |
| Preconditions | The fixture of TC-013 with a `done.sh` hook that exits 1 (AC gate refuses) |
| Input | `kf status --change demo` |
| Steps | See steps table below |
| Expected outcome | The close is refused naming the hook; stage stays review; the worktree still exists; the branch exists locally and on the bare origin — nothing irreversible ran before the gate held |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run status with the refusing hook | Refused; worktree and branch intact |

## TC-034

| Field | Detail |
|---|---|
| Test case ID | TC-034 |
| Requirement reference | FR-016 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | The drive fixture of TC-016 with a fake runner that appends one JSONL line per second (`assistant` with a `tool_use` Edit of `src/a.ts`, then a `result` with `STATUS: DONE`) and sleeps 5s before exiting 0 |
| Input | `kf drive demo`, then `kf drive demo --status` and `kf drive demo --watch --tail` after 2s |
| Steps | See steps table below |
| Expected outcome | `--status` prints a `Live:` line ending in the activity `Edit src/a.ts (…s ago)`; the heartbeat prints the same; `--tail` shows the readable activity lines, no raw JSON; `runs/<id>.log` is non-empty before the worker exits |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Start the drive and read `--status` after 2s | `Live:` line carries `Edit src/a.ts` and an age |
| 2 | Run `--watch --tail` until the drive stops | Heartbeat shows the activity; tail lines are readable; final event is the task `done` |

## TC-035

| Field | Detail |
|---|---|
| Test case ID | TC-035 |
| Requirement reference | FR-016 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | The drive fixture with a fake runner whose only output is `{"type":"result","is_error":true,"result":"boom: tool denied","exit":1}` and exit code 1 |
| Input | `kf drive demo --watch` |
| Steps | See steps table below |
| Expected outcome | The task reason reads `worker exited 1: boom: tool denied`; the stop reason of `tasks_blocked` quotes the same text; `drive.runs` counts the attempts as today |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the drive to its stop | `kf tasks demo` shows the quoted worker text on TASK-001 |
| 2 | Read `--status` | `Stop: tasks_blocked — … worker exited 1: boom: tool denied …` |

## TC-036

| Field | Detail |
|---|---|
| Test case ID | TC-036 |
| Requirement reference | FR-016 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | The drive fixture with a fake runner whose first call writes a partial edit to `src/a.ts` and exits 1 with `{"type":"result","is_error":true,"api_error_status":429,"result":"You've hit your 5-hour limit · resets 1:30pm"}`, and whose second call (resume argv with the recorded session) finishes the task with `STATUS: DONE` |
| Input | `kf drive demo` twice, reading `--status` and `kf tasks demo` in between |
| Steps | See steps table below |
| Expected outcome | After the first drive: stopped with code `usage_limit`, reason containing `resets 1:30pm`, `nextCommand: kf drive demo`, TASK-001 `pending` (not failed, not blocked), `runs` unchanged from before the attempt, the partial edit still in the task worktree. After the second drive: the runner was called with the resume argv and the same session id; TASK-001 `done` and merged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | First drive | Stop `usage_limit`; task pending; runs not incremented; worktree keeps `src/a.ts` |
| 2 | Second drive | Resume argv with the recorded session; task done and merged |
