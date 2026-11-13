---
name: plan
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

A task stopped at `cap reached` (kf:implement, Repairing after the loop) returns here: the re-approved contract gives the work a new task with its own five rounds, or no longer requires what failed, and the session that resumes ledgers `superseded by TASK-MMM` or `superseded by contract`.

Read work item kind from `kf status --change {feature_name} --json`. For `kind: bug`, use the confirmed bug report as the contract: reproduction, expected fix, scope, regression strategy and docs impact. Skip section 2 (a bug runs no scout and no spec-reviewer); present this concise contract and run approval in sections 3 and 4, leaving out what only a feature has: the `kf tasks --graph` block, the `Execution:` lines, the developer cap, the research choices and the plan's Definition of Done. A bug with two or more tasks gets a `phase-2-implementation-plan.md` holding only a Task Breakdown table (Files, Dependencies) and its `Execution:` lines, read by `kf tasks`, `kf next` and `kf verify` as a feature's plan and fingerprinted by `kf approve` with the bug report; still no use cases, diagram or test-case artifacts. A one-task bug keeps the report-only contract. The approval summary then includes the `kf tasks --graph` block and the `Execution:` lines for such a bug. Do not create other feature planning artifacts for a bug. If the request introduces behavior beyond correcting the defect, explain the scope change and follow the user's decision before creating a related feature.

## 2. Write the four plan artifacts (in order)

Read the confirmed Test Strategy from `phase-1-spec-requirement.md` (feature spec: `Level`, `UI Tests`, `Tools`, `Coverage Target`; a bug report has `Test Level`, `Tools`, `Coverage Target` and no `UI Tests`) — it was agreed with the human in Phase 1. Everything below must honour it.

### Who writes what

The four artifacts depend on each other: the UC list drives the diagram and the test cases, and every `TC-###` must cite a real `FR-###` and `UC-###`. So the skeleton stays with you, and subagents only take the work that is independent once the skeleton is fixed:

| Step | Who | Output |
| --- | --- | --- |
| 0. Ground the requirement | You, inline | Every name the spec commits to verified against its definition; contradictions fixed in the spec before any plan text |
| a. Impact survey | `Agent(kf:scout)` — one dispatch per thing that changes (a module, a shared surface, a data shape), all in one message | A `file:line` blast-radius map per target, saved verbatim as `<item>/reviews/scout-<target>.md` for the implement stage to reuse; never pasted into the planning artifacts |
| a2. Research | `Agent(kf:researcher)` in mode `web` or `prior-art` (brief: `${CLAUDE_PLUGIN_ROOT}/assets/shared/researcher-brief.md`), in the same message as the scouts, whenever the plan chooses between two or more approaches or libraries, or names an external dependency or API version | A cited report saved as `<item>/reviews/research-<slug>.md`; reports brainstorm already saved are reused, not re-researched. It runs next to the scouts and does not replace them |
| b. Skeleton | You | `implementation-plan`, the `use-case-specification` index with the final UC IDs, slugs and one-line goals |
| c. UC files | One subagent per `UC-###`, in parallel | `use-cases/UC-###-<slug>.md` |
| d. Diagram + test cases | You | `use-case-diagram`, `test-cases` |
| e. Contract review | `Agent(kf:spec-reviewer)` with a fresh context, `model: fable` | Findings returned to you before section 3; advisory, never a gate on its own |

When the change is small (two UCs or fewer), skip the per-UC-file subagents of step c and write those files yourself: each handover re-reads the spec and the code, which costs more than it saves at that size. The scout (step a) and the spec-reviewer (step e) are never skipped for a feature. Research done inline must still write `<item>/reviews/research-<slug>.md`: the self-review fails a choice without that report. If your runtime has no subagent tool, do the same steps yourself in the same order.

**Subagent prompt contract** — every subagent prompt must state:

- Task: its step (c for a UC file; the scout and spec-reviewer agents carry their own contracts), and for step c the exact `UC-###`, slug and goal from the index
- Files to read: `phase-1-spec-requirement.md`, the skeleton artifacts, the relevant source paths
- Files it may write: step c, exactly its one `use-cases/UC-###-<slug>.md`; step e, only its report file; step a writes nothing
- Constraints: never rename or renumber a `UC-###`/`FR-###`, never add scope beyond the confirmed requirement, never edit another artifact, never run `kf approve`, `kf stage` or `kf archive`
- Context: `.works/planning/{feature_name}_{ts}/` (from `kf status --change {feature_name}`)

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

