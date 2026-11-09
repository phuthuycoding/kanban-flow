# TASK-001 tests report

Advisory run: no developer was in flight; the developer's step-3 run confirms.

## Files
- src/tests/harness-config.test.ts (extended; import adds DEFAULT_DEVELOPER_MAX), new describe "validateHarness reads the developer ceiling":
  exports a default ceiling of 6; accepts a valid ceiling and keeps developers as given; rejects a max that is not an integer from 1 to 16; rejects a developers value that is not an object
- src/tests/tasks-command.test.ts (extended), new describe "the developer ceiling in --json":
  reports the default of 6 when the key is not set; reports the default when developers is set without a max; reports the configured max with source config; fails with the max message when the configured max is 0; keeps the graph JSON key set free of developers
  Updated existing test (renamed "lists the tasks byte-identically and appends the developer ceiling in --json without --graph") to expect {feature, tasks, developers:{max:6,source:"default"}}.

## TC mapping
- TC-001 -> harness-config.test.ts "accepts a valid ceiling and keeps developers as given" (+ "exports a default ceiling of 6")
- TC-002 -> harness-config.test.ts "rejects a max ..." and "rejects a developers value ..."
- TC-003 -> tasks-command.test.ts the five tests in the new describe + the updated byte-for-byte test
- Not mine: none (no UI/E2E TCs).

## Run
`npx vitest run src/tests/harness-config.test.ts src/tests/tasks-command.test.ts` -> failing (8 failed)
- exports a default ceiling of 6: expected undefined to be 6 (export missing)
- rejects a max...: 0: expected [Function call] to throw an error
- rejects a developers value...: 3: expected [Function call] to throw an error
- updated byte-identical test: stdout lacks the developers field
- reports default / default with {} / configured max: developers undefined / keys ['feature','tasks']
- fails with the max message when max is 0: expected +0 not to be +0

## Concerns
- "accepts a valid ceiling..." and "keeps the graph JSON key set free of developers" pass before implementation (legacy carry-through and unchanged graph path); they are regression guards, not red tests.
- The cmdTasks invalid-config test accepts either a non-zero result or a thrown error, because the brief says only "fails the command"; both must contain the max message.
