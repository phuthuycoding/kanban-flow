---
feature: verify-tiers
context: harness
created: 20261109_1700
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  S[Agent session] --> UC1[UC-001 Verify a task on its related tests]
  S --> UC2[UC-002 Verify a wave with the full suite]
  K[kf CLI - kf next] --> UC3[UC-003 Hold the next wave until its predecessor's suite passes]
  S --> UC4[UC-004 Trace a wave failure back to a task]
  S --> UC5[UC-005 Reuse the last wave's record at the gates]
  H[Human - project owner] -. pins harness.verify.related .-> UC1
  H -. approves the config change .-> UC5
  UC2 -->|passing record releases| UC3
  UC2 -->|exit 1 leads to| UC4
  UC4 -->|reopened task completes, wave owed again| UC2
  UC2 -->|last wave's record read by| UC5
```

- Actors: Agent session, kf CLI (kf next), Human (project owner)
- Use cases: UC-001, UC-002, UC-003, UC-004, UC-005
- Relationships: UC-002's record releases UC-003's hold and is reused by UC-005; a UC-002 failure enters UC-004, which returns to UC-002 once the reopened task completes.
