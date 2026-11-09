---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Test Plan

> **Partly superseded by `kf-next`:** the scheduling rules this doc puts in the `kf:implement` skill text (dispatch order, the live developer cap, contention, resume, fix-round and cascade routing) are now computed by `kf next` and ledger lines are written through `kf record`; the skill no longer states them. The behaviour itself still holds. Kept for history.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | adaptive-developer-cap |
| Context | harness |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`), `gh issue view` for TC-011 |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 10 | 10 | config validation and prose surface tests |
| Integration | 6 | 6 | `kf tasks --json`, `kf loop-stats` fixture, issue body, validate/doctor/status/worktree with domains off |
| UI / E2E | 0 | 0 | no UI |
| **Total** | **16** | **16** | |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-004, FR-007 | TC-004, TC-005, TC-010 | 3 | all pass |
| UC-002 | FR-003 | TC-006 | 1 | pass |
| UC-003 | FR-005 | TC-007, TC-008 | 2 | all pass |
| UC-004 | FR-006 | TC-009 | 1 | pass |
| UC-005 | FR-004, FR-007, FR-008 | TC-001, TC-002, TC-003, TC-010, TC-011 | 5 | all pass |
| UC-006 | FR-009, FR-010, FR-011, FR-012 | TC-012, TC-013, TC-014, TC-015, TC-016 | 5 | all pass |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001 | TC-004 | yes | |
| FR-002 | UC-001 | TC-005 | yes | |
| FR-003 | UC-002 | TC-006 | yes | |
| FR-004 | UC-005 | TC-001, TC-002, TC-003 | yes | |
| FR-005 | UC-003 | TC-007, TC-008 | yes | |
| FR-006 | UC-004 | TC-009 | yes | |
| FR-007 | UC-001 | TC-010 | yes | |
| FR-008 | UC-005 | TC-011 | yes | checked by command, not vitest |
| FR-009 | UC-006 | TC-012 | yes | |
| FR-010 | UC-006 | TC-013 | yes | |
| FR-011 | UC-006 | TC-014, TC-015, TC-016 | yes | |
| FR-012 | UC-006 | TC-016 | yes | |

## TC-001

`validateHarness` accepts a valid ceiling (TASK-001).

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-004 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | `{developers:{max:1}}`, `{developers:{max:16}}`, `{developers:{}}`, no `developers` |
| Steps | See steps table below |
| Expected outcome | No throw; the returned object keeps `developers` as given; legacy keys such as `parallel` are carried through unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call validateHarness with each input | No throw; the returned object keeps `developers` as given; legacy keys such as `parallel` are carried through unchanged |

## TC-002

`validateHarness` rejects an invalid ceiling (TASK-001).

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-004 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | `max` 0, 17, 2.5, "4", null; `developers` = 3, [], "x" |
| Steps | See steps table below |
| Expected outcome | Throws `harness.developers.max must be an integer from 1 to 16` for the max cases and `harness.developers must be an object { max? }` for the non-object cases, each naming the config file |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Call validateHarness with each input | Throws `harness.developers.max must be an integer from 1 to 16` for the max cases and `harness.developers must be an object { max? }` for the non-object cases, each naming the config file |

## TC-003

`kf tasks <f> --json` reports the ceiling (TASK-001).

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-004 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | Fixture project with an approved plan; config without the key, with `max: 3`, with `max: 0` |
| Steps | See steps table below |
| Expected outcome | `developers: {max: 6, source: "default"}`; `{max: 3, source: "config"}`; exit non-zero with the max message; `--graph --json` key set unchanged; `feature` and `tasks` byte-identical to before |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run `kf tasks <f> --json` with no `harness.developers` | `developers: {max: 6, source: "default"}`; `feature` and `tasks` byte-identical to before |
| 2 | Run it with `harness.developers.max: 3` | `developers: {max: 3, source: "config"}` |
| 3 | Run it with `harness.developers.max: 0` | Exit non-zero with `harness.developers.max must be an integer from 1 to 16` |
| 4 | Run `kf tasks <f> --graph --json` with no key | Key set unchanged (no `developers`) |

## TC-004

Implement skill states the live cap start and ceiling source (TASK-002).

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | skills/implement/SKILL.md, references/task-loop.md |
| Steps | See steps table below |
| Expected outcome | Neither contains `cap of 4`; both state the seats counted (fix-round, resume-commit), the three dispatch conditions, `Ruling: developer cap <N> — start`, start = min(2, `harness.developers.max`), and that the ceiling is read from `kf tasks <f> --json` `developers.max` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read both files | Neither contains `cap of 4`; both state the seats counted (fix-round, resume-commit), the three dispatch conditions, `Ruling: developer cap <N> — start`, start = min(2, `harness.developers.max`), and that the ceiling is read from `kf tasks <f> --json` `developers.max` |

## TC-005

Step-up rule (TASK-002).

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | skills/implement/SKILL.md, task-loop.md |
| Steps | See steps table below |
| Expected outcome | States +1 per clean parallel wave, decided in wave order once that wave and every earlier wave are complete; inline waves never change N; bounded by the ceiling and the widest incomplete wave; the `Ruling: developer cap <old> → <new> — wave <w> clean` grammar |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the step-up paragraph | States +1 per clean parallel wave, decided in wave order once that wave and every earlier wave are complete; inline waves never change N; bounded by the ceiling and the widest incomplete wave; the `Ruling: developer cap <old> → <new> — wave <w> clean` grammar |

## TC-006

Step-down and re-run rule (TASK-002).

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-003 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | skills/implement/SKILL.md, task-loop.md |
| Steps | See steps table below |
| Expected outcome | Lists all nine signatures verbatim; only ledgered controller verifies count (not `--stage`, not developers' runs); N = max(1, ⌊N/2⌋) at most once per contention event; `Note TASK-NNN: verify rerun — contention <signature>`; no new developer until fewer than N in flight; one re-run; a second failure goes to the fix loop or the other-task routing |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the step-down paragraph | Lists all nine signatures verbatim; only ledgered controller verifies count (not `--stage`, not developers' runs); N = max(1, ⌊N/2⌋) at most once per contention event; `Note TASK-NNN: verify rerun — contention <signature>`; no new developer until fewer than N in flight; one re-run; a second failure goes to the fix loop or the other-task routing |

## TC-007

Wait line and resume rules (TASK-002).

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | skills/implement/SKILL.md, task-loop.md |
| Steps | See steps table below |
| Expected outcome | Grammar and waiting-developers paragraph use `TASK-NNN: developer waits — <N> developers in flight`; the example has a concrete N; the ledger example still has 10 leading shapes; resume states N from the latest cap ruling or min(2, max), capped at the current max, the pending rerun note, the owed step-down and wave-order step-ups; seats above a lowered N are never cancelled |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the ledger grammar, the example and the resume section | Grammar and waiting-developers paragraph use `TASK-NNN: developer waits — <N> developers in flight`; the example has a concrete N; the ledger example still has 10 leading shapes; resume states N from the latest cap ruling or min(2, max), capped at the current max, the pending rerun note, the owed step-down and wave-order step-ups; seats above a lowered N are never cancelled |

## TC-008

`kf loop-stats` parses a live-cap ledger (TASK-003).

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-005 |
| Use case reference | UC-003 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Repository at the item branch |
| Input | fixtures/loop-stats/adaptive-cap.ledger.md |
| Steps | See steps table below |
| Expected outcome | Figures equal adaptive-cap.expected.json; the unparsed list is empty; the `2`/`3 developers in flight` waits gate on the next `developer done` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the loop-stats computation on the fixture | Figures equal adaptive-cap.expected.json; the unparsed list is empty; the `2`/`3 developers in flight` waits gate on the next `developer done` |

## TC-009

Plan skill Execution line at wave width (TASK-004).

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-006 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository at the item branch |
| Input | skills/plan/SKILL.md |
| Steps | See steps table below |
| Expected outcome | No `min(wave width, 4)`; N is the wave width; the summary says the cap starts at min(2, `harness.developers.max`) and scales itself |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the Execution mode paragraph and the approval summary list | No `min(wave width, 4)`; N is the wave width; the summary says the cap starts at min(2, `harness.developers.max`) and scales itself |

## TC-010

User-facing docs describe the live cap (TASK-005).

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-007 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository at the item branch |
| Input | README.md, .github/pages/index.html, docs/workflow/harness.md, lifecycle.md, cli-reference.md |
| Steps | See steps table below |
| Expected outcome | None states a fixed cap of 4 developers; README and harness.md document `harness.developers.max` (default 6, 1..16); harness.md shows the `<N> developers in flight` wait line; cli-reference documents the `developers` field of `kf tasks --json` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read each file | None states a fixed cap of 4 developers; README and harness.md document `harness.developers.max` (default 6, 1..16); harness.md shows the `<N> developers in flight` wait line; cli-reference documents the `developers` field of `kf tasks --json` |

## TC-011

Issue #126 states the chosen design (controller).

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-008 |
| Use case reference | UC-005 |
| Test type | Integration |
| Priority | Low |
| Preconditions | Repository at the item branch |
| Input | `gh issue view 126 --json body` |
| Steps | See steps table below |
| Expected outcome | Body names the live cap, `harness.developers.max` default 6, start min(2, max), step up per clean wave, halve on contention; #129's body carries the task checklist; the PR body contains `Closes #126` and `Closes #129` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the command after the controller edits the issue | Body names the live cap, `harness.developers.max` default 6, start min(2, max), step up per clean wave, halve on contention; #129's body carries the task checklist; the PR body contains `Closes #126` and `Closes #129` |

