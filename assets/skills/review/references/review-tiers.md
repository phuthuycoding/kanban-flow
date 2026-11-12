# Review tiers — the diff picks the reviewer set, not the orchestrator

The whole-branch review scales with the diff. `scripts/select-tier` decides mechanically from three numbers so the tier is never a judgement call made under time pressure. Print the tier and its reason in the report before dispatching anything.

## Inputs

```bash
BASE=<baseline commit>                     # the ## Baseline HEAD of tasks.md, or the branch point
# Code lines only drive the tier: lockfiles, snapshots, generated and build output, and prose (`*.md`)
# do not cost the same review attention. Docs are still in the diff the reviewers read.
EXCL=(':(exclude)*.lock' ':(exclude)package-lock.json' ':(exclude)*.snap' ':(exclude)dist/**' ':(exclude)build/**' ':(exclude)*.min.js' ':(exclude)*.map' ':(exclude)*.md')
ADDED=$(git diff --numstat "$BASE" -- . "${EXCL[@]}" | awk '{a+=$1+$2} END{print a+0}')
EXCLUDED=$(( $(git diff --numstat "$BASE" | awk '{a+=$1+$2} END{print a+0}') - ADDED ))   # report this number in the pack
NEW=$(git -c core.quotePath=false ls-files --others --exclude-standard -- . ':(exclude).works/**' ':(exclude).worktrees/**' "${EXCL[@]}")   # untracked new files are invisible to git diff; same exclusions
[ -z "$NEW" ] || ADDED=$((ADDED + $(printf '%s\n' "$NEW" | tr '\n' '\0' | xargs -0 grep -Il . 2>/dev/null | tr '\n' '\0' | xargs -0 cat 2>/dev/null | wc -l)))
# Shared surface: a route, event, queue, schema or migration changed in CODE lines. Module exports are
# NOT a signal — every TypeScript change exports something, and a floor that always fires is no floor.
SHARED=$({ git diff "$BASE" -- . ':(exclude)*.json' ':(exclude)*.md' ':(exclude)*.lock' ':(exclude)*.snap' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
  printf '%s\n' "$NEW" | grep -vE '\.(json|md|lock|snap)$' | grep . | tr '\n' '\0' | xargs -0 -r cat; } \
  | grep -cE 'router\.(get|post|put|patch|delete)\(|\.route\(|app\.(get|post|put|patch|delete)\(|emit\(|publish\(|subscribe\(|@InjectModel|\.collection\(|CREATE TABLE|ALTER TABLE|DROP TABLE' >/dev/null && echo 1 || echo 0)
# Paths are a signal too — content lines never show a changed migration or route FILE, only its body.
{ git diff --name-only "$BASE"; printf '%s\n' "$NEW"; } | grep -qE '(^|/)(migrations?|routes?|schemas?|contracts?)(/|\.)' && SHARED=1
CRITICAL=0   # 1 when the item's requirement or the diff touches auth, sessions, tenant scope, payments, migrations or secrets
```

The repository may add its own shared-surface signals (a CLI's help table, a public SDK entry file) in `.kf/review/rules/` under a `## Shared surfaces` heading; the orchestrator appends them to the regex. `CRITICAL` is the one input the orchestrator sets by reading the requirement's scope and the changed paths; say in the report why it is 0 or 1.

## The rule

| Condition | Tier | Reviewers |
| --- | --- | --- |
| `CRITICAL=1`, any size | **T3** | five dimensions in parallel, all on `fable` |
| `ADDED > 600` | **T3** | five dimensions in parallel, all on `opus` |
| `201 ≤ ADDED ≤ 600` | **T2** | five dimensions in parallel on `opus` |
| `ADDED ≤ 200` and `SHARED=1` | **T1C** | one all-dimension `code-reviewer` on `opus` **plus one `contracts` reviewer** on `opus` — two dispatches, not five |
| `ADDED ≤ 200` and `SHARED=0` | **T1** | one `code-reviewer` on `opus` covering every dimension |

The five dimensions are `bugs`, `security`, `perf`, `contracts`, `intent`. Each T2/T3 reviewer gets the same pack and a one-line dimension; it may still report a finding outside its dimension when it sees one. Dispatch the set in **one message** so they run concurrently; collect each by name — a reviewer that goes quiet is an incomplete gate, not a clean one.

**Name the model on every dispatch.** A dispatch without a model lands on the runtime's default, which may be the session's most expensive model or its cheapest; neither is a decision. Never below `opus` for a reviewer: a review is the last check on the code, and a reviewer weaker than the writer misses what the writer missed. The aliases are Claude Code's; `${CLAUDE_PLUGIN_ROOT}/assets/shared/harness-tools.md` § Model tiers maps them for other runtimes, and for an account with no `fable`.

## Oversized diffs (`ADDED > 2000`)

Do not review as one unit, and do not ask the human — report the split.

1. Group the changed files into bundles of at most ~600 code lines by directory or by plan task; write the manifest once: `git diff --name-only "$BASE" > <item>/reviews/<id>/manifest.txt`.
2. Build one package per bundle with the script's pathspec form: `review-package "$BASE" HEAD <item>/reviews/<id>/bundle-<n>.diff --untracked -- <paths of bundle n>`.
3. Dispatch **one all-dimension reviewer per bundle** on `opus` (`fable` when `CRITICAL=1`), each given its bundle package plus the manifest so it knows the other half of a contract may have changed elsewhere, and **one `contracts` reviewer** on `opus` given the manifest and every bundle's stat section.
4. Merge every bundle's arrays into one, verify it with `scripts/verify-findings.mjs` (which then dedups by `title + file`), report per bundle and in total.

More than eight bundles means the item should have been more than one work item: record `split recommended: <N> bundles` in the report's `## Reviewer` section and continue — the human reads it before the merge, not as a mid-review question.

## Why tiers

A single reviewer on a 900-line diff reads the first half carefully and skims the rest; five reviewers each reading the whole diff for one failure class catch what the single pass skims past. The opposite failure is paying five reviewers for a 40-line change. A floor that fires on every diff is the same failure wearing a different name, which is why module exports are not a shared-surface signal. The thresholds are a starting point; move them in this file, not in the skill, when the project's measurements say so.
