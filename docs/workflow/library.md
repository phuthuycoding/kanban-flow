# Library entry

`@phuthuycoding/kanban-flow/lib` exposes kf's readers and read models to another program — the hosted ledger service (#182), or a script — so it computes an item's state with the code the CLI runs. Import that path:

```ts
import { readLedgerState, computeStatus, listFeatures } from "@phuthuycoding/kanban-flow/lib";
```

The bare `@phuthuycoding/kanban-flow` is the CLI entry: importing it runs a `kf` command from `process.argv`. Import `@phuthuycoding/kanban-flow/lib`, never the bare package, to use the library. Importing `/lib` runs no command, reads no argv, prints nothing and leaves the exit code alone. No other path resolves: a deep import such as `@phuthuycoding/kanban-flow/dist/workflow/status.js` is refused by the package's `exports` map. The package is ESM only and ships type declarations for this path.

The readers need a filesystem: the item readers and read models read `.works/<stage>/<item>/` folders under a project root, so a service materialises the folders before calling them. Nothing here writes or runs a hook. Some readers run read-only git commands, as `kf status` does: `findWorksRoot` asks `git rev-parse --git-common-dir` for the main checkout when no folder at or above the path holds `.works/` (a linked worktree), and `computeStatus` — so `dashboardData` too — validates the item's reports and living docs against its git checkout. A service that has no checkout gets the answers `kf status` gives without one.

## Trust and cost

The readers were written for the CLI, which runs one command over the user's own checkout. A long-running service that calls them should know five things:

- **Only trusted trees.** `computeStatus`, and so `dashboardData`, runs git in the item's worktree, the directory its `.kfw.json` names in `worktree.path`, or in the project root when it names none. git reads the config of the repository it runs in, so whoever can write a tree's `.kfw.json`, or a `.git` directory inside it, chooses where git runs and what that config runs. Pass these readers only trees the caller trusts; requirement #184 excludes git that changes state, not this read-only git. A service that reads replicated, untrusted folders needs its own guard.
- **The host's config.** `computeStatus` and `dashboardData` read the project's `.kf/config.json` merged with the reading host's global `~/.kf/config.json` and any `.kf/workspace.json` above the project root, so the same tree can read differently on another host. A layer with keys that do not apply prints one `kf: <path>: not applied …` warning on stderr, once per file per process. No reader writes a file.
- **Synchronous, without a timeout.** Every reader blocks: they read files with the synchronous `fs` calls and run git as a child process that has no timeout. `dashboardData` runs git for each item in implementation, testing or review. Call them off a request path, in a worker or a job.
- **A per-process cache.** `computeStatus` caches the project's `worktree.domains` flag per root and config version for the life of the process; a service that reads many roots keeps one entry for each.
- **TypeScript resolution.** The types resolve through the `exports` map, so a TypeScript consumer needs `moduleResolution` `node16`, `nodenext` or `bundler`.

## Stability

- **stable** — removing or renaming the export, or changing a parameter or the shape it returns in a way existing callers notice, is a breaking change: a major version. While the package is `0.x`, this package bumps the minor for such a change (`0.19` → `0.20`) and lists it under **Changed** in the changelog — SemVer itself promises nothing for `0.y.z`; from `1.0` the change bumps the major.
- **experimental** — may change in any minor release. These are the task-loop scheduler's internals and the shapes the CLI prints as text; they are exported so a service can run the same fold, not because their shape is settled.

A field added to a returned object or an event added to a union is not breaking.

## Exports

