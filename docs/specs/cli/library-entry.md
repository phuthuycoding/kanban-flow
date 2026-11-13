# library-entry

## Purpose
Let another program read kf's work items with the code the CLI runs. The hosted ledger service (#182) computes an item's status from replicated logs, and a script can do the same, without spawning `kf` or copying its readers. The entry gives them a public import path whose stable part is versioned.

## Current behaviour
- **Two package entries.** `@phuthuycoding/kanban-flow` stays the CLI entry: `exports["."]` and `bin.kf` point at `dist/index.js`, and importing it runs a `kf` command from `process.argv`. `@phuthuycoding/kanban-flow/lib` (`exports["./lib"]`, `dist/lib.js` with `dist/lib.d.ts`) is the library entry. No other path resolves: a deep import into `dist/` is refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Importing the library has no side effect.** `src/lib.ts` holds re-exports only: importing it runs no command, reads no argv, prints nothing, writes nothing and leaves the exit code alone.
- **What it exports.** The task-loop ledger readers (`readLedgerState`, `parseLedger`, `loopStats`, `foldWorld`, `liveCap`), the item readers (`findWorksRoot`, `listFeatures`, `findFeature`, `readFeatureMeta`, `readStageRecords`, `executionContractHash`), the lifecycle log (`ITEM_LOG_FILE`, `foldItemLog`, `readItemLog`, `sharedMeta`), the read models (`computeStatus`, `computeBuckets`, `statusToJson`, `dashboardData`), and the types their parameters and results use.
- **Types ship with it.** The build emits declarations, so a TypeScript consumer typechecks against `dist/lib.d.ts`. The package is ESM only.
- **Readers need a filesystem and may run git.** The item readers read `.works/<stage>/<item>/` folders under a project root, so a service materialises the folders first. Nothing in the library writes or runs a hook. `findWorksRoot` asks git for the main checkout from a linked worktree, and `computeStatus` (and so `dashboardData`) validates reports and living docs against the git checkout, as `kf status` does.
- **Stability.** `docs/workflow/library.md` marks every export stable or experimental. Breaking a stable export is a major version; while the package is `0.x` it bumps the minor and is listed under **Changed**. Experimental exports, the task-loop scheduler's internals and the text-output shapes, may change in any minor. A test keeps the document's list equal to the library's exports.

## Use cases
- UC-001 Import the library and fold a task-loop ledger: `readLedgerState`, `foldWorld` and `loopStats` give the events, each task's state and the loop measurement.
- UC-002 Read a materialised item folder and compute its status: `listFeatures`, `readFeatureMeta`, `readItemLog` and `computeStatus` give the item, its metadata, its lifecycle fold and the status `kf status` prints.

## Surfaces
- `src/lib.ts`, `package.json` (`exports["./lib"]`), `tsconfig.build.json` (`declaration`)
- `docs/workflow/library.md` (the export list and the stability marks), README.md, CHANGELOG.md
- Tests: `src/tests/lib-entry.test.ts`, `src/tests/lib-readers.test.ts`, `src/tests/lib-docs.test.ts`

## History
- 20261113_1339 — ledger-lib: created — the `@phuthuycoding/kanban-flow/lib` entry with type declarations, the readers and read models it exports, and the stability document (#184)
