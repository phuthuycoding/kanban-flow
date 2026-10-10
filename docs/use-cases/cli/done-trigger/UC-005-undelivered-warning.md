---
uc: "UC-005"
feature: "done-trigger"
context: "cli"
---

# UC-005 — Doctor/status surfaces an archived-but-undelivered item

## Goal
A work item sitting in `dones` with an open issue and no `delivered` flag is visible instead of silently stale.

## Actors
- Primary: maintainer/agent

## Preconditions
- Item in `dones` with `.kfw.json.issue` set and `delivered` absent.

## Trigger
`kf doctor` or `kf status --change <feature>`.

## Main Flow
1. `runDoctor` lists items in `dones`; for each with `meta.issue && !meta.delivered` → WARNING: "archived but not delivered — run kf issues done <feature>".
2. `kf status` shows a delivered/delivery line on the item (e.g. "Delivered: no — run kf issues done").

## Alternative Flows
- A1. `delivered === true` → no warning; status shows delivered.
- A2. No `issue` field → silent (projects without the GitHub pack are not nagged).
- A3. Cancelled items → out of scope; `cancelled.sh` already closed the issue as not-planned.

## Exception Flows
- E1. Unreadable `.kfw.json` → existing doctor finding handles it; no additional warning.

## Postconditions
- The pending delivery step is discoverable; nothing mutates state.

## Acceptance Criteria
- [ ] dones + issue + !delivered → doctor WARNING naming `kf issues done`; status shows undelivered.
- [ ] After `delivered` recorded → no warning.
- [ ] dones item with no issue → silent.
