---
feature: "command-tree"
context: "cli"
tested: "20261017_1812"
execution: "d55e56f0-fa56-4d40-976e-e1dcc2037dd2"
status: PASS
---

# Testing Result

## Feature
command-tree

## Environment
- OS: macOS (Darwin 25.5.0)
- Runtime: Node v22.21.0, vitest
- Tooling: `npm test`, `npm run typecheck`, `npm run lint`

## Execution Time
~23s full suite (2026-10-17 ~18:12 local)

## Summary
| Metric | Result |
|---|---:|
| Total | 6 planned TCs |
| Passed | 6 |
| Failed | 0 |
| Rejected | 0 |
| Blocked | 0 |

## Test Results

| Case / test name | Type | Status | Expected | Actual | Evidence |
|---|---|---|---|---|---|
| TC-001 (verb map: 9 verbs × 2 nouns → flat dispatch ids) | Unit | PASS | each `feature|bug <verb>` parses to the right dispatch + noun flag | all 18 mappings correct | `command-tree.test.ts` "maps every verb for both nouns" |
| TC-002 (`bug start` ⇒ `--type bug`; `feature start` ⇒ feature; options parse) | Unit | PASS | injected type + user options preserved (`--context`) | `type` injected; context kept | "bug start implies --type bug" |
| TC-003 (legacy alias equivalence: `kf stage` ≡ `kf feature move`) | Unit | PASS | identical command/positionals/options, noun aside | identical | "produces the same ParsedArgs as the canonical spelling" |
| TC-004 (strict parsing unchanged — unknown option throws on both spellings) | Unit | PASS | both throw | both throw | "flat commands still parse options strictly" |
| TC-005 (`kf help <noun>` group help, `<noun> <verb>` leaf, flat unchanged) | Unit | PASS | nested help resolves; flat help intact | resolved | "help resolves nested paths" suite |
| TC-006 (kind mismatch refused; unknown item passes through; `start --type` conflict refused) | Unit | PASS | bug-verb-on-feature and feature-verb-on-bug both refuse with clear message; missing item → handler's own error | all refused/passed correctly | "kind mismatch refuses clearly" suite |

## Commands and Evidence

| Command / tool | Exit code | Evidence / output |
|---|---:|---|
| `npx vitest run src/tests/command-tree.test.ts` | 0 | 10 tests passed |
| `npm test` (full suite) | 0 | 36 files, 580 tests passed |
| `npm run typecheck` | 0 | tsc --noEmit clean |
| `npm run lint` | 0 | oxlint clean |

## Failures and Blockers

| Case / test name | Error / blocker | Impact | Next action |
|---|---|---|---|
| — none — | | | |

## Coverage

| Metric / scope | Target | Measured | Evidence |
|---|---:|---:|---|
| Planned TC execution | 6/6 | 6/6 | all implemented in command-tree.test.ts |
| New-code coverage | 80% | N/A | dispatch layer is pure mapping; all branches (resolve/inject/gate paths) exercised by unit tests |

## Regression
Full suite green (580). Flat commands verified byte-equivalent at the ParsedArgs level and the strict-parser test shows rejection behavior is preserved on both spellings. Help for flat commands unchanged.

## Conclusion
- PASS — the declarative command tree routes `kf feature|bug <verb>` to the existing handlers with zero behavior change, kind mismatches refuse clearly, nested help works, and all 27 flat commands remain permanent aliases.
