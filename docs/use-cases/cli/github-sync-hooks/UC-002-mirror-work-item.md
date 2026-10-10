---
feature: "github-sync-hooks"
context: "cli"
created: "20261010_1217"
id: UC-002
---

# UC-002 — Work item mirrors to issue and board across stages

## Actor
The hook pack, invoked by `kf` at each transition, on behalf of the agent.

## Preconditions
- `repository` and `project` configured; pack installed; gh authenticated.

## Main Flow
1. `kf new` → brainstorm.sh runs `kf issues create` → issue exists, URL recorded.
2. `kf stage … planning` → `kf issues sync` copies the confirmed requirement into the body; board Status moves.
3. Implementation/testing/review stages → Status moves; implementation self-assigns.
4. `kf archive` → dones.sh verifies all AC ticked (synced from the PASS report when `acGate`), then closes the issue and moves the card to Done.
5. `kf cancel` → issue closed as not planned.

## Alternate Flows
- GitHub unreachable: warn, exit 0 — kf transitions are never blocked by GitHub (except the AC check, which skips closing rather than guessing).
- Unreadable `.kfw.json`: dones refuses (fail closed), others warn and skip.

## Postconditions
- Issue body carries the spec and a "Kết quả thực hiện" evidence section; board Status matches the item's stage.
