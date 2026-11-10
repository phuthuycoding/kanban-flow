# Backlog

Things known to be soft, or wanted next, that are not yet a GitHub issue. No mandatory order — each item records its context, why it is held, and the condition that would start it. Finished work lives in [CHANGELOG.md](CHANGELOG.md) and the git history, not here.

## Tracked as GitHub issues

- **#144 EPIC: verifiable loop** — kf gates on its own evidence; the session stays the controller. Open items: #145 verify-evidence, #146 verify-tiers, #147 testing-slim. #145 replaces the old "manual testing reports are taken on trust" gap.
- **#139** Workflow gaps found while fixing exit-code-cell.
- **#131** `kf doctor`: warn about unknown top-level keys in `.kf/config.json`.

## Held — do not build for a need that has not appeared

- [ ] **Secret scan: an entropy check for `KEY=value`.** The known-shape half shipped (JWT, Slack and Discord webhooks, connection strings). An entropy check changes the scanner from "recognise a known shape" to "guess statistically" and would fire on commit hashes, base64 images and checksums; without a real corpus to calibrate the threshold, people learn to `--force` past the gate, which is worse than not having it. **Condition to start:** the first real miss an entropy check would have caught.
- [ ] **`kf supersede <old> --by <new>`.** A structured link between work items that replace one another. `kf cancel --reason "superseded by X"` already records it in words, and nothing reads a structured link today. **Condition to start:** something that walks the replacement chain (a report, the dashboard).
- [ ] **Dashboard upgrade.** Burndown per context, lead time per stage, the longest-stuck items. A wish list, not a need anyone has hit. **Condition to start:** a specific question the current dashboard cannot answer.
- [ ] **CONTRIBUTING, an issue template, a code of conduct.** **Condition to start:** someone outside shows interest in contributing.

## Needs the owner

- [ ] **Record a demo GIF for the README** — one real `kf new → approve → stage` cycle, so a reader sees a gate refuse rather than only reading about it. Needs screen capture.

## Known by design — not bugs

- **`docs/requirement/cli/{open-source-ready,workflow-hardening}.md` differ from their sealed sources under `.works/done/`.** The canonical copies carry the new repo name; the sealed specs keep the text as approved. Editing a sealed spec breaks its approval fingerprint, and `kf approve` cannot run on a done item, so both would stay `approval_changed` for good. Consequence: `kf archive` on those two items reports `Canonical docs have changed since archive`. **Do not clear it with `--force`** — that overwrites the canonical copies with the old repo name.

## Dropped in this cleanup (2026-11-09)

Removed because the runtime they belonged to was retired with `kf drive` / `kf run` (drive-retire, #115): the async inbox bridge between agents, `kf run --task` for ad-hoc work, verifying `resume` for the gemini/opencode runner presets, and running `harness.stages` with two roles for real. The in-session loop (`kf next` / `kf record`) replaced that design; reopen any of them as a GitHub issue if the need reappears against the current harness.
