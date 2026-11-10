---
feature: verify-evidence
context: harness
created: 20261109_1326
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  S[Agent session] --> UC1[UC-001 Record a stage verify run]
  S --> UC2[UC-002 Enter review on a passing record at HEAD]
  H[Human - project owner] --> UC3[UC-003 Enter review with a waiver]
  S -. on the human's word .-> UC3
  R[Reviewer] --> UC4[UC-004 See the record or waiver]
  H --> UC4
  K[kf CLI] --- UC1
  K --- UC2
  K --- UC3
  UC1 -->|record read by| UC2
  UC1 -->|record shown by| UC4
  UC3 -->|waiver shown by| UC4
```

- Actors: Agent session, Human (project owner), Reviewer, kf CLI
- Use cases: UC-001, UC-002, UC-003, UC-004
- Relationships: UC-002 consumes the record UC-001 writes; UC-003 is the only path into review when no stage verify is pinned; UC-004 displays what UC-001 and UC-003 produced.
