---
feature: "{feature_name}"
context: "{context}"
reviewer: "{agent_or_human}"
created: "{timestamp}"
---

# {Feature Name} — Review Report

## Summary
| Metric | Result |
|--------|--------|
| Overall | PASS/FAIL |
| Score | {A/B/C/F} |

## Gate Checklist
- [ ] Build passes
- [ ] Tests pass
- [ ] Security rules pass
- [ ] Performance rules pass
- [ ] Code conventions pass

## Violations Found
| Severity | File | Rule | Description |
|----------|------|------|-------------|
| HIGH/MEDIUM/LOW | {file}:{line} | {rule} | {description} |

## Files Reviewed
- {file_1}: {brief_summary}
- {file_N}: {brief_summary}

## Recommendations
- {recommendation_1}
- {recommendation_N}

## Decision
APPROVED / CHANGES REQUESTED
