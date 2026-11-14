---
feature: "{feature_name}"
context: "{context}"
created: "{timestamp}"
kind: bug
status: pending
severity: {severity}
---

# Bug Report

## Bug Summary
{bug_summary}

## Problem Statement
{problem_statement}

## Severity
{severity}

## Environment
{environment}

## Steps to Reproduce
1. {reproduction_step}

## Actual Result
{actual_result}

## Expected Result
{expected_result}

## Scope
### In Scope
- {in_scope_item}

### Out of Scope
- {out_of_scope_item}

## Estimate
- Agent minutes: {estimate_minutes}

The agent's own estimate of the fix, in minutes. `kf approve` records it; the file count of a bug is unknown, so the size comes from the minutes alone.

## Related Feature

| Field | Value |
|---|---|
| Feature / context | {related_feature} |
| Existing living doc (`docs/specs/<context>/<capability>.md`) | {related_docs} |

Use `N/A` with a reason when no related feature can be identified.

## Constraints
- {constraint}

## Assumptions
- {assumption}

## Acceptance Criteria
- [ ] {acceptance_criterion}

## Edge Cases
- {edge_case}

## Suspected Root Cause
{suspected_root_cause}

## Regression Test Strategy
- Test Level: {test_level}
- Tools: {test_tools}
- Coverage Target: {coverage_target}%

## Documentation Impact

| Update needed? | Affected docs | Reason / intended update |
|---|---|---|
| {docs_update_needed} | {affected_docs} | {docs_update_reason} |

Name the existing living doc under `docs/specs/{context}/` whose behaviour the fix corrects; a bug fix updates a living doc and does not create a new one.

## Open Questions
- {open_question}
