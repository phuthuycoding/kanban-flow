# Daily plan

The morning printout. The human approves or edits it; nothing is driven before that.

```text
Plan YYYY-MM-DD — slots: 3 | budget: 8 points (median of 3 days)
Batch 1 (7/8 points)
  t1 · workflow-slim · feature · L · carry-over — blocked yesterday: verify_failed, fixed by the human
  t2 · cli-refactor · feature · M · review
  t3 · login-timeout · bug · S · implementation — sequential with t2 (src/cli/*)
Batch 2 (if Batch 1 drains)
  t4 · board-colours · feature · M · implementation
  t5 · docs-split · feature · XL · should split — not dispatched until split or overridden
⏸ Needs you (decide)
  - t6 confirm spec epic-types — brainstorm, spec pending
  - t7 approve plan (or --backlog) search-index
  - t10 legacy-login — review PASS but not closed: Gate failed for 'legacy-login'. Fix validation before archiving: review_landing_missing
  - t5 split or override docs-split — XL
✓ Waiting to merge (do this on GitHub)
  - t8 https://github.com/<owner>/<repo>/pull/104 — ! gh pr merge 104
  - t9 docs/cli-d awaiting push — ! git push -u origin docs/cli-d
  - t11 docs/cli-e not proven merged (no merged PR has docs/cli-e at 0123456789ab as its head) — ! git push -u origin docs/cli-e
Calibration: budget = median daily actual points of 2026-10-28 (6), 2026-10-29 (10), 2026-10-30 (8); kind feature: hit rate 9/14, bias +0.3 sizes, factor 1 (defaults — 14 rows with estmin, needs 20)
Approve, or edit (drop / reorder / resize / override XL / slots=N)?
```

Rules:

- One line per item: `<id> · <feature> · <kind> · <size> · <stage or carry-over reason>`. `kind` is `feature`, `bug` or `pr` (a red-CI PR with no item).
- Ids `t1`, `t2`, … are per day; a carried line gets a new id and keeps its note.
- Batch 1 fills in priority order — carry-over, review, testing, implementation — until the next line would exceed the budget (points, or the `10 tasks` default counted in lines). The rest is Batch 2.
- Mark every `sequential` pair on the later line (`sequential with t2 (<overlapping path>)`).
- An XL line says `should split`; it is listed but not dispatched until the human splits it or overrides it here.
- Needs you and Waiting to merge come from `kf status --all --json` (`needsYou[]`, including `canonical docs for <f> never landed` decisions; `waitingToMerge[]`, including `docsBranch` entries with their own `command`) plus travel's own decisions (XL, red CI with no item).
- Calibration is the `calibration:` and `kind <k>:` lines of `estimates stats` (`calibration: none yet` below 3 measured days).
- Empty sections print `  (none)`.
