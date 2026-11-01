---
name: kanban-plan
description: 'Plan and obtain human approval for a kanban feature contract or lightweight bug triage contract; the approval starts the item, or parks it in backlog when the reply defers. Use when a work item is in planning.'
---

# Kanban Phase 2 — Planning → Execution Contract (Human + Agent)

Argument: `<feature_name>`.

Phase 2 turns the confirmed requirement into a **binding execution contract** that the human approves. Everything written here is law for the rest of the pipeline — no silent scope creep afterwards.

---

## 1. Verify stage

```bash
kf status --change {feature_name}   # must show stage = planning
```

If approval is already valid, keep the contract unchanged and go to section 4: `kf approve` re-runs the move. If the approval is changed or pending, finish the applicable contract and obtain fresh human approval.

Read work item kind from `kf status --change {feature_name} --json`. For `kind: bug`, use the confirmed bug report as the contract: reproduction, expected fix, scope, regression strategy and docs impact. Skip section 2; present this concise contract and run approval in sections 3 and 4. Do not create feature planning artifacts for a bug. If the request introduces behavior beyond correcting the defect, explain the scope change and follow the user's decision before creating a related feature.

## 2. Write the four plan artifacts (in order)

Read the confirmed Test Strategy from `phase-1-spec-requirement.md` (`Level` in a feature spec, `Test Level` in a bug report, plus `UI Tests`, `Tools`, `Coverage Target`) — it was agreed with the human in Phase 1. Everything below must honour it.

### Who writes what

The four artifacts depend on each other: the UC list drives the diagram and the test cases, and every `TC-###` must cite a real `FR-###` and `UC-###`. So the skeleton stays with you, and subagents only take the work that is independent once the skeleton is fixed:

| Step | Who | Output |
| --- | --- | --- |
| 0. Ground the requirement | You, inline | Every name the spec commits to verified against its definition; contradictions fixed in the spec before any plan text |
| a. Impact survey | `Agent(scout)` — one dispatch per thing that changes (a module, a shared surface, a data shape), all in one message | A `file:line` blast-radius map per target, saved verbatim as `<item>/reviews/scout-<target>.md` for the implement stage to reuse; never pasted into the planning artifacts |
| b. Skeleton | You | `implementation-plan`, the `use-case-specification` index with the final UC IDs, slugs and one-line goals |
| c. UC files | One subagent per `UC-###`, in parallel | `use-cases/UC-###-<slug>.md` |
| d. Diagram + test cases | You | `use-case-diagram`, `test-cases` |
| e. Contract review | `Agent(spec-reviewer)` with a fresh context, `model: opus` | Findings returned to you before section 3; advisory, never a gate on its own |

Skip the subagents and do every step yourself when the change is small (two UCs or fewer, or a survey that fits in a few files): each handover re-reads the spec and the code, which costs more than it saves at that size. If your runtime has no subagent tool, do the same steps yourself in the same order.

**Subagent prompt contract** — every subagent prompt must state:

- Task: its step (c for a UC file; the scout and spec-reviewer agents carry their own contracts), and for step c the exact `UC-###`, slug and goal from the index
- Files to read: `phase-1-spec-requirement.md`, the skeleton artifacts, the relevant source paths
- Files it may write: step c only, exactly its one `use-cases/UC-###-<slug>.md`; steps a and e write nothing
- Constraints: never rename or renumber a `UC-###`/`FR-###`, never add scope beyond the confirmed requirement, never edit another artifact, never run `kf approve`, `kf stage`, `kf archive` or `kf run`
- Context: `.works/planning/{feature_name}/` (from `kf status --change {feature_name}`)

**Subagent status protocol** — require every subagent to end with:

```text
Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
Summary: one or two sentences
Concerns/Blockers: (optional)
```

Treat `DONE_WITH_CONCERNS`, `BLOCKED` and `NEEDS_CONTEXT` as not-done: resolve it before moving on. A missing `Status:` line is not done either.

### 0. Ground the requirement — "what is X?"

Before any plan text, verify every name the confirmed spec commits to against its **definition**, not a call site: files and modules, functions and exported symbols, CLI commands and flags, tables and fields, endpoints and payload shapes, config keys and env vars. Read the installed types for a library, the running process for an env var, the schema for a field a condition will branch on. A name you cannot find is not "probably renamed" — fix the spec (or record the gap under Open Questions and tell the user) before planning against it. Documentation is not ground truth; code and live state are.

