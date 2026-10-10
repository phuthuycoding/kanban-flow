---
uc: "UC-004"
feature: "done-trigger"
context: "cli"
---

# UC-004 — `kf issues done` refuses when the PR is not merged

## Goal
A linked-but-unmerged PR blocks the delivery claim — the exact false-close the bug reported.

## Actors
- Primary: maintainer/agent
- Secondary: `gh`

## Preconditions
- Work item in `dones`, `.kfw.json.pr` set to a pull request that is open or closed-unmerged.

## Trigger
`kf issues done <feature>`.

## Main Flow
1. Command resolves the item and the `pr` field.
2. `gh pr view <url> --json state` returns `OPEN` (or `CLOSED`).
3. Command refuses: "PR <url> is not merged (state: OPEN) — merge it, or deliver by hand."

## Alternative Flows
- A1. PR `CLOSED` without merge → same refusal; a closed-unmerged PR is not delivery.
- A2. Human disagrees (e.g. squash-merged via another branch) → they remove `pr` or close the issue by hand; no `--force` escape in v1.

## Exception Flows
- E1. `gh` error (auth/network/not found) → refuse with the gh error — unverifiable is not verified.

## Postconditions
- Nothing changed: issue stays open, board untouched, `.kfw.json` unchanged.

## Acceptance Criteria
- [ ] Stub `gh pr view` returning OPEN → exit 1, no `issue close`/`item-edit` calls, no flag.
- [ ] CLOSED-unmerged → same refusal.
- [ ] `gh` failure → refusal with the error surfaced.
