---
feature: ade-sync
context: worktree
created: 20261014_2111
status: archived
---
# Use Case

## Overview

| Field | Value |
|---|---|
| ID | UC-005 |
| Name | Add a new ADE adapter |
| Requirement reference | FR-002 |
| Goal | Supporting a third ADE is a one-file change plus a registry entry |
| Primary actor | kf maintainer |

## Supporting Actors
- None

## Preconditions
- New ADE exposes a CLI or socket API for listing/attaching checkouts.

## Trigger
Maintainer implements `AdeAdapter` for the new tool.

## Main Flow

| Step | Actor / system | Action | Outcome |
|---|---|---|---|
| 1 | Maintainer | Create `src/integrations/ade/<name>.ts` implementing `isAvailable`/`attach`/`detach?` | New adapter exists |
| 2 | Maintainer | Append instance to `ADE_ADAPTERS` | Picked up by create + remove paths automatically |
| 3 | kf | No edits in lifecycle.ts, stage.ts or worktree.ts | Contract proven by test with a stub adapter |

## Alternative Flows
### A1
- Trigger: ADE has no detachable state

| Step | Action | Outcome / return to main flow |
|---|---|---|
| A1.1 | Omit `detach` (optional member) | Orchestration skips it |

## Exception Flows
### E1

| Trigger | Handling | Resulting state / message |
|---|---|---|
| Adapter violates the non-throw contract | Orchestration still guards with try/catch | Warning, never a crash |

## Postconditions
- New ADE participates in UC-001/UC-004 flows with zero lifecycle changes.

## Business Rules
- The registry is the single extension point; lifecycle code references only the interface.

## Data
- `ADE_ADAPTERS: AdeAdapter[]`.

## Acceptance Criteria
- [ ] A test registers a stub adapter and observes attach/detach invoked on create/remove without touching lifecycle code.
