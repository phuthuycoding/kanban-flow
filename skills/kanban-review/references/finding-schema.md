# Finding schema — one shape for every reviewer

Every reviewer the kanban skills dispatch — the whole-branch review in `kanban-review` at any tier, and the per-task review in `kanban-implement` — returns its findings in this shape, as a JSON array first and prose after. One schema, so the orchestrator can merge, dedup and verify them mechanically.

## Finding

| Field | Required | Meaning |
| --- | --- | --- |
| `dimension` | yes | `bugs` \| `security` \| `perf` \| `contracts` \| `intent` \| `quality`. `intent` judges the diff against the approved requirement and plan: intent not implemented, scope added, behaviour the requirement rules out. `quality` covers the AI-risk lens and rule violations that are none of the others. |
| `severity` | yes | `HIGH` \| `MEDIUM` \| `LOW` — the same three levels the review rules use. HIGH must be fixed before merge (security risk, data loss, crash, a requirement not met, a test that asserts nothing where the requirement needs one). MEDIUM should be fixed before merge (performance, maintainability, a weak test). LOW is a suggestion. |
| `title` | yes | Short label; the orchestrator dedups by `title + file`. |
| `issue` | yes | One sentence: what is wrong and why it matters. |
| `fix` | yes | A concrete recommendation. |
| `file` | recommended | Repo-relative path. |
| `line` | recommended | The line, or range, the finding anchors to. |
| `evidence` | required with `file` + `line` | One **verbatim** line of code copied from the file at or near `line`, without the diff's `+`/`-` marker. `scripts/verify-findings` matches it against the real file and refutes a finding whose quote does not exist. |

Example:

```json
[
  {"dimension":"bugs","severity":"HIGH","title":"catch swallows parse error","file":"src/cli/commands/stage.ts","line":"88","issue":"A JSON parse failure is caught and ignored, so a corrupt .kfw.json reads as an empty item.","fix":"Rethrow with the path as context or let it propagate.","evidence":"} catch {"}
]
```

## After the array, as prose

```
Declined: <item> — <why you cannot judge it>        (one per line, or none)
Deferred: <ledger line> — must-fix-before-merge | fine to leave   (whole-branch review only)
Examined: <what you read; what you did not>
Findings: <N HIGH, M MEDIUM, P LOW>
Shippable: YES | NO
```

`Shippable: NO` whenever a HIGH finding is open or a Deferred item is must-fix-before-merge.

## How the orchestrator uses it

1. Concatenate every reviewer's array (T2/T3 fan-out, or one per bundle).
2. Dedup by `title + file`, keeping the highest severity.
3. `bash scripts/verify-findings <root> < findings.json` → `kept` and `refuted`. Refuted findings are listed in the report under "refuted at verification" and do not count.
4. Rank kept findings HIGH → MEDIUM → LOW and copy them into the report's Findings table, one `FINDING-###` per row, Evidence = the verbatim quote, Required action = `fix`.
5. The report `status:` follows the gate semantics, not the reviewer's word: `PASS` only with zero open HIGH findings and every MEDIUM assessed against acceptance and the Definition of Done.
