import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { parseLedger, TS_SUFFIX } from "../workflow/loop-stats.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const implement = () => read("skills", "kanban-implement", "SKILL.md");
const taskLoop = () => read("skills", "kanban-implement", "references", "task-loop.md");
const travel = () => read("skills", "travel", "SKILL.md");
const estimation = () => read("skills", "travel", "references", "estimation.md");

/** The text between the first `from` and the next `to` after it (to the end when `to` is absent). */
function slice(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(to, start + from.length);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

const ledgerSection = () => slice(taskLoop(), "\n## The ledger", "\n## ");
const finalSection = () => slice(implement(), "\n## 4.", "\n## References");

const paragraphs = (text: string) => text.split(/\n\s*\n/);
const paragraphWith = (text: string, phrase: string) => {
  const found = paragraphs(text).find((p) => p.includes(phrase));
  expect(found, phrase).toBeDefined();
  return found as string;
};
const linesWith = (text: string, phrase: string) => text.split("\n").filter((l) => l.includes(phrase));

/** The body lines of the single ```ledger-example fence in the ledger section. */
function ledgerExample(): string[] {
  const blocks = [...ledgerSection().matchAll(/```ledger-example\n([\s\S]*?)```/g)];
  expect(blocks, "one ```ledger-example block").toHaveLength(1);
  return blocks[0][1].split("\n").filter((l) => l.trim() !== "");
}

const SHAPE_ORDER = ["dispatched", "done", "verifyStarted", "verifyDone", "developerWaits", "fixQueued", "fixRound", "cascadeOwed", "complete"];

// The grammar a line must follow for kf loop-stats to read it, verbatim from the requirement.
const GRAMMAR = [
  "TASK-NNN: <seat> dispatched model=<model>[ round=<R>][ cascade=<sha7>] @ <ts>",
  "TASK-NNN: <seat> done status=<STATUS> @ <ts>",
  "TASK-NNN: verify started @ <ts>",
  "TASK-NNN: verify done exit=<n> @ <ts>",
  "TASK-NNN: developer waits — <reason> @ <ts>",
  "TASK-NNN: fix queued — developer TASK-MMM in flight @ <ts>",
  "TASK-NNN: fix round <R>/5 (…) @ <ts>",
  "TASK-NNN: cascade re-review owed — after <sha7> of TASK-MMM @ <ts>",
  "TASK-NNN: complete (…) @ <ts>",
];

/** A commit range in a ledger commit field — the form commit lists replace. */
const COMMIT_RANGE = /commits [^\s,;)]+\.\.[^\s,;)]+/;

// A pre-feature ledger excerpt (drive-retire): no suffixes, free-form seat lines, a commit range,
// and "fix round" in lines that are not fix rounds — so counting the phrase over-counts rounds.
const PRE_FEATURE_LEDGER = `# Task loop ledger — drive-retire — plan: /tmp/plan.md
TASK-002: base 4ad7c81
TASK-002: test-writer dispatched (stand-in: general-purpose, opus)
TASK-002: tests written (stand-in: general-purpose, opus) — 20 tests in src/tests/drive-retired.test.ts, 19 fail for the right reason
Ruling: src/cli/tree.ts stays untouched — buildCommandTree skips a verb whose command spec is gone — cost if wrong: a dead VERB_DISPATCH row
TASK-002: minor (deferred): dead VERB_DISPATCH run row in src/cli/tree.ts:46 once the run command is gone
TASK-002: test hashes src/tests/drive-retired.test.ts=72d245a130481dcd4de1129b37d039ebf1371023
TASK-002: developer DONE_WITH_CONCERNS (stand-in: general-purpose, opus) — commit 4e4b384; test hashes match; kf verify --task TASK-002 --base 4ad7c81 → exit 0
TASK-002: review r0 (code-reviewer, opus): spec ✅; 1 MEDIUM (drive-retired.test.ts:40 rebuilds dist mid-suite) → fix round 1 to the test-writer
TASK-002: test hashes src/tests/drive-retired.test.ts=397782f2aeb576f4ac875d49471322d7565b52e8 (fix round 1)
TASK-002: fix round 1/5 (1 addressed, 0 open — mid-suite build dropped; commits 4e4b384..b601fbf)
TASK-002: kf verify --task TASK-002 --base 4ad7c81 → exit 0
TASK-002: complete (commits 4ad7c81..b601fbf, review clean; stand-in seats: general-purpose)
`;

