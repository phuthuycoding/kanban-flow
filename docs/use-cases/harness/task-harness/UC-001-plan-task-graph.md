---
feature: task-harness
context: harness
created: 20261024_1110
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-001 |
| Name | Plan declares a task DAG with roles and files; validate catches bad graphs |
| Requirement reference | FR-001, FR-004, FR-019 |
| Goal | The approved implementation plan carries a machine-readable task graph (dependencies, `Role`, `Files`) so the same plan always produces the same dispatch, and `kf validate` rejects a malformed graph before approval. |
| Primary actor | Main agent (planning) |

## Supporting Actors
- Owner / operator: approves the plan (the approval fingerprints the plan file, so the DAG and role assignment become part of the approved contract) and defines the roles in `harness.roles` in `.kf/config.json`.
- `kf validate`: parses the `## Task Breakdown` table and reports graph errors.
- `kanban-plan` skill: instructs the main agent to fill the `Role` and `Files` columns from the template.

## Preconditions
- The work item is in `planning` and `phase-2-implementation-plan.md` exists, created from the template whose Task Breakdown has the columns `Task`, `Description`, `Area`, `Dependencies`, `Expected output`, `FR / UC references`, `Role`, `Files`.
- `.kf/config.json` defines `harness.roles` (the set of valid role keys). For a project without roles, only `-` is a valid `Role`.
- The requirement is confirmed (Phase 1 gate passed).

## Trigger
The main agent writes or edits the Task Breakdown table of the implementation plan and runs `kf validate <feature>` (before asking the owner to approve the plan).

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Main agent | Writes one row per task in `## Task Breakdown`: unique `TASK-###` id, dependencies as task ids (or `-`, `—`, `none`, `n/a` or an empty cell for no dependencies), a `Role` (a key of `harness.roles`, or `-`), and a `Files` cell of paths or glob patterns the task may change. | The plan file holds the task graph in structured form. |
| 2 | Main agent | Runs `kf validate <feature>`. | kf parses the table, tolerating a missing table or missing columns. Ids are compared upper-cased; in a Dependencies cell every `TASK-###` token is a dependency and other text is ignored. |
| 3 | kf validate | Checks ids: every `TASK-###` is unique. | No `task_duplicate` error. |
| 4 | kf validate | Checks dependencies: every dependency names an existing task, and the graph has no cycle (a self-dependency counts as a cycle). | No `task_dep_missing` and no `task_dep_cycle` error. |
| 5 | kf validate | Checks each `Role`: it is `-` or a key of `harness.roles`. | No `task_role_unknown` error. |
| 6 | kf validate | Marks every task whose `Files` cell is empty or missing as "files unknown" (valid, not an error). | The graph is accepted; such tasks will later run alone (FR-005). A Task Breakdown section with no table yields zero tasks and no ERROR. |
| 7 | Main agent | Presents the plan to the owner for approval. | The owner approves; the approval fingerprints the plan file, so the DAG, roles and file sets are frozen as the approved contract. |
| 8 | kf | At run time, resolves each task's role: the plan's `Role` when it names a declared role; for `-`, the first role of `harness.stages.implementation`; when that is empty, `harness.main`. | Role resolution is deterministic and never a runtime guess (FR-004). |

## Alternative Flows
### A1
- Trigger: The plan was approved before this feature (no `Role` / `Files` columns) or has no Task Breakdown table.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | `kf validate` parses the table tolerantly: a missing column is treated as `-` for role and "files unknown" for files. | No error is reported for the missing columns. |
| A1.2 | Role resolution applies the FR-004 fallback (`harness.stages.implementation` first role, else `harness.main`). | Every task (if any; a section with no table yields zero tasks) gets the fallback role and runs sequentially, because every task is "files unknown". Returns to step 8. |

### A2
- Trigger: The project has no harness roles configured (`harness.roles` empty) and every task uses `Role` `-`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | Step 5 passes because `-` is always valid. | No `task_role_unknown` error. Returns to step 6. |

### A3
- Trigger: The main agent follows the `kanban-plan` skill (FR-019) rather than editing the table freehand.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The skill's template provides the `Role` and `Files` columns and tells the agent to fill them. | The agent fills a role and a file set per task. Returns to step 2. |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Two rows use the same `TASK-###` id. | `kf validate` reports an ERROR and the plan cannot be approved cleanly until fixed. | ERROR `task_duplicate`, naming the duplicate id. Reported as a separate finding from other graph errors. |
| A task lists a dependency id that is not a row in the table (for example `TASK-099`). Ids are compared upper-cased, so `task-001` resolves to `TASK-001` and is not an error; a cell such as `TASK-001 (schema)` means `TASK-001`. | ERROR; the main agent corrects the dependency. | ERROR `task_dep_missing`, naming the task and the missing dependency. A self-dependency is reported as the one-task cycle `task_dep_cycle` (for example `TASK-004 → TASK-004`). |
| The dependencies form a cycle, for example `TASK-002 → TASK-003 → TASK-002`. | ERROR that names the cycle path. | ERROR `task_dep_cycle` with the cycle spelled out (for example `TASK-002 → TASK-003 → TASK-002`). |
| A task's `Role` is neither `-` nor a key of `harness.roles`. | ERROR; the main agent picks a declared role or the owner adds the role to `.kf/config.json`. | ERROR `task_role_unknown`, naming the task and the unknown role. |
| Several of the above occur in one plan. | Each is reported as its own ERROR; none hides another. | One ERROR line per problem; `kf validate` exits non-zero. |

