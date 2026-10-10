---
feature: "skill-scope"
context: "cli"
created: "20261010_1833"
status: planning
---

# Test Plan

Test Strategy from `phase-1-spec-requirement.md` decides the depth:
`unit` → Unit; `unit+integration` → Unit + Integration; `full` → Unit + Integration + UI/E2E.

Extend the tables and repeat `## TC-###` for every planned test. Remove unused sample rows. Counts must match the detailed cases; use `0` with a reason for excluded test types. This is the planned contract: execution outcomes belong in the testing-result report.

## Feature Test Summary

| Field | Value |
|---|---|
| Feature | skill-scope |
| Context | cli |
| Test level | unit |
| UI scope | none — CLI surface only |
| Tools / commands | vitest (`npm test`), `mkdtemp` fixtures for fake project root + fake HOME |
| Coverage target | 80% |

## Overall Case Counts

| Test type | Planned | Must pass | Notes |
|---|---:|---:|---|
| Unit | 20 | 20 | all FR/UC behavior at function level |
| Integration | 0 | 0 | excluded — Test Level `unit` per spec |
| UI / E2E | 0 | 0 | excluded — no UI |
| **Total** | **20** | **20** | **CLI command handlers + helpers** |

## Use Case Coverage Matrix

| Use case | Requirement(s) | Test cases | Planned | Pass criteria |
|---|---|---|---:|---|
| UC-001 | FR-001, FR-002, FR-003, FR-005 | TC-001, TC-002, TC-003 | 3 | init lands `~` links/copies, no project copies, mode reported |
| UC-002 | FR-002, FR-005 | TC-004, TC-005, TC-006 | 3 | question asked, `skills.scope` persisted, bad values rejected |
| UC-003 | FR-001, FR-003 | TC-007, TC-008, TC-009, TC-010 | 4 | global install + configured-scope cleanup; package intact |
| UC-004 | FR-003 | TC-011, TC-012 | 2 | project install never touches `~`; errors outside `.works/` |
| UC-005 | FR-004 | TC-013, TC-014, TC-015 | 3 | uninstall removes only the chosen scope; idempotent |
| UC-006 | FR-006, FR-007 | TC-016, TC-017, TC-018, TC-019, TC-020 | 5 | scope-aware statuses; doctor check+fix loop |

## Requirement Coverage Matrix

| Requirement | Use case(s) | Test case(s) | Covered? | Gap / note |
|---|---|---|---|---|
| FR-001 | UC-001, UC-003 | TC-001, TC-002, TC-007, TC-010 | yes | link-or-copy + `userRel` + symlink-safe removal |
| FR-002 | UC-002 | TC-004, TC-005, TC-006 | yes | `skills.scope` parse, validate, default |
| FR-003 | UC-003, UC-004 | TC-007, TC-008, TC-009, TC-011, TC-012 | yes | `--scope` semantics + cleanup rule + no-`.works` cases |
| FR-004 | UC-005 | TC-013, TC-014, TC-015 | yes | scoped uninstall + warning + idempotence |
| FR-005 | UC-001, UC-002 | TC-001, TC-003, TC-004 | yes | all three init paths honor scope |
| FR-006 | UC-006 | TC-016, TC-017, TC-019 | yes | autoconfig scope/status/duplicate reporting |
| FR-007 | UC-006 | TC-018, TC-020 | yes | doctor report + `--fix` repair loop |
| FR-008 | UC-003, UC-005 | covered inside TC-007/TC-013 flag-parsing assertions | partial | could-priority: `--global`/`--project` shorthand asserted where implemented; dropped if args conflicts |

## TC-001

