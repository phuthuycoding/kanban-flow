# Library entry

`@phuthuycoding/kanban-flow/lib` exposes kf's readers to another program — the hosted ledger service (#182), or a script — so it reads replicated task-loop ledgers, lifecycle logs and item folders with the code the CLI runs. Import that path:

```ts
import { readLedgerState, readItemLog, listFeatures } from "@phuthuycoding/kanban-flow/lib";
```

The bare `@phuthuycoding/kanban-flow` is the CLI entry: importing it runs a `kf` command from `process.argv`. Import `@phuthuycoding/kanban-flow/lib`, never the bare package, to use the library. Importing `/lib` runs no command, reads no argv, prints nothing and leaves the exit code alone. No other path resolves: a deep import such as `@phuthuycoding/kanban-flow/dist/workflow/status.js` is refused by the package's `exports` map. The package is ESM only and ships type declarations for this path.

The readers need a filesystem: the item readers read `.works/<stage>/<item>/` folders under the project root the caller passes, so a service materialises the folders before calling them. The library runs no git and reads no host config: no export starts git or another child process, and none reads the global `~/.kf/config.json` or a `.kf/workspace.json`, whatever folder it is given, so a path a replicated `.kfw.json` names steers nothing on the reading host. Nothing here writes a file or runs a hook. kf's status read models (`computeStatus`, `kf dashboard`'s data) and `findWorksRoot` run git or read those layers, so the library does not export them; a status computed without git belongs to the cloud service (#187).

## Trust and cost

The readers were written for the CLI, which runs one command over the user's own checkout. A long-running service that calls them should know these things:

- **No git, no host config.** The library runs no git and reads no host config. No reader writes a file under `.works/`; the readers open only paths inside the folder they are given, plus whatever a link there points to (see **Links are followed**).
- **Synchronous, without a timeout.** Every reader blocks: they read files with the synchronous `fs` calls. Call them off a request path, in a worker or a job.
- **A lookup is a full scan.** `listFeatures` is a full scan of `.works/`: it lists every stage folder and reads and checks every `.kfw.json`. `findFeature` runs one `listFeatures` per call, so a service that resolves many items calls `listFeatures` once and indexes the result by name or folder.
- **Whole files in memory.** `readItemLog` and `readStageRecords` read the whole file into memory, and so do the other readers; no reader bounds file size.
- **The fold checks only the keys.** `foldItemLog` and `readItemLog` keep only the shared metadata keys a record sets, but they check only the keys, not the values: a replicated log can give `feature`, `issue` or `approval` a value `readFeatureMeta` would refuse, although the result is typed `SharedMeta`. A service checks the values before it builds a path, a link or a page from them.
- **Stage records skip bad lines.** `readStageRecords` skips a line that is not JSON or not a stage record, and says nothing. kf's own gate reads only the latest record and reports an unreadable last line, so the last element of `readStageRecords` is not the gate's answer: after a cut-off or edited line it is an older record.
- **Links are followed.** The readers follow symbolic links, and a FIFO blocks them, so a link in a materialised tree makes a reader open a path outside the folder it was given. A service materialises regular files only: no links, no FIFOs, with a size limit of its own.
- **TypeScript resolution.** The types resolve through the `exports` map, so a TypeScript consumer needs `moduleResolution` `node16`, `nodenext` or `bundler`.

## Stability

- **stable** — removing or renaming the export, or changing a parameter or the shape it returns in a way existing callers notice, is a breaking change: a major version. While the package is `0.x`, this package bumps the minor for such a change (`0.19` → `0.20`) and lists it under **Changed** in the changelog — SemVer itself promises nothing for `0.y.z`; from `1.0` the change bumps the major.
- **experimental** — may change in any minor release. These are the task-loop scheduler's internals and the shapes the CLI prints as text; they are exported so a service can run the same fold, not because their shape is settled.

A new optional field on a returned object is not breaking. A new member of an exported union (an event, a stage, a cause) is listed under **Changed** in the changelog: TypeScript code that switches on the union exhaustively stops compiling.

## Exports

| Export | Kind | Stability | What it does |
|---|---|---|---|
| `readLedgerState` | function | stable | Reads a task-loop ledger (`loop/progress.md` text) into its events and state |
| `LedgerRead` | type | stable | What `readLedgerState` returns: `{ ok: true, state }`, or `{ ok: false, repair }` when any line cannot be read |
| `LedgerState` | type | stable | The ledger's events, in order |
| `LedgerEvent` | type | stable | One ledger event |
| `EventBase` | type | stable | The line number and timestamp every ledger event carries |
| `DecisionTarget` | type | stable | What a `decided` note or a ruling closes, as the fold tags it |
| `DecisionRegion` | type | stable | The region of the loop a `DecisionTarget` names |
| `RepairLine` | type | stable | A ledger line the reader could not place, with its number |
| `parseLedger` | function | stable | Parses ledger text into lines for measurement |
| `ParsedLedger` | type | stable | What `parseLedger` returns |
| `LedgerLine` | type | stable | One parsed ledger line |
| `ShapeName` | type | stable | The name of a ledger line shape in the ledger grammar |
| `WaveShapeName` | type | stable | The name of a `wave <w>: verify …` line shape |
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
| `CapCause` | type | stable | Why the cap changed, as a `capRuling` ledger event carries it |
| `Action` | type | experimental | An action the scheduler owes |
| `HeldRerun` | type | experimental | A contention re-run held back |
| `listFeatures` | function | stable | Every work item of a project; an item whose `.kfw.json` is invalid is listed with `metaError`, never thrown |
| `findFeature` | function | stable | One work item by name; throws `AmbiguousFeatureError` when the name matches more than one folder |
| `AmbiguousFeatureError` | class | stable | The error `findFeature` throws on an ambiguous name; its message names the matching folders |
| `readFeatureMeta` | function | stable | An item folder's `.kfw.json`; throws an `Error` when the file is not valid JSON or its shape, feature or context name is invalid; returns `null` when the folder has no `.kfw.json`, and an fs error is rethrown as is |
| `executionContractHash` | function | stable | The contract fingerprint `approval.contractHash` is compared with |
| `Feature` | type | stable | A work item: name, `context`, stage, folder, `dir` and metadata; an item whose `.kfw.json` is invalid has `meta` null and `metaError` set |
| `FeatureMeta` | type | stable | The `.kfw.json` snapshot |
| `Approval` | type | stable | The approval block of the metadata |
| `Bypass` | type | stable | One recorded `--force` or `--skip-hooks` bypass |
| `Cancellation` | type | stable | The record of a cancelled item |
| `WorktreeRegistration` | type | stable | The item's worktree: path, branch, domain and port |
| `VerifyWaiver` | type | stable | The human's waiver of the stage verify |
| `ShipState` | type | stable | The delivery stamps of the metadata: PR published, auto-merge scheduled, merged, release and changelog |
| `Stage` | type | stable | A stage name |
| `WorkItemKind` | type | stable | `feature` or `bug` |
| `ApprovalStatus` | type | stable | The approval state in the metadata |
| `LegacyStageName` | type | stable | A stage name an earlier release wrote |
| `readStageRecords` | function | stable | The item's `loop/stage-verify.jsonl` records, in file order; a line that is not JSON or not a stage record is skipped without notice, so the last element is not the gate's latest record |
| `StageRecord` | type | stable | One stage-verify record |
| `StepOutcome` | type | stable | The outcome of one command in a stage-verify record |
| `ITEM_LOG_FILE` | constant | stable | `lifecycle.jsonl`, the lifecycle log's file name |
| `readItemLog` | function | stable | Reads and folds an item folder's lifecycle log; the folded values are not validated (see Trust and cost) |
| `foldItemLog` | function | stable | Folds lifecycle-log text into the stage and shared metadata; the folded values are not validated (see Trust and cost) |
| `sharedMeta` | function | stable | The metadata without `worktree`, the run-state keys of the removed `kf drive` and unknown keys, as the log records it; values are copied unchecked |
| `ItemRecord` | type | stable | One lifecycle record |
| `ItemOrigin` | type | stable | The machine and channel that wrote a lifecycle record |
| `ItemEvent` | type | stable | A lifecycle event name |
| `ItemState` | type | stable | The stage and shared metadata a fold gives |
| `FoldResult` | type | stable | What `foldItemLog` and `readItemLog` return |
| `SharedMeta` | type | stable | What `sharedMeta` returns |
