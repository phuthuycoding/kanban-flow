---
name: brainstorm
description: 'Kanban Phase 1 — brainstorm the feature requirement with the user, create the feature via `kf new`, and author phase-1-spec-requirement.md with FR-### anchors. Use when a kanban feature is at the brainstorm stage, or right after "kanban {context} {feature}" starts a brand-new feature.'
---

# Kanban Phase 1 — Brainstorm (Human + Agent)

Arguments: `<context> <feature_name>`.

The user's idea is at its coarsest here. Your job is to convert a rough idea into a **precise, testable requirement** with `FR-###` anchors — everything downstream (UC, TC, traceability) hangs off them.

Brainstorming is **divergence then convergence**: first open the problem up from every useful angle (ideas, users, edge cases, alternatives), then shut it down into a bounded, agreed requirement. Do not rush. The quality of Phase 1 decides how many questions the rest of the pipeline has to re-ask.

**Run via orchestrator:** normally invoked by `kf:flow`. Call this skill directly when a feature is (or should be) at the `brainstorm` stage.

---

## 0. Classify the path, and say it out loud

`kf:flow` names a path before this skill runs; if you were called directly, name it now — "this looks bounded, so the spec will be a page and I skip the divergence framework" — so the user can override it:

- **Spike** — a question or a one-shot operation that lands no code. **Stop here: no `kf new`.** Hand off to `Skill(kf:spike)`, which owns the procedure. If the answer becomes work, classify again.
- **Bounded** — a change to a flow that already exists in this repository. Run sections 1, 3, 4 and 5; **skip section 2** (the frameworks). The spec is a page: the restated journey, one or two FRs, the Affected surfaces, a Test Strategy, acceptance criteria. Its Scope comes from the restated journey and the user's answers, since there is no synthesis. Every gate below still applies.
- **Architectural** — everything else. All sections.

One-way ratchet: if the bounded spec grows a second surface or a new subsystem mid-way, say so and step up to architectural; never the reverse.

## 1. Understand the challenge

Orientation before ideation. Cheap questions here prevent expensive ones later.

1. **Read the repository.** Structure, stack, tooling, data model, conventions. Reading code beats asking — never make the user explain what the code already answers.
2. **Ground the request.** Before your first question, verify every entity the idea names against its real definition — the file, command, table, field, endpoint or config key — spelled as the source spells it. A name the user used that the code does not have is your first question, not an assumption. Field-level detail waits for planning; here the names must be real.
3. **Read one similar existing feature** (if any) for house patterns.
   **Research before you ask.** When the idea names an external library, API, service or standard that the repository does not define, or asks how other tools do something (prior art), dispatch **`Agent(kf:researcher)`** with `${CLAUDE_PLUGIN_ROOT}/assets/shared/researcher-brief.md` (mode `web` or `prior-art`) before asking the user any question. Do not ask the user first and do not wait for a go-ahead: research triggers on need. The item does not exist yet, so the report goes to the brief's no-item location (`$CLAUDE_JOB_DIR/tmp`, else the OS temp dir); after `kf new` in section 3, copy it to `<item>/reviews/research-<slug>.md`, and cite each report in the spec under *Assumptions* or *Open Questions*. Without a web tool the researcher replies `BLOCKED`: say so in *Open Questions* instead of answering from memory.
4. **Restate the challenge.** In one or two sentences, play the user's idea back: *"You want X in order to achieve Y, in the context of Z — is that right?"*. Fix misunderstandings before generating ideas against the wrong target. Describe the real user journey — what they see and type — and have the user agree to it before any FR list or structural naming; the human decides whether the journey is right, and a spec written before that agreement is rework waiting to happen.
5. **If no `.works/` → `kf init --defaults`** (full bootstrap without prompts: config, seeded `.kf` overrides, `.gitignore`).

Rules of engagement:
- **Material ambiguity** (missing scope, unclear behavior, conflicting acceptance criteria) → ask **up to 3 focused questions**, then proceed. Each question names the decision it feeds.
- **Minor details** → make a reasonable assumption and record it in the spec under *Assumptions*.
- The user is the *brief*, not the implementer. Do not trouble them with mechanics.

