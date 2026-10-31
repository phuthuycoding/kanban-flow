# Estimation

Sizes are agent time and files touched, not human hours. The `estimates` script does every computation; travel supplies the inputs.

## Sizes

| Size | Points | Default minutes | Default files |
|---|---|---|---|
| S | 1 | < 5 | ≤ 3 |
| M | 2 | 5–20 | ≤ 10 |
| L | 4 | 20–60 | ≤ 30 |
| XL | 8 | > 60 | > 30, or needs a spec |

Size = the **higher** of the time size and the files size. XL is `should split`: not dispatched until the human splits it or overrides it in the plan.

```bash
estimates size <minutes> <files> .kf/travel/estimates.md
# M
# points: 2
# defaults (14 rows measured)      or      learned (30 rows)
```

**Learned thresholds.** Once `estimates.md` has ≥ 20 rows with a numeric `actual`, the script takes the last 30 such rows; for each size with ≥ 3 rows, the minute threshold becomes the 75th percentile of `work` and the file threshold the 75th percentile of `files` among rows whose `actual` is that size (index `floor(0.75 × n)` of the sorted values). A size with fewer than 3 rows keeps its default. Sizing then checks S → M → L, XL above L.

## Inputs for a line

- **files**: the number of distinct paths in the union of the item's pending task Files (`kf tasks <f> --json`, tasks not `done`). A directory or glob counts as 10. No plan (a red-CI PR): `gh pr view <n> --json changedFiles`.
- **minutes**: your estimate of agent time to `ready` — implementation tasks still pending plus testing and review. A testing or review line with nothing to implement is usually S or M. Needs a spec → XL.
- A kind whose `stats` line says `estimate one size up` (or down): apply it before printing the plan.

## Measurement row

`.kf/travel/estimates.md`, created by the first `measure` with a header:

```text
date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap
2026-10-31 · t1 · demo · feature · M · M · 14 · 1 · 6 · 1 · implementation→review · T1 · 0
```

| Field | Source |
|---|---|
| date | today (`--date` to override) |
| id, feature, kind, est | the ledger line |
| actual | computed by the script: the size of `work` and `files`, higher of the two; `-` with `--cancelled` |
| work | minutes: sum of `endedAt − at` over the item's `runs[]` started today (`kf status --change <f> --json`) — drive runs only, not time waiting on the human |
| review | minutes of the runs among those whose `stage` is `review` (a share of `work`) |
| files | `git diff --shortstat <base>...HEAD` in the item worktree, recorded as `files=<n>` on the ledger line at `waiting-to-merge` (the worktree is gone after the merge); else `gh pr view <n> --json changedFiles` |
| rounds | the drive's repair loops (`loops` of `kf drive <f> --status --json`) |
| path | the stages the item crossed today, e.g. `implementation→review` |
| tier | the review tier in the review report (`T1`, `T1C`, `T2`, `T3`), or `-` |
| gap | computed: sizes between est and actual, signed (`+1` = estimated one size low) |

Cancelled or restarted from scratch → `--cancelled`: `actual -`, `gap -`; `stats` and the learned thresholds skip the row.

## Budget and calibration

```bash
estimates stats .kf/travel/estimates.md
```

| Line | Rule |
|---|---|
| `budget:` | median of the daily sums of actual points when ≥ 3 days are measured; else `10 tasks` |
| `hit rate:` | rows with est = actual / measured rows |
| `bias:` | rows estimated too high (over) and too low (under) |
| `throughput:` | total actual points / measured days |
| `sizes:` | defaults or learned, with the learned thresholds |
| `calibration:` | the dates (and their points) the budget rests on, or `none yet` |
| `kind <k>:` | a kind with ≥ 3 rows whose mean gap is ≥ 1 size: estimate one size up (or down) |
| `warning:` | this week's hit rate (the 7 days ending at the latest row) is below the previous 7 days' |

The plan's Calibration line and the end-of-day summary print these lines as the script gives them.