// The same excerpt in the timestamped grammar: seat lines, one suffix per line, commit lists.
const REWRITTEN_LEDGER = `# Task loop ledger — drive-retire — plan: /tmp/plan.md
TASK-002: base 4ad7c81 @ 2026-11-01T10:40:00+07:00
TASK-002: test-writer dispatched model=opus @ 2026-11-01T10:40:12+07:00
TASK-002: test-writer done status=DONE @ 2026-11-01T10:52:30+07:00
Ruling: src/cli/tree.ts stays untouched — buildCommandTree skips a verb whose command spec is gone — cost if wrong: a dead VERB_DISPATCH row @ 2026-11-01T10:53:01+07:00
TASK-002: minor (deferred): dead VERB_DISPATCH run row in src/cli/tree.ts:46 once the run command is gone @ 2026-11-01T10:53:20+07:00
TASK-002: test hashes src/tests/drive-retired.test.ts=72d245a130481dcd4de1129b37d039ebf1371023 @ 2026-11-01T10:53:40+07:00
TASK-002: developer dispatched model=opus @ 2026-11-01T10:54:00+07:00
TASK-002: developer done status=DONE_WITH_CONCERNS @ 2026-11-01T11:20:45+07:00
TASK-002: verify started @ 2026-11-01T11:21:00+07:00
TASK-002: code-reviewer dispatched model=opus @ 2026-11-01T11:21:02+07:00
TASK-002: verify done exit=0 @ 2026-11-01T11:22:10+07:00
TASK-002: code-reviewer done status=findings @ 2026-11-01T11:35:00+07:00
TASK-002: test-writer dispatched model=opus round=1 @ 2026-11-01T11:35:30+07:00
TASK-002: test-writer done status=DONE @ 2026-11-01T11:41:00+07:00
TASK-002: test hashes src/tests/drive-retired.test.ts=397782f2aeb576f4ac875d49471322d7565b52e8 @ 2026-11-01T11:41:20+07:00
TASK-002: fix round 1/5 (1 addressed, 0 open — mid-suite build dropped; commits b601fbf) @ 2026-11-01T11:41:30+07:00
TASK-002: verify started @ 2026-11-01T11:41:40+07:00
TASK-002: code-reviewer dispatched model=opus round=1 @ 2026-11-01T11:41:42+07:00
TASK-002: verify done exit=0 @ 2026-11-01T11:42:50+07:00
TASK-002: code-reviewer done status=clean @ 2026-11-01T11:48:00+07:00
TASK-002: complete (commits 4e4b384,b601fbf, review clean) @ 2026-11-01T11:48:10+07:00
`;

describe("the ledger grammar in task-loop.md", () => {
  it("writes the nine timestamped line shapes once, with the seats a line may name", () => {
    const section = ledgerSection();
    for (const shape of GRAMMAR) expect(section, shape).toContain(shape);
    expect(section).toContain("`<seat>` is one of `test-writer`, `developer`, `automation-writer`, `code-reviewer`");
  });

  it("gives one example per shape, each parsed by kf loop-stats into that shape, then a ruling and a hashes line read as timed notes", () => {
    const example = ledgerExample();
    expect(example).toHaveLength(11);
    const parsed = parseLedger(`# header\n${example.join("\n")}`).lines;
    expect(parsed).toHaveLength(11);
    expect(parsed.slice(0, 9).map((l) => l.kind)).toEqual(Array(9).fill("shape"));
    expect(parsed.slice(0, 9).map((l) => l.shape)).toEqual(SHAPE_ORDER);
    expect(example[9].startsWith("Ruling:"), example[9]).toBe(true);
    expect(example[10].startsWith("TASK-001: test hashes"), example[10]).toBe(true);
    expect(parsed.slice(9).map((l) => l.kind)).toEqual(["other-timed", "other-timed"]);
    for (const line of parsed) {
      expect(line.kind).not.toBe("unparsed");
      expect(line.kind).not.toBe("untimed");
      expect(Number.isFinite(line.ts), String(line.stamp)).toBe(true);
    }
  });

  it("ends every example line with one ISO-8601 timestamp with its offset", () => {
    for (const line of ledgerExample()) {
      const suffix = TS_SUFFIX.exec(line);
      expect(suffix, line).not.toBeNull();
      expect((suffix as RegExpExecArray)[1], line).toMatch(/[+-]\d{2}:\d{2}$/);
      // A second suffix would hide inside the body the first one leaves behind.
      expect(TS_SUFFIX.test(line.slice(0, (suffix as RegExpExecArray).index)), line).toBe(false);
    }
  });

  it("states the suffix and forbids a second one", () => {
    const section = ledgerSection();
    expect(section).toContain("@ <ISO-8601 timestamp with offset>");
    expect(section).toContain("never a second suffix");
  });

  it("records commit lists, not ranges, in fix round and complete lines", () => {
    const section = ledgerSection();
    expect(section).toContain("commits <a7>,<b7>");
    expect(section).not.toMatch(COMMIT_RANGE);
    const example = ledgerExample();
    for (const phrase of [": fix round ", ": complete ("]) {
      const line = example.find((l) => l.includes(phrase));
      expect(line, phrase).toBeDefined();
      expect(line).toMatch(/commits [0-9a-f]{7}(,[0-9a-f]{7})*/);
      expect(line).not.toMatch(COMMIT_RANGE);
    }
  });

  it("keeps the phrase fix round to the fix round shape, so travel's round count stays true", () => {
    const section = ledgerSection();
    for (const line of linesWith(section, "fix round").filter((l) => /TASK-(NNN|\d+): /.test(l))) {
      expect(line).toMatch(/TASK-(NNN|\d+): fix round (<R>|\d+)\/5/);
    }
    expect(linesWith(ledgerExample().join("\n"), "fix round")).toHaveLength(1);
  });

  it("names the other ledger lines as suffixed but not parsed for figures", () => {
    expect(ledgerSection()).toContain("not parsed for figures");
  });
});

