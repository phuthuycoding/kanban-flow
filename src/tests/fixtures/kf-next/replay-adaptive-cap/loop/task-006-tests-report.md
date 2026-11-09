# TASK-006 tests report

Advisory run: a developer (TASK-004) was in flight in this worktree.

File written: src/tests/worktree-domains.test.ts (9 tests)
- worktree.domains config switch: defaults to true when absent; keeps an explicit true; keeps an explicit false; rejects a non-boolean value
- domain infra probes gated by worktree.domains: validate emits no infra finding when domains is false; validate still emits it when true; validate still emits it when absent; doctor reports no worktree infra line when domains is false; doctor still reports the line when true

Determinism: the project's worktree.routesFile points at a corrupt JSON file, so the routes probe fails on any machine. No mocks.

TC mapping
- TC-012 -> the four "config switch" tests
- TC-013 -> the five "probes gated" tests
Out of scope (UI/E2E): none.

Command: npx vitest run src/tests/worktree-domains.test.ts  -> exit 1 (6 failed, 3 passed)
Failing, for the right reason:
- defaults to true / keeps true / keeps false: `domains` is undefined on worktreeConfig (field missing)
- rejects non-boolean: parseWorktreeConfig does not throw "worktree.domains must be boolean"
- validate off: stdout still contains worktree_infra_missing
- doctor off: stdout still lists `worktree infra (dns|proxy|routes)`
Passing before implementation (3): the "on"/absent cases for validate and doctor. They pin unchanged behaviour (regression guards), as TC-013 requires; not a concern.

Concerns
- doctor output carries an unrelated plugin ERROR on the fixture; tests only assert on the "worktree infra" text.
- src/tests/worktree.test.ts:96-101 (defaults) not inspected for a full-object toEqual; if it pins the default object it needs `domains: true` and is outside my allowlist (the developer or controller should check).
