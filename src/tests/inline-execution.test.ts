import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { ARTIFACTS, METADATA_FILE } from "../workflow/schema.js";
import { LEDGER_SHAPES, parseLedger } from "../workflow/loop-stats.js";
import type { ParsedArgs } from "../cli/args.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const PLAN = () => read("skills", "plan", "SKILL.md");
const IMPLEMENT = () => read("skills", "implement", "SKILL.md");
const TASK_LOOP = () => read("skills", "implement", "references", "task-loop.md");
/** Both files that carry the implement-side rules; each rule may sit in either. */
const IMPLEMENT_SIDE = () => `${IMPLEMENT()}\n${TASK_LOOP()}`;

describe("the plan skill's execution mode per wave", () => {
  it("reads the task graph with kf tasks <f> --graph", () => {
    expect(PLAN()).toContain("kf tasks <f> --graph");
  });

  it("writes an inline Execution line for a wave of one task", () => {
    expect(PLAN()).toContain("Execution: wave <w> inline");
  });

  it("writes a parallel Execution line whose N is the largest non-overlapping set of the wave, with no clamp", () => {
    const text = PLAN();
    expect(text).toContain("Execution: wave <w> parallel, <N> developers");
    expect(text).not.toContain("min(wave width, 4)");
    expect(text).toMatch(/N = the largest set of the wave's tasks whose Files do not overlap/);
  });

  it("states in the approval summary that the developer cap starts at min(2, `harness.developers.max`) and scales itself", () => {
    const text = PLAN();
    expect(text).toContain("min(2, `harness.developers.max`)");
    expect(text).toMatch(/scales itself/i);
  });

  it("states the Execution lines in the approval summary", () => {
    const text = PLAN();
    const summary = /approval summary[^\n]*Execution|Execution[^\n]*approval summary/i;
    expect(text).toMatch(summary);
  });
});

describe("the plan skill's placement of the Execution lines", () => {
  it("puts the Execution lines under Task Breakdown, after the table, and does not special-case an all-inline plan", () => {
    const text = PLAN();
    expect(text).toMatch(/under Task Breakdown[^\n]*after the table/i);
    expect(text).not.toMatch(/inline end to end/i);
  });
});

describe("the harness doc on the execution mode", () => {
  it("states signature drift with a Ruling and test-writer re-dispatch, and large diffs", () => {
    const text = read("docs", "workflow", "harness.md");
    expect(text).toMatch(/signature drift[^\n]*`?Ruling:`?[^\n]*re-dispatch|re-dispatch[^\n]*signature drift/i);
    expect(text).toMatch(/large diffs/i);
  });
});

describe("the implement skill and task loop on the inline developer seat", () => {
  it("has the controller fill the developer seat inline and ledger the Note line", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toContain("Note TASK-NNN: developer seat inline");
    expect(text).toMatch(/controller fills the developer seat/i);
  });

  it("keeps the developer dispatched and developer done lines for an inline seat", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/inline[^\n]*developer dispatched[^\n]*developer done|developer dispatched[^\n]*developer done[^\n]*inline/i);
  });

  it("keeps test-writers running ahead for the next 4 tasks in an inline wave", () => {
    // The ahead-for-4 rule already exists for parallel waves; this case needs it stated for the inline mode.
    expect(IMPLEMENT_SIDE()).toMatch(/inline[^\n]*test-writers?[^\n]*(ahead|next 4 tasks)|test-writers?[^\n]*(ahead|next 4 tasks)[^\n]*inline/i);
  });

  it("keeps the code-reviewer an independent agent that never reviews the controller's own task", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/independent (agent|code-reviewer)/i);
    expect(text).toMatch(/never reviews its own task/i);
  });

  it("does not commit task N+1 before the review of task N is back", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/does not commit (task )?N\+1 until N's review is back/i);
    expect(text).toMatch(/HIGH and MEDIUM findings first/i);
  });

  it("ledgers a Ruling on signature drift and re-dispatches the dependent test-writers", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/signature drift/i);
    expect(text).toMatch(/signature drift[^\n]*`?Ruling:`?[^\n]*re-dispatch|re-dispatch[^\n]*signature drift/i);
    expect(text).toMatch(/signature drift[^\n]*never edits their tests/i);
  });

  it("resumes an open inline task in the controller and never spawns a developer for it", () => {
    const text = IMPLEMENT();
    expect(text).toMatch(/open inline task[^\n]*resumed by the controller[^\n]*never spawns? a developer/i);
    expect(text).toMatch(/fix rounds? of an inline task run inline/i);
  });

  it("names the inline exception inside the Seats, in this order paragraph", () => {
    const text = IMPLEMENT();
    const start = text.indexOf("**Seats, in this order.**");
    expect(start, "Seats paragraph").toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const end = rest.search(/\n\s*\n/);
    const paragraph = end === -1 ? rest : rest.slice(0, end);
    expect(paragraph).toMatch(/in an inline wave[^\n]*controller fills the developer seat/i);
  });

  it("defines a chain as consecutive tasks in inline waves and rules large diffs with a Ruling", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/chain[^\n]*consecutive tasks in inline waves/i);
    expect(text).toMatch(/large diffs[^\n]*`?Ruling:`?|`?Ruling:`?[^\n]*large diffs/i);
  });

  it("has the chain subagent write per-task developer lines and resumes that same subagent", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/chain subagent[^\n]*developer dispatched[^\n]*developer done/i);
    expect(text).toMatch(/resum\w* that same subagent/i);
  });

  it("lets the inline resume rule yield to a chain Ruling and sends fix rounds to the chain subagent", () => {
    const text = IMPLEMENT();
    expect(text).toMatch(/unless a chain `?Ruling:`? names a chain subagent/i);
    expect(text).toMatch(/fix rounds of an inline task run inline, or in the chain subagent its `?Ruling:`? names/i);
  });

  it("writes each chain task's developer dispatched at the hand-over, never ahead of it", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/writes each chain task's `?developer dispatched`? when it hands that task over/i);
    expect(text).toMatch(/never ahead of the hand-over/i);
  });

  it("carves the inline task out of the generic developer re-dispatch and dispatch steps", () => {
    const text = IMPLEMENT();
    expect(text).toContain("(except an inline task, which step 4 resumes)");
    expect(text).toMatch(/^3\. No `developer dispatched` → except an inline task \(step 4\)/m);
  });

  it("starts an unstarted inline task in the controller, or hands it to the chain subagent at dispatch", () => {
    const step3 = IMPLEMENT().split("\n").find((l) => l.startsWith("3. No `developer dispatched`"));
    expect(step3, "resume step 3").toBeDefined();
    expect(step3).toMatch(/An inline task not yet started is started by the controller/);
    expect(step3).toMatch(/hands the task to that subagent and writes `developer dispatched` at the hand-over/);
  });

  it("finishes a started inline task in the controller, or resumes the chain subagent and ledgers its report", () => {
    const step4 = IMPLEMENT().split("\n").find((l) => l.startsWith("4. `developer dispatched` without"));
    expect(step4, "resume step 4").toBeDefined();
    expect(step4).toMatch(/the controller inspects the worktree diff, finishes, commits and ledgers `developer done`/);
    expect(step4).toMatch(/chain `Ruling:`[^\n]*the controller resumes that subagent and ledgers `developer done` when it reports/);
  });

  it("starts task N+1 only after N's review when their Files overlap", () => {
    expect(IMPLEMENT_SIDE()).toMatch(/N\+1's Files overlap N's[^\n]*N\+1 starts only after N's review/i);
  });

  it("uses one resumed developer subagent for more than 5 inline tasks", () => {
    const text = IMPLEMENT_SIDE();
    expect(text).toMatch(/more than 5 inline tasks/i);
    expect(text).toMatch(/one (developer )?subagent resumed|one resumed developer subagent|resumed for the whole chain/i);
  });
});

