---
feature: adaptive-developer-cap
context: harness
created: 20261102_1647
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  C[Controller session] --> UC1[UC-001 Start at the low cap and step up]
  C --> UC2[UC-002 Step down and re-run once]
  C --> UC3[UC-003 Resume rebuilds the live cap]
  C --> UC4[UC-004 Plan records waves at wave width]
  H[Human] --> UC5[UC-005 Set the ceiling in config]
  K[kf CLI] --> UC5
  H --> UC6[UC-006 Turn the domain layer off]
  K --> UC6
  UC1 -. reads ceiling .-> UC5
  UC2 -. lowers N of .-> UC1
  UC3 -. rebuilds N of .-> UC1
```

- Actors: Controller session, Human, kf CLI
- Use cases: UC-001..UC-006
- Relationships: UC-001 reads the ceiling of UC-005; UC-002 lowers and UC-003 rebuilds the N that UC-001 raises.
