# Review tiers — the diff picks the reviewer set, not the orchestrator

The whole-branch review scales with the diff. `scripts/select-tier` decides mechanically from three numbers so the tier is never a judgement call made under time pressure. Print the tier and its reason in the report before dispatching anything.

## Inputs

```bash
BASE=<baseline commit>                     # the ## Baseline HEAD of tasks.md, or the branch point
ADDED=$(git diff --numstat "$BASE" | awk '{a+=$1+$2} END{print a+0}')
NEW=$(git -c core.quotePath=false ls-files --others --exclude-standard)   # untracked new files are invisible to git diff
[ -z "$NEW" ] || ADDED=$((ADDED + $(printf '%s\n' "$NEW" | tr '\n' '\0' | xargs -0 cat | wc -l)))
# Shared surface: a route, event, queue, schema, migration or public API changed in CODE lines (docs and lockfiles excluded).
SHARED=$({ git diff "$BASE" -- ':(exclude)*.json' ':(exclude)*.md' ':(exclude)*.lock' ':(exclude)*.snap' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) '
  printf '%s\n' "$NEW" | grep -vE '\.(json|md|lock|snap)$' | grep . | tr '\n' '\0' | xargs -0 -r cat; } \
  | grep -cE 'router\.(get|post|put|patch|delete)|\.route\(|emit\(|publish\(|subscribe\(|@InjectModel|collection\(|CREATE TABLE|ALTER TABLE|migration|export (async )?function|export const' >/dev/null && echo 1 || echo 0)
CRITICAL=0   # 1 when the item's requirement or the diff touches auth, sessions, tenant scope, payments, migrations or secrets
```

`CRITICAL` is the one input the orchestrator sets by reading the requirement's scope and the changed paths; say in the report why it is 0 or 1.

## The rule

| Condition | Tier | Reviewers |
| --- | --- | --- |
| `CRITICAL=1`, any size | **T3** | five dimensions in parallel, all on `opus` |
| `ADDED > 600` | **T3** | as above |
| `201 ≤ ADDED ≤ 600` | **T2** | five dimensions in parallel on `sonnet`; `contracts` on `opus` when `SHARED=1` |
| `ADDED ≤ 200` and `SHARED=1` | **T2** | the T2 floor: a small diff that changes a shared surface still gets the `contracts` dimension |
| `ADDED ≤ 200` and `SHARED=0` | **T1** | one `code-reviewer` on `sonnet` covering every dimension |

The five dimensions are `bugs`, `security`, `perf`, `contracts`, `intent`. Each T2/T3 reviewer gets the same pack and the same doctrine, plus one line naming its dimension; it may still report a finding outside its dimension when it sees one. Dispatch all five in **one message** so they run concurrently; collect each by name — a reviewer that goes quiet is an incomplete gate, not a clean one.

**Name the model on every dispatch.** A dispatch without a model lands on the runtime's default, which may be the session's most expensive model or its cheapest; neither is a decision. Never below `sonnet` for a reviewer: the cheapest tier takes more turns and reviews worse.

## Oversized diffs

`ADDED > 2000`: do not review as one unit. Split by directory or by plan task into bundles of at most ~600 lines, run `select-tier` per bundle, review each bundle with the full file manifest (`git diff --name-only "$BASE"`) as context so a reviewer knows the other half of a contract may have changed elsewhere, then merge and dedup. More than eight bundles means the item should have been more than one work item; say so in the report and ask the human before continuing.

## Why tiers

A single reviewer on a 900-line diff reads the first half carefully and skims the rest; five reviewers each reading the whole diff for one failure class catch what the single pass skims past. The opposite failure is paying five reviewers for a 40-line change. The thresholds are a starting point; move them in this file, not in the skill, when the project's measurements say so.
