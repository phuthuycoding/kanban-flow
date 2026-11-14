# item-lifecycle-log

## Purpose
Keep a work item's history in a file that only grows. `.kfw.json` is a snapshot that every lifecycle command overwrites, and the stage is only the folder's position; the lifecycle log records each change as it happens, so the history can be read and the snapshot rebuilt from it. It is the base a remote can replicate (#182).

## Current behaviour
- **One log per item.** Every work item folder holds `lifecycle.jsonl`, one JSON record per line. kf only appends to it. `.kfw.json` stays the snapshot every command reads; nothing reads the log in its place.
- **A record.** `v` (1), `at` (ISO-8601 UTC with milliseconds), `actor` (git `user.name`, else `$USER`, else `$USERNAME`, else `human`), `origin` (`{ machine, via: "cli" }`), `event`, then `from` and `stage` when the stage changed, `set` (each shared metadata field the change set, with its whole new value), `unset` (the fields it removed) and `derived: true` on `opened` and `reconciled`.
- **Who writes it.** The code that makes the change, inside the item lock, once the change has succeeded: `kf new` writes `created` (before its brainstorm hook; it takes no lock, the folder was just created); `kf stage` and the move of `kf approve` write `stage`; `kf approve` writes `approved` first, and `approval-restored` when its move is refused and kf puts the previous approval back; `kf cancel` writes `cancelled`; `kf verify --stage --waive` writes `waiver`; `kf issues create` and `kf issues link` write `linked`; the close into `done` writes `delivered`, and so does a later close of a done item that changes a field; `kf status --all` proving a docs branch landed writes `docs`.
- **What never enters it.** The `worktree` block of `.kfw.json`, and any host name, home directory or project path: the one metadata value that holds a path, the hook a `--skip-hooks` bypass names, is recorded as `hook:<file name>`. `kf worktree create` and `kf worktree remove` write no record.
- **The id.** `kf new` gives the item a uuid, kept in `.kfw.json` as `id` and carried by the log; `kf status --change <feature> --json` prints it. An item of an earlier release gets one at its first lifecycle write. A `.kfw.json` that lost its `id` gets back the one its log holds, at the next write or `kf doctor --fix`; a new uuid is minted only when the log holds none.
- **The machine.** `origin.machine` is a random uuid kf creates once in `~/.kf/machine-id`; it is `unknown` when that file cannot be read or created, or holds no uuid.
- **The fold.** Reading the records in order gives the item's stage and its shared metadata: every metadata field kf validates except `worktree`, with a skipped hook named by its file name. The fold applies only those shared keys from a record's `set` and `unset`: a `worktree`, `__proto__` or unknown key in a record changes nothing, so a log written elsewhere cannot add a machine-local field or swap the result's prototype. For an up-to-date log that equals the item's stage and the same projection of `.kfw.json`. One unreadable line refuses the whole log, and so does a log that never sets `schema`, `feature`, `context` and `created` as strings: the reason names the first missing key. A refused log is never appended to, gives no id, and `kf doctor` reports it as one it cannot read.
- **Catching up.** Before a lifecycle write appends its own record, kf compares the fold with the item as it was before the change, read inside the lock. No log: an `opened` record with that earlier stage and metadata (and the item's new id when it had none). A log that is behind — a `.kfw.json` edited by hand, a folder moved by hand, a record lost to a failed write — a `reconciled` record with the fields that differ. The command's own record follows.
- **Refusals and rollbacks.** A refused command and a move whose rename or stamp fails leave the log byte-identical; an id stamped for the move is rolled back with it. A write that changes no shared field and no stage appends no record of its own.
- **Failures never change a command.** When the log cannot be read or written the command keeps its exit code and its effect and prints one line on stderr, `⚠ lifecycle log not written for '<feature>': <path>: <reason>`. A log with an unreadable line is never appended to.
- **`kf doctor`** warns for an item whose log cannot be read or is behind its `.kfw.json`, naming the line or the fields, and stays silent for an item with no log; the warnings never change its verdict. `kf doctor --fix` opens a log for every item that has none and reconciles one that is behind, stamping a missing id while keeping the file's indentation. It leaves alone a log it cannot read and an item that still holds the run state of the removed `kf drive`, and reports an item it cannot repair as an error.
- **Not protected against rewriting.** The log lives in the item folder, which the agent can write; it protects against lost history, not against a file changed on purpose.

## Use cases
- UC-001 Record a lifecycle change as it happens — each command appends the record of the change it made, and nothing on a refusal or a rollback.
- UC-002 Rebuild an item's metadata and stage from its log — the fold of an up-to-date log equals the stage and the shared metadata.
- UC-003 Bring an item's log up to date when it is missing or behind — `opened` or `reconciled` precedes the command's own record.
- UC-004 See and repair a log that disagrees, in kf doctor — a warning without `--fix`, a repair with it.

## Surfaces
- `src/workflow/item-log.ts` (`ITEM_LOG_FILE`, `ItemRecord`, `sharedMeta`, `foldItemLog`, `readItemLog`, `syncItemLog`, `recordChange`), `src/shared/machine.ts` (`machineId`), `src/shared/actor.ts` (`detectReviewer`)
- `src/workflow/features.ts` (`FeatureMeta.id`, `updateFeatureMeta` with an event), `src/workflow/transition.ts`, `src/workflow/cancel.ts`, `src/workflow/archive.ts`, `src/cli/commands/new.ts`, `approve.ts`, `verify.ts`, `issues.ts`, `inspect.ts`
- `kf doctor` (`src/project/doctor-item-log.ts`, `src/cli/args.ts`), `kf status --json` (`src/workflow/status.ts`)
- `docs/workflow/artifacts.md#the-lifecycle-log-itemlifecyclejsonl`, `docs/workflow/cli-reference.md`, README.md, CHANGELOG.md

## History
- 20261113_0950 — item-ledger: created — an append-only `lifecycle.jsonl` per work item, the item `id`, the machine id, the catch-up records, a fold that applies only the shared keys, and the `kf doctor` check and repair (#183); 20261114_0223 — ledger-lib: the fold refuses a log without the required metadata keys (#184)
