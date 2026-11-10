---
feature: "{feature_name}"
context: "{context}"
created: "{timestamp}"
status: DONE
---

# Feature Report

## Feature
{feature_name}

## Completion Overview

| Field | Result |
|---|---|
| Context | {context} |
| Delivery summary | {delivery_summary} |
| Reviewed execution | {execution_id} |
| Testing / review status | PASS / PASS |

## Requirement Summary
{requirement_summary}

## Scope
{scope}

## Implementation Summary
{implementation_summary}

## Changed Areas

| Area / files | Change | Requirement / use case |
|---|---|---|
| {changed_area} | {change_summary} | {requirement_reference} |

## Use Cases

| Use case | Delivered behavior | Evidence |
|---|---|---|
| UC-001 {use_case_name} | {delivered_behavior} | {use_case_evidence} |

## Test Summary
| Metric | Result |
|---|---:|
| Test cases | {total_cases} |
| Passed | {passed} |
| Failed | {failed} |
| Coverage | {overall_coverage}% |

## Review Summary
{review_summary}

## Documentation Updated

| Document | Update / purpose | Status |
|---|---|---|
| {other_document} | {documentation_updated} | {documentation_status} |

Record `N/A` with a reason if no other documents need updates.

## Docs Reconciled

| Document | Superseded / updated behavior | Action |
|---|---|---|
| {reconciled_document} | {reconciled_change} | {reconciled_action} |

List each living doc created or updated under `docs/specs/{context}/` and each legacy feature consolidated into one (its requirement, use-case and testplan files removed). Write `None — <reason>` instead of the table when no living doc or legacy feature is affected.

## Known Limitations
- {known_limitation}

## Accepted Follow-ups

| Item | Reason deferred | Backlog reference |
|---|---|---|
| {follow_up} | {deferred_reason} | {backlog_reference} |

## Final Status
DONE
