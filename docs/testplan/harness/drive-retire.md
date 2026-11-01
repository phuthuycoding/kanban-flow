---
feature: drive-retire
context: harness
created: 20261101_1210
status: archived
---
# Test Plan

Test Strategy from `phase-1-spec-requirement.md`: `unit+integration`.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | drive-retire |
| Context | harness |
| Test level | unit+integration |
| UI scope | none |
| Tools / commands | vitest (`npm test`, `src/tests/*.test.ts`); integration tests run the real `kf` CLI against temp git repos |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 7 | 7 | allowlist helpers, plan parsing, skill and doc text |
| Integration | 12 | 12 | real CLI against temp git repos |
| UI / E2E | 0 | 0 | Test level is unit+integration; no UI |
| **Total** | **19** | **19** | **all must pass** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-002, FR-003 | TC-001, TC-002, TC-003, TC-004, TC-005, TC-006 | 6 | every listed case passes |
| UC-002 | FR-001, FR-004, FR-006, FR-007, FR-011, FR-012 | TC-007, TC-008, TC-009, TC-010, TC-011, TC-012, TC-019 | 7 | every listed case passes |
| UC-003 | FR-008, FR-009 | TC-013 | 1 | every listed case passes |
| UC-004 | FR-005, FR-006, FR-010 | TC-014, TC-015, TC-016, TC-017, TC-018 | 5 | every listed case passes |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-002 | TC-007, TC-019 | Yes | - |
| FR-002 | UC-001 | TC-001, TC-002, TC-003, TC-005, TC-006 | Yes | - |
| FR-003 | UC-001 | TC-004 | Yes | - |
| FR-004 | UC-002 | TC-011 | Yes | - |
| FR-005 | UC-004 | TC-014, TC-015, TC-016 | Yes | - |
| FR-006 | UC-002, UC-004 | TC-008, TC-017 | Yes | - |
| FR-007 | UC-002 | TC-012 | Yes | - |
| FR-008 | UC-003 | TC-013 | Yes | - |
| FR-009 | UC-003 | TC-013 | Yes | - |
| FR-010 | UC-004 | TC-018 | Yes | - |
| FR-011 | UC-002 | TC-010 | Yes | - |
| FR-012 | UC-002 | TC-009 | Yes | - |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Temp git repo item with a plan whose TASK-001 Files is `src/a.ts`; one commit after BASE touches `src/a.ts` and `src/b.ts` |
| Input | `kf verify f --task TASK-001 --base <BASE>` |
| Steps | See steps table below |
| Expected outcome | Exit 2; stdout names `src/b.ts`; no verify command runs (a marker command is not executed) |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Temp git repo item with a plan whose TASK-001 Files is `src/a.ts`; one commit after BASE touches `src/a.ts` and `src/b.ts` | Fixture ready |
| 2 | Run: `kf verify f --task TASK-001 --base <BASE>` | Exit 2; stdout names `src/b.ts`; no verify command runs (a marker command is not executed) |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Same item; commit touches only allowed files; `harness.verify.task` = [["true"],["false"]] |
| Input | `kf verify f --task TASK-001 --base <BASE>`, then with [["true"]] |
| Steps | See steps table below |
| Expected outcome | First run exits 1 naming `false` and its exit code; second run exits 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Same item; commit touches only allowed files; `harness.verify.task` = [["true"],["false"]] | Fixture ready |
| 2 | Run: `kf verify f --task TASK-001 --base <BASE>`, then with [["true"]] | First run exits 1 naming `false` and its exit code; second run exits 0 |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item with a plan; a valid BASE |
| Input | `--task TASK-999`; `--base nosuchref`; `--base` = a commit not an ancestor of HEAD; `--task` without `--base` |
| Steps | See steps table below |
| Expected outcome | Each exits 3 with the reason; the verify marker command never runs |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item with a plan; a valid BASE | Fixture ready |
| 2 | Run: `--task TASK-999`; `--base nosuchref`; `--base` = a commit not an ancestor of HEAD; `--task` without `--base` | Each exits 3 with the reason; the verify marker command never runs |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-003 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item with `harness.verify.stage` = [["true"]], then [["sh","-c","exit 4"]], then none |
| Input | `kf verify f --stage` |
| Steps | See steps table below |
| Expected outcome | Exit 0; exit 1 naming the command with code 4; exit 0 printing that nothing is configured |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item with `harness.verify.stage` = [["true"]], then [["sh","-c","exit 4"]], then none | Fixture ready |
| 2 | Run: `kf verify f --stage` | Exit 0; exit 1 naming the command with code 4; exit 0 printing that nothing is configured |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Integration |
| Priority | Medium |
| Preconditions | Item with no worktree; `harness.verify.task` absent; HEAD equals BASE |
| Input | `kf verify f --task TASK-001 --base HEAD` |
| Steps | See steps table below |
| Expected outcome | Exit 0; output says it ran in the project root and that no task verify is configured |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item with no worktree; `harness.verify.task` absent; HEAD equals BASE | Fixture ready |
| 2 | Run: `kf verify f --task TASK-001 --base HEAD` | Exit 0; output says it ran in the project root and that no task verify is configured |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Allowlist helpers moved to src/workflow/allowlist.ts |
| Input | pathAllowed with exact path, directory prefix, glob, no match; an empty Files list; a missing verify binary |
| Steps | See steps table below |
| Expected outcome | Same results as the old pathAllowed cases; empty Files → check skipped and reported; ENOENT → failure naming the command |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Allowlist helpers moved to src/workflow/allowlist.ts | Fixture ready |
| 2 | Run: pathAllowed with exact path, directory prefix, glob, no match; an empty Files list; a missing verify binary | Same results as the old pathAllowed cases; empty Files → check skipped and reported; ENOENT → failure naming the command |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Built CLI |
| Input | `kf drive x`, `kf run x`, `kf runs x`, `kf harness`, `kf -h` |
| Steps | See steps table below |
| Expected outcome | Each of the four exits 1 with `unknown command`; `kf -h` lists none of them and lists `verify` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Built CLI | Fixture ready |
| 2 | Run: `kf drive x`, `kf run x`, `kf runs x`, `kf harness`, `kf -h` | Each of the four exits 1 with `unknown command`; `kf -h` lists none of them and lists `verify` |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-006 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | Item in review whose .kfw.json has `drive` with a supervisorPid of a dead process, `runs` with a running record, `sessions`, `tasks` |
| Input | `kf status --change f`, `kf inspect`, `kf sync`, `kf stage` (transition), `kf archive f` (PASS reports, landing none), `kf cancel` and `kf migrate` on second such items |
| Steps | See steps table below |
| Expected outcome | None refuses on run/drive grounds; the leftover keys are still in .kfw.json after each write |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Item in review whose .kfw.json has `drive` with a supervisorPid of a dead process, `runs` with a running record, `sessions`, `tasks` | Fixture ready |
| 2 | Run: `kf status --change f`, `kf inspect`, `kf sync`, `kf stage` (transition), `kf archive f` (PASS reports, landing none), `kf cancel` and `kf migrate` on second such items | None refuses on run/drive grounds; the leftover keys are still in .kfw.json after each write |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-012 |
| Use case reference | UC-002 |
| Test type | Integration |
| Priority | High |
| Preconditions | A freshly planned item |
| Input | `kf approve f`; `kf inspect`; `kf autoconfig` |
| Steps | See steps table below |
| Expected outcome | `Next:` names the implement skill and not `kf drive`; inspect and autoconfig output contain no drive/run/runs/harness command |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: A freshly planned item | Fixture ready |
| 2 | Run: `kf approve f`; `kf inspect`; `kf autoconfig` | `Next:` names the implement skill and not `kf drive`; inspect and autoconfig output contain no drive/run/runs/harness command |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-011 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | Plans with and without a Role column |
| Input | parse and `kf validate`; `kf tasks --json` |
| Steps | See steps table below |
| Expected outcome | Both parse to the same tasks; no `task_role_unknown`; `kf doctor` raises no `plannedRolesMissing` for a plan naming an unknown role; JSON rows have no `role`; the template has no Role column |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Plans with and without a Role column | Fixture ready |
| 2 | Run: parse and `kf validate`; `kf tasks --json` | Both parse to the same tasks; no `task_role_unknown`; `kf doctor` raises no `plannedRolesMissing` for a plan naming an unknown role; JSON rows have no `role`; the template has no Role column |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-004 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | skills/kanban-implement/SKILL.md |
| Input | Surface test reading the skill |
| Steps | See steps table below |
| Expected outcome | It names `kf verify <f> --task` after the task commit and before the code-reviewer, maps exit 1/2/3 as FR-004 says, and uses `kf verify --stage` for the build gate |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: skills/kanban-implement/SKILL.md | Fixture ready |
| 2 | Run: Surface test reading the skill | It names `kf verify <f> --task` after the task commit and before the code-reviewer, maps exit 1/2/3 as FR-004 says, and uses `kf verify --stage` for the build gate |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-007 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | skills/ tree |
| Input | grep for `kf-run:`, `assignedRoles`, `kf (drive|run|runs|harness)\b`; read the kanban-review fallback |
| Steps | See steps table below |
| Expected outcome | No `kf-run:` or `assignedRoles`; command mentions only as removal notes; the fallback says the review cannot complete and the human is told, without `kf run` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: skills/ tree | Fixture ready |
| 2 | Run: grep for `kf-run:`, `assignedRoles`, `kf (drive|run|runs|harness)\b`; read the kanban-review fallback | No `kf-run:` or `assignedRoles`; command mentions only as removal notes; the fallback says the review cannot complete and the human is told, without `kf run` |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-008, FR-009 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | skills/travel/SKILL.md and references |
| Input | Surface test reading the travel skill |
| Steps | See steps table below |
| Expected outcome | No `kf drive`; defines `slots=N`, each item in its own worktree, background seat dispatch while advancing another item; `slots=1` behaves like one kanban-flow session; resume after compaction reads `.kf/travel/progress.md` then the item's `loop/progress.md` and restarts no item; `driving`, `blocked` (reason + next command), `waiting-to-merge` defined without `kf drive --status`; never approves/archives/merges/pushes to main |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: skills/travel/SKILL.md and references | Fixture ready |
| 2 | Run: Surface test reading the travel skill | No `kf drive`; defines `slots=N`, each item in its own worktree, background seat dispatch while advancing another item; `slots=1` behaves like one kanban-flow session; resume after compaction reads `.kf/travel/progress.md` then the item's `loop/progress.md` and restarts no item; `driving`, `blocked` (reason + next command), `waiting-to-merge` defined without `kf drive --status`; never approves/archives/merges/pushes to main |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Configs: verify only; full legacy block; legacy keys with wrong types (`roles: "x"`) |
| Input | Any kf command loads the config; `kf doctor` |
| Steps | See steps table below |
| Expected outcome | All load (no Invalid project config); verify-only gets no warning; each legacy key gets one `harness_legacy_key` warning naming `kf doctor --fix` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Configs: verify only; full legacy block; legacy keys with wrong types (`roles: "x"`) | Fixture ready |
| 2 | Run: Any kf command loads the config; `kf doctor` | All load (no Invalid project config); verify-only gets no warning; each legacy key gets one `harness_legacy_key` warning naming `kf doctor --fix` |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Config with every legacy key plus `harness.verify` and unrelated keys |
| Input | `kf doctor --fix` |
| Steps | See steps table below |
| Expected outcome | Legacy keys gone; `harness.verify` and every other key keep their values |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Config with every legacy key plus `harness.verify` and unrelated keys | Fixture ready |
| 2 | Run: `kf doctor --fix` | Legacy keys gone; `harness.verify` and every other key keep their values |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-005 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Config with legacy keys |
| Input | `kf init` (and bootstrap) on that project |
| Steps | See steps table below |
| Expected outcome | The legacy keys are still present afterwards; a fresh `kf init` writes no `harness` block |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Config with legacy keys | Fixture ready |
| 2 | Run: `kf init` (and bootstrap) on that project | The legacy keys are still present afterwards; a fresh `kf init` writes no `harness` block |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-006 |
| Use case reference | UC-004 |
| Test type | Integration |
| Priority | High |
| Preconditions | Two items with `drive`/`runs`/`sessions`/`tasks` in .kfw.json, one with a live pid (the test's own process) |
| Input | `kf doctor`; `kf doctor --fix` |
| Steps | See steps table below |
| Expected outcome | Doctor warns `meta_legacy_run_state` per item and names the live pid with "stop this process yourself"; --fix strips the four keys and keeps the rest; no process is killed |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: Two items with `drive`/`runs`/`sessions`/`tasks` in .kfw.json, one with a live pid (the test's own process) | Fixture ready |
| 2 | Run: `kf doctor`; `kf doctor --fix` | Doctor warns `meta_legacy_run_state` per item and names the live pid with "stop this process yourself"; --fix strips the four keys and keeps the rest; no process is killed |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-010 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | README.md, .github/pages/index.html, docs/workflow/ |
| Input | grep `kf (drive|run|runs|harness)\b` |
| Steps | See steps table below |
| Expected outcome | Only lines that say the commands were removed |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Set up: README.md, .github/pages/index.html, docs/workflow/ | Fixture ready |
| 2 | Run: grep `kf (drive|run|runs|harness)\b` | Only lines that say the commands were removed |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-001 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | Source tree after the change |
| Input | List `src/harness/` and `src/worktree/tasks.ts`; grep `src/` for imports of `harness/` |
| Steps | See steps table below |
| Expected outcome | `src/harness/` does not exist, `src/worktree/tasks.ts` does not exist, and no source file imports from `harness/` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | Read the source tree | Neither path exists |
| 2 | Grep `src/` for `harness/` imports | No hit |
