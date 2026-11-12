# config-layers

## Purpose
Let a person set kf defaults once — for every project on the machine (global) or for every repository under a parent folder (workspace) — while the project's committed `.kf/config.json` keeps the last word.

## Current behaviour
- **Three layers.** kf reads `~/.kf/config.json` (global), the nearest `.kf/workspace.json` above the project root (workspace) and `<project>/.kf/config.json` (project). The workspace walk starts at the project root's parent and goes up to the filesystem root. It skips the home directory and uses only the first file it finds. A missing file contributes nothing.
- **Precedence.** project > workspace > global. Plain objects merge key by key. An array or a scalar comes whole from the nearest layer that sets it. A key whose parsed value is `undefined` counts as not set. Every consumer of `readProjectConfig` sees the merged config.
- **Where each key applies.** `reviewer`, `agents` and `skills` apply at every layer. Every other key applies at the project layer only: `schema`, `created`, `repository`, `project`, `contexts`, `defaultContext`, `stacks`, `harness`, `worktree` and the legacy `stack` and `ship`. The table lives in one place (`KEY_LAYERS`), shared by the reader, `kf config set` and `kf doctor`.
- **Keys that do not apply.** A key in a global or workspace file that does not apply there, or that kf does not know, is not applied and not validated. kf prints `kf: <path>: not applied at the <layer> layer: <keys>` on stderr, at most once per file per process, and the command still runs.
- **Validation.** The applied keys are validated by the project's own rules. An invalid global or workspace file (bad JSON, not an object, a bad `reviewer`/`agents`/`skills` value) fails the command with an error naming that file. An unreadable file is an error, not a missing one: the error names the file and keeps the fs error code.
- **Project at home.** When the project root is the home directory, `~/.kf/config.json` is the project file. It is read once, as the project layer, and there is no global layer.
- **Writers stay project-only.** `kf init` (including `--minimal`), onboarding (`saveConfig`, `bootstrapDefaults`) and `kf doctor --fix` take their write decisions against the project file alone (`readProjectFileConfig`). `saveConfig` writes `reviewer`, `agents` or `skills` only when the project file already has that key, when no global or workspace layer supplies it, or when the answer differs from the inherited value. Onboarding prompts offer the effective values as defaults, so accepting one leaves that key out of the committed config (a human decision during review of #176, replacing the requirement's Out of Scope line that kept init prompts unseeded). `kf init --minimal` installs skills at the effective scope for the effective agents.
- **`kf config show [--json]`** prints the effective config, each leaf with its source layer (arrays are leaves), plus the paths of the layer files found. `--global` / `--workspace` print only that file, marking each key that does not apply there as `not applied`.
- **`kf config get <key>`** prints one value by dotted path: scalars raw, objects and arrays as JSON. With `--global` / `--workspace` it reads only that layer. An unset key exits 1 with `<key> is not set.`.
- **`kf config set <key> <value>`** writes one value by dotted path to the project file, or to the layer named by `--global` / `--workspace`.
  - The value is parsed as JSON when it parses, else taken as a string.
  - It refuses, and writes nothing, when:
    - the top-level key is not a kf config key, including the legacy `ship` and `stack` (`"<key>" is not a kf config key`);
    - the key does not apply at that layer (`"<key>" applies at the project layer only`);
    - the target file is already invalid;
    - a non-object sits in the path;
    - the result fails validation.
  - The write is atomic. Only the changed top-level member is re-serialised; every other member keeps its value text and order (the `serializeConfigPreserving` guarantee).
  - `--global` creates `~/.kf/config.json` when it is missing. When the project root is home, it writes the project file under project rules.
  - `--workspace` writes the nearest workspace file, or creates `.kf/workspace.json` in `--workspace-dir` or else in the project root's parent. It refuses three targets:
    - the home directory;
    - a directory that is not an ancestor of the project;
    - a directory that a workspace file between it and the project would shadow.
    A workspace file farther up does not block it.
  - Outside a project, only `--global` works.
- **`kf doctor`** lists the active layer files (`Config layers:` and `--json` `configLayers`). It reports an invalid layer file as an ERROR naming its path, and each key not applied as a WARNING naming the file and the key. Its checks of `.kf/config.json` read the project file alone, and `--fix` never edits a global or workspace file. When the project file is missing and a layer file is invalid, `--fix` writes no defaults and reports the layer error instead.
- **Not layered.** Worktrees follow the repository: `worktree` is project-only. Machine proxy and DNS settings stay in `~/.config/kanban-flow/config.json`.

## Use cases
- UC-001 Inherit global defaults in a project — a `reviewer`/`agents`/`skills` value in `~/.kf/config.json` reaches every consumer unless the project sets it.
- UC-002 Share settings across repositories through a workspace file — the nearest `.kf/workspace.json` applies between global and project.
- UC-003 Inspect the effective config and its sources — `kf config show/get` and `kf doctor`.
- UC-004 Write a value to a chosen layer — `kf config set` with `--global`, `--workspace` and `--workspace-dir`.

## Surfaces
- `src/project/config-layers.ts` (`KEY_LAYERS`, `readConfigLayers`, `findWorkspaceConfigPath`, `globalConfigPath`), `src/project/config.ts` (`readProjectConfig`, `readProjectFileConfig`)
- `kf config` (`src/cli/commands/config.ts`, `src/cli/args.ts`), `kf doctor` (`src/project/doctor.ts`)
- `docs/workflow/cli-reference.md#config-layers`, README.md, CHANGELOG.md

## History
- 20261112_1230 — layered-config: created — global `~/.kf/config.json` and workspace `.kf/workspace.json` layers for `reviewer`, `agents`, `skills`; `kf config show/get/set`; doctor layer findings (#176)
