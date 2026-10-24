---
feature: "{feature_name}"
context: "{context}"
created: "{timestamp}"
status: planning
---

# Implementation Plan

## Feature
{feature_name}

## Objective
{objective}

## Implementation Scope
### Implement Now
- {implement_now_item}

### Supporting Features
- {supporting_feature}

### Future Features
- {future_feature}

### Explicitly Not Implemented
- {not_implemented_item}

## Task Breakdown

| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |
|---|---|---|---|---|---|---|---|
| TASK-001 | {task_description} | {area} | {dependencies} | {expected_output} | {requirement_reference} | {role_or_dash} | {file_paths_dirs_or_globs} |

Add one row per task. Execution progress lives outside the approved plan: in `.kfw.json` and the `tasks.md` that kf renders when the task harness runs, or in a hand-maintained `tasks.md` otherwise. **Role** is a key of `harness.roles` in `.kf/config.json`, or `-` for no specific role. **Files** is a comma-separated list of paths, directories or globs: the allowlist of everything the task may touch. Tasks with overlapping Files run one after another; an empty Files cell means the files are unknown and the task runs alone. Dependencies are `TASK-###` tokens or `-`. Every surface declared under `## Affected surfaces` in the spec must appear here — as a task row or a `## Documentation Impact` entry — or `kf validate` warns it is uncovered.

## Complexity
- Level: {complexity_level}
- Reason: {complexity_reason}

## Impact Analysis

| Area | Impact |
|---|---|
| Backend | {backend_impact} |
| Frontend | {frontend_impact} |
| Database | {database_impact} |
| API | {api_impact} |
| Infrastructure | {infrastructure_impact} |
| Security | {security_impact} |
| Performance | {performance_impact} |
| Regression | {regression_impact} |
| Dependencies | {dependencies_impact} |

## Risks and Mitigation

| Risk | Impact | Mitigation / rollback |
|---|---|---|
| {risk} | {risk_impact} | {risk_mitigation} |

## Architecture Constraints
- {architecture_constraint}

## Implementation Constraints
- {implementation_constraint}

## Testing Strategy
- Unit: {unit_strategy}
- Integration: {integration_strategy}
- E2E: {e2e_strategy}
- Coverage target: >= {coverage_target}%

## Documentation Impact
- {documentation_impact}

## Definition of Done
- [ ] Implementation complete
- [ ] Unit tests
- [ ] Integration tests where applicable
- [ ] Coverage meets the agreed target
- [ ] E2E tests when required by the agreed Test Level
- [ ] All test cases pass
- [ ] Review passes
- [ ] Documentation updated
- [ ] Feature report generated
