---
feature: loop-throughput
context: harness
created: 20261101_1349
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  C[Controller]
  S[Seats: test-writer, developer, code-reviewer]
  K[kf CLI / review-package]
  T[Travel]
  H[Human]
  C --> UC1[UC-001 Pipeline two neighbouring tasks]
  C --> UC2[UC-002 Same-wave test-writers with disjoint Files]
  C --> UC3[UC-003 Verify a task by its commit list]
  C --> UC4[UC-004 Cascade re-review after a fix]
  C --> UC5[UC-005 Resume with two tasks in flight]
  C --> UC6[UC-006 Measure a loop and record it]
  UC1 --> S
  UC2 --> S
  UC4 --> S
  UC1 -. uses .-> UC3
  UC2 -. uses .-> UC3
  UC3 --> K
  UC2 -. reads overlaps .-> K
  UC5 --> T
  C --> UC7[UC-007 Read the history across loops]
  H --> UC7
  UC6 -. feeds .-> T
  UC6 --> H
```

- Actors: Controller, Seats, kf CLI / review-package, Travel, Human
- Use cases: UC-001 – UC-007
- Relationships: pipelining and same-wave parallelism both verify and package each task by its commit list (UC-003); same-wave gating reads `kf tasks --json` `overlaps`; resume and the timestamped ledger are read by travel; `kf loop-stats` measures each loop (UC-006), feeds travel's measured work and appends the history the human reads (UC-007).
