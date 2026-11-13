# library-entry

## Purpose
Let another program read kf's work items with the code the CLI runs. The hosted ledger service (#182) computes an item's status from replicated logs, and a script can do the same, without spawning `kf` or copying its readers. The entry gives them a public import path whose stable part is versioned.

## Current behaviour
- **Two package entries.** `@phuthuycoding/kanban-flow` stays the CLI entry: `exports["."]` and `bin.kf` point at `dist/index.js`, and importing it runs a `kf` command from `process.argv`. `@phuthuycoding/kanban-flow/lib` (`exports["./lib"]`, `dist/lib.js` with `dist/lib.d.ts`) is the library entry. No other path resolves: a deep import into `dist/` is refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Importing the library has no side effect.** `src/lib.ts` holds re-exports only: importing it runs no command, reads no argv, prints nothing, writes nothing and leaves the exit code alone.
- **What it exports.** The task-loop ledger readers (`readLedgerState`, `parseLedger`, `loopStats`, `foldWorld`, `liveCap`), the item readers (`findWorksRoot`, `listFeatures`, `findFeature`, `readFeatureMeta`, `readStageRecords`, `executionContractHash`), the lifecycle log (`ITEM_LOG_FILE`, `foldItemLog`, `readItemLog`, `sharedMeta`), the read models (`computeStatus`, `computeBuckets`, `statusToJson`, `dashboardData`), and the types their parameters and results use.
- **Types ship with it.** The build emits declarations, so a TypeScript consumer typechecks against `dist/lib.d.ts`. The package is ESM only.
- **Readers need a filesystem and may run git.** The item readers read `.works/<stage>/<item>/` folders under a project root, so a service materialises the folders first. No reader writes a file under `.works/` or runs a hook. `findWorksRoot` asks git for the main checkout from a linked worktree, and `computeStatus` (and so `dashboardData`) runs git in the item worktree its `.kfw.json` names, or the project root, to judge the stage record and the living docs, as `kf status` does.
- **Trust and cost.** Because git runs where a tree and its `.kfw.json` point, the readers are for trees the caller trusts; requirement #184 excludes git that changes state, not this read-only git. `dashboardData`, and `computeStatus` for an item in implementation, testing or review, also read the host's global and workspace config layers and may print a `not applied` warning on stderr. Every reader is synchronous and the git calls have no timeout. `dashboardData` caches the `worktree.domains` flag per root and config version for the life of the process. The types need `moduleResolution` `node16`, `nodenext` or `bundler`. `docs/workflow/library.md` § Trust and cost is the full statement.
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
