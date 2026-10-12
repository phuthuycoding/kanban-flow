---
feature: archive-after-merge
context: cli
created: 20261010_2034
status: archived
kind: feature
---
# Spec Requirement — archive-after-merge

## Objective

Make `kf archive` the **single post-delivery gate**: the moment an item is accepted as truly shipped — folder move to `dones`, canonical docs sync, issue close, board "Done", `delivered` flag — all happen together, and only after the work has actually landed (PR merged, or the human confirms delivery by running it).

Today archive runs at review PASS, so `docs/requirement/cli/<feature>.md` materializes as "the system's current business" while the code is still an open PR — the same false-finalization the `done-trigger` feature removed from the issue/board layer, left over at the docs + folder layer.

## Problem Statement

- `kf archive` currently bundles three different events: lifecycle bookkeeping (move → dones), documentation finalization (canonical docs sync), and (previously) tracker closure. Only the first is review-adjacent; the other two are delivery-adjacent.
- `done-trigger` fixed the tracker layer (`kf issues done`), but the maintainer's mental model — *"archive = copy spec + update the system's latest business docs"* — is still violated: docs claim "shipped" while `skill-scope`'s PR #28 sat open and its canonical docs already existed.
- `done-trigger`'s shipped design was a workaround for archive being early. If archive itself becomes the delivery gate, most of that apparatus folds away: `kf issues done`, `delivered.sh`, `statusMap.delivered` all become unnecessary — `dones` simply means "delivered" again, gated correctly this time.

## First Principles pass

- TRUTH 1: `docs/` canonical = "the system's current business state" — a spec for unmerged code misdescribes the system.
- TRUTH 2: delivery evidence = merged PR, or a human saying so. Review PASS is a quality gate, not delivery.
- TRUTH 3: folder move, canonical docs, issue close, board Done and `delivered` all assert the same truth — "this work is in the system". They should flip together, at the moment that truth becomes real.
- TRUTH 4: between review PASS and merge there is a real, possibly long-lived state: "accepted, awaiting delivery". It needs visibility, not a stage of its own.
- QUESTIONED ASSUMPTION: "archive must run immediately after review" — historical coupling; its pieces are separable and re-timeable.

## Recommended shape (S1 — the one this spec proposes)

`dones` returns to meaning **delivered**. An item that passes review waits in `review` — visible as "awaiting merge" — until the human runs `kf archive` after the change lands. Archive then does the full finalization in one ordered pass: PR merge check (when `pr` is recorded) → AC gate (existing `dones.sh`) → move → canonical docs → board → `statusMap.dones` (i.e. "Done" again) → issue close (restored in `dones.sh`) → `delivered`/`deliveredAt` written last. The `delivered` pseudo-stage, `delivered.sh`, `statusMap.delivered` and `kf issues done` all collapse — `done-trigger`'s `pr` field, merge verification, `delivered` flag and visibility warnings survive as the mechanism.

## Scope

### In scope

- `kf archive` gated on delivery evidence: refuses when `.kfw.json.pr` exists and the PR is not merged (OPEN, CLOSED-unmerged, or `gh` unverifiable) — exit 1, zero side effects. No `--force` escape.
- Archive's ordered finalization: AC gate → move review→dones → canonical docs sync → `dones` hook (issue close restored + board → `statusMap.dones`) → `delivered`/`deliveredAt` written last.
- Items already in `dones` (legacy, archived-early): `kf archive` is the reconcile path — re-runs docs sync + hook + flag idempotently.
- Visibility: `kf status`/`kf doctor` surface "reviewed, awaiting merge" (review-stage item with a PASS report) and "dones without `delivered`" (legacy items) pointing at `kf archive`.
- `dones.sh` restores `close_issue_done`; `delivered.sh`, `statusMap.delivered`, `KFW_PROJECT_STATUS_DELIVERED` default, and `kf issues done` are removed (or kept as a thin `archive` alias — open question).
- Skills/docs encode the new semantics: `kanban-archive`, `kanban-flow` pipeline text, `cli-reference.md`, CHANGELOG.

### Out of scope

- Push-based delivery detection — webhooks/GitHub Actions can't reach `.works/` (gitignored, local state); a daemon for real-time merging is overkill for a local CLI.
- A new "awaiting-delivery" kanban stage — `review` holds the item; visibility comes from artifacts, not the state machine.
- Release/deploy tracking — `delivered` means merged/confirmed shipped, never "deployed".
- Reopening items from dones (existing cancel/reopen paths unchanged).

### Automation (pull model, in scope)

- `kf sync` — a sweep command that iterates review/dones items with `meta.pr`, checks merge state via `gh pr view`, and runs the archive finalization for each merged one. Runnable by hand or from cron/launchd — no daemon.
- Optional: `kf sync` may infer `pr` for items whose linked issue gained a merged PR reference (GitHub `issues/<n>/timeline` `cross-referenced` events), reducing manual `kf issues link`. (could)

## Actors

- Human maintainer — merges the PR, then runs `kf archive` as the delivery confirmation.
- `gh` CLI — merge-state verification, issue close, board sync (via hook pack).
- GitHub Projects "Auto-close issue" board workflow — native backstop that closes the issue when the card hits the closing status; observed live on issue #29.

## Functional Requirements

