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
│       └── archive.ts    # closure and canonical docs sync
├── workflow/             # domain state, artifacts and validation
├── project/              # project config and bootstrap prompts
├── integrations/         # agents, skill installation and hooks
├── dashboard/            # analytics HTTP server and HTML view
├── shared/               # filesystem paths, frontmatter and time helpers
└── tests/                # all Vitest tests, grouped separately from runtime
```

Dependency direction is intentionally one-way: command handlers call workflow/project/integration services; workflow code does not import CLI handlers. Shared utilities contain no command dispatch. This keeps changes to the CLI surface isolated from state and artifact rules.

When adding code, place it beside the responsibility it serves. Add a command handler under `src/cli/commands/`, a state or gate rule under `src/workflow/`, and its test under `src/tests/`. Keep the public dispatch in `src/index.ts` limited to wiring.
