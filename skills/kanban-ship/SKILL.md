---
name: kanban-ship
description: 'Kanban ship stage — publish the item as a PR, wait or schedule the merge, then run release and changelog via `kf ship`. Use when a work item is in the shipping stage, or right after a PASS review when the human chooses to ship.'
---

# Kanban Shipping (Human gate + Agent)

The pipeline's third human gate lives here: review PASS → **ship now or archive directly?** Ask once. Non-code items (docs, config, research) and projects with ship automation off go straight to `kf archive` from review — never move an item into `shipping` that has nothing to deliver.

## Entry

```bash
kf status --change {feature_name}   # must show stage = review with a current PASS report
kf stage {feature_name} shipping    # moves the item; refused without a current PASS
```

Only `review` (with PASS) may enter `shipping`. `shipping → dones` happens through `kf archive` — the delivery gate still applies (recorded PR must be merged, or the human confirms).

## The ship loop

```bash
kf ship {feature_name}              # resumable: publish → merge → release → changelog
```

`kf ship` is idempotent — re-run it until it prints "Ship complete":

1. **publish** — pushes the item's branch (worktree branch when one exists, else the checkout's current branch), opens the PR via `gh pr create`, records `meta.pr`. Already-recorded PRs are never recreated. `--draft` opens a draft PR.
2. **merge** — reads PR state via `gh`. `merge: "manual"` (default) reports "waiting" and exits 0 — the human merges on GitHub (CI/review enforced there), then you re-run `kf ship`. `merge: "auto"` runs `gh pr merge --auto` once; GitHub merges when checks pass. kf never merges itself. A PR closed unmerged stops the pipeline — report it to the human.
3. **release** — when merged and `release: true`: tag + `gh release create` with notes generated from the item's spec/report artifacts. `release: false` or `--skip-release` records the step as skipped — the human owns it.
4. **changelog** — when `changelog: true`: appends an entry to `CHANGELOG.md` in the file's existing format. `changelog: false` or `--skip-changelog` records skipped.

Config lives in `.kf/config.json` (`ship` block); flags (`--draft`, `--skip-release`, `--skip-changelog`) override it per run. Every outcome is stamped into `.kfw.json` `meta.ship` — killing `kf ship` mid-pipeline and re-running converges to the same state.

## When ship automation is off

`ship.enabled` unset/false → `kf ship` prints the manual checklist for the item (push, `gh pr create`, `kf issues link <f> --pr`, merge/release/changelog by hand, then `kf archive`) and exits 1. Nothing is written. The `shipping` stage itself remains usable as a waiting state while a PR awaits merge — move items there manually if the board should show "waiting for merge".

## Project hook

`.kf/hooks/shipping.sh` runs on entering shipping (same precedence as other stage hooks). Put project-specific release/deploy steps there — kf only builds in tag + `gh release create`.

## Delivery

When `kf ship` reports complete (or the human finished the manual steps and the PR is merged):

```bash
kf archive {feature_name}           # shipping → dones — delivery gate, docs sync, issue close, board Done
```

`kf sync` also sweeps shipping items whose recorded PR merged — archive fires automatically.

## Hard rules

- Never force a review FAIL/REJECT/REQUIREMENT_BUG item into shipping — the gate refuses; loop back per the review skill.
- Never merge a PR yourself — `merge: "auto"` schedules `--auto` at most; `--merge`/`--admin`/`--force` on `gh pr merge` is not allowed.
- A PR closed unmerged means stop and report to the human — never silently republish.
- Do not edit approved contract artifacts; ship progress lives in `meta.ship` only.

## Done

The item is either delivered or visibly waiting for merge. Hand off:

```text
Ship complete → kf archive {feature_name} (kanban-archive).
Nothing to ship → archive directly from review — skip this stage.
```