- FR-001 | must | `kf archive` refuses when `meta.pr` exists and `gh pr view` reports anything but MERGED — exit 1, no folder move, no docs sync, no hook, no flag. Covers OPEN, CLOSED-unmerged and unverifiable responses.
- FR-002 | must | Successful archive performs finalization in order: AC gate via `dones.sh` → folder move (or in-place refresh when already dones) → canonical docs sync → board → `statusMap.dones` → issue close → `delivered`/`deliveredAt` written last. A mid-way failure leaves the item re-runnable.
- FR-003 | must | No `pr` recorded → archive proceeds on human invocation (the run is the confirmation); warns when no `issue` is linked.
- FR-004 | must | Items already in `dones` → archive reconciles idempotently: docs resync, hook re-run (closing a closed issue / moving a moved card is harmless), flag written.
- FR-005 | should | `kf status` and `kf doctor` surface the awaiting-delivery state: review-stage item with a PASS report + linked issue → "awaiting merge — run `kf archive`"; dones-stage item without `delivered` (legacy) → "run `kf archive` to finalize". No delivery side effects from read paths.
- FR-006 | must | `dones.sh` restores `close_issue_done` (dones = delivered again); `delivered.sh`, `statusMap.delivered` key, `KFW_PROJECT_STATUS_DELIVERED` default-env and `kf issues done` are removed from code, pack and docs — OR `issues done` stays as a thin alias for `kf archive` (see open questions).
- FR-007 | must | Skills + docs updated to "archive = post-delivery finalization": `skills/kanban-archive`, `skills/kanban-flow` pipeline section, `docs/workflow/cli-reference.md`, `docs/requirement/cli/github-sync-hooks.md`, CHANGELOG. Recommended statusMap guidance reverts to `dones → "Done"`.

## Non-Functional Requirements

- Idempotent: every finalization side effect is safe to re-run; `delivered` records state but never gates re-execution.
- Fail-open on GitHub outages (existing hook convention): the flag records, warnings surface; fail-closed on unmerged-PR evidence and unreadable `.kfw.json`.
- Backwards compatible: `.kfw.json` without `pr`/`delivered` reads unchanged; installed `.kf/hooks/` copies refresh on re-seed, `kf doctor` flags divergence.

## Main Use Cases

- UC-001 Archive refuses an unmerged PR — `pr` recorded, PR open → exit 1, nothing changes.
- UC-002 Archive delivers a merged item — full finalization pass, flag written.
- UC-003 Archive without PR evidence — proceeds with warning when no issue linked.
- UC-004 Re-run reconciles legacy dones items — archived-early item gets docs + close + flag.
- UC-005 Awaiting-merge is visible — status/doctor show the review-passed-but-unshipped state.

## Constraints

- `delivered` is written by archive only — no read path performs delivery side effects.
- No `--force` escape on the unmerged-PR refusal (the AC-gate `--force` semantics for unchecked criteria are unchanged).
- `statusMap.dones` is project configuration — recommend "Done" again, but the map stays the project's choice.
- `cancelled` path unchanged; `acGate` unchanged.

## Assumptions

- `pr` is recorded by the human (`kf issues link …/pull/N`), or the delivering PR is known to close via `Closes #N` — archive's merge check only applies when the field exists.
- Review-PASS items waiting in `review` is acceptable — the board already maps `review` to "In review", and an "awaiting merge" card sitting there is honest.
- GitHub Projects "Auto-close issue" workflow (when enabled board-side) closes the issue the moment the card hits Done — `close_issue_done` remains as the backstop for boards without it.

## Edge Cases

- Archive run before merge (the original bug class) → refused, item stays in review.
- PR merged but `gh` down at archive time → per fail-open convention: proceed, warn, flag records; a re-run reconciles — OR refuse? (Decision: check spec before confirm — recommend refuse, since unverifiable ≠ merged; AC gate precedent treats unreadable as "proceed". Pick at planning.)
- Issue already closed by `Closes #N` in the PR body → close is a no-op, archive succeeds.
- Two PRs deliver one item → `pr` holds the first; archive checks only it.
- Worktree removal / cleanup currently happens at archive — under S1 it runs post-merge; a long-held `review` item keeps its worktree until archive (document).
- `delivered` flag on a dones item from the old flow → honored; absent → FR-005 warning.

## Open Questions

1. `kf issues done` — fold into `kf archive` fully (recommended; it shipped unreleased, removing it is free) vs keep as an alias vs keep as the lightweight path for no-PR/no-hook items?
2. `statusMap.delivered` + `delivered.sh` — remove entirely (recommended under S1) vs keep for projects that want a board-visible "Awaiting release" column between merged and released?
3. `gh` outage at archive when `pr` exists: refuse (unverifiable ≠ merged) vs proceed + warn (fail-open convention)? Current AC-gate precedent is proceed; the unmerged-PR refusal is stronger evidence — planning picks.
4. Bug items — same merge gate (they may have `pr` linked the same way)?
5. `delivered` flag — keep for legacy reconciliation + doctor warning (recommended) vs drop and let `stage === dones` imply delivered?

## Test Strategy

| Field | Value |
|---|---|
| Level | unit |
| UI Tests | none |
| Tools | vitest + hook harness with stubbed `gh` (PATH stub logging argv) |
| Coverage Target | 80% |

## Acceptance Criteria

- [ ] `kf archive` on a review-PASS item with `pr` → merged PR proceeds, unmerged/unverifiable PR refuses with exit 1 and zero side effects.
- [ ] Successful archive writes canonical docs, moves to `dones`, runs the issue close + board sync, and stamps `delivered` — re-runnable without duplicates.
- [ ] `kf issues done` is gone (or is a documented `archive` alias); `delivered.sh` and `statusMap.delivered` removed from code, pack and docs.
- [ ] `dones.sh` closes the issue again; packaged and installed copies match; `GITHUB_HOOK_PACK` updated.
- [ ] `kf status`/`kf doctor` warn "awaiting merge" for review-PASS items with a linked issue, and "run kf archive" for legacy undelivered dones items.
- [ ] Skills (`kanban-archive`, `kanban-flow`) and `cli-reference.md` describe archive as the post-delivery step; recommended `statusMap` maps `dones → "Done"`.
- [ ] Coverage ≥ 80%; existing suite green.
