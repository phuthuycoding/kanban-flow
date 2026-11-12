# Reviewer brief — the dispatch for `code-reviewer`

Use this when dispatching the whole-branch review. The `code-reviewer` agent is registered for Claude Code by the kf plugin (`kf install` runs the plugin install); its body lives at `${CLAUDE_PLUGIN_ROOT}/assets/agents/code-reviewer.md` so every runtime can read it. The agent has **no write tool**: its reply is the report, and the orchestrator saves it.

```
Agent:
  subagent_type: kf:code-reviewer               # see "Stand-ins" below when it is not registered
  model: [MODEL]                             # opus | fable — REQUIRED, per references/review-tiers.md
  description: "Review [FEATURE] — [DIMENSION or whole diff]"
  prompt: |
    Read first, in this order — they are your contract:
    1. [DOCTRINE_FILE]   (references/reviewer-doctrine.md)
    2. [SCHEMA_FILE]     (references/finding-schema.md)

    ## Your dimension
    [DIMENSION: bugs | security | perf | contracts | intent — or "all dimensions" for T1].
    Report any finding you see outside it too, but spend your attention here.

    ## The review pack
    Read this file next; it is your whole input: [PACK_FILE]
    Its ## Rules block lists the rule files that bind this review — read every one; a violated
    rule is a finding whose file, line and evidence are the offending code line; the rule's
    path:line goes in issue. Its ## Diff block names the review package
    and the checkout path for reading files.

    ## Read-only
    You have no Write, Edit or Bash tool and must not look for a way around that. Do not
    dispatch or request another reviewer.

    ## Reply = report
    Reply with at most 60 lines: the JSON findings array first (evidence = one verbatim line
    from the file, at least 6 characters, without the diff marker — a quote that is missing,
    elsewhere in the file or outside the root is refuted and dropped), then the prose lines
    Declined / Deferred / Examined / Findings / Shippable. The caller saves your reply as the
    report; nothing you do not send is delivered.
```

**Placeholders**

- `[MODEL]` — from the tier: `opus` for every tier; `fable` only when `CRITICAL=1`.
- `[DIMENSION]` — one of the five for T1C's second seat, T2 and T3; "all dimensions" for T1 and T1C's first seat.
- `[DOCTRINE_FILE]`, `[SCHEMA_FILE]` — absolute paths of this skill's `references/reviewer-doctrine.md` and `references/finding-schema.md` (the reviewer has Read; pasting them costs output tokens on every dispatch).
- `[PACK_FILE]` — the pack the orchestrator wrote: `<item>/reviews/<execution-id>/pack.md`.

**After the reply:** save it verbatim to `<item>/reviews/<execution-id>/reviewer-<dimension>.md`, then extract its JSON array into `<item>/reviews/<execution-id>/reviewer-<dimension>.json` (`reviewer-<dimension>-<bundle>.json` for bundles); the skill's step 6 merges every one of them into a single `findings.json` for `scripts/verify-findings.mjs`.

**What never goes in the brief:** "do not flag X", "treat Y as at most LOW", "the plan chose this on purpose". That is pre-judging; let the reviewer raise it and assess the finding against the contract when it arrives.

## Stand-ins

When `code-reviewer` is not registered but the runtime has a subagent tool, dispatch `subagent_type: general-purpose` with the same prompt, **prefixed by the full body of `${CLAUDE_PLUGIN_ROOT}/assets/agents/code-reviewer.md`** and the sentence "You must not write, edit or run anything; you have been given tools you may not use." A stand-in keeps every tool, so its read-only limit is a request: record `stand-in: general-purpose` for that seat in the report's `## Reviewer` section. With no subagent tool at all, the review cannot be completed by this session (see the skill, step 5).

## The pack

Write it before any dispatch, from facts you produced in the skill's steps 2–4. Paths, not pasted artifacts, wherever the reviewer can read the file itself.

```
# Review pack — <feature> · execution <id> · tier <T> (<reason>; <N> non-code lines excluded from ADDED)

## Intent
Requirement: <abs path of phase-1-spec-requirement.md>  (FR-### in scope: ...)
Plan: <abs path of phase-2-implementation-plan.md>  (tasks: TASK-001 ..., Files allowlists)
Use cases / test cases: <abs paths>
Kind: feature | bug  (for a bug: the bug report path and the sibling entry points it lists)

## Diff
<abs path of reviews/<id>/review-<base7>..<head7>.diff>   (commit list, stat, diff -U10; untracked new text files appended, skipped ones listed)
Checkout for reading files: <abs path of the item worktree>

## Verified
<command> → exit <code>, <N passed / M failed>, <duration>      (one line per command actually run)
Test files that ran: <names>
Regression on BASE: <N> failed (expected) / on HEAD: <N> passed   (bugs and behaviour fixes)
Changed behaviour no test touches: <list, or "none identified">
Testing report: <abs path of phase-4-testing-result.md> (status PASS, execution <id>)

## Rules
<abs path of each rule file, in precedence order: project, user, package>
<abs path of AGENTS.md / CLAUDE.md when present>

## Deferred
<verbatim `minor (deferred)` and `parked` lines from <item>/loop/progress.md, or "no ledger">

## Baseline
HEAD at start: <sha>   (from the ## Baseline section of tasks.md)
Pre-existing working-tree changes: <list, or none>
Worktree: <path> (branch <name>)
```
