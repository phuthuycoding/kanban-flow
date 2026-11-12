import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { LEGACY_SKILLS, MANAGED_AGENTS, MANAGED_SKILLS } from "../integrations/managed.js";
import { loopStats, parseLedger } from "../workflow/loop-stats.js";

const read = (...parts: string[]) => readFileSync(join(PKG_ROOT, ...parts), "utf8");
const AGENT = ["assets", "agents", "researcher.md"];
const BRIEF = ["assets", "shared", "researcher-brief.md"];

/** The YAML frontmatter block between the leading `---` fences. */
function frontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  expect(m, "frontmatter").not.toBeNull();
  return m![1];
}

/** The text of the `## <n>.` section of a skill, up to the next `## ` heading. */
function section(text: string, heading: RegExp): string {
  const start = text.search(heading);
  expect(start, `section ${heading}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the researcher agent definition", () => {
  it("is named researcher, limited to its six tools without Bash, and names the three modes without a spike mode", () => {
    const text = read(...AGENT);
    const head = frontmatter(text);
    expect(head).toMatch(/^name: researcher$/m);
    const tools = /^tools:\s*(.+)$/m.exec(head)?.[1].split(",").map((t) => t.trim());
    expect(tools).toEqual(["Read", "Grep", "Glob", "WebSearch", "WebFetch", "Write"]);
    expect(tools).not.toContain("Bash");
    const description = /^description:\s*(.+)$/m.exec(head)?.[1] ?? "";
    for (const mode of ["web", "code", "prior-art"]) {
      expect(description, `description names ${mode}`).toContain(mode);
      expect(text, `body has a ${mode} mode`).toMatch(new RegExp("`" + mode + "`"));
    }
    expect(text).not.toMatch(/`spike`/);
  });

  it("gives each mode a stop rule and sends blast-radius mapping to scout", () => {
    const text = read(...AGENT);
    for (const mode of ["web", "code", "prior-art"]) {
      const start = text.search(new RegExp("^### `" + mode + "`", "m"));
      expect(start, `a section for ${mode}`).toBeGreaterThanOrEqual(0);
      const rest = text.slice(start + 1);
      const next = rest.search(/\n#{1,3} /);
      const slice = next === -1 ? rest : rest.slice(0, next);
      expect(slice, `stop rule inside the ${mode} section`).toMatch(/\*\*Stop\*\*/);
    }
    expect(text).toMatch(/code[\s\S]{0,600}scout/);
    expect(text).toMatch(/blast radius|consumers/i);
  });

  it("states the reply contract: 40 lines, confidence, sources, three claim lists and a closing STATUS line", () => {
    const text = read(...AGENT);
    expect(text).toMatch(/40 lines/);
    expect(text).toMatch(/confidence/i);
    expect(text).toMatch(/high\W+medium\W+(or\W+)?low/i);
    expect(text).toMatch(/sources/i);
    for (const list of ["verified", "inferred", "unverified"]) expect(text, list).toMatch(new RegExp(list, "i"));
    expect(text).toContain("STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT");
  });

  it("is at most 150 lines and defaults to the sonnet model", () => {
    const text = read(...AGENT);
    expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(150);
    expect(frontmatter(text)).toMatch(/^model: sonnet$/m);
    expect(text).not.toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  it("forbids tracked-file edits, commits, writing git commands, spawning agents, scope decisions and downloaded scripts", () => {
    const text = read(...AGENT);
    expect(text).toMatch(/never[\s\S]{0,300}edit[\s\S]{0,60}tracked/i);
    expect(text).toMatch(/never[^\n]*commit/i);
    expect(text).toMatch(/git command that writes|writing git|git[^.\n]{0,40}writ/i);
    expect(text).toMatch(/spawn[\s\S]{0,20}agent|dispatch[\s\S]{0,20}agent/i);
    expect(text).toMatch(/never[^\n]*(decide|decision)[^\n]*scope|not deciding[^\n]*scope|does not decide scope/i);
    expect(text).toMatch(/never[^\n]*downloaded script/i);
  });

  it("has no git log, show or blame allowance and reads code with Read, Grep and Glob only", () => {
    const text = read(...AGENT);
    expect(text).not.toMatch(/git (log|show|blame)/i);
    expect(text).not.toMatch(/read-only commands/i);
  });

  it("names the report path as the only file it writes", () => {
    expect(read(...AGENT)).toMatch(/report (path|file)[^\n]*(only file|only thing)|only file[^\n]*(writes?|write)[^\n]*report|(writes?|write)[^\n]*only[^\n]*report/i);
  });

  it("says a stand-in loses tool-level enforcement and the controller checks git status --porcelain after a stand-in dispatch", () => {
    const agent = read(...AGENT);
    const brief = read(...BRIEF);
    expect(`${agent}\n${brief}`).toMatch(/stand-in[^\n]*(loses|lose|without)[^\n]*tool-level (enforcement|restriction)/i);
    expect(brief).toMatch(/stand-in[^\n]*git status --porcelain|git status --porcelain[^\n]*stand-in/i);
    expect(brief).toMatch(/no tracked (change|file)|tracked[^\n]*(unchanged|no change)/i);
  });

  it("treats fetched content as untrusted data and stops with BLOCKED when no web tool is present", () => {
    const text = read(...AGENT);
    expect(text).toMatch(/untrusted/i);
    expect(text).toMatch(/never[\s\S]{0,40}instructions|not (as )?instructions/i);
    expect(text).toMatch(/no web tool|web tool[\s\S]{0,80}(absent|missing|not (present|available))|without a web tool/i);
    expect(text).toMatch(/BLOCKED/);
  });
});

describe("the managed names", () => {
  it("lists researcher among seven managed agents and ships its definition file", () => {
    expect(MANAGED_AGENTS).toHaveLength(7);
    expect(MANAGED_AGENTS).toContain("researcher");
    for (const agent of MANAGED_AGENTS) expect(existsSync(join(PKG_ROOT, "assets", "agents", `${agent}.md`)), agent).toBe(true);
  });

  it("keeps the eight legacy kanban-* names and a bare name per managed skill dir", () => {
    expect(LEGACY_SKILLS).toHaveLength(8);
    for (const name of LEGACY_SKILLS) expect(name).toMatch(/^kanban-/);
    for (const skill of MANAGED_SKILLS) expect(existsSync(join(PKG_ROOT, "assets", "skills", skill, "SKILL.md")), skill).toBe(true);
  });
});

describe("the researcher dispatch brief", () => {
  it("names the mode, question, decision, time box and report path", () => {
    const text = read(...BRIEF);
    for (const field of [/mode/i, /question/i, /decision/i, /time box/i, /report path/i]) expect(text).toMatch(field);
  });

  it("puts the report under the item reviews dir, else under CLAUDE_JOB_DIR/tmp, else the OS temp dir", () => {
    const text = read(...BRIEF);
    expect(text).toContain("<item>/reviews/research-<slug>.md");
    expect(text).toContain("$CLAUDE_JOB_DIR/tmp");
    expect(text).toMatch(/OS temp(orary)? dir/i);
  });

  it("is referenced by the brainstorm, plan and implement skills", () => {
    for (const skill of ["brainstorm", "plan", "implement"]) {
      expect(read("assets", "skills", skill, "SKILL.md"), skill).toContain("researcher-brief.md");
    }
  });
});

describe("the brainstorm trigger", () => {
  it("dispatches the researcher before asking the user, without asking first, and cites the report in the spec", () => {
    const sec = section(read("assets", "skills", "brainstorm", "SKILL.md"), /\n## 1\. Understand the challenge/);
    expect(sec).toContain("Agent(kf:researcher)");
    expect(sec).toMatch(/library|API|service|standard/);
    expect(sec).toMatch(/other tools|prior art/i);
    expect(sec).toMatch(/before[^.\n]{0,60}(ask|question)/i);
    expect(sec).toMatch(/not (ask|asked)|never ask|without asking/i);
    expect(sec).toMatch(/Assumptions|Open Questions/);
  });
});

describe("the plan trigger", () => {
  const plan = () => read("assets", "skills", "plan", "SKILL.md");

  it("dispatches the researcher next to the scouts when a choice or an external dependency appears", () => {
    const text = plan();
    expect(text).toContain("Agent(kf:researcher)");
    expect(text).toMatch(/`web`|web.{0,5}prior-art|prior-art/);
    expect(text).toMatch(/same message[^.\n]{0,80}scout|scout[^.\n]{0,120}same message/i);
    expect(text).toMatch(/two or more|between (two|approaches)/i);
    expect(text).toMatch(/API version|external dependency/i);
  });

  it("names the choice and its sources in the approval summary and fails an unresearched choice in self-review", () => {
    const text = plan();
    const approval = section(text, /\n## 3\. Human approval gate/);
    expect(approval).toMatch(/choice/i);
    expect(approval).toMatch(/sources/i);
    expect(text).toMatch(/self-review[\s\S]{0,400}(fail|reject)[\s\S]{0,200}research|(fail|reject)[^.\n]{0,120}without a research report/i);
  });
});

/** The 3.2 bullet that dispatches the researcher. */
function researcherBullet(): string {
  const sec = section(read("assets", "skills", "implement", "SKILL.md"), /\n### 3\.2 /);
  const bullet = sec.split("\n").find((l) => l.startsWith("- ") && l.includes("Agent(kf:researcher)"));
  expect(bullet, "a 3.2 bullet that dispatches Agent(kf:researcher)").toBeDefined();
  return bullet!;
}

describe("the implement trigger", () => {
  it("dispatches the researcher for missing outside knowledge and re-dispatches the same developer with the conclusion", () => {
    const b = researcherBullet();
    expect(b).toMatch(/NEEDS_CONTEXT/);
    expect(b).toMatch(/BLOCKED/);
    expect(b).toMatch(/outside knowledge/i);
    expect(b).toMatch(/re-dispatch the same (developer|agent)/i);
    expect(b).toMatch(/conclusion/i);
    expect(b).toMatch(/report path/i);
  });

  it("excludes a plan defect, a test dispute and an architectural choice, and rules the dispatch is no fix round", () => {
    const b = researcherBullet();
    expect(b).toMatch(/plan defect, a test dispute or an architectural choice/i);
    expect(b).toMatch(/not a fix round/i);
  });

  it("writes a Ruling line that cites the research report", () => {
    expect(researcherBullet()).toMatch(/Ruling: research <report path> supplied to TASK-NNN developer/);
  });
});

describe("a ledger with a research ruling", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  const BASE = [
    "# Task loop ledger — research",
    "TASK-001: developer dispatched model=sonnet @ 2026-11-02T10:00:00+07:00",
    "TASK-001: developer done status=NEEDS_CONTEXT @ 2026-11-02T10:10:00+07:00",
    "TASK-001: code-reviewer dispatched model=opus @ 2026-11-02T10:30:00+07:00",
    "TASK-001: code-reviewer done status=findings @ 2026-11-02T10:40:00+07:00",
    "TASK-001: fix round 1/5 (missing null check) @ 2026-11-02T10:41:00+07:00",
  ];
  /** The Ruling form the implement skill prescribes, filled in and given a timestamp. */
  function rulingFromSkill(): string {
    const form = /Ruling: research <report path> supplied to TASK-NNN developer — <why> — <cost if wrong>/.exec(researcherBullet());
    expect(form, "the research Ruling form in the skill").not.toBeNull();
    return (
      "TASK-001: " +
      form![0]
        .replace("<report path>", ".works/implementation/x/reviews/research-lib.md")
        .replace("TASK-NNN", "TASK-001")
        .replace("<why>", "missing API version")
        .replace("<cost if wrong>", "a wrong pin breaks the build") +
      " @ 2026-11-02T10:12:00+07:00"
    );
  }

  function loadFromTemp(lines: string[]): ReturnType<typeof loopStats> {
    dir = mkdtempSync(join(tmpdir(), "research-ledger-"));
    const file = join(dir, "progress.md");
    writeFileSync(file, lines.join("\n") + "\n");
    return loopStats(parseLedger(readFileSync(file, "utf8")));
  }

  it("parses without unparsed lines and leaves the fix-round count unchanged", () => {
    const without = loadFromTemp(BASE);
    const withRuling = loadFromTemp([...BASE.slice(0, 3), rulingFromSkill(), ...BASE.slice(3)]);
    expect(without.rounds).toBe(1);
    expect(withRuling.rounds).toBe(1);
    expect(withRuling.unparsed).toEqual([]);
  });
});
