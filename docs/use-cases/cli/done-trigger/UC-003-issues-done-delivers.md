---
uc: "UC-003"
feature: "done-trigger"
context: "cli"
---

# UC-003 — `kf issues done` delivers the work item

## Goal
One explicit command performs delivery: closes the issue, moves the board to the delivered status, records the flag.

## Actors
- Primary: maintainer/agent
- Secondary: `delivered.sh` hook, `gh`

## Preconditions
- Work item is in `dones` stage.
- `repository` configured (else polite refusal — nothing to sync against).

## Trigger
`kf issues done <feature>` — the human runs it after the change landed (PR merged, or delivery they confirm for items without a PR).

## Main Flow
1. Resolve work item; refuse unless stage is `dones`.
2. If `.kfw.json.pr` set → `gh pr view <url> --json state` must return `MERGED`; otherwise refuse (see UC-004).
3. Run `delivered.sh` via `runHook` (project → user → package precedence): `sync_project_status delivered` → board card to `statusMap.delivered` (default "Done"), then `close_issue_done` with a delivery comment.
4. Write `delivered` (and `deliveredAt`) into `.kfw.json`.
5. Print what happened: issue closed, board status, flag recorded.

## Alternative Flows
- A1. No `pr` set → skip step 2 entirely; the human's invocation is the confirmation.
- A2. No `issue` link → nothing to close and no board card; warn and still record `delivered` (exit 0).
- A3. `delivered.sh` not found (older installed pack) → warn "GitHub side effects skipped" and still record `delivered`.
- A4. No `project` board → hook skips the board move, closes issue only.
- A5. Item already `delivered` → re-run re-executes the idempotent steps and reports "already delivered"; `delivered` never gates re-execution (an earlier outage may have skipped side effects).

## Exception Flows
- E1. Item not in `dones` → refuse ("archive it first"), nothing changes.
- E2. `gh pr view` fails (auth/network) → refuse without side effects — an unverifiable merge is not a verified merge.
- E3. Hook exits non-zero (GitHub outage inside hook follows its own fail-open warnings) → command warns; flag still written.

## Postconditions
- Issue closed (or already closed — GitHub may have closed it via `Closes #N`; harmless), board at `statusMap.delivered`, `.kfw.json.delivered === true`.

## Business Rules
- The PR merge check applies only when `pr` is recorded; an unrecorded delivery is confirmed by the human running the command.
- Order matters: verify → side effects → flag. The flag is last so a crash before it leaves the item re-runnable.

## Acceptance Criteria
- [ ] Stubbed `gh`: merged PR + linked issue → `issue close` and `project item-edit` called, flag written.
- [ ] No PR → same result without the merge check.
- [ ] No `delivered.sh` → warning + flag, exit 0.
- [ ] No issue → flag recorded, warning, exit 0.
- [ ] Re-run after success exits 0 and reports "already delivered".
