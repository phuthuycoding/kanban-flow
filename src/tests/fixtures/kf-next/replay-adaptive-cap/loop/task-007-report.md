# TASK-007 report
Implemented: status.ts (Direct line; root via findWorksRoot(feature.dir) since renderStatusText has no root and is used with .map), transition.ts (note), worktree.ts (create/list direct-only), lifecycle.ts (worktreeHook takes cfg; omits KFW_WORKTREE_DOMAIN when off).
Checks: tsc --noEmit exit 0; npm run lint exit 0; vitest worktree-domains-output, worktree, worktree-domains, archive-delivery, cancel-item, migrate: 6 files, 97/97 pass. Full suite not run (seat in flight).
Test file unedited. Concern: status.ts now reads project config at render when a worktree exists; missing root falls back to domains-on.

## Fix round 1
status.ts: new resolveDomains(root) reads only readProjectConfig(root).worktree?.domains (no worktreeConfig, no git subprocess); memoised per root keyed by .kf/config.json mtime (a plain per-root memo would go stale when config is rewritten, as the handed test does). Catches only ProjectConfigError -> domains on plus a `Config:   invalid .kf/config.json — <message>` line; other errors rethrown. No-root case still defaults to on (no config exists to be invalid).
Checks: tsc 0, lint 0, vitest 12 files / 142 tests pass (worktree-domains-output, worktree, archive-delivery, cancel-item, migrate, all *status* tests).
Test gap: the invalid-config path (Config line, no throw) is not covered by the handed file and I did not probe it by hand; recommend the test-writer add one.
