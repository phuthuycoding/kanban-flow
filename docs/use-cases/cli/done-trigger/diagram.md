---
feature: "done-trigger"
context: "cli"
created: "20261010_2012"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  M[Maintainer / agent] --> UC1[UC-001 Archive leaves issue open]
  M --> UC2[UC-002 Link a pull request]
  M --> UC3[UC-003 kf issues done delivers]
  M --> UC4[UC-004 done refuses unmerged PR]
  M --> UC5[UC-005 doctor/status warns undelivered]

  HK[GitHub hook pack] -.runs during.-> UC1
  HK -.delivered.sh.-> UC3
  GH[gh CLI] -.issue/board calls.-> HK
  GH -.pr view.-> UC3
  GH -.pr view.-> UC4

  UC3 -->|closes issue + board Delivered| GH
  UC4 -->|refuses, no side effects| M
```

- Actors: maintainer/agent (runs the commands), the GitHub sync hook pack (`dones.sh`, `delivered.sh`, `lib-github.sh`), `gh` CLI.
- Use cases: UC-001..005 as indexed.
- Relationships: `delivered.sh` is invoked by `kf issues done` (UC-003); `gh` is the transport behind both merge verification and tracker side effects; UC-004 is the refusal branch of UC-003's merge check.
