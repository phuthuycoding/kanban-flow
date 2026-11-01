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
estimates size <minutes> <files> .kf/travel/estimates.md <kind>
# L
# points: 4
# defaults (14 feature rows with estmin)      or      learned: 15 min × 2 = 30 min (feature, last 30 rows)
```

**Learned minutes.** The thresholds never change: `size` and `measure` both size with the defaults above, so `est` and `actual` compare like with like. What is learned is how far your minute estimates miss, per kind. Once `estimates.md` has ≥ 20 measured rows of that kind with an `estmin`, the script takes the last 30 such rows and computes the factor = the median of `work ÷ estmin`, clamped to 0.5–3. `size` multiplies your minutes by the factor, then sizes the result with the defaults. Work that runs slower than estimated gives a factor above 1 (estimates go up); faster gives one below 1 (estimates go down). The file count is not corrected. The factor is computed only from your raw estimate and the measured work, so it cannot feed on itself — as long as `estmin` is the number you passed to `size`, never the corrected one. Rows without `estmin` (older rows) and cancelled rows are skipped for learning, not refused.

## Inputs for a line

- **files**: the number of distinct paths in the union of the item's pending task Files (`kf tasks <f> --json`, tasks not `done`). A directory or glob counts as 10. No plan (a red-CI PR): `gh pr view <n> --json changedFiles`.
- **minutes**: your estimate of agent time to `ready` — implementation tasks still pending plus testing and review. A testing or review line with nothing to implement is usually S or M. Needs a spec → XL. Estimate without looking at the factor and do not adjust for it yourself: the script applies it. Record these raw minutes on the ledger line as `estmin=<n>` and the approved size as `est0=<size>`; a carried line keeps the `est0` and `estmin` of the day it was first planned, since `work` covers every day. Its morning re-size feeds only the day's budget and batching.
- **kind**: the line's kind (`feature`, `bug`, `pr`); each kind learns its own factor.

## Measurement row

`.kf/travel/estimates.md`, created by the first `measure` with a header:

```text
date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin
2026-10-31 · t1 · demo · feature · M · M · 14 · 1 · 6 · 1 · implementation→review · T1 · 0 · 10
```

A row without `estmin` (written before it existed) ends at `gap`; it still counts for budget, hit rate and bias.

| Field | Source |
|---|---|
| date | today (`--date` to override) |
| id, feature, kind | the ledger line |
| est | the line's `est0`: the size approved when the line was first planned, not a carried line's re-size |
| actual | computed by the script with the **default** thresholds (never the learned ones, so learning cannot feed on itself): the size of `work` and `files`, higher of the two; `-` with `--cancelled` |
| work | minutes of seat work on the item, summed across every day: the duration of each seat run (implementation, testing and review phases) as travel observes it in the seat's completion notification, added to the `work=<n>` already on the item's line in `.kf/travel/progress.md`; time waiting on the human is not counted. The line carries the running sum, and `work=<n>` at review PASS is what `measure` takes |
| review | the part of `work` spent in review seats, summed the same way and kept as `review=<n>` beside `work=<n>` on the travel line |
| files | `git diff --shortstat <base>...HEAD` in the item worktree, recorded as `files=<n>` on the ledger line at `ready` (the worktree is gone after the merge); else `gh pr view <n> --json changedFiles` |
| rounds | the number of `fix round` lines in the item's `loop/progress.md` |
| path | the distinct phases the item ran, in the order they first ran, e.g. `implementation→testing→review` |
| tier | the review tier in the review report (`T1`, `T1C`, `T2`, `T3`), or `-` |
| gap | computed: sizes between est and actual, signed (`+1` = estimated one size low) |
| estmin | the raw minutes on the ledger line (`estmin=<n>`), the ones passed to `size` before the factor; `--estmin`, above 0. Omitted → the row ends at `gap`, counts for hit rate and bias, and teaches the factor nothing |

Cancelled or restarted from scratch → `--cancelled`: `actual -`, `gap -`; `stats` and the factor skip the row.

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
| `calibration:` | the dates (and their points) the budget rests on, or `none yet` |
| `kind <k>:` | per kind: hit rate, bias = the mean signed gap in sizes (`+` = estimates too low), and the current factor with the rows it rests on (`clamped from <x>` when the clamp held), or `factor 1 (defaults …)` below 20 rows with `estmin` |
| `warning:` | this week's hit rate (the 7 days ending at the latest row) is below the previous 7 days' |

The plan's Calibration line and the end-of-day summary print these lines as the script gives them.