---

## 2. Diverge — open the problem (framework phase)

Architectural path only — a bounded change skips this section. A `kanban` launch can arrive with the idea fully formed or as a vague half-thought. **If the requirement is not already crystal clear, run a brainstorming framework** to widen the view before committing to a shape.

Pick the framework that fits the situation. Ask yourself (or the user, if genuinely uncertain) which angle is weak:

| Angle you need | Framework |
|---|---|
| Challenge the premise / rebuild from fundamentals | **First Principles** |
| Improve / stretch an existing product or flow | **SCAMPER** |
| User-centric problem shaping | **Design Thinking** |
| New product / new market / launch narrative | **Working Backwards** |
| Diagnose *why* something is broken | **5 Whys** |
| Break a creative block / surface many options fast | **Rapid Fire** |

When ambiguity warrants divergence, run one suitable framework and record the outcome in the spec. For an already precise requirement, proceed to authoring and confirmation.

### Framework 1: First Principles Thinking

1. **Identify the problem** — what are we actually trying to solve?
2. **Break it down** — the fundamental truths/components that cannot be argued away.
3. **Question assumptions** — for every "we need X", ask *do we really? what if we...*.
4. **Rebuild** — if we started fresh with the truths as the only constraint, what would we build?

```
PROBLEM: [challenge]

CURRENT APPROACH:
- How it's typically done: ...
- Assumptions baked in: ...

FUNDAMENTAL TRUTHS:
1. [core requirement that cannot change]
2. [physical/logical constraint]
3. [user need at the deepest level]

QUESTIONED ASSUMPTIONS:
- "We need X" -> Do we really? What if...?
- "It must be Y" -> Why? Alternative...?

REBUILT SOLUTION:
- [the shape that survives]

WHAT CHANGES IN THE SPEC:
- Scope in / out decisions this surfed (only if it genuinely informs the requirement)
```

### Framework 2: SCAMPER

Apply each lens to the feature. Generate at least one idea per letter.

```
CHALLENGE: [feature/flow being designed]

[S] Substitute — other tech/approach/component?
[C] Combine — which features/systems can merge?
[A] Adapt — what's similar elsewhere, what can we copy across domains?
[M] Modify — bigger/smaller/faster/slower? exaggerate what?
[P] Put to other uses — who else could use this, for what?
[E] Eliminate — what can be removed without killing the value?
[R] Reverse — opposite ordering, roles, or flow?

TOP 3 IDEAS:
1. ... (why)
2. ... (why)
3. ... (why)

WHICH ONES LAND IN THE SPEC:
- [idea] -> FR/orientation; [idea] -> explicitly out of scope (recorded)
```

### Framework 3: Design Thinking

1. **Empathize** — who is the user, what is their current journey, what do they *really* need (not just what they say)?
2. **Define** — problem statement in the form: *"[User] needs [need] because [insight]"*.
3. **Ideate** — 10+ ideas, no judgment, quantity first, build on each other.
4. **Prototype** — the cheapest thing that validates the direction.
5. **Test** — what feedback do we need, what metric proves it works?

```
EMPATHIZE:
- User: [who]
- Pain points: [...]
- Current journey: [steps]

DEFINE:
- Problem statement: [user] needs [need] because [insight]
- How Might We: [question]

IDEATE (10+):
1..10+

PROTOTYPE:
- MVP concept: ...
- Cheapest validation: ...

TEST:
- Success metric: ...
- Feedback needed: ...
```

### Framework 4: Working Backwards (Amazon-style)

Start from the end experience and work back to what we must build.

1. **Press release** — announce the finished feature.
2. **FAQ** — answer the customer + internal questions.
3. **Customer experience** — the detailed user journey.
4. **Work back to requirements** — what must exist for that journey.

```
PRESS RELEASE:
- Headline: [name] helps [user] [benefit]
- Problem: [2-3 sentences]
- Solution: [2-3 sentences]
- How it works: [plain explanation]

FAQ:
- Q(A): what is it / how different / how to start / cost

REQUIREMENTS THAT MUST EXIST:
1. ... 2. ... 3. ...
```

