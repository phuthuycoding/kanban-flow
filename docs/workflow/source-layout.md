# Source layout

CLI runtime code lives under `src/` and is grouped by responsibility. File moves do not change the public `kf` commands or the generated entrypoint `dist/index.js`.

```text
src/
├── index.ts              # CLI entrypoint and command dispatch
├── cli/
│   ├── args.ts           # argument parsing and help metadata
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
│       ├── run.ts        # kf run / kf runs (hand a stage to a worker agent)
│       ├── harness.ts    # kf harness (effective harness config)
│       └── archive.ts    # closure and canonical docs sync
├── workflow/             # domain state, artifacts and validation
│   ├── schema.ts         # stages, artifacts, transitions
│   ├── features.ts       # .kfw.json metadata (approval, execution id, bypasses), feature listing
│   ├── status.ts         # artifact checklist rendering
│   ├── findings.ts       # Finding/ValidationResult types
│   ├── secrets.ts        # secret-like content scan
│   ├── validate-artifacts.ts     # due artifacts, stage gate, requirement confirmed
│   ├── validate-approval.ts      # approval fingerprint, recorded bypasses
│   ├── validate-reports.ts       # tasks.md, testing/review report semantics, exit codes
│   ├── validate-traceability.ts  # FR → UC → TC references
│   ├── direction.ts      # directional gate (PASS/FAIL/REQUIREMENT_BUG)
│   └── validate.ts       # facade: composes the checks, renders results, re-exports
├── harness/              # multi-agent harness: role/runner config, worker prompt, session, run executor, role chain, detached supervisor
├── project/              # project config and bootstrap prompts
├── integrations/         # agents, skill installation and hooks
├── dashboard/            # analytics HTTP server and HTML view
├── shared/               # filesystem paths, frontmatter and time helpers
└── tests/                # all Vitest tests, grouped separately from runtime
    ├── helpers/          # fake agent CLIs and harness project fixture
    └── setup/            # vitest globalSetup (builds dist for detached-run tests)
```

Dependency direction is intentionally one-way: command handlers call workflow/project/integration services; workflow code does not import CLI handlers. Shared utilities contain no command dispatch. This keeps changes to the CLI surface isolated from state and artifact rules.

When adding code, place it beside the responsibility it serves. Add a command handler under `src/cli/commands/`, a state or gate rule under `src/workflow/`, and its test under `src/tests/`. Keep the public dispatch in `src/index.ts` limited to wiring.
