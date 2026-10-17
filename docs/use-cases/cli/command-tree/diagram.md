---
feature: command-tree
context: cli
created: 20261017_1750
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  H[Human] --> UC3[UC-003 Help renders tree]
  AG[Agent] --> UC1[UC-001 Resolve noun→verb]
  AG --> UC4[UC-004 Kind mismatch refuses]
  S[Scripts / hooks] --> UC2[UC-002 Legacy alias works]
```

- Actors: Agent, Human, Scripts/hooks
- Use cases: UC-001 resolution; UC-002 compatibility; UC-003 help; UC-004 kind guard
- Relationships: UC-002 and UC-001 reach the same handlers through different spellings
