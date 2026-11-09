---
feature: kf-next
context: harness
created: 20261107_2254
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  S[Controller session] --> UC1[UC-001 Run a task loop from kf next]
  S --> UC2[UC-002 Resume a loop after compaction]
  S --> UC3[UC-003 Handle a verify failure, a fix round and a cascade]
  S --> UC4[UC-004 Run a bug's tasks]
  T[kf:travel session] --> UC1
  T --> UC2
  H[Human] -. watches seats .-> UC1
  UC3 -. reopens .-> UC1
```

- Actors: Controller session, `kf:travel` session, Human
- Use cases: UC-001, UC-002, UC-003, UC-004
- Relationships: the `kf:travel` session runs UC-001 and UC-002 for items it owns; UC-003 returns to the loop of UC-001; the human only watches and gains no gate.