describe("a pre-feature ledger rewritten in the grammar", () => {
  it("suffixes every line after the header exactly once", () => {
    const parsed = parseLedger(REWRITTEN_LEDGER).lines;
    expect(parsed).toHaveLength(REWRITTEN_LEDGER.trim().split("\n").length - 1);
    for (const line of parsed) {
      expect(line.kind, `line ${line.line}`).not.toBe("untimed");
      expect(line.kind, `line ${line.line}`).not.toBe("unparsed");
    }
    for (const text of REWRITTEN_LEDGER.trim().split("\n").slice(1)) {
      const suffix = TS_SUFFIX.exec(text);
      expect(suffix, text).not.toBeNull();
      expect(TS_SUFFIX.test(text.slice(0, (suffix as RegExpExecArray).index)), text).toBe(false);
    }
    expect(parseLedger(PRE_FEATURE_LEDGER).lines.every((l) => l.kind === "untimed")).toBe(true);
  });

  it("counts fix round lines equal to its fix rounds, where the old form over-counted", () => {
    const rounds = parseLedger(REWRITTEN_LEDGER).lines.filter((l) => l.shape === "fixRound").length;
    expect(rounds).toBe(1);
    expect(linesWith(REWRITTEN_LEDGER, "fix round")).toHaveLength(rounds);
    expect(linesWith(PRE_FEATURE_LEDGER, "fix round")).toHaveLength(3);
  });

  it("uses commit lists in its fix round and complete lines", () => {
    for (const line of parseLedger(REWRITTEN_LEDGER).lines.filter((l) => l.shape === "fixRound" || l.shape === "complete")) {
      const text = REWRITTEN_LEDGER.split("\n")[line.line - 1];
      expect(text).toMatch(/commits [0-9a-f]{7}(,[0-9a-f]{7})*/);
      expect(text).not.toMatch(COMMIT_RANGE);
    }
  });
});

