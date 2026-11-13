# library-entry

## Purpose
Let another program read kf's work items with the code the CLI runs. The hosted ledger service (#182) reads replicated task-loop ledgers, lifecycle logs and item folders, and a script can do the same, without spawning `kf` or copying its readers. The entry gives them a public import path whose stable part is versioned.

## Current behaviour
- **Two package entries.** `@phuthuycoding/kanban-flow` stays the CLI entry: `exports["."]` and `bin.kf` point at `dist/index.js`, and importing it runs a `kf` command from `process.argv`. `@phuthuycoding/kanban-flow/lib` (`exports["./lib"]`, `dist/lib.js` with `dist/lib.d.ts`) is the library entry. No other path resolves: a deep import into `dist/` is refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Importing the library has no side effect.** `src/lib.ts` holds re-exports only: importing it runs no command, reads no argv, prints nothing, writes nothing and leaves the exit code alone.
- **What it exports.** The task-loop ledger readers (`readLedgerState`, `parseLedger`, `loopStats`, `foldWorld`, `liveCap`), the item readers (`listFeatures`, `findFeature`, `readFeatureMeta`, `readStageRecords`, `executionContractHash`) and the error `findFeature` throws on an ambiguous name (`AmbiguousFeatureError`), the lifecycle log (`ITEM_LOG_FILE`, `foldItemLog`, `readItemLog`, `sharedMeta`), and every type a stable export references, directly or through another type; an experimental export can reference types the library does not export.
- **No git, no host config.** No export starts git or another child process, and none reads the global `~/.kf/config.json` or a `.kf/workspace.json`, whatever folder it is given, so a path a replicated `.kfw.json` names steers nothing on the reading host. kf's status read models (`computeStatus`, `kf dashboard`'s data) and `findWorksRoot` run git or read those layers, so they are not exported; the item readers take the project root the caller passes. A status computed without git belongs to the cloud service (#187).
- **Readers need a filesystem and are synchronous.** The item readers read `.works/<stage>/<item>/` folders under the project root, so a service materialises the folders first. No reader writes a file under `.works/` or runs a hook. Every reader blocks on synchronous `fs` calls; `listFeatures` is a full scan and `findFeature` runs one per call; the readers read whole files and follow symbolic links, so a service materialises regular files only. The types need `moduleResolution` `node16`, `nodenext` or `bundler`. `docs/workflow/library.md` § Trust and cost is the full statement.
- **Types ship with it.** The build emits declarations, so a TypeScript consumer typechecks against `dist/lib.d.ts`. The package is ESM only.
- **Stability.** `docs/workflow/library.md` marks every export stable or experimental. Breaking a stable export is a major version; while the package is `0.x` it bumps the minor and is listed under **Changed**. Experimental exports, the task-loop scheduler's internals and the text-output shapes, may change in any minor. Every type a stable export references, directly or through another type, is itself exported and stable. Tests keep the document's list equal to the library's exports and walk the built declarations for that type closure.

## Use cases
- UC-001 Import the library and fold a task-loop ledger: `readLedgerState`, `foldWorld` and `loopStats` give the events, each task's state and the loop measurement.
- UC-002 Read a materialised item folder: `listFeatures`, `findFeature`, `readFeatureMeta`, `readStageRecords` and `readItemLog` give the items, their metadata, their stage-verify records and their lifecycle fold, without running git or reading the host's config.

## Surfaces
- `src/lib.ts`, `src/workflow/next/types.ts` (`EventBase` exported), `package.json` (`exports["./lib"]`), `tsconfig.build.json` (`declaration`)
- `docs/workflow/library.md` (the export list and the stability marks), README.md, CHANGELOG.md
- Tests: `src/tests/lib-entry.test.ts`, `src/tests/lib-readers.test.ts`, `src/tests/lib-docs.test.ts`, `src/tests/lib-types.test.ts`

## History
- 20261113_1339 — ledger-lib: created — the `@phuthuycoding/kanban-flow/lib` entry with type declarations, the ledger, item and lifecycle-log readers it exports without git or host config, and the stability document (#184); 20261113_1925 — the type sentence narrowed to the stable closure, the reader cost named (scan, whole files, links)
