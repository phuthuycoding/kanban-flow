---
name: kanban-test
description: Run automated tests for a feature. Use when user says "test feature", "kanban test", "run tests {feature_name}".
args: "[CONTEXT] [FEATURE_NAME]"
---

# Kanban Test

Move task from doing → testing, then execute the test plan.

**ARGUMENTS:** `<context> <feature_name>` — e.g. `auth user-login`.

---

## Workflow

### Step 1: Find and load the task

1. Find folder in `.works/doing/{feature_name}_*/`
2. Read `test-plan.md` — what to test
3. Read `tasks.md` — what was implemented

### Step 2: Move to testing

```bash
mv .works/doing/{feature_name}_{timestamp} .works/testing/
```

### Step 3: Detect test framework

Read project config to find test framework:
- `package.json` → npm scripts (jest, vitest, mocha)
- `go.mod` → `go test`
- `Cargo.toml` → `cargo test`
- `requirements.txt` → pytest
- `pubspec.yaml` → flutter test

### Step 4: Execute tests

**Phase A: Unit tests**
```bash
{test_command} -- --testPathPattern={feature_files}
```

**Phase B: Integration tests** (if test plan includes them)
```bash
{integration_test_command} -- --testPathPattern={feature_files}
```

**Phase C: E2E tests** (if test plan includes them)
```bash
{e2e_test_command}
```

### Step 5: Compare results against test plan

For each scenario in `test-plan.md`:
- Check if corresponding test exists
- Check if it passes
- Mark coverage in test plan

### Step 6: Report results

Write test results to `.works/testing/{feature_name}_{timestamp}/test-results.md`:

```markdown
# Test Results: {feature_name}

## Summary
| Total | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| {N}   | {N}    | {N}    | {N}     |

## Results by Scenario
| Scenario | Status | Duration |
|----------|--------|----------|
| {name}   | PASS/FAIL | {time} |

## Failed Tests (if any)
- {test_name}: {error_message}
```

### Step 7: Gate decision

**All tests pass:**
> "All {N} tests pass! Ready for review. Use /kanban-review {feature_name}"

**Some tests fail:**
> "{N} tests failed. Options:
> 1. Fix now (implement/kanban will fix)
> 2. Skip and proceed to review (mark as known issue)
> What do you prefer?"

---

## Gate

- [ ] Task moved from `.works/doing/` to `.works/testing/`
- [ ] Test execution complete
- [ ] Test results written to `test-results.md`
- [ ] All tests pass OR user decision on failures
- [ ] **User CONFIRMED to proceed to review**

## Output format

```
## Test Results: {feature_name}

### Unit Tests
✓ {N} passed, ✗ {M} failed

### Integration Tests
✓ {N} passed, ✗ {M} failed

### Coverage
- Lines: {N}%
- Branches: {N}%

{IF ALL PASS:}
All tests pass! Use /kanban-review {feature_name}

{IF FAILURES:}
Some tests failed. See details in:
.testing/{feature_name}_{timestamp}/test-results.md
```
