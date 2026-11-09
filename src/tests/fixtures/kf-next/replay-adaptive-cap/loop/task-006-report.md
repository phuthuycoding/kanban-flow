# TASK-006 report
Implemented: WorktreeConfig.domains, parse rejects non-boolean ("worktree.domains must be boolean"), default true; inspect.ts and doctor.ts gate probeDomainInfra on enabled && domains.
Files: src/worktree/config.ts, src/cli/commands/inspect.ts, src/cli/commands/doctor.ts (+ handed src/tests/worktree-domains.test.ts, unchanged).
Commands: npx vitest run (4 files) exit 0, 86/86; npx tsc --noEmit exit 0 no output. Full suite/lint not run (seats in flight).