const TABLE_HEADER = "| Task | Description | Area | Dependencies | Expected output | FR / UC references | Role | Files |\n|---|---|---|---|---|---|---|---|";
const INLINE_LEDGER = [
  "# Task loop ledger — inline",
  "TASK-001: developer dispatched model=inline @ 2026-11-02T09:00:00Z",
  "Note TASK-001: developer seat inline @ 2026-11-02T09:00:00Z",
  "TASK-001: developer done status=DONE @ 2026-11-02T09:20:00Z",
  "TASK-001: code-reviewer dispatched model=sonnet @ 2026-11-02T09:21:00Z",
  "TASK-001: code-reviewer done status=clean @ 2026-11-02T09:27:00Z",
  "TASK-001: complete (commits a1b2c3d, review clean) @ 2026-11-02T09:28:00Z",
  "",
].join("\n");

let root: string;

beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), "kf-inline-exec-")));
  ensureWorksStructure(root);
  await mkdir(join(root, ".kf"), { recursive: true });
  await writeFile(join(root, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20261102_0900", defaultContext: "app" }));
  const dir = join(root, ".works", "implementation", "inl_20261102_0900");
  await mkdir(join(dir, "loop"), { recursive: true });
  await writeFile(join(dir, METADATA_FILE), JSON.stringify({ schema: "kanban-flow", feature: "inl", context: "app", created: "20261102_0900" }));
  const row = "| TASK-001 | Do TASK-001 | Core | - | Done | FR-001 / UC-001 | coder | src/TASK-001.ts |";
  await writeFile(join(dir, ARTIFACTS["implementation-plan"].file), `# Implementation Plan\nUC-001: Create a task\n\n## Task Breakdown\n\n${TABLE_HEADER}\n${row}\n`);
  await writeFile(join(dir, "loop", "progress.md"), INLINE_LEDGER);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the inline developer ledger line", () => {
  it("is named with model=inline in the implement skill's Inline waves ledger rule", () => {
    const rule = IMPLEMENT().split("\n").find((l) => l.startsWith("1. **Ledger.**"));
    expect(rule, "Inline waves rule 1").toBeDefined();
    expect(rule).toContain("model=inline");
  });

  it("is named with model=inline in the task loop's ledger section", () => {
    const text = TASK_LOOP();
    const start = text.search(/^#+ The ledger/m);
    expect(start, "ledger section").toBeGreaterThanOrEqual(0);
    expect(text.slice(start)).toContain("model=inline");
  });

  it("parses as a developer dispatched line under the real ledger grammar", () => {
    const parsed = parseLedger("# Task loop ledger — x\nTASK-001: developer dispatched model=inline @ 2026-11-02T09:00:00Z\n");
    const out = JSON.stringify(parsed);
    expect(out).toContain("model");
    expect(out).toContain("inline");
    expect(LEDGER_SHAPES.dispatched.test("TASK-001: developer dispatched model=inline")).toBe(true);
  });
});

describe("kf loop-stats on a ledger with an inline developer seat", () => {
  it("counts the developer interval and leaves the Note line out of the unparsed lines", async () => {
    const { cmdLoopStats } = await import("../cli/commands/loop-stats.js");
    const args: ParsedArgs = { command: "loop-stats", positionals: ["inl"], options: { json: true } };
    const res = await cmdLoopStats(args, root);
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout) as { seats: Record<string, { count: number; sum: number }>; unparsed: number[]; orphans: number[] };
    expect(out.seats.developer).toMatchObject({ count: 1, sum: 20 });
    expect(out.seats["code-reviewer"]).toMatchObject({ count: 1, sum: 6 });
    expect(out.unparsed).toEqual([]);
    expect(out.orphans).toEqual([]);
  });
});
