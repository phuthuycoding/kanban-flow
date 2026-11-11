import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import type { ParsedArgs } from "../cli/args.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const walkMd = (rel: string): string[] =>
  readdirSync(join(ROOT, rel)).flatMap((name) => {
    const child = `${rel}/${name}`;
    if (statSync(join(ROOT, child)).isDirectory()) return walkMd(child);
    return name.endsWith(".md") ? [child] : [];
  });

const flatMd = (rel: string) =>
  readdirSync(join(ROOT, rel))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${rel}/${f}`);

const STOP_REASONS = [
  "an irreversible or destructive operation",
  "a security-sensitive action",
  "a side effect outside this worktree",
  "a reopened task at its round cap",
  "a plan too broken to act on",
  "REQUIREMENT_BUG",
  "BLOCKED",
];
const REMOVED_PHRASES = ["one fix cycle", "Failed again → STOP", "Auto-fix benign blockers once"];
const LOOP_SKILLS = ["skills/implement/SKILL.md", "skills/test/SKILL.md", "skills/flow/SKILL.md"];

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("one fix rule and one stop list across implement, test and flow", () => {
  for (const skill of LOOP_SKILLS) {
    it(`${skill} names all seven stop reasons`, () => {
      const text = read(skill);
      for (const reason of STOP_REASONS) expect(text, reason).toContain(reason);
    });

    it(`${skill} no longer carries the retired fix wording`, () => {
      const text = read(skill);
      for (const phrase of REMOVED_PHRASES) expect(text, phrase).not.toContain(phrase);
    });

    it(`${skill} keeps the round-cap stop`, () => {
      expect(read(skill)).toContain("a reopened task at its round cap");
    });
  }

  it("kf:flow states the stop list once, not twice", () => {
    const text = read("skills/flow/SKILL.md");
    expect(text.split("a plan too broken to act on").length - 1).toBe(1);
  });

  it("kf:implement keeps the five-things sentence", () => {
    expect(read("skills/implement/SKILL.md")).toContain("Five things stop you");
  });

  it("kf:test and kf:flow send a testing FAIL, a review FAIL and red CI to Repairing after the loop", () => {
    for (const skill of ["skills/test/SKILL.md", "skills/flow/SKILL.md"]) {
      const text = read(skill);
      expect(text, skill).toContain("Repairing after the loop");
      expect(text, skill).toMatch(/testing FAIL/i);
      expect(text, skill).toMatch(/review FAIL/i);
      expect(text, skill).toMatch(/red CI/i);
    }
  });
});

describe("no surface offers REJECT as a status to write", () => {
  it("the autoconfig briefing does not mention REJECT", async () => {
    dir = await mkdtemp(join(tmpdir(), "kfw-slim-auto-"));
    const parsed = { command: "autoconfig", options: {}, positionals: [] } as unknown as ParsedArgs;
    const res = await cmdAutoconfig(parsed, dir, async () => ({ code: 0, stdout: "[]", stderr: "" }));
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("REJECT");
  });

  const surfaces = [
    ...walkMd("skills"),
    ...flatMd("kanban-flow/templates"),
    "kanban-flow/README.md",
    ...flatMd("docs/workflow"),
  ];

  it("covers the expected surfaces", () => {
    expect(surfaces.length).toBeGreaterThan(20);
  });

  for (const file of surfaces) {
    it(`${file} has no REJECT`, () => {
      expect(read(file)).not.toContain("REJECT");
    });
  }

  it("the user-facing README and the Pages site do not offer REJECT", () => {
    expect(read("README.md")).not.toContain("REJECT");
    expect(read(".github/pages/index.html")).not.toContain("REJECT");
  });

  it("the testing result template Summary has no Rejected row", () => {
    expect(read("kanban-flow/templates/phase-4-testing-result.md")).not.toMatch(/\|\s*Rejected\s*\|/);
  });
});

describe("user docs describe the slimmed testing stage and the one fix rule", () => {
  for (const page of ["docs/workflow/skills.md", "docs/workflow/lifecycle.md"]) {
    it(`${page} describes testing as reading the stage record, mapping cases, running uncovered behaviour and measuring coverage per changed file`, () => {
      const text = read(page);
      expect(text).toMatch(/stage record/i);
      expect(text).toMatch(/line coverage/i);
      expect(text).toMatch(/per changed file/i);
      expect(text).toMatch(/uncovered/i);
    });
  }

  it("gates.md and README.md return a gate failure to the owning task under the five-round cap", () => {
    for (const page of ["docs/workflow/gates.md", "README.md"]) {
      const text = read(page);
      expect(text, page).toMatch(/owning task|task that owns/i);
      expect(text, page).toMatch(/five rounds|five-round/i);
    }
  });

  it("README.md testing text cites the stage record", () => {
    expect(read("README.md")).toMatch(/\btest(ing|s)?\b[^]{0,300}?reads? the stage record/i);
  });

  it("CHANGELOG [Unreleased] records the testing change and the REJECT fold", () => {
    const log = read("CHANGELOG.md");
    const start = log.indexOf("## [Unreleased]");
    const next = log.indexOf("\n## [", start + 1);
    const section = log.slice(start, next === -1 ? undefined : next);
    expect(section).toMatch(/### Changed/);
    expect(section).toMatch(/stage record/i);
    expect(section).toMatch(/line coverage|coverage per changed file/i);
    expect(section).toMatch(/fix rule/i);
    expect(section).toContain("REJECT");
  });
});
