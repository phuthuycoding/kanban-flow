---
feature: ship-pipeline
context: cli
created: 20261017_1750
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  H[Human] -->|decides at ship gate| UC1[UC-001 Move to shipping]
  AG[Agent] --> UC1
  AG --> UC2[UC-002 Ship: publish PR]
  AG --> UC3[UC-003 Manual merge wait/resume]
  AG --> UC4[UC-004 Release + changelog]
  AG --> UC5[UC-005 Archive shipped]
  AG --> UC6[UC-006 Archive direct from review]
  O[Project owner] --> UC7[UC-007 No ship config = legacy]
  UC1 --> UC2
  UC2 --> UC3
  UC3 --> UC4
  UC4 --> UC5
```

- Actors: Agent (runs commands), Human (ship gate + manual merge), Project owner (config)
- Use cases: UC-001 gated entry; UC-002–004 the resumable ship pipeline; UC-005–006 the two exits to dones; UC-007 backward compatibility
- Relationships: UC-002→003→004→005 form the ship chain; UC-006 is the bypass path
