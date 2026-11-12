---
feature: "{feature_name}"
context: "{context}"
tested: "{timestamp}"
execution: "{execution_id}"
status: BLOCKED
---

# Testing Result

## Feature
{feature_name}

## Environment
- OS: {os}
- Runtime: {runtime}
- Tooling: {tooling}

## Execution Time
{execution_time}

## Summary
| Metric | Result |
|---|---:|
| Total | {total} |
| Passed | {passed} |
| Failed | {failed} |
| Blocked | {blocked} |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 | {test_type} | {tc_status} | {expected_outcome} | {actual_outcome} | {evidence} |

Use the approved TC IDs for features; use reproduction/regression test names for bugs. Include every required test, including blocked or unexecuted tests. For an automated case, Evidence names the test file and the test name that cover it and cites the stage record (or the no-stage-commands run). A case with no test or only a skipped test is `FAIL`, naming the owning task.

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| {tool} | {exit_code} | {command_evidence} |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| {affected_test} | {error} | {failure_impact} | {next_action} |

## Behaviour run

{behaviour_run}

Each changed behaviour no test exercises and each `TASK-NNN: unverified — <claim>` ledger line: the command and its real output. With nothing to run, write `none — <why>`.

## Coverage

| File | Target | Line % | Command |
|---|---:|---:|---|
| {changed_file} | {coverage_target}% | {line_coverage}% | {coverage_command} |

Line coverage per changed source file, from one run of the project's coverage tool. Do not equate test pass rate with code coverage. A file below the target is `FAIL`; required but unmeasurable coverage is `BLOCKED`. With no target or no changed source files, write the reason instead of a row.

## Regression
{regression}

## Conclusion
- {conclusion}
