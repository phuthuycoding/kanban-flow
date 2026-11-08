# Repairs to the replayed ledger

`loop/progress.md` is a copy of the real ledger of the done item `adaptive-developer-cap_20261102_1605`.
`readLedgerState` refuses every line below as written, so each one was repaired in this copy with the
smallest edit that keeps its meaning. The original ledger is unchanged. Every repaired line keeps its line
number and its ` @ <timestamp>` suffix, so the replay's line numbers match the original.

| Line | Original body | Repaired body | Why |
|---|---|---|---|
| 16 | `TASK-001: test hashes src/tests/harness-config.test.ts=6358473608dd2d4fae336e3858ed119033a9dbfa e954457d427db6a6994fac4aa492e2220d74183f  src/tests/tasks-command.test.ts=` | `TASK-001: test hashes src/tests/harness-config.test.ts=6358473608dd2d4fae336e3858ed119033a9dbfa src/tests/tasks-command.test.ts=e954457d427db6a6994fac4aa492e2220d74183f` | Mis-split by the shell; lines 40/41 of the same ledger restate the two hashes in this form. |
| 83 | `TASK-007: test-writer done status=DONE round=1` | `TASK-007: test-writer done status=DONE` | The `done` shape carries no `round=`; the round is the one its dispatch (line 82) names. |
| 86 | `TASK-007: developer done status=DONE round=1` | `TASK-007: developer done status=DONE` | Same: `round=` dropped, the dispatch on line 85 names round 1. |
| 90 | `TASK-007: code-reviewer done status=clean round=1` | `TASK-007: code-reviewer done status=clean` | Same: the dispatch on line 89 names round 1. |
| 100 | `TASK-002: test-writer done round=1` | `TASK-002: test-writer done status=DONE` | No status was written; the controller went on to hash the tests (line 101), which it does on a DONE. |
| 102 | `TASK-002: developer done status=DONE_WITH_CONCERNS commits=529f014 round=1` | `TASK-002: developer done status=DONE_WITH_CONCERNS` | `commits=` and `round=` are not in the shape; the commit stays recorded by `TASK-002: review package 529f014` (line 103). |
| 104 | `TASK-002: verify started commits=a17e404,529f014` | `TASK-002: verify started` | `commits=` is not in the shape; the review package lines name the task's commits. |
| 108 | `TASK-002: code-reviewer done status=findings round=1` | `TASK-002: code-reviewer done status=findings` | `round=` dropped; the dispatch on line 105 names round 1. |
| 112 | `TASK-002: verify started commits=a17e404,529f014` | `TASK-002: verify started` | As line 104. |
| 113 | `TASK-002: test-writer done round=2` | `TASK-002: test-writer done status=DONE` | As line 100: the tests were hashed next (line 114). |
| 116 | `TASK-002: developer done status=DONE commits=b822298 round=2` | `TASK-002: developer done status=DONE` | The commit stays recorded by `TASK-002: review package b822298` (line 117). |
| 118 | `TASK-002: verify started commits=a17e404,529f014,b822298` | `TASK-002: verify started` | As line 104. |
| 123 | `TASK-005: developer dispatched model=sonnet lane=A` | `TASK-005: developer dispatched model=sonnet` | `lane=` is not in the shape; the three lanes stay three dispatches of the task's developer. |
| 124 | `TASK-005: developer dispatched model=sonnet lane=B` | `TASK-005: developer dispatched model=sonnet` | As line 123. |
| 125 | `TASK-005: developer dispatched model=sonnet lane=C` | `TASK-005: developer dispatched model=sonnet` | As line 123. |
| 126 | `TASK-002: code-reviewer done status=clean round=2` | `TASK-002: code-reviewer done status=clean` | `round=` dropped; the dispatch on line 119 names round 2. |
| 129 | `TASK-005: developer done status=DONE lane=A commits=9a81234,e808897` | `TASK-005: developer done status=DONE` | The commits stay recorded by the review package on line 136. |
| 130 | `TASK-005: developer done status=DONE lane=C commits=f47913c` | `TASK-005: developer done status=DONE` | As line 129. |
| 132 | `TASK-005: developer done status=DONE lane=B commits=4cca0c7` | `TASK-005: developer done status=DONE` | As line 129. |
| 133 | `TASK-005: test-writer done` | `TASK-005: test-writer done status=DONE` | No status was written; the tests were hashed next (line 134). |
| 135 | `TASK-005: developer done status=DONE commits=5269055 (controller-direct + tests unchanged)` | `TASK-005: developer done status=DONE` | As line 129. |
| 137 | `TASK-005: verify started commits=9a81234,e808897,4cca0c7,f47913c,d6d8213,5269055` | `TASK-005: verify started` | As line 104. |
| 140 | `TASK-005: code-reviewer done status=clean (3 LOW)` | `TASK-005: code-reviewer done status=clean` | The trailing remark is not in the shape; the LOWs are handled by the `Ruling:` on line 141. |

The verify logs (`loop/task-002-verify.log`, `loop/task-005-verify.log`) predate the `## kf verify <time> exit=<n>`
block header, so they yield no blocks; they are copied unchanged. No report carries a `Commits created` section.
