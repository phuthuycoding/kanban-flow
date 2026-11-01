---
feature: drive-retire
context: harness
created: 20261101_1210
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  C[In-session controller] --> UC1[UC-001 Verify a task and a stage with kf verify]
  C --> UC2[UC-002 Implement an item in session with kf verify gates]
  T[Travel session] --> UC3[UC-003 Run the day with travel as controller]
  H[Human operator] --> UC4[UC-004 Clean leftover drive config and state with kf doctor]
  H --> UC2
  UC2 -->|includes| UC1
  UC3 -->|includes per item| UC2
  K[kf CLI] -.-> UC1
  K -.-> UC4
```

- Actors: Human operator, In-session controller, Travel session, kf CLI
- Use cases: UC-001, UC-002, UC-003, UC-004
- Relationships: UC-002 includes UC-001 after each task and before testing; UC-003 runs UC-002 for each item it holds; the kf CLI executes UC-001 and UC-004