`kf stage <feature> planning` already fetched and fast-forwarded the base checkout to its upstream — survey the files as they are; if the transition output carried a `⚠` line (base behind its upstream, remote unreachable, detached HEAD), surface it to the user before writing the contract instead of pulling yourself.

Grounding protects you from a name that does not exist; it does nothing to protect a caller you never knew about. So before writing the plan, dispatch **`Agent(kf:scout)`** once per thing the change will modify — a module, a shared surface (route, event, queue, schema, public export, CLI contract), a data shape — all in one message, naming the ref the change lands on. Each returns, under 40 lines: consumers (three passes: definition, symbol usage, indirect reach), the tests covering the change and the paths no test covers, what is written together with it, and why the code exists (`git blame` / `git log -S`).

**Check the receipt before using a report.** Every "none found" names the patterns searched; a countable claim never comes from documentation; the ref scouted is stated; a repo or module with no row was not covered. A missing report is *not scouted*, never *clean* — ask for it, and if none comes, say the survey is incomplete. `cannot enumerate by grep: <mechanism>` makes the result partial; carry "partial" into the plan's Risks.

Save each report verbatim as `<item>/reviews/scout-<target>.md` — `kf:implement` reuses them instead of scouting the same surfaces again. Feed `Highest risk`, `Uncovered paths` and `Written together` into the plan's impact analysis, risks and test cases — a scout report that changes nothing about the plan was either unnecessary or unread. Do not paste reports into the artifacts. When the runtime has no subagent tool, run the four targets yourself in the same order and say so.

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
- **Execution mode per wave**: read `kf tasks <f> --graph` once the breakdown is written and record one line per wave, under Task Breakdown after the table — `Execution: wave <w> inline` for a wave of one task, otherwise `Execution: wave <w> parallel, <N> developers` with N = the largest set of the wave's tasks whose Files do not overlap one another (each task's `overlaps` in `kf tasks <f> --json`; no clamp). Tasks of one wave whose Files overlap run in sequence, so N can be smaller than the wave. The line is the most the wave can use; the live developer cap decides how many run. An inline wave spawns no developer: the controller fills the seat (`kf:implement` § Inline waves). Waves come from Dependencies only.
- **Files** is the task's allowlist and must name everything the task will touch — registering a flag in `args.ts` counts. A task that touches a file outside its Files makes `kf verify --task` exit 2: `kf stage <f> planning`, edit Files, the human approves, `kf approve <f>` (moves the item back to implementation), then re-run `kf verify`. When unsure, prefer directories or globs.
- **Wiring**: a file every task must touch to reach its code (a crate root, `mod.rs`, a barrel, a router, a registry) gets one scaffold task in the first wave. It declares what the later tasks fill, with stubs so the tree builds, and the later tasks keep that file out of their Files. Otherwise it lies outside every allowlist, or every task overlaps on it and the wave runs in sequence.
- Read the spec's `## Affected surfaces` first: every declared surface gets a task row or a `## Documentation Impact` entry — `kf validate` warns on any surface the plan never mentions. `N/A` means none owed.
- **Documentation Impact** names the living docs this feature changes, one line each: `docs/specs/<context>/<capability>.md` (created or updated at review step 2b; `README` is the context index, never a capability), `consolidates: <context>/<feature>` for each legacy feature under `docs/requirement`, `docs/use-cases` or `docs/testplan` whose behaviour this feature changes (step 2b folds it into a living doc and deletes its files), or `none — <reason>`. `kf validate` refuses a section that names no living doc and waives nothing (`docs_impact_missing`), and a context the project does not declare (`docs_context_undeclared`).
- **Global Constraints**: the spec's project-wide requirements that bind every task (version floors, dependency limits, naming and copy rules, exact values), one line each, verbatim — the task reviewer in `kf:implement` receives this section word for word. `None` when the spec states none.
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
  - `full` → add **`UI / E2E`** cases for the user-facing flows: what is clicked, what is typed, what appears on screen, following the `UI Tests` scope (critical or all). A task that builds a screen or a route a browser loads carries its own UI cases, so its automation-writer runs in that task; a final E2E task may add journeys across tasks, never replace them. Add the matching `## TC-###` sections from the detailed template, with references that match that scope.
