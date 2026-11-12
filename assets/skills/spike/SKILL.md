---
name: spike
description: Answer a question instead of changing the code, with no work item. Use for "can we…", "how long would…", "what does X return today" questions, for probing an API, a library or a setting, and for one-shot operations that land no code. Reports a recommendation, the sources and the exact commands run.
---

# Spike — a question, not a change

Plugin root: `${CLAUDE_PLUGIN_ROOT}` — resolve it to the path this skill was loaded from.

The output of a spike is an answer; anything built along the way is throwaway. Probing that only reads needs no nod from the user.

## Procedure

1. Open no work item: no `kf new`, no `.works/` file, no branch. The spike leaves nothing in the repository.
2. State in two sentences what you will probe, then start. Do not wait for a nod; read-only probing never waits for one.
3. Dispatch `Agent(kf:researcher)` for each question that research can answer (docs, APIs, versions, prior art, how an existing piece of code works), using the template in `${CLAUDE_PLUGIN_ROOT}/skills/flow/references/researcher-brief.md`. Probe the rest yourself, as cheaply as correctness allows.
4. Write throwaway code only in a scratch dir under `$CLAUDE_JOB_DIR/tmp` when that variable is set, otherwise under the OS temp dir (`mktemp -d`). Never write it into the repository.
5. Wait for the user's explicit "go" before any irreversible step: a delete, a publish, a setting flipped on a shared system, a write to a remote. Name the step and its effect when you ask.
6. Report a recommendation, the sources it rests on, and the exact commands you ran, so the user can repeat them.
7. When the answer turns into work, hand back to the flow skill (`Skill(kf:flow)`) to reclassify the request as bounded or architectural before any change is made.

## Report path

The researcher's report goes where the brief says: with no work item, `$CLAUDE_JOB_DIR/tmp/research-<slug>.md` when `$CLAUDE_JOB_DIR` is set, otherwise `research-<slug>.md` under the OS temp dir. A spike never writes a report under `.works/`; if the findings are worth keeping, say so and let the user decide where they go.
