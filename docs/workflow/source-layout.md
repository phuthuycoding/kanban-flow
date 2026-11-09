# Source layout

CLI runtime code lives under `src/` and is grouped by responsibility. File moves do not change the public `kf` commands or the generated entrypoint `dist/index.js`.

```text
src/
├── index.ts              # CLI entrypoint and command dispatch
├── cli/
│   ├── args.ts           # argument parsing and help metadata
│   ├── tree.ts           # declarative command tree (flat commands + feature|bug noun verbs)
│   ├── noun-gate.ts      # kind check for `kf feature|bug <verb>` paths
│   ├── result.ts         # command result contract
│   └── commands/         # command handlers, split by use
│       ├── init.ts       # project initialization
│       ├── new.ts        # feature/bug creation
│       ├── inspect.ts    # list, show, view, status, validate
│       ├── artifacts.ts  # instruct and templates
│       ├── stage.ts      # state transitions
│       ├── approve.ts    # planning approval
│       ├── rules.ts      # stack review-rule pack installation
│       ├── autoconfig.ts # agent-facing setup briefing (context, checklist, rules, workflow)
│       ├── tasks.ts      # kf tasks (the plan's task graph)
│       ├── verify.ts     # kf verify (task allowlist check and harness.verify)
│       ├── loop-stats.ts # kf loop-stats (src/cli/commands/loop-stats.ts: ledger report, --record, --all)
│       ├── next.ts       # kf next (the task loop's actions due now; read-only)
│       ├── record.ts     # kf record (one stamped ledger line under the item lock)
│       ├── ship.ts       # kf ship — deprecated alias, prints a pointer and exits 1
│       ├── cancel.ts     # kf cancel (argument parsing and output over workflow/cancel)
│       └── archive.ts    # kf archive (argument parsing and output over workflow/archive)
├── workflow/             # domain state, artifacts and validation
│   ├── schema.ts         # stages, artifacts, transitions
│   ├── features.ts       # .kfw.json metadata (approval, execution id, bypasses), feature listing
│   ├── bypass.ts         # --force/--skip-hooks audit records (recordBypasses, bypassNote)
│   ├── canonical-docs.ts # canonical docs sync: content, paths, prepare/write/rollback copies
│   ├── archive.ts        # archive transaction (archiveItem) behind kf archive
│   ├── cancel.ts         # cancel transaction (cancelItem) behind kf cancel
│   ├── tasks.ts          # the plan's task graph
│   ├── allowlist.ts      # task Files allowlist matching
│   ├── verify.ts         # verifyTask / verifyStage / verifyWave behind kf verify
│   ├── loop-stats.ts     # src/workflow/loop-stats.ts: ledger parsing and loop measurements behind kf loop-stats
│   ├── next/             # the task loop state machine behind kf next and kf record
│   │   ├── types.ts      # the contract: LedgerState, LoopInputs, World, Intent, Action and NextResult
│   │   ├── ledger-state.ts # the ledger as events; open seats and verifies, completed tasks, commits
│   │   ├── inputs.ts     # plan or bug tasks.md, reports, verify logs, the item branch's git log
│   │   ├── fold.ts       # foldWorld(): the ledger folded once into one state per task; lifecycle transitions
│   │   ├── verify-region.ts # verify region: exits, failures, re-runs, stale runs, waits and routed failures
│   │   ├── review-region.ts # review region: one reviewer lane per task, own and cascade demands, the own verdict
│   │   ├── atcap.ts      # at-cap region: the Breaker, the cap stop, the minimal fix past the cap, cascades at the cap
│   │   ├── judgements.ts # the judgement table: every decide and stop, with the ledger lines that close it
│   │   ├── intents.ts    # what each task and the item owe, before arbitration
│   │   ├── arbiter.ts    # cross-task arbitration: holds, dependencies, overlaps, the live cap, the reviewer lane
│   │   ├── cap.ts        # the live developer cap and contention re-runs
│   │   ├── liveness.ts   # the liveness guard: every open task has a witness, every decide names a closing line
│   │   ├── waves.ts      # the wave tier: per-wave verify state, the later-wave developer hold, wave verify actions and decides
│   │   ├── schedule.ts   # schedule(): fold, intents, arbiter, then the liveness guard
│   │   └── record.ts     # recordEvent(): validates and appends one ledger line
│   ├── migrate.ts        # one-time move of legacy dones/shipping items to done/review
│   ├── status.ts         # artifact checklist rendering
│   ├── findings.ts       # Finding/ValidationResult types
│   ├── secrets.ts        # secret-like content scan
│   ├── validate-artifacts.ts     # due artifacts, stage gate, requirement confirmed
│   ├── validate-approval.ts      # approval fingerprint, recorded bypasses
│   ├── validate-reports.ts       # tasks.md, testing/review report semantics, exit codes
│   ├── validate-traceability.ts  # FR → UC → TC references
│   ├── direction.ts      # directional gate (PASS/FAIL/REQUIREMENT_BUG)
│   └── validate.ts       # facade: composes the checks, renders results, re-exports
├── project/              # project config, declared contexts and bootstrap prompts
├── integrations/         # agents, skill installation, hooks
│   └── github.ts         # gh CLI wrapper and PR merge gate (checkMergeGate); domain result, no CLI type
├── dashboard/            # analytics HTTP server and HTML view
├── shared/               # filesystem paths, frontmatter and time helpers, per-item lock, git helpers
└── tests/                # all Vitest tests, grouped separately from runtime
    ├── helpers/          # test helpers
    └── setup/            # vitest globalSetup (builds dist, isolates HOME)
```

Dependency direction is intentionally one-way: command handlers call workflow/project/integration services; workflow code does not import CLI handlers. Shared utilities contain no command dispatch. This keeps changes to the CLI surface isolated from state and artifact rules.

When adding code, place it beside the responsibility it serves. Add a command handler under `src/cli/commands/`, a state or gate rule under `src/workflow/`, and its test under `src/tests/`. Keep the public dispatch in `src/index.ts` limited to wiring.
