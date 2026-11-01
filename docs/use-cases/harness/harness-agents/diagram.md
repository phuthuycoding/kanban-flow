---
feature: harness-agents
context: harness
created: 20261101_0917
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  H[Human operator] --> UC1[UC-001 Install the six agents]
  C[Controller session] --> UC2[UC-002 Run one task through test-writer, developer and code-reviewer]
  C --> UC3[UC-003 Resolve a test dispute]
  C --> UC4[UC-004 Cover UI test cases with automation-writer]
  UC2 --> TW[test-writer]
  UC2 --> DV[developer]
  UC2 --> CR[code-reviewer]
  UC3 --> TW
  UC3 --> DV
  UC4 --> AW[automation-writer]
  UC2 -. dispute .-> UC3
  UC2 -. UI/E2E TCs under full .-> UC4
```

- Actors: Human operator, Controller session, test-writer, developer, automation-writer (code-reviewer is the existing seat)
- Use cases: UC-001, UC-002, UC-003, UC-004
- Relationships: UC-002 extends to UC-003 when the developer reports `TEST_DISPUTE`, and to UC-004 when a task carries UI/E2E TCs under `Level: full`