| Field | Detail |
|---|---|
| Test case ID | TC-001 |
| Requirement reference | FR-001, FR-003, FR-005 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | temp project root without `.kf/config.json`; fake HOME dir |
| Input | `cmdInit`/`cmdBootstrap` equivalent with defaults + `agents: [claude]` |
| Steps | See steps table below |
| Expected outcome | `~/.claude/skills/kanban-*` are symlinks into `PKG_SKILLS_DIR`; project `.claude/skills` has no managed dirs |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run init defaults path against the fixture | exit 0 |
| 2 | `lstatSync(~/.claude/skills/kanban-flow)` | `isSymbolicLink()` true; `readlink` resolves into package `skills/kanban-flow` |
| 3 | list `<root>/.claude` | no `skills` dir or no managed entries inside it |

## TC-002

| Field | Detail |
|---|---|
| Test case ID | TC-002 |
| Requirement reference | FR-001 |
| Use case reference | UC-001 |
| Test type | Unit |
| Priority | High |
| Preconditions | fixture as TC-001; symlink creation forced to fail (stub `symlink` to throw EPERM, or an ephemeral `PKG_SKILLS_DIR` fixture path) |
| Input | same install call |
| Steps | See steps table below |
| Expected outcome | skill dirs land as real directories; output states copy mode |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | trigger install with linking unavailable | exit 0 |
| 2 | `lstatSync` each managed entry | `isDirectory()` true, `isSymbolicLink()` false |
| 3 | inspect stdout | names the dir and reports "copied" fallback |

## TC-003

| Field | Detail |
|---|---|
| Test case ID | TC-003 |
| Requirement reference | FR-002, FR-005 |
| Use case reference | UC-001, UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | fixture project whose `.kf/config.json` contains `skills.scope: "project"` |
| Input | `kf init --minimal` path |
| Steps | See steps table below |
| Expected outcome | skills copied into `<root>/.claude/skills`; `~` dirs untouched |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run init minimal against the configured fixture | exit 0 |
| 2 | check `<root>/.claude/skills` | eight managed dirs present, all real directories |
| 3 | check `~/.claude/skills` | no managed entries created |

## TC-004

| Field | Detail |
|---|---|
| Test case ID | TC-004 |
| Requirement reference | FR-002, FR-005 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | `askAll` driven with a scripted readline answering "project" at the scope question |
| Input | `askAll(rl, root)` answers: project scope |
| Steps | See steps table below |
| Expected outcome | `BootstrapAnswers.skillScope === "project"`; `saveConfig` writes `skills.scope: "project"` |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run `askAll` with the scripted answers | returns `skillScope: "project"` |
| 2 | `saveConfig(root, answers)` | `.kf/config.json` contains `skills.scope: "project"` |

## TC-005

| Field | Detail |
|---|---|
| Test case ID | TC-005 |
| Requirement reference | FR-002, FR-005 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | same harness; default/Quick-setup path and a config already carrying `skills.scope: "project"` |
| Input | `bootstrapDefaults(root)`; `askAll` with Enter at the scope question on the configured fixture |
| Steps | See steps table below |
| Expected outcome | defaults resolve `global`; on a project-configured fixture the question's default is project |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `bootstrapDefaults` on fresh fixture | `skillScope === "global"` |
| 2 | `askAll` accepting defaults on project-scope fixture | keeps `skillScope === "project"` |

## TC-006

| Field | Detail |
|---|---|
| Test case ID | TC-006 |
| Requirement reference | FR-002 |
| Use case reference | UC-002 |
| Test type | Unit |
| Priority | High |
| Preconditions | config fixtures: absent `skills`, `"scope": "banana"`, `skills` not an object |
| Input | `readProjectConfig` / `effectiveSkillsScope` |
| Steps | See steps table below |
| Expected outcome | absent → `global`; garbage → named-field error |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `effectiveSkillsScope(readProjectConfig(root))` with no `skills` | `"global"` |
| 2 | config with `skills.scope: "banana"` | throws error naming `skills.scope` and `"global"/"project"` |

## TC-007