### a. Impact survey — "what depends on X?"

`kf stage <feature> planning` already fetched and fast-forwarded the base checkout to its upstream — survey the files as they are; if the transition output carried a `⚠ base is N commit(s) behind` warning, surface it to the user before writing the contract instead of pulling yourself.

Grounding protects you from a name that does not exist; it does nothing to protect a caller you never knew about. So before writing the plan, dispatch **`Agent(scout)`** once per thing the change will modify — a module, a shared surface (route, event, queue, schema, public export, CLI contract), a data shape — all in one message, naming the ref the change lands on. Each returns, under 40 lines: consumers (three passes: definition, symbol usage, indirect reach), the tests covering the change and the paths no test covers, what is written together with it, and why the code exists (`git blame` / `git log -S`).

**Check the receipt before using a report.** Every "none found" names the patterns searched; a countable claim never comes from documentation; the ref scouted is stated; a repo or module with no row was not covered. A missing report is *not scouted*, never *clean* — ask for it, and if none comes, say the survey is incomplete. `cannot enumerate by grep: <mechanism>` makes the result partial; carry "partial" into the plan's Risks.

Save each report verbatim as `<item>/reviews/scout-<target>.md` — `kanban-implement` reuses them instead of scouting the same surfaces again. Feed `Highest risk`, `Uncovered paths` and `Written together` into the plan's impact analysis, risks and test cases — a scout report that changes nothing about the plan was either unnecessary or unread. Do not paste reports into the artifacts. When the runtime has no subagent tool, run the four targets yourself in the same order and say so.

### b-d. Skeleton, UC files, diagram and test cases

Write the implementation plan and the use-case index first (step b). Once the UC IDs are fixed, dispatch one subagent per UC file (step c), all in one batch. When they return, read each UC file and check that its ID, goal and acceptance criteria match the index, then write the diagram and the test cases yourself (step d).

Print each template and fill the file at its path:

```bash
kf instruct implementation-plan --change {feature_name}
kf instruct use-case-specification --change {feature_name}
kf instruct use-case-diagram --change {feature_name}
kf instruct test-cases --change {feature_name}
kf instruct use-case --change {feature_name} --id UC-001-create-task
```

### implementation-plan
- Scope: now / supporting / future / not-in-scope
- `TASK-###` breakdown (fill **Files** for every task; Dependencies are `TASK-###` tokens or `-`), complexity, impact analysis (backend / frontend / DB / API / infra / security / performance / regression / deps)
- **Files** is the task's allowlist and must name everything the task will touch — registering a flag in `args.ts` counts. A task that touches a file outside its Files stops the drive (`plan_change_needed`) and needs re-approval. When unsure, prefer directories or globs, at the cost of parallelism (overlapping Files run one after another; empty Files runs alone).
- Read the spec's `## Affected surfaces` first: every declared surface gets a task row or a `## Documentation Impact` entry — `kf validate` warns on any surface the plan never mentions. `N/A` means none owed.
- **Global Constraints**: the spec's project-wide requirements that bind every task (version floors, dependency limits, naming and copy rules, exact values), one line each, verbatim — the task reviewer in `kanban-implement` receives this section word for word. `None` when the spec states none.
- **Review Focus**: up to five inputs or failure modes the spec implies but no task's tests exercise, likeliest first, each as the condition plus the behaviour expected (e.g. "a contact with no phone number: the export skips the row, it does not write an empty cell"). Each line's pinning test belongs to the task that owns the behaviour. `None` only after checking.
- A plan records decisions, not code: which files, which names and signatures, which values from the spec, which test proves each task. Forbidden placeholders: "TBD", "similar to TASK-N", a name no task defines, "add appropriate error handling". A task is the smallest unit with its own test cycle that is worth a fresh reviewer's gate; fold setup and docs into the task that needs them, split only where a reviewer could reject one task and approve its neighbour.
- Testing strategy incl. **coverage target from the spec's Test Strategy (default >= 80%)** and Definition of Done
- When Test Level is `full`: name the UI/E2E framework you will use (Playwright, Cypress and so on) and say which suite covers the critical flows and which covers everything.

