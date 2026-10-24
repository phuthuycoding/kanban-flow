---
feature: task-harness
context: harness
created: 20261024_1105
status: archived
---
# Use Case Diagram

```mermaid
flowchart LR
  Main[Main agent]
  Owner[Owner / operator]
  Driver[kf driver]
  Worker[Worker agent]

  Main --> UC1[UC-001 Plan declares a task DAG; validate catches bad graphs]
  Owner --> UC2[UC-002 Inspect the task graph and progress]
  Owner --> UC3[UC-003 Run one planned task by hand]
  Main --> UC4[UC-004 Drive an approved item to the ship gate]
  Owner --> UC4
  Driver --> UC5[UC-005 Task fails, retries, then blocks]
  Driver --> UC6[UC-006 Task merge conflicts with an item-branch commit]
  Driver --> UC7[UC-007 Bounded repair loops after FAIL]
  Owner --> UC8[UC-008 Stop, crash and resume a drive]
  Owner --> UC9[UC-009 Configure verify, limits and drive-stop hook]

  UC3 --> Worker
  UC4 --> Worker
  UC7 --> Worker
  UC4 -. includes .-> UC5
  UC4 -. includes .-> UC6
  UC4 -. includes .-> UC7
  UC4 -. uses graph from .-> UC1
  UC4 -. requires config from .-> UC9
  UC8 -. resumes .-> UC4
```

- Actors: Main agent (plans, hands off), Owner / operator (approves, starts, configures, inspects, stops), kf driver (detached supervisor), Worker agent (headless runner executing one task or one stage role)
- Use cases: UC-001 … UC-009
- Relationships: UC-004 includes task failure (UC-005), merge conflict (UC-006) and repair loops (UC-007); it depends on the validated graph (UC-001) and the harness configuration (UC-009); UC-008 resumes UC-004; UC-003, UC-004 and UC-007 dispatch work to the Worker agent.