| Field | Detail |
|---|---|
| Test case ID | TC-007 |
| Requirement reference | FR-003, FR-008 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | fixture project (`.works/`) with the eight managed dirs under `.claude/skills` plus an `unrelated/` dir; no `skills` field |
| Input | `cmdInstall([], { cwd: root, scope: "global" })` and `kf install --global` parsing |
| Steps | See steps table below |
| Expected outcome | `~` links created; project managed dirs removed; `unrelated/` survives |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run install global | exit 0; `~/.claude/skills/kanban-*` symlinked |
| 2 | list `<root>/.claude/skills` | managed names gone; `unrelated/` still there |
| 3 | parse `kf install --global` | resolves to `scope: "global"` equivalent |

## TC-008

| Field | Detail |
|---|---|
| Test case ID | TC-008 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | fixture as TC-007 but `skills.scope: "project"` configured |
| Input | `cmdInstall(..., { scope: "global" })` |
| Steps | See steps table below |
| Expected outcome | `~` links installed; project copies preserved; output notes both scopes populated |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run install with flag global on project-scoped config | exit 0 |
| 2 | check project `.claude/skills` | managed dirs still present |
| 3 | inspect stdout | warns/notes both scopes now hold skills |

## TC-009

| Field | Detail |
|---|---|
| Test case ID | TC-009 |
| Requirement reference | FR-003 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | temp dir with no `.works/` anywhere up the tree |
| Input | `cmdInstall([], { cwd: dir, scope: "global" })` |
| Steps | See steps table below |
| Expected outcome | installs into `~` dirs; no "not a kanban project" error |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run install global without `.works/` | exit 0; `~` skills present |

## TC-010

| Field | Detail |
|---|---|
| Test case ID | TC-010 |
| Requirement reference | FR-001 |
| Use case reference | UC-003 |
| Test type | Unit |
| Priority | High |
| Preconditions | `~` holds managed symlinks; snapshot of `PKG_SKILLS_DIR` file hashes |
| Input | `removeSkillsFrom(~dir)` then re-`copySkillsTo`/link |
| Steps | See steps table below |
| Expected outcome | links removed; every packaged skill file byte-identical before and after |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | uninstall the linked skills | `~/.claude/skills/kanban-*` gone |
| 2 | hash `PKG_SKILLS_DIR` recursively | identical to the pre-test snapshot |

## TC-011

| Field | Detail |
|---|---|
| Test case ID | TC-011 |
| Requirement reference | FR-003 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | High |
| Preconditions | `~/.claude/skills` populated with links; `.works/` fixture present |
| Input | `cmdInstall([], { cwd: root, scope: "project" })` and bare `cmdInstall` on project-scope config |
| Steps | See steps table below |
| Expected outcome | project dirs are real dirs; every `~` entry unchanged |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run install project | exit 0; `<root>/.claude/skills/kanban-*` `isDirectory()` true |
| 2 | snapshot `~` entries before/after | identical (links still resolve) |
| 3 | repeat via bare install on `skills.scope: "project"` config | same result |

## TC-012

| Field | Detail |
|---|---|
| Test case ID | TC-012 |
| Requirement reference | FR-003 |
| Use case reference | UC-004 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | temp dir without `.works/` |
| Input | `cmdInstall([], { cwd: dir, scope: "project" })` |
| Steps | See steps table below |
| Expected outcome | refuses with the existing not-a-project message |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run install project outside `.works/` | code 1, `not a kanban project` |

## TC-013

| Field | Detail |
|---|---|
| Test case ID | TC-013 |
| Requirement reference | FR-004, FR-008 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | High |
| Preconditions | `~` holds managed links AND project holds managed copies |
| Input | `cmdUninstall([], { cwd: root, scope: "global" })` |
| Steps | See steps table below |
| Expected outcome | `~` entries removed, project copies intact, warning line printed |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run uninstall global | exit 0; stdout mentions global serving all projects |
| 2 | check `~` | managed entries gone |
| 3 | check project `.claude/skills` | managed dirs still present |

## TC-014