## TC-012

`worktree.domains` parse and default (TASK-006).

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-009 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | `{enabled:true}`, `{domains:true}`, `{domains:false}`, `{domains:"no"}` |
| Steps | See steps table below |
| Expected outcome | Absent → `domains: true` from `worktreeConfig`; booleans kept; `"no"` throws `worktree.domains must be boolean` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the test over the input | Absent → `domains: true` from `worktreeConfig`; booleans kept; `"no"` throws `worktree.domains must be boolean` |

## TC-013

No infra probe when off (TASK-006).

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-010 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | Project with `worktree.enabled: true`, `domains: false`, no domain infra; same with `domains: true` |
| Steps | See steps table below |
| Expected outcome | `kf validate` has no `worktree_infra_missing` and `kf doctor` no `worktree infra` line when off; with `domains: true` the probe still runs (finding present when the probe fails) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the test over the input | `kf validate` has no `worktree_infra_missing` and `kf doctor` no `worktree infra` line when off; with `domains: true` the probe still runs (finding present when the probe fails) |

## TC-014

Direct URL in status, transition and `kf worktree` (TASK-007).

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-011 |
| Use case reference | UC-006 |
| Test type | Integration |
| Priority | High |
| Preconditions | Repository at the item branch |
| Input | Provisioned worktree with `domains: false`; then `domains: true` |
| Steps | See steps table below |
| Expected outcome | Off: `kf status --change`, the transition note, `kf worktree create` and `list` show `http://127.0.0.1:<port>` and no `.test` URL; route file still has the entry. On: output byte-identical to before |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the test over the input | Off: `kf status --change`, the transition note, `kf worktree create` and `list` show `http://127.0.0.1:<port>` and no `.test` URL; route file still has the entry. On: output byte-identical to before |

