---
feature: parallel-developers
context: harness
created: 20261101_2201
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-009 |
| Name | Show the plan's parallelism before approval |
| Requirement reference | FR-014 |
| Goal | Show the plan's parallelism before approval with `kf tasks --graph`, so the human sees how parallel the plan is before approving |
| Primary actor | Planner |

## Supporting Actors
- `kf tasks` (`src/cli/commands/tasks.ts`, `src/cli/args.ts`): parses `--graph` and prints the block.
- `taskGraphSummary` (`src/workflow/tasks.ts`): computes the figures from `taskView` rows, beside `taskView` and never called by it.
- The human: reads the approval summary and approves, or asks for a plan change.

## Preconditions
- The work item is in planning and has a plan whose tasks declare `Dependencies` and `Files`.
- The task graph has no cycle (`checkTaskGraph` reports no ERROR).

## Trigger
The Planner reaches the approval summary in kanban-plan § 3, or runs `kf tasks <feature> --graph`.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Planner | Runs `kf tasks <feature> --graph` after the normal graph checks pass | The command builds the `taskView` rows |
| 2 | System | `taskGraphSummary(rows)` takes `earliestStart` from each row's existing `wave` | One earliest start step per task |
| 3 | System | Finds the longest dependency chain by task count, ending at the task with the highest `wave`; ties go to the lowest task id at each step; dependencies missing from the plan are ignored | `criticalPath` and `length` |
| 4 | System | Finds the largest set of tasks with no direct or transitive dependency between any two and no Files overlap (exact branch-and-bound in id order for up to 30 tasks, first such set in id order; above 30 a greedy conflict-free lower bound (amended at review FINDING-003)) | `maxWidth`, `maxWidthExact` and `widthSet` |
| 5 | System | Prints `critical path: TASK-001 → TASK-003 (length 2)`, `max width: 3 (TASK-001, TASK-002, TASK-004)` and `earliest start: TASK-001 1, TASK-002 1, …` | The human sees the plan's parallelism |
| 6 | Planner | kanban-plan includes that block in the approval summary | The human decides on a plan that shows its parallelism |

## Alternative Flows
### A1
- Trigger: the Planner passes `--graph --json`.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | The command prints `{ "feature", "criticalPath", "length", "maxWidth", "maxWidthExact", "widthSet", "earliestStart" }` | Same figures as the text block; flow ends |

### A2
- Trigger: the plan has a task with `files: null` (Files unknown).

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A2.1 | The task is treated as overlapping every other task, as `filesOverlap` does | `maxWidth` never puts it in a set larger than 1; return to main flow step 5 |

### A3
- Trigger: the plan has a transitive dependency (A→B→C) and C's Files are disjoint from A's.

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A3.1 | The width search treats A and C as related | A and C are never in the same `widthSet`; return to step 5 |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Cyclic or otherwise invalid task graph | The existing check runs before `--graph`; the graph is not computed | Exit 1, `Task graph of '<feature>' is invalid; fix the plan:` with `ERROR <code>: <message>` lines, stderr `invalid task graph` |
| The plan has zero tasks | No chain and no set | `critical path: none (length 0)` and `max width: 0`, exit 0 |
| The plan has more than 30 tasks | The exact search is skipped; a greedy conflict-free set is a lower bound | `max width: ≥N (ids)`, JSON `maxWidthExact: false`, exit 0 (amended at review FINDING-003) |
| No plan, or unknown feature | Existing `kf tasks` behavior | Unchanged exit code and message |

## Postconditions
- The human has seen the critical path, its length, the max width and each task's earliest start before approving.
- `kf tasks --json` output (without `--graph`) is byte-identical to today.
- Nothing is written; `taskView`, `kf verify` and `review-package` are unchanged.

## Business Rules
- `earliestStart` is the row's existing `wave`; the graph never recomputes waves (FR-014).
- `maxWidth` is the largest set in which no two tasks are related by a dependency (direct or transitive) and no two overlap; unknown Files overlap everything. It is exact for plans of up to 30 tasks; above 30 it is a greedy conflict-free lower bound, labelled `≥N` and `maxWidthExact: false` (amended at review FINDING-003).
- A plan that looks wide on dependencies alone can still show a small `maxWidth` because of Files overlaps; that is the signal to change the plan before approval, not a failure.
- `taskGraphSummary` is computed beside `taskView`, never inside it, because `taskView` feeds `--json` and `kf loop-stats`.
- The docs that carry `--graph` (`docs/workflow/cli-reference.md`, `skills/kanban-flow/SKILL.md` CLI block, `skills/kanban-plan/SKILL.md` § 3) name it, pinned by `open-source-surface.test.ts` (FR-010).

## Data
- Input: `TaskViewRow[]` from `taskView(feature)` with `dependencies`, `files`, `overlaps`, `wave`.
- Output: `criticalPath: string[]`, `length: number`, `maxWidth: number`, `maxWidthExact: boolean`, `widthSet: string[]`, `earliestStart: Record<string, number>`.
- Fixtures: a 3-task chain plus 3 independent disjoint tasks (`src/tests/task-graph.test.ts`, `src/tests/tasks-command.test.ts`).

## Acceptance Criteria
- [ ] On a fixture plan with a 3-task chain and 3 independent disjoint tasks, `kf tasks <f> --graph` prints the critical path, its length and the hand-computed max width (FR-014).
- [ ] A task with unknown Files counts as overlapping everything and is excluded from any `widthSet` larger than 1 (FR-014).
- [ ] With a transitive dependency A→B→C and C disjoint from A, A and C are never in the same `widthSet` (FR-014).
- [ ] A plan of more than 30 tasks prints `max width: ≥N (ids)` with a conflict-free set and `maxWidthExact: false`; a plan of 30 tasks stays exact (FR-014) (amended at review FINDING-003).
- [ ] `--graph --json` carries `feature`, `criticalPath`, `length`, `maxWidth`, `maxWidthExact`, `widthSet` and `earliestStart`; `--json` alone is byte-identical to before (FR-014).
- [ ] A cyclic graph exits 1 with `invalid task graph`; a plan with zero tasks prints `critical path: none (length 0)` and `max width: 0` (FR-014).
- [ ] The kanban-plan approval summary includes the `kf tasks <f> --graph` block, and the docs name `--graph` (FR-014, FR-010).
