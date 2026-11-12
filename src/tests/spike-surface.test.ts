import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MANAGED_SKILLS, MANAGED_AGENTS, LEGACY_SKILLS } from "../integrations/managed.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Spelled out on purpose: the module under test is checked against the intended lists, not against itself.
const SKILLS = ["flow", "brainstorm", "plan", "implement", "test", "review", "archive", "bug", "spike", "travel", "docs"];
const AGENTS = ["code-reviewer", "scout", "spec-reviewer", "developer", "test-writer", "automation-writer", "researcher"];
const LEGACY = ["kanban-flow", "kanban-brainstorm", "kanban-plan", "kanban-implement", "kanban-test", "kanban-review", "kanban-archive", "kanban-bug"];

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const flow = () => read("assets/skills/flow/SKILL.md");
const spike = () => read("assets/skills/spike/SKILL.md");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".md")) out.push(full);
  }
  return out;
}

function frontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  return m ? m[1] : "";
}

/** The table row of `text` whose first cell contains `label`, or "" when there is none. */
function row(text: string, label: RegExp): string {
  return text.split("\n").find((l) => l.startsWith("|") && label.test(l.split("|")[1] ?? "")) ?? "";
}

function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length);
  const next = rest.search(/\n#{1,2} /);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("the managed name lists", () => {
  it("lists ten bare skills in order, seven agents including researcher and the eight legacy names", () => {
    expect(MANAGED_SKILLS).toEqual(SKILLS);
    expect([...MANAGED_AGENTS].sort()).toEqual([...AGENTS].sort());
    expect(MANAGED_AGENTS).toContain("researcher");
    expect(LEGACY_SKILLS).toEqual(LEGACY);
  });

  it("has a skill dir and an agent file in the tree for every managed name", () => {
    for (const name of SKILLS) expect(existsSync(join(ROOT, "assets", "skills", name, "SKILL.md")), `skills/${name}/SKILL.md`).toBe(true);
    for (const name of AGENTS) expect(existsSync(join(ROOT, "assets", "agents", `${name}.md`)), `agents/${name}.md`).toBe(true);
  });

  it("names the spike skill spike in its frontmatter", () => {
    expect(frontmatter(spike())).toMatch(/^name:\s*["']?spike["']?\s*$/m);
  });

  it("describes the spike skill for questions like can we, how long would and what does X return", () => {
    const description = frontmatter(spike()).split("\n").find((l) => l.startsWith("description:")) ?? "";
    expect(description).toMatch(/can we/i);
    expect(description).toMatch(/how long would/i);
    expect(description).toMatch(/what does/i);
  });
});

describe("the spike skill procedure", () => {
  const steps = () =>
    spike()
      .split("\n")
      .filter((l) => /^\d+\.\s/.test(l));

  it("holds exactly the seven numbered steps", () => {
    expect(steps()).toHaveLength(7);
  });

  it("opens no work item (step 1)", () => {
    expect(steps()[0]).toMatch(/work item/i);
    expect(steps()[0]).toMatch(/\bno\b|\bnot\b|\bnever\b|without/i);
  });

  it("states what it will probe in two sentences and starts without waiting for a nod (step 2)", () => {
    expect(steps()[1]).toMatch(/two sentences/i);
    expect(steps()[1]).toMatch(/nod|without waiting|does not wait|no need to wait/i);
  });

  it("dispatches Agent(kf:researcher) for the questions research can answer (step 3)", () => {
    expect(steps()[2]).toContain("Agent(kf:researcher)");
    expect(steps()[2]).toContain("researcher-brief.md");
  });

  it("writes throwaway code only in a scratch dir under the job tmp dir or the OS temp dir (step 4)", () => {
    expect(steps()[3]).toContain("$CLAUDE_JOB_DIR/tmp");
    expect(steps()[3]).toMatch(/temp dir|temp directory|tmpdir|OS temp/i);
  });

  it("waits for an explicit go before any irreversible step (step 5)", () => {
    expect(steps()[4]).toMatch(/explicit/i);
    expect(steps()[4]).toMatch(/\bgo\b/i);
    expect(steps()[4]).toMatch(/irreversible/i);
  });

  it("reports a recommendation, the sources and the exact commands (step 6)", () => {
    expect(steps()[5]).toMatch(/recommendation/i);
    expect(steps()[5]).toMatch(/sources/i);
    expect(steps()[5]).toMatch(/commands/i);
  });

  it("hands back to the flow skill to reclassify when the answer turns into work (step 7)", () => {
    expect(steps()[6]).toMatch(/reclassif|classify again/i);
    expect(steps()[6]).toMatch(/flow/i);
  });

  it("keeps the report in the temp root and never under .works/ (report path section)", () => {
    const report = section(spike(), "## Report path");
    expect(report).not.toBe("");
    expect(report).toContain("research-<slug>.md");
    expect(report).toContain("$CLAUDE_JOB_DIR/tmp");
    expect(report).toMatch(/never[^.\n]*\.works\/|not[^.\n]*\.works\/|no report[^.\n]*\.works\//i);
  });
});

describe("the flow skill wiring", () => {
  it("hands the classify Spike row to Skill(kf:spike) without the inline procedure", () => {
    const spikeRow = row(flow(), /^\s*\*\*Spike\*\*\s*$/);
    expect(spikeRow).not.toBe("");
    expect(spikeRow).toContain("Skill(kf:spike)");
    expect(spikeRow).not.toMatch(/get a nod/i);
    expect(spikeRow).not.toMatch(/two sentences/i);
  });

  it("lists Agent(kf:researcher) in the brainstorm, plan and implement named lines", () => {
    for (const label of [/Brainstorm/, /Plan/, /Implement/]) {
      const r = row(flow(), new RegExp(`^\\s*\\d\\s+${label.source}`));
      expect(r, String(label)).toContain("Agent(kf:researcher)");
    }
  });

  it("has a Spike row with Skill(kf:spike) in the named-line table", () => {
    const named = section(flow(), "## Every step leaves a named line");
    const r = row(named, /Spike/);
    expect(r).toContain("Skill(kf:spike)");
  });

  it("names all seven agents, researcher included, in the multi-agent harness section", () => {
    const harness = section(flow(), "## Multi-agent harness");
    for (const name of AGENTS) expect(harness, name).toContain(name);
    expect(harness).toContain("Agent(kf:researcher)");
  });
});

describe("the harness tools reference", () => {
  const tools = () => read("assets/shared/harness-tools.md");

  it("lists the seven agents in the dispatch-by-name row", () => {
    const r = row(tools(), /Dispatch a kanban agent by name/);
    expect(r).not.toBe("");
    for (const name of AGENTS) expect(r, name).toContain(name);
    expect(r).toContain("kf:");
  });

  it("gives the paste path for copies under the kf-flow skill dir", () => {
    expect(tools()).toContain("<skills dir>/kf-flow/agents/<name>.md");
  });
});

describe("the kf: prefix on every dispatch and hand-off", () => {
  const files = () => [...walk(join(ROOT, "assets", "skills")), ...walk(join(ROOT, "assets", "agents"))];
  const names = [...SKILLS, ...AGENTS].join("|");

  it("scans the spike skill", () => {
    expect(files().some((f) => f.endsWith(join("skills", "spike", "SKILL.md")))).toBe(true);
  });

  it("never dispatches or hands off to a managed name without the kf: prefix", () => {
    const bare = [new RegExp(`\\b(Agent|Skill)\\((${names})\\)`), new RegExp(`subagent_type:\\s*["']?(${names})\\b`)];
    const offenders: string[] = [];
    for (const f of files()) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (bare.some((re) => re.test(line))) offenders.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