- Keep the plan table-driven: fill overall totals, per-type counts, use-case coverage matrix and requirement coverage matrix before the detailed `## TC-###` tables.
- Define each test in a `## TC-###` section referencing `FR-###` (spec) and `UC-###` (the matching individual use-case file). `kf validate` blocks missing or unknown references before approval.
- If the user wants to change the test level during Phase 2, which is rare: update the Test Strategy in `phase-1-spec-requirement.md` before generating the cases, and say so when you present the contract for approval.

### e. Contract review

Before section 3, run your own self-review first (spec coverage: every FR has a task and a TC; type and name consistency across tasks; every Review Focus line has a pinning test; proportion: a plan several times longer than its spec is a transcript; research: the self-review fails a plan that chooses between approaches or libraries, or pins an external dependency or API version, without a research report). Then dispatch **`Agent(kf:spec-reviewer)`** once, `model: fable`, with a fresh context: the brief names the work item folder, says the contract is at planning, carries a verbatim excerpt of the user's request (in the brief or a file you write under the item folder; never only the spec's Objective), names the git ref to ground names against and names a report file under the item folder (`<item>/reviews/contract-review.md`). It reports only requirement gaps, untestable FR/AC/TC, traceability breaks (an `FR-###` with no `TC-###`, a `TC-###` citing an unknown FR or UC, an index/file id mismatch, an uncovered Affected surface), scope drift, contradictions and ungrounded names. It edits nothing. Print `spec review ran on: <its model line>`; with no report, print `spec review: no report` and say the review is missing — do not narrate a missing report as clean. Fix what it finds yourself, or record why a finding does not apply; HIGH findings you did not fix go into the approval summary.

## 3. Human approval gate

```bash
kf validate --change {feature_name}
```

Before approval, `approval_required` is expected, also when revising a contract (every entry to planning resets the approval to pending); `approval_changed` means the contract was edited without returning to planning. Fix all other errors and assess warnings before presenting the contract. `kf approve` validates the artifacts without requiring an existing approval. Present a tight summary to the user:

- what the feature does (2-3 lines)
- implementation plan headlines (tasks, approach, risks), with the output of `kf tasks <feature> --graph` (critical path and max width) as a block
- the approval summary lists the plan's `Execution:` lines, one per wave, so the human sees which waves run inline, and says the developer cap starts at min(2, `harness.developers.max`) and scales itself
- each choice between approaches or libraries, or external dependency or API version, with its sources (the research reports)
- test strategy + coverage target *(as agreed in the spec's Test Strategy: unit / unit+integration / full + UI scope)*
- Definition of Done
- when `.kf/config.json` does not set `worktree.enabled: true`: implementation and `kf verify` run in the main checkout, not an item worktree — say so in the same message

Ask once: **"approve?"** The reply carries the start: "approve" starts implementation; "approve, backlog" (or any reply that defers) parks it. Do not choose on the user's behalf and do not ask a second question.

`kf approve` fingerprints the requirement, four planning artifacts and all individual UC files for a feature; for a bug it fingerprints only the bug report. `kf stage` requires the approved contents to remain unchanged. Progress and test outcomes belong in tasks.md and the testing report; do not rewrite the approved contract during execution.

## 4. Approve — the reply decides the move

| Reply | Command | Result |
|---|---|---|
| approve | `kf approve {feature_name}` | approval recorded, item → implementation (worktree provisioned when enabled), `Next: load the kf:implement skill` |
| approve, backlog | `kf approve {feature_name} --backlog` | approval recorded, item → backlog; it starts later with `kf stage {feature_name} implementation` on the user's word |

A refused move (hook, worktree provisioning) leaves the item in planning with the approval not kept: fix what the message names and re-run the same command. A base behind its upstream does not refuse the move (a fast-forward that fails does, with the approval not kept); report any `⚠` line in the `kf approve` output to the user. A deferred item keeps its approved contract in `backlog`.

---

## Done

Approval recorded and the item moved. Hand off:

```text
In implementation: load kf:implement. In backlog: leave it there and resume only after an explicit start decision.
```