### E2

| Trigger | Handling | Resulting state / message |
|---|---|---|
| The plan is edited after approval so the Task Breakdown changes. | The approval fingerprint no longer matches; the item needs re-approval (existing gate behaviour). | Approval is stale: `kf validate` reports `approval_changed`, `kf drive` refuses to start naming re-approval (`kf approve <feature>`), and a drive already running stops with code `approval_changed` at its next step boundary (FR-012). |

## Postconditions
- The implementation plan's Task Breakdown is a valid task graph: unique ids, resolvable dependencies, an acyclic graph, and known roles.
- `kf validate` reports no `task_duplicate`, `task_dep_missing`, `task_dep_cycle` or `task_role_unknown` ERROR for the item.
- Tasks with an empty or missing `Files` cell are identified as "files unknown".
- After owner approval, the task graph, roles and file sets are covered by the approval fingerprint.

## Business Rules
- A duplicate id, a dangling dependency, a dependency cycle and an unknown role are each an ERROR; an empty or missing `Files` cell is valid, never an error.
- A Dependencies cell of `-`, `—`, `none`, `n/a` or empty means no dependencies; otherwise every `TASK-###` token is a dependency and other text is ignored. Ids are compared upper-cased. A self-dependency is a cycle.
- Valid `Role` values are `-` or a key of `harness.roles`; the agent never chooses a role by capability at runtime.
- Role resolution order (FR-004): the plan's `Role` if declared; for `-`, the first role of `harness.stages.implementation`; if that is empty, `harness.main`.
- Plans approved before this feature remain valid: missing columns mean role `-` and "files unknown", so those plans run sequentially.
- The plan file is fingerprinted by approval, so the DAG and role assignment are part of the approved contract; the same plan yields the same dispatch.
- Skills and templates carry the standard (FR-019): the template has `Role` and `Files` columns and `kanban-plan` fills them.

## Data
- Implementation plan `## Task Breakdown` table: columns `Task`, `Description`, `Area`, `Dependencies`, `Expected output`, `FR / UC references`, `Role`, `Files`.
- `harness.roles` in `.kf/config.json`: the set of valid role keys; `harness.stages.implementation` and `harness.main`: role-resolution fallbacks.
- Validation findings: error codes `task_duplicate`, `task_dep_missing`, `task_dep_cycle`, `task_role_unknown` (the cycle finding names the cycle).
- Approval fingerprint: hash of the plan file recorded at approval.

## Acceptance Criteria
- [ ] `kf validate` reports a cycle `TASK-002 → TASK-003 → TASK-002`, a self-dependency `TASK-004 → TASK-004` (also `task_dep_cycle`), a dangling dependency, a duplicate id and an unknown role as separate ERRORs with codes `task_dep_cycle`, `task_dep_missing`, `task_duplicate`, `task_role_unknown`, and exits non-zero (TC-001).
- [ ] Dependencies cells `-`, `—`, `None`, `n/a` and empty mean no dependency, `TASK-001 (schema)` means `TASK-001`, and `task-001` resolves to `TASK-001` (TC-002).
- [ ] A task with an empty or missing `Files` cell is accepted and marked "files unknown".
- [ ] A plan without `Role` / `Files` columns validates without graph errors and every task resolves to role `-` with files unknown; a Task Breakdown without a table yields zero tasks and no ERROR (TC-002).
- [ ] Role resolution returns the plan's `Role` when declared, else the first `harness.stages.implementation` role, else `harness.main`.
- [ ] After approval, editing a task's Role cell makes `kf validate` report `approval_changed` and makes `kf drive` exit 1 naming re-approval (TC-004).
- [ ] The implementation-plan template header has `Role` and `Files` and its sample row parses; `kanban-plan` tells the agent to fill them; `kanban-implement` has a task-worker section naming a single `TASK-###` and no longer contains "Pick the agent that fits"; `kanban-flow` checks `worktree.enabled` at the start decision and hands off to `kf drive` (asserted by a test over the shipped files, TC-005).
