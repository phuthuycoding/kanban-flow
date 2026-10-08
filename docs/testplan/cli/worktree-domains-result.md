---
status: PASS
execution: 5496e4e1-2a70-468c-ada7-923a2dbe4725
---

# Testing Result — worktree-domains

Execution: `5496e4e1-2a70-468c-ada7-923a2dbe4725`

## Test approach

Test level per approved plan: `unit+integration`, Vitest. All integration tests run
against real git repositories under `mkdtemp` and ephemeral proxy ports — no sudo,
no machine state touched. Manual smoke runs additionally exercised `kf worktree
create|list|setup --print` and `kf proxy serve` on a throwaway repo.

## Results

| TC | Name | Result | Evidence |
|----|------|--------|----------|
| TC-001 | worktree config defaults + validation | PASS | `worktree.test.ts` › "defaults and validates" |
| TC-002 | slug + domain generation | PASS | `worktree.test.ts` › "slugifies into DNS-safe domains" |
| TC-003 | port allocation (registry ∪ routes) | PASS | `worktree.test.ts` › "skips ports claimed" |
| TC-004 | routes file read/write/remove + corrupt JSON error | PASS | `worktree.test.ts` › "writes atomically" |
| TC-005 | findWorksRoot via git-common-dir from linked worktree | PASS | `worktree.test.ts` › FR-003 tests |
| TC-006 | proxy routes Host → port | PASS | `proxy.test.ts` › "forwards a routed Host" |
| TC-007 | unknown host 502 + route list | PASS | `proxy.test.ts` › "502s an unknown host" |
| TC-008 | fallbackUpstream forward, Host preserved | PASS | `proxy.test.ts` › "forwards unrouted hosts" |
| TC-009 | routes hot reload via mtime | PASS | `proxy.test.ts` › "reloads the routes file" |
| TC-010 | self-forward loop refused (X-Forwarded-By) | PASS | `proxy.test.ts` › "refuses a fallback that loops" |
| TC-011 | websocket upgrade tunnel | PASS | `proxy.test.ts` › "tunnels websocket upgrades" |
| TC-012 | `worktree setup --print` renders full plan, touches nothing | PASS | `worktree-setup.test.ts` › "--print renders" |
| TC-012b | foreign zone rule → conflict refuses overwrite | PASS | `worktree-setup.test.ts` › conflict tests |
| TC-013 | stage→implementation creates worktree+branch+route+registry | PASS | `worktree.test.ts` › "creates worktree + branch + route" |
| TC-014 | non-git repo → transition fails closed | PASS | `worktree.test.ts` › "fails closed" |
| TC-015 | reuse on re-enter / rebuild deleted worktree / unmanaged branch refused | PASS | `worktree.test.ts` › reuse tests |
| TC-016 | archive tears down, keeps branch, warns unmerged | PASS | `worktree.test.ts` › "archive removes worktree" |
| TC-017 | dirty worktree refuses archive + cancel; `--force` cleans | PASS | `worktree.test.ts` › dirty tests |
| TC-018 | cancel removes worktree+route, keeps branch | PASS | `worktree.test.ts` › "cancel tears down" |
| TC-019 | validate emits `worktree_infra_missing` WARNING; doctor WARNINGs; enabled:false silent | PASS | `worktree-setup.test.ts` › FR-006 tests |
| TC-020 | status shows path/domain/port; JSON includes `worktree` | PASS | `worktree.test.ts` › "status runs from the worktree cwd" |
| TC-021 | `kf` commands work from inside the worktree cwd | PASS | `worktree.test.ts` › FR-003 + status tests |
| TC-022 | `worktree list` + all three orphan kinds | PASS | `worktree.test.ts` › orphan test |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npm run typecheck` (tsc --noEmit) | 0 | clean |
| `npm run lint` (oxlint src) | 0 | 0 findings |
| `npm run build` (tsc build) | 0 | dist/ emitted |
| `npx vitest run` (full suite, 25 files) | 0 | 404/404 tests pass, incl. 34 new worktree/proxy/setup tests |
| `kf worktree create demo-feat` on tmp repo (smoke) | 0 | worktree + `kf/demo-feat` + `demo-feat.repo.test → 127.0.0.1:5100` + `.kfw.json` registration |
| `kf status --change demo-feat` run from inside worktree (smoke) | 0 | resolved main root via `--git-common-dir`; printed Worktree/Domain lines |
| `kf proxy serve --listen 127.0.0.1:18080` (smoke) | 0 | routed `demo-feat.repo.test` → 200 upstream; unknown host → 502 + route list |
| `kf worktree setup --print` (smoke) | 0 | printed dnsmasq/resolver/LaunchDaemon plan; correctly detected Valet `address=/.test/127.0.0.1` conflict in `~/.config/valet/dnsmasq.d/tld-test.conf` |

## Coverage

Target ≥80% on new code paths: every new module (`worktree/config`, `routes`,
`manager`, `lifecycle`, `setup`, `health`, `proxy/server`, `cli/commands/worktree`)
is exercised by the suites above, including error paths (non-git refusal, dirty
refusal, corrupt routes file, unmanaged branch, loop guard, orphan detection).

## Issues found during testing

None outstanding. Two real defects were caught by the new tests and fixed before
this report: (1) git canonicalizes worktree paths (`/var` → `/private/var`), which
broke reuse/orphan comparisons — now normalized via `realpathSync`; (2) corrupt
routes JSON must propagate rather than being treated as empty (`readRoutesSafe`).

## Conclusion

All functional requirements verified against the approved contract on this
execution. Remaining environment caveat: `sudo kf worktree setup` is not run by
tests (by design — it mutates the machine); it was verified via `--print` plus
conflict detection against the live dnsmasq/Valet configuration.