| Field | Detail |
|---|---|
| Test case ID | TC-014 |
| Requirement reference | FR-004 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | both scopes populated as TC-013 |
| Input | `cmdUninstall([], { cwd: root, scope: "project" })` |
| Steps | See steps table below |
| Expected outcome | project copies removed; `~` links survive |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run uninstall project | exit 0 |
| 2 | check `~` links | still resolving |
| 3 | check project dir | managed names gone |

## TC-015

| Field | Detail |
|---|---|
| Test case ID | TC-015 |
| Requirement reference | FR-004 |
| Use case reference | UC-005 |
| Test type | Unit |
| Priority | Low |
| Preconditions | `~` populated; temp dir without `.works/` |
| Input | `cmdUninstall([], { cwd: dir, scope: "global" })` twice |
| Steps | See steps table below |
| Expected outcome | first run removes; second reports already clean, exit 0 |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run uninstall global without `.works/` | exit 0; `~` cleaned |
| 2 | run again | exit 0; "already clean" lines |

## TC-016

| Field | Detail |
|---|---|
| Test case ID | TC-016 |
| Requirement reference | FR-006 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | fixture project; `~` with one agent linked, one missing, one stale copy |
| Input | `cmdAutoconfig` output string |
| Steps | See steps table below |
| Expected outcome | briefing shows scope line + per-agent linked/missing/stale + fix command |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run autoconfig | stdout contains "scope: global" and per-agent status rows |
| 2 | scan checklist rows | missing/stale agents carry `kf install` / `kf doctor --fix` action |

## TC-017

| Field | Detail |
|---|---|
| Test case ID | TC-017 |
| Requirement reference | FR-006 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | agent installed as *copy* (fallback path or explicit copy fixture); mutate one SKILL.md |
| Input | `skillsStatus` / autoconfig after mutation; then `kf install` |
| Steps | See steps table below |
| Expected outcome | status flips to stale; reinstall returns clean |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | edit installed `kanban-plan/SKILL.md` in the copy dir | status → stale |
| 2 | run `cmdInstall` at that scope | status → clean; file matches package |

## TC-018

| Field | Detail |
|---|---|
| Test case ID | TC-018 |
| Requirement reference | FR-007 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | `~` links installed; simulate dangling link (point link at a now-missing target or remove target dir fixture) |
| Input | `runDoctor` / `applyDoctorFixes` |
| Steps | See steps table below |
| Expected outcome | finding reports broken link; `--fix` recreates a working link |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run doctor on the dangling fixture | finding names the broken link |
| 2 | run `applyDoctorFixes` then doctor again | link recreated at current `PKG_SKILLS_DIR`; finding gone |

## TC-019

| Field | Detail |
|---|---|
| Test case ID | TC-019 |
| Requirement reference | FR-006, FR-007 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | Medium |
| Preconditions | `skills.scope: "global"`; `~` links installed; managed dirs also present under project `.claude/skills` |
| Input | `cmdAutoconfig` and `runDoctor` |
| Steps | See steps table below |
| Expected outcome | both flag project copies as duplicates with a cleanup suggestion |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | run autoconfig/doctor | duplicate-project-copies row/finding appears |
| 2 | `doctor --fix` (or `kf install`) | project copies removed per configured-scope rule |

## TC-020

| Field | Detail |
|---|---|
| Test case ID | TC-020 |
| Requirement reference | FR-007 |
| Use case reference | UC-006 |
| Test type | Unit |
| Priority | High |
| Preconditions | fixture with a configured agent missing skills at the effective scope |
| Input | `runDoctor` exit semantics + `applyDoctorFixes` |
| Steps | See steps table below |
| Expected outcome | doctor reports error (ok=false) before fix, clean after |
| Status | PENDING |

### Steps

| Step | Action | Expected result |
|---|---|---|
| 1 | `runDoctor` on the missing-skills fixture | `ok === false`, finding at effective scope |
| 2 | `applyDoctorFixes` + `runDoctor` | no skills findings; `ok === true` (other findings aside) |
