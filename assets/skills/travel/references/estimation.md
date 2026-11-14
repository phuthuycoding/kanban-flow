# Estimation

Sizes are agent time and files touched, not human hours. Estimation is a harness component: `kf approve` records each item's estimate, the close measures the item, and `kf estimate` does every computation. Travel reads the results and supplies only the inputs of a day-only size.

## Sizes

| Size | Points | Default minutes | Default files |
|---|---|---|---|
| S | 1 | < 5 | ≤ 3 |
| M | 2 | 5–20 | ≤ 10 |
| L | 4 | 20–60 | ≤ 30 |
| XL | 8 | > 60 | > 30, or needs a spec |

Size = the **higher** of the time size and the files size. XL is `should split`: kf reports it as `estimate_should_split` at the planning gate, and travel does not dispatch an XL line until the human splits it or overrides it in the plan.

## The item estimate

The planner fills the contract's `## Estimate` section (`- Agent minutes: <n>`, raw minutes); `kf approve` records those minutes, the files the plan names and the size they give. Travel reads it:

```bash
kf estimate show <f> --json
# { "minutes": 40, "files": 12, "filesMark": "exact", "size": "L", "factor": 1, … }
# or { "none": true, "reason": "no estimate was recorded when '<f>' was approved" }
```

An item with a recorded estimate is never sized again: its `size` is the line's size on every day the line is carried, and its points count toward the budget.

## A line with no item estimate

An item that recorded none (`none: true`) and a `pr` line (a red-CI PR with no item) are sized for the day only, and the line says `no item estimate`:

```bash
kf estimate size <minutes> <files|unknown> --kind <kind>
# L
# points: 4
# defaults (14 feature rows with estmin)      or      learned: 15 min × 2 = 30 min (feature, last 30 rows)
```

- **files**: the number of distinct paths in the union of the item's pending task Files (`kf tasks <f> --json`, tasks not `done`). A directory or glob counts as 10. No plan (a red-CI PR): `gh pr view <n> --json changedFiles`. `unknown` when neither gives a count.
- **minutes**: your estimate of agent time to review PASS (`waiting-to-merge`) — implementation tasks still pending plus testing and review. A testing or review line with nothing to implement is usually S or M. Needs a spec → XL. Estimate without looking at the factor and do not adjust for it yourself: `kf estimate size` applies it.
- **kind**: the line's kind (`feature`, `bug`, `pr`); each kind learns its own factor.

A day-only size feeds only that day's budget and batching. It is never recorded anywhere, and the next morning sizes the remaining work again.

## Learned minutes

The thresholds never change: estimates and measured actuals are both sized with the defaults above, so they compare like with like. What is learned is how far minute estimates miss, per kind. The history is every done item's `metrics.json` plus the legacy travel estimates file, which kf reads and never writes. Once it has ≥ 20 measured rows of that kind with an estimate in minutes (`estmin`), kf takes the last 30 such rows and computes the factor = the median of `work ÷ estmin`, clamped to 0.5–3. `kf estimate size --kind` and `kf approve` multiply the raw minutes by the factor, then size the result with the defaults. Work that runs slower than estimated gives a factor above 1 (estimates go up); faster gives one below 1 (estimates go down). The file count is not corrected. The factor is computed only from raw estimates and measured work, so it cannot feed on itself. Rows without `estmin` (older rows) still count for the budget, hit rate and bias, and teach the factor nothing.

## Budget and calibration

```bash
kf estimate stats
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

The plan's Calibration line and the end-of-day summary print these lines as kf gives them.

## Pairs

```bash
kf estimate overlap "<files A>" "<files B>"
# sequential   or   parallel
```

`sequential` when any path or glob of one cell can match a path of the other.