### Framework 5: 5 Whys

Use when the feature exists to fix a *problem* whose true cause is unclear. Iterate "why" until the root cause surfaces (5 is the rule of thumb; stop early if a real cause appears).

```
PROBLEM: [initial symptom]

Why #1 -> Because: ...
Why #2 -> Because: ...
Why #3 -> Because: ...
Why #4 -> Because: ...
Why #5 -> Because: [root cause]

ROOT CAUSE: [summary]

WHAT THE FEATURE MUST ACTUALLY DO: [solution targeting the root cause, not the symptom]
```

### Framework 6: Rapid Fire

Generate 15+ options in one pass, no filtering during generation.

```
CHALLENGE: [feature]

IDEAS (15+):
1..15+

CATEGORIES:
- Quick wins / Big bets / Experiments / Parking lot

TOP 3 TO PURSUE:
1. ... (why)
2. ... (why)
3. ... (why)
```

### Synthesis (always, whichever framework)

End divergence by answering three questions in the spec's language:

```
IDEAS SURFACED: [what changed the shape]
SCOPE DECISION: [what's in, what's explicitly out — and why]
REMAINING BLIND SPOTS: [what we could not evaluate cheaply at Phase 1]
```

---

## 3. Create the feature

Check `kf list --json` first. If the feature already exists, resume its requirement; do not run `kf new` again. Feature and context names use letters, digits, hyphens or underscores and start with a letter or digit.

**Pick the context before you run `kf new`.** A project may declare the contexts it uses in `.kf/config.json`, and `kf new` refuses anything outside that list:

```bash
kf contexts --json   # declared: [...], restricted: true|false
```

- `restricted: true` — use one of the declared names, spelled exactly. `Auth` is refused next to `auth`, because accepting both is how a second docs tree appears.
- `restricted: false` — nothing is declared; any valid name works, and the `brief` field tells you how to propose a list. Show the proposal to the human; once they confirm it, write only the list they confirmed to `.kf/config.json` as `"contexts"` (the first entry is the default). Never write a list they have not confirmed. The edit dirties the checkout and makes `kf stage` skip its base fast-forward, so ask the human to commit it before the stage move.

If `kf new` refuses the name, it prints the nearest declared one. Take that suggestion or ask the human — do not invent a new context to get past the refusal, and do not add one to `.kf/config.json` on your own.

```bash
kf new {feature_name} --context {context}
```

Scaffolds `.works/brainstorm/{feature}_{ts}/` + metadata + seeded `phase-1-spec-requirement.md`.

Copy any research report saved earlier to `<item>/reviews/research-<slug>.md` now, before the spec cites it.

---

## 4. Author the requirement

Print the template and instructions:

```bash
kf instruct spec-requirement --change {feature_name}
```

Fill **every section** of `phase-1-spec-requirement.md`. Mapping from divergence to sections:

