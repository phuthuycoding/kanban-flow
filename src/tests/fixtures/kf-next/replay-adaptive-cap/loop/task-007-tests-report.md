# TASK-007 tests report

Advisory run: a developer (TASK-002) is in flight in this worktree.

File written: /Volumes/Labs/Code/projects/kaban-flow/.worktrees/adaptive-developer-cap/src/tests/worktree-domains-output.test.ts (11 tests)

## TC -> test
- TC-014 -> worktree output with domains off: transition note shows direct URL and no domain line; status shows direct URL and no domain line; worktree create prints direct only; worktree list prints direct only and keeps route and stored domain; a registration made with domains on prints direct URL only once the switch is off (review-focus case)
- TC-014 (on, byte-identical, guard) -> worktree output with domains on: keeps today's exact lines (absent and true); worktree create prints domain then direct
- TC-014 (JSON unchanged, guard) -> json outputs still carry the domain
- TC-015 -> worktree hook env: omits the domain variable when domains are off; carries all four variables when domains are on

Out of scope: none (TC-014 Integration, TC-015 Unit; both covered through the real hook script env).

## Command
npx vitest run src/tests/worktree-domains-output.test.ts -> 6 failed | 5 passed (exit non-zero)

Failing (right reason, current code prints Domain/domain and exports the domain env):
- transition note: expected to contain "\n  Direct:   http://127.0.0.1:5100"; got "Domain:   http://demo.app.test  (direct: ...)"
- status: lines lack "Direct:   http://127.0.0.1:5100"
- worktree create: not.toContain("domain:") but output has "domain: http://demo.app.test"
- worktree list: lacks "  direct: http://127.0.0.1:5100"; has "domain: ... -> 127.0.0.1:5100"
- old registration + switch off: status lacks "Direct:" line
- hook env off: output contains KFW_WORKTREE_DOMAIN=demo.app.test

## Concerns
- 5 tests pass before implementation by design: domains-on exact-line guards (both cases + create), JSON guard, hook env with domains on. They pin "byte-identical to today" and must stay green.
- Status JSON guard asserts the domain appears in the `kf status --change --json` string; domains-off route/port checks also pass today (unchanged behaviour).
- domains-off hook-env test uses `env | grep ^KFW_WORKTREE_`, so an empty-but-set variable also fails it.

## Fix report, round 1 (invalid config in kf status)
Added test "status with an invalid project config > falls back to the domain line and reports the config problem" in src/tests/worktree-domains-output.test.ts. Provisions a worktree with domains true, rewrites config with `worktree.domains: "no"`, runs `cmdStatus` with `change: demo`; asserts code 0, output contains `Domain:   http://`, and a line starting `Config:   invalid .kf/config.json — ` containing `worktree.domains must be boolean`. Expected values from the controller ruling.
Run against c956119: `npx vitest run src/tests/worktree-domains-output.test.ts` -> 12 passed (the 6 earlier domains-off failures now pass too with the implementation present). Not committed.