### use-case-specification
- Use `phase-2-use-case-specification.md` only as an index and coverage summary.
- Write **one file per use case** under `use-cases/`, named `UC-###-<slug>.md` (e.g. `UC-001-create-task.md`), using `kf instruct use-case --id UC-###-<slug>`. The slug makes a file listing readable; plain `UC-###.md` stays valid.
- Each file contains one `UC-###`: goal, actors, preconditions, trigger, main / alternative / exception flows, postconditions, business rules, data and acceptance criteria.
- The `UC-###` prefix of the file name and the declared ID must match exactly. Do not put multiple UC narratives in one file.

### use-case-diagram
- Mermaid `graph TD` / `flowchart`: actors → use cases (one box per UC-###)

### test-cases
- **Generate test cases from the spec's Test Level (unit | unit+integration | full):**
  - `unit` → `Unit` cases only, one per acceptance criterion and per edge case, each tied to an FR and a UC.
  - `unit+integration` → add `Integration` cases wherever the change meets another system, the database or an API.
  - `full` → add **`UI / E2E`** cases for the user-facing flows: what is clicked, what is typed, what appears on screen, following the `UI Tests` scope (critical or all). Add the matching `## TC-###` sections from the detailed template, with references that match that scope.
- Keep the plan table-driven: fill overall totals, per-type counts, use-case coverage matrix and requirement coverage matrix before the detailed `## TC-###` tables.
- Define each test in a `## TC-###` section referencing `FR-###` (spec) and `UC-###` (the matching individual use-case file). `kf validate` blocks missing or unknown references before approval.
- If the user wants to change the test level during Phase 2, which is rare: update the Test Strategy in `phase-1-spec-requirement.md` before generating the cases, and say so when you present the contract for approval.

### e. Contract review

Before section 3, run your own self-review first (spec coverage: every FR has a task and a TC; type and name consistency across tasks; every Review Focus line has a pinning test; proportion: a plan several times longer than its spec is a transcript). Then dispatch **`Agent(spec-reviewer)`** once, `model: opus`, with a fresh context: the brief names the work item folder, says the contract is at planning, points at the user's request (the spec's Objective, or an excerpt file you write) and names a report file under the item folder (`<item>/reviews/contract-review.md`). It reports only requirement gaps, untestable FR/AC/TC, traceability breaks (an `FR-###` with no `TC-###`, a `TC-###` citing an unknown FR or UC, an index/file id mismatch, an uncovered Affected surface), scope drift, contradictions and ungrounded names. It edits nothing. Print `spec review ran on: <its model line>`; with no report, print `spec review: no report` and say the review is missing — do not narrate a missing report as clean. Fix what it finds yourself, or record why a finding does not apply; HIGH findings you did not fix go into the approval summary.

## 3. Human approval gate

```bash
kf validate --change {feature_name}
```

Before approval, `approval_required` is expected; `approval_changed` is expected when revising an old contract. Fix all other errors and assess warnings before presenting the contract. `kf approve` validates the artifacts without requiring an existing approval. Present a tight summary to the user:

- what the feature does (2-3 lines)
- implementation plan headlines (tasks, approach, risks)
- test strategy + coverage target *(as agreed in the spec's Test Strategy: unit / unit+integration / full + UI scope)*
- Definition of Done
- when `.kf/config.json` sets `harness.verify.stage` but `worktree.enabled` is not `true`: the drive (`kf drive`) cannot start — ask the human to enable worktrees in the same message

Ask once: **"approve?"** The reply carries the start: "approve" starts implementation; "approve, backlog" (or any reply that defers) parks it. Do not choose on the user's behalf and do not ask a second question.

`kf approve` fingerprints the requirement, four planning artifacts and all individual UC files for a feature; for a bug it fingerprints only the bug report. `kf stage` requires the approved contents to remain unchanged. Progress and test outcomes belong in tasks.md and the testing report; do not rewrite the approved contract during execution.

## 4. Approve — the reply decides the move

| Reply | Command | Result |
|---|---|---|
| approve | `kf approve {feature_name}` | approval recorded, item → implementation (worktree provisioned when enabled), `Next: kf drive {feature_name}` or the implement skill |
| approve, backlog | `kf approve {feature_name} --backlog` | approval recorded, item → backlog; it starts later with `kf stage {feature_name} implementation` on the user's word |

A refused move (hook, worktree provisioning, base behind) leaves the item in planning with the approval not kept: fix what the message names and re-run the same command. A deferred item keeps its approved contract in `backlog`.

---

## Done

Approval recorded and the item moved. Hand off:

```text
In implementation: load kanban-implement (or kf drive when a drive is configured). In backlog: leave it there and resume only after an explicit start decision.
```