describe("resuming the task loop from the ledger", () => {
  it("drops the rule that resumed only from a task's last fix round line", () => {
    expect(implement()).not.toContain("a task whose last line is a fix round resumes at the next round");
  });

  it("rebuilds only the head and next task, each at its first unmet step, in eleven ordered steps", () => {
    const text = implement();
    const intro = paragraphWith(text, "Resume from the ledger");
    expect(intro).toContain("only the head task H and the next task X");
    expect(intro).toContain("first unmet step");
    // The ordered list runs from the intro to the next bold-led paragraph or heading.
    const after = text.slice(text.indexOf(intro) + intro.length);
    const end = after.search(/\n(\*\*|#)/);
    const list = (end === -1 ? after : after.slice(0, end)).trim();
    const items = list.split(/\n(?=\d+\. )/).filter((i) => /^\d+\. /.test(i));
    expect(items.map((i) => Number(/^(\d+)\./.exec(i)?.[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const n of [0, 1]) expect(items[n]).toContain("test-writer");
    expect(items[2]).toContain("last task commit");
    expect(items[2]).toContain("Files are disjoint");
    expect(items[3]).toMatch(/developer`? `?done/);
    for (const n of [4, 5]) expect(items[n]).toContain("verify");
    expect(items[6]).toContain("code-reviewer");
    expect(items[7]).toContain("fix queued");
    // A round's own test-writer or automation-writer seat must not count as the round's developer dispatch.
    expect(items[7]).toMatch(/test-writer[\s\S]*automation-writer`? `?dispatched[\s\S]*round=/);
    expect(items[7]).toContain("next fix round");
    expect(items[7]).toContain("breaker");
    expect(items[7]).toContain("resume the developer to commit them unchanged");
    expect(items[8]).toContain("fix queued");
    expect(items[9]).toContain("cascade re-review owed");
    expect(items[10]).toContain("completion check");
  });

  it("never re-dispatches a complete task and earns completion only from the ledger", () => {
    const text = implement();
    expect(text).toContain("A task with a `complete` line is never re-dispatched");
    expect(text).not.toMatch(/all seats (are )?done/i);
    const rule = paragraphWith(text, "`verify done exit=0`");
    expect(rule).toContain("`developer done`");
    expect(rule).toContain("last commit");
    expect(rule).toMatch(/clean/);
  });

  it("quotes no commit range in any fix round or complete line of the skill or its loop reference", () => {
    for (const [name, text] of [["SKILL.md", implement()], ["task-loop.md", taskLoop()]]) {
      expect(text, name).not.toContain("(commits <base7>..<head7>");
      expect(text, name).not.toMatch(COMMIT_RANGE);
    }
  });

  it("has travel resume each item from the head and next task's ledger lines", () => {
    const resume = paragraphWith(travel(), "Resume after compaction");
    expect(resume).toMatch(/head/);
    expect(resume).toMatch(/next task/);
    expect(resume).not.toMatch(/last line/);
  });
});

describe("a stand-in seat in the ledger", () => {
  const NOTE = "Note TASK-NNN: <seat> stand-in general-purpose @ <ts>";

  it("is ledgered as its own note line, not folded into the seat's dispatched line", () => {
    for (const line of implement().split("\n").filter((l) => l.includes("stand-in: general-purpose"))) {
      expect(line).not.toContain("in the ledger line");
    }
    expect(implement()).toContain(NOTE);
    expect(taskLoop()).toContain(NOTE);
  });

  it("reads the note as a timed note, while a stand-in folded into a dispatched line breaks that shape", () => {
    const note = parseLedger("# h\nNote TASK-001: developer stand-in general-purpose @ 2026-11-01T18:41:26+07:00").lines;
    expect(note.map((l) => l.kind)).toEqual(["other-timed"]);
    const folded = parseLedger("# h\nTASK-001: developer dispatched model=opus stand-in: general-purpose @ 2026-11-01T18:41:26+07:00").lines;
    expect(folded.map((l) => l.kind)).toEqual(["unparsed"]);
  });
});

describe("the loop's measurement report", () => {
  it("records the item's figures and prints the report and the largest bucket beside the rulings", () => {
    const report = paragraphWith(finalSection(), "kf loop-stats <f> --record");
    expect(report).toContain("kf loop-stats --all");
    expect(report).toContain("largest:");
    expect(report).toContain("Rulings I made");
  });
});

describe("travel's measured work and review minutes", () => {
  it("takes the implementation phase's work and review from kf loop-stats when the ledger is timestamped", () => {
    const measure = paragraphWith(travel(), "seat minutes, verify excluded");
    for (const s of ["--work", "--review", "code-reviewer minutes", "kf loop-stats <f> --json", "timestamped seat lines", "from seat notifications otherwise"]) {
      expect(measure, s).toContain(s);
    }
    expect(travel()).toMatch(/testing and review phases[^.\n]*notification/i);
  });

  it("says in estimation.md which source the work and review rows used, and still counts fix round lines for rounds", () => {
    const rows = estimation().split("\n");
    for (const field of ["work", "review"]) {
      const row = rows.find((r) => r.startsWith(`| ${field} |`));
      expect(row, field).toBeDefined();
      expect(row, field).toContain("kf loop-stats <f> --json");
      expect(row, field).toMatch(/notification/);
    }
    const rounds = rows.find((r) => r.startsWith("| rounds |"));
    expect(rounds).toContain("the number of `fix round` lines");
  });
});