| Export | Kind | Stability | What it does |
|---|---|---|---|
| `readLedgerState` | function | stable | Reads a task-loop ledger (`loop/progress.md` text) into its events and state |
| `LedgerRead` | type | stable | What `readLedgerState` returns: `{ ok: true, state }`, or `{ ok: false, repair }` when any line cannot be read |
| `LedgerState` | type | stable | The ledger's events, in order |
| `LedgerEvent` | type | stable | One ledger event |
| `RepairLine` | type | stable | A ledger line the reader could not place, with its number |
| `parseLedger` | function | stable | Parses ledger text into lines for measurement |
| `ParsedLedger` | type | stable | What `parseLedger` returns |
| `LedgerLine` | type | stable | One parsed ledger line |
| `loopStats` | function | experimental | Measures a parsed ledger, as `kf loop-stats` prints |
| `LoopStats` | type | experimental | What `loopStats` returns |
| `Seat` | type | stable | A loop seat: test-writer, developer, code-reviewer, automation-writer |
| `foldWorld` | function | experimental | Folds ledger state and loop inputs into each task's state, as `kf next` does |
| `liveCap` | function | experimental | The live developer cap `foldWorld` takes |
| `World` | type | experimental | What `foldWorld` returns |
| `TaskState` | type | experimental | One task's state in the world |
| `LoopInputs` | type | experimental | The plan, reports, verify runs and git facts the fold reads |
| `LoopTask` | type | experimental | One task of the loop inputs |
| `Cap` | type | experimental | What `liveCap` returns |
| `CapCause` | type | experimental | Why the cap changed |
| `Action` | type | experimental | An action the scheduler owes |
| `HeldRerun` | type | experimental | A contention re-run held back |
| `findWorksRoot` | function | stable | The nearest folder at or above a path that holds `.works/` (a linked worktree resolves to its main checkout), or null |
| `listFeatures` | function | stable | Every work item of a project |
| `findFeature` | function | stable | One work item by name |
| `readFeatureMeta` | function | stable | An item folder's `.kfw.json` |
| `executionContractHash` | function | stable | The contract fingerprint `approval.contractHash` is compared with |
| `Feature` | type | stable | A work item: name, stage, folder, metadata |
| `FeatureMeta` | type | stable | The `.kfw.json` snapshot |
| `Stage` | type | stable | A stage name |
| `WorkItemKind` | type | stable | `feature` or `bug` |
| `ApprovalStatus` | type | stable | The approval state in the metadata |
| `LegacyStageName` | type | stable | A stage name an earlier release wrote |
| `readStageRecords` | function | stable | The item's `loop/stage-verify.jsonl` records |
| `StageRecord` | type | stable | One stage-verify record |
| `ITEM_LOG_FILE` | constant | stable | `lifecycle.jsonl`, the lifecycle log's file name |
| `readItemLog` | function | stable | Reads and folds an item folder's lifecycle log |
| `foldItemLog` | function | stable | Folds lifecycle-log text into the stage and shared metadata |
| `sharedMeta` | function | stable | The metadata without machine-local and legacy keys, as the log records it |
| `ItemRecord` | type | stable | One lifecycle record |
| `ItemEvent` | type | stable | A lifecycle event name |
| `ItemState` | type | stable | The stage and shared metadata a fold gives |
| `FoldResult` | type | stable | What `foldItemLog` and `readItemLog` return |
| `SharedMeta` | type | stable | What `sharedMeta` returns |
| `statusToJson` | function | experimental | The object `kf status --change <feature> --json` prints |
| `computeStatus` | function | experimental | One item's status, the input of `statusToJson` |
| `FeatureStatus` | type | experimental | What `computeStatus` returns |
| `Finding` | type | experimental | A validation finding in a status |
| `StageEvidence` | type | experimental | The stage-verify evidence in a status |
| `computeBuckets` | function | experimental | The `Needs you` and `Waiting to merge` buckets of `kf status --all` |
| `Buckets` | type | experimental | What `computeBuckets` returns |
| `WaitingToMergeEntry` | type | experimental | One `Waiting to merge` entry |
| `dashboardData` | function | experimental | The board data `kf dashboard` renders |
| `DashboardFilters` | type | experimental | The context and kind filters `dashboardData` takes |
