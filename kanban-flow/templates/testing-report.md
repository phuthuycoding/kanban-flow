---
feature: "{feature_name}"
context: "{context}"
tested: "{timestamp}"
tester: "{agent_or_human}"
status: "{PASS/FAIL}"
---

# {Feature Name} — Testing Report

## Summary
| Metric | Result |
|--------|--------|
| Total Tests | {N} |
| Passed | {N} |
| Failed | {N} |
| Skipped | {N} |
| Coverage | {N}% |

## Environment
- Branch: {branch_name}
- Commit: {sha}
- Test framework: {jest/vitest/go test/pytest/...}
- OS: {os}

## Results by Scenario
| # | Scenario | Type | Priority | Status | Duration | Notes |
|---|----------|------|----------|--------|----------|-------|
| 1 | {scenario_name} | unit/integration/e2e | P0/P1/P2 | PASS/FAIL | {time} | {note} |
| N | {scenario_name} | unit/integration/e2e | P0/P1/P2 | PASS/FAIL | {time} | {note} |

## Failed Tests Detail
| Test | Error Message | Root Cause | Fix Needed? |
|------|---------------|-----------|-------------|
| {test_name} | {error} | {cause} | yes/no |

## Coverage Report
| Metric | Expected | Actual | Status |
|--------|----------|--------|--------|
| Unit coverage | ≥ {N}% | {N}% | PASS/FAIL |
| Integration coverage | ≥ {N}% | {N}% | PASS/FAIL |

## Conclusion
- **OVERALL STATUS:** {PASS / FAIL / PARTIAL}
- Gate to next step: {PASS → proceed to review} / {FAIL → fix before continuing}

## Notes
- {observation_1}
- {observation_N}