## TC-015

Hook env without domain (TASK-007).

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-011 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository at the item branch |
| Input | Hook invocation built for a worktree with `domains: false` |
| Steps | See steps table below |
| Expected outcome | Env has `KFW_WORKTREE_PATH`, `KFW_WORKTREE_PORT`, `KFW_WORKTREE_BRANCH` and no `KFW_WORKTREE_DOMAIN`; with domains on it has all four |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the test over the input | Env has `KFW_WORKTREE_PATH`, `KFW_WORKTREE_PORT`, `KFW_WORKTREE_BRANCH` and no `KFW_WORKTREE_DOMAIN`; with domains on it has all four |

## TC-016

Skills, docs and repo config for the switch (TASK-005).

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-011, FR-012 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Repository at the item branch |
| Input | skills/implement, test, review SKILL.md, automation-writer brief and agent, README.md, docs/workflow/autoconfig.md, Pages, .kf/config.json |
| Steps | See steps table below |
| Expected outcome | Skills and the automation-writer say to use `http://127.0.0.1:<port>` when `worktree.domains` is false; autoconfig.md and cli-reference.md say `KFW_WORKTREE_DOMAIN` exists only with domains on; `kf worktree` help mentions the switch; README, autoconfig.md and Pages document `worktree.domains` (default true); this repo's config has `"domains": false` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Run the test over the input | Skills and the automation-writer say to use `http://127.0.0.1:<port>` when `worktree.domains` is false; autoconfig.md and cli-reference.md say `KFW_WORKTREE_DOMAIN` exists only with domains on; `kf worktree` help mentions the switch; README, autoconfig.md and Pages document `worktree.domains` (default true); this repo's config has `"domains": false` |
