---
feature: "skill-scope"
context: "cli"
created: "20261010_1833"
status: planning
---

# Use Case Diagram

```mermaid
flowchart LR
  M[maintainer] --> UC1[UC-001 Fresh init defaults to global skills]
  M --> UC2[UC-002 Onboarding asks scope and persists]
  M --> UC3[UC-003 Install global cleans project copies]
  M --> UC4[UC-004 Install project leaves global untouched]
  M --> UC5[UC-005 Uninstall at a chosen scope]
  M --> UC6[UC-006 Autoconfig/doctor report scope and stale skills]
  AG[AI coding agents] -. consumes .-> UC1
  AG -. consumes .-> UC3
```

- Actors: maintainer (drives all kf commands), AI coding agents (passive consumers of installed skills)
- Use cases: UC-001..UC-006 as indexed in `phase-2-use-case-specification.md`
- Relationships: the maintainer triggers every use case through `kf` commands; agents only read the resulting `~`/project skill dirs — no UC where an agent acts.
