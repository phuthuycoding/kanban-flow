# Reviewer brief — the dispatch for `code-reviewer`

Use this when dispatching the whole-branch review. Prefer the `code-reviewer` agent (installed by `kf install` for Claude Code into `.claude/agents/`); when the runtime has no such agent, dispatch a general-purpose subagent with the same prompt and tell it it has no write tools and must not use any.

```
Agent:
  subagent_type: code-reviewer        # or general-purpose when the agent is not registered
  model: [MODEL]                             # sonnet | opus — REQUIRED, per references/review-tiers.md
  description: "Review [FEATURE] — [DIMENSION or whole diff]"
  prompt: |
    [DOCTRINE — paste references/reviewer-doctrine.md here, verbatim]

    ## Your dimension
    [DIMENSION: bugs | security | perf | contracts | intent — or "all dimensions" for T1].
    Report any finding you see outside it too, but spend your attention here.

    ## The review pack
    Read this file first; it is your whole input: [PACK_FILE]
    Its ## Rules block lists the rule files that bind this review. Read every one.

    ## Finding schema
    Return findings as described in: [SCHEMA_FILE]
    `evidence` is a verbatim line from the file, without the diff marker; a quote
    that does not exist in the file is refuted and the finding is dropped.

    ## Read-only
    You have no Write, Edit or Bash tool and must not look for a way around that.
    Do not dispatch or request another reviewer.

    ## Report
    Write your full report to [REPORT_FILE]. Reply with at most 60 lines: the JSON
    findings array first, then Declined / Deferred / Examined / Findings / Shippable.
```

**Placeholders**

- `[MODEL]` — from the tier: `sonnet` for T1 and T2, `opus` for T3 and for T2's `contracts` dimension when `SHARED=1`.
- `[DIMENSION]` — one of the five for T2/T3; "all dimensions" for T1.
- `[PACK_FILE]` — the pack the orchestrator wrote: `<item>/reviews/<execution-id>/pack.md`.
- `[SCHEMA_FILE]` — the absolute path of this skill's `references/finding-schema.md`.
- `[REPORT_FILE]` — `<item>/reviews/<execution-id>/reviewer-<dimension>.md`.

**What never goes in the brief:** "do not flag X", "treat Y as at most LOW", "the plan chose this on purpose". That is pre-judging; let the reviewer raise it and assess the finding against the contract when it arrives.

## The pack

Write it before any dispatch, from facts you produced in the skill's steps 2–4. Paths, not pasted artifacts, wherever the reviewer can read the file itself.

```
# Review pack — <feature> · execution <id> · tier <T> (<reason>)

## Intent
Requirement: <abs path of phase-1-spec-requirement.md>  (FR-### in scope: ...)
Plan: <abs path of phase-2-implementation-plan.md>  (tasks: TASK-001 ..., Files allowlists)
Use cases / test cases: <abs paths>
Kind: feature | bug  (for a bug: the bug report path and the sibling entry points it lists)

## Diff
<abs path of reviews/<id>/review-<base7>..<head7>.diff>   (commit list, stat, diff -U10; untracked new files appended)

## Verified
<command> → exit <code>, <N passed / M failed>, <duration>      (one line per command actually run)
Test files that ran: <names>
Changed behaviour no test touches: <list, or "none identified">
Testing report: <abs path of phase-4-testing-result.md> (status PASS, execution <id>)

## Rules
<abs path of each rule file, in precedence order: project, user, package>
<abs path of AGENTS.md / CLAUDE.md when present>

## Deferred
<verbatim `minor (deferred)` and `parked` lines from <item>/sdd/progress.md, or "no ledger">

## Baseline
HEAD at start: <sha>   (from the ## Baseline section of tasks.md)
Pre-existing working-tree changes: <list, or none>
Worktree: <path> (branch <name>)
```
