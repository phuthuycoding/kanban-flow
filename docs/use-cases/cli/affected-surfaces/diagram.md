---
feature: affected-surfaces
context: cli
created: 20261012_1935
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  H[Human maintainer] --> UC1[UC-001 gate refuses unfilled surfaces]
  H --> UC4[UC-004 N/A escape]
  A[Agent] --> UC2[UC-002 surfaces flow into plan]
  A --> UC3[UC-003 validate warns uncovered]
  KF[kf stage / validate] --> UC1
  KF --> UC3
  UC1 -.requires.-> S["## Affected surfaces section (spec template)"]
  UC2 -.carries.-> S
```

- Actors: human maintainer (declares surfaces, hits the gate), agent (authors spec + plan), `kf stage`/`kf validate` (enforcement machinery).
- Use cases: gate refusal on unfilled/missing section; surfaces flowing into plan tasks/doc-impact; validate warning on uncovered surfaces; the N/A escape.
- Relationships: the gate and the coverage warning both read the same spec section — one blocks at brainstorm-exit, the other warns from planning on.