- **Objective / Problem Statement** — the restated challenge (sharpened by the framework).
- **Scope (in & out)** — the SCOPE DECISION from synthesis; on the bounded path, the restated journey and the user's answers. Explicit "out" items are valuable: they stop Phase 2-3 from drifting.
- **Affected surfaces** — every user-facing surface the change touches (README, docs site, landing page, CLI `-h`, examples, changelog, packaging, API reference), one bullet each, or the literal `N/A`. Each bullet is the bare surface name (`README.md`, not `README.md — new flag`): `kf validate` matches it as a lowercase substring of the plan. The spec cannot leave brainstorm without it. Ask the human when the surface list is ambiguous — they own what counts as user-facing.
- **Functional Requirements `FR-###`** — **the traceability anchor.** One behavior per FR, phrased so a test could pass/fail on it. Include the priority (must/should/could) and a note carrying any framework rationale.
- **Non-Functional Requirements** — performance, security, UX, accessibility, compliance.
- **Main Use Cases** — one line each with `UC-###` ids (full narratives live in Phase 2).
- **Constraints / Assumptions / Edge Cases / Open Questions** — edge cases should feel adversarial: empty states, concurrency, permissions, partial failure, boundary values.
- **Test Strategy** — onboard the user on how deep to test (this locks what Phase 2 must produce):
  - Ask: *"How far do you want this feature tested?"* with concrete options:
    - `unit` — unit tests only, for logic and state. The default for a pure backend or utility feature.
    - `unit+integration` — unit tests plus tests where the change meets another system, the database or an API. The default for an API or a datastore.
    - `full` — unit, integration and **UI/E2E** (Playwright, Cypress, Detox and so on). The default for anything with a user interface or a critical flow, such as a web todo list, a login or a checkout.
  - When the user picks `full`, ask how wide the UI coverage goes: *"UI tests for every flow, or only the critical ones?"* → `{test_level}: full`, `{ui_test_scope}: critical|all`.
  - Record it in the spec under the labels that template actually uses: the feature template has `Level`, `UI Tests`, `Tools` (the framework name and the file that runs it) and `Coverage Target` (80% by default); the bug template has `Test Level`, `Tools` and `Coverage Target`, and no `UI Tests`.
  - **Let the nature of the feature set the default.** Do not ask again when the answer is obvious: a CRUD API is `unit+integration`, an app with a UI is `full`. Ask only when you genuinely cannot decide.
- **Acceptance Criteria** — each `[ ]` must be independently verifiable by a human or a test. Under `full`, at least one criterion per FR must read as a UI action: what is clicked, what is typed, what appears on screen.

Set `status: pending` → `status: confirmed` in the spec frontmatter when the human signs off (Phase 1 ends on this confirmation). Write nothing under `docs/` here: the living docs are edited at review (`kf:review` step 2b), and a file in the main checkout would make `kf stage … planning` skip its base fast-forward.

```bash
kf status --change {feature_name}
```

The checklist reports content completion; human confirmation is still required before advancing.

---

## 5. Review the spec, then confirm with the human

**Self-review first**, with fresh eyes: placeholders or vague requirements; sections that contradict each other; a scope too wide for one implementation plan; a requirement that could be read two ways. Fix inline.

**Then dispatch `Agent(kf:spec-reviewer)` once**, `model: opus`, with a fresh context: the brief names the work item folder, carries a verbatim excerpt of the user's original request (in the brief or a file you write under the item folder; never only the Objective), names the git ref to ground names against and names a report file (`<item>/reviews/spec-review.md`). It reports only requirement gaps, untestable FRs or acceptance criteria, internal contradictions and ungrounded names — never new scope. Print `spec review ran on: <its model line>`; with no report, print `spec review: no report`. HIGH findings go into the confirmation ask below; the review never blocks on its own, the human does. When the runtime has no subagent tool, run the same four checks yourself and say so.

Present a tight summary (do not dump the whole file):

```text
FEATURE: {name}  ({context})
STATUS: pending

OBJECTIVE: {one line}

FR SUMMARY:
- FR-001 | must | {behavior}
- ...
UC SUMMARY:
- UC-001 {name}
- ...

ACCEPTANCE (sample):
- [ ] {criterion}

DECISIONS RECORDED:
- {scope decision / assumption}
- ...

SCOPE OUT (explicit):
- {item} — because {reason}

SPEC REVIEW (spec-reviewer, <model>): {n HIGH, n MEDIUM, n LOW}
- [HIGH] {finding} — {fixed | left for your call because ...}

Please confirm the requirement.
```

- On confirmation → set `status: confirmed`, run `kf stage {feature_name} planning`, then load kf:plan.
- If the user pushes back → update the spec, re-confirm. This is normal; the spec exists to absorb disagreement cheaply here, not in implementation.

---

## Done

The requirement is confirmed. Hand off to **Phase 2 — Planning**:

```text
Load the kf:plan skill and write the four plan artifacts (implementation-plan, use-case-specification, use-case-diagram, test-cases). The one-line use-case summaries and the FR/UC ids from phase-1-spec-requirement.md are the input — the full narratives are written in Phase 2, not carried over from Phase 1. Do not re-derive the ids from scratch.
```
