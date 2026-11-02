# Task loop ledger — adaptive-cap
Wave 1: TASK-001, TASK-002, TASK-003 @ 2026-11-02T09:00:00Z
Ruling: developer cap 2 — start — cost if wrong: one developer seat idle for a wave @ 2026-11-02T09:00:00Z
TASK-001: test-writer dispatched model=opus @ 2026-11-02T09:00:00Z
TASK-002: test-writer dispatched model=opus @ 2026-11-02T09:00:00Z
TASK-003: test-writer dispatched model=opus @ 2026-11-02T09:00:00Z
TASK-001: test-writer done status=DONE @ 2026-11-02T09:04:00Z
TASK-002: test-writer done status=DONE @ 2026-11-02T09:05:00Z
TASK-001: developer dispatched model=opus @ 2026-11-02T09:05:00Z
TASK-003: test-writer done status=DONE @ 2026-11-02T09:06:00Z
TASK-002: developer dispatched model=sonnet @ 2026-11-02T09:06:00Z
TASK-003: developer waits — 2 developers in flight @ 2026-11-02T09:07:00Z
TASK-001: developer done status=DONE @ 2026-11-02T09:15:00Z
TASK-003: developer dispatched model=sonnet @ 2026-11-02T09:16:00Z
TASK-002: developer done status=DONE @ 2026-11-02T09:18:00Z
TASK-001: complete (commits a000001) @ 2026-11-02T09:19:00Z
TASK-002: complete (commits a000002) @ 2026-11-02T09:20:00Z
TASK-003: developer done status=DONE @ 2026-11-02T09:24:00Z
TASK-003: complete (commits a000003) @ 2026-11-02T09:25:00Z
Ruling: developer cap 2 → 3 — wave 1 clean @ 2026-11-02T09:25:00Z
Wave 2: TASK-004, TASK-005, TASK-006, TASK-007 @ 2026-11-02T09:26:00Z
TASK-004: test-writer dispatched model=opus @ 2026-11-02T09:26:00Z
TASK-005: test-writer dispatched model=opus @ 2026-11-02T09:26:00Z
TASK-006: test-writer dispatched model=opus @ 2026-11-02T09:26:00Z
TASK-007: test-writer dispatched model=opus @ 2026-11-02T09:26:00Z
TASK-004: test-writer done status=DONE @ 2026-11-02T09:29:00Z
TASK-005: test-writer done status=DONE @ 2026-11-02T09:30:00Z
TASK-004: developer dispatched model=opus @ 2026-11-02T09:30:00Z
TASK-006: test-writer done status=DONE @ 2026-11-02T09:31:00Z
TASK-005: developer dispatched model=sonnet @ 2026-11-02T09:31:00Z
TASK-007: test-writer done status=DONE @ 2026-11-02T09:32:00Z
TASK-006: developer dispatched model=sonnet @ 2026-11-02T09:32:00Z
TASK-007: developer waits — 3 developers in flight @ 2026-11-02T09:33:00Z
TASK-004: developer done status=DONE @ 2026-11-02T09:38:00Z
TASK-007: developer dispatched model=opus @ 2026-11-02T09:39:00Z
TASK-004: verify started @ 2026-11-02T09:40:00Z
TASK-004: verify done exit=1 @ 2026-11-02T09:42:00Z
Ruling: developer cap 3 → 1 — EADDRINUSE in TASK-004 verify @ 2026-11-02T09:42:00Z
Note TASK-004: verify rerun — contention EADDRINUSE @ 2026-11-02T09:42:00Z
TASK-005: developer done status=DONE @ 2026-11-02T09:46:00Z
TASK-006: developer done status=DONE @ 2026-11-02T09:48:00Z
TASK-007: developer done status=DONE @ 2026-11-02T09:50:00Z
TASK-004: verify started @ 2026-11-02T09:51:00Z
TASK-004: verify done exit=0 @ 2026-11-02T09:54:00Z
TASK-004: complete (commits a000004) @ 2026-11-02T09:55:00Z
TASK-005: complete (commits a000005) @ 2026-11-02T09:56:00Z
TASK-006: complete (commits a000006) @ 2026-11-02T09:57:00Z
TASK-007: complete (commits a000007) @ 2026-11-02T09:58:00Z
