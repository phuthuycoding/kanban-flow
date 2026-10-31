import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { DRIVE_STOP_CODES } from "../workflow/features.js";

const DIR = join(PKG_ROOT, "skills", "travel");
const read = (...parts: string[]) => readFileSync(join(DIR, ...parts), "utf8");
const skill = read("SKILL.md");

/** Bodies of the ```bash fences: the commands the skill itself runs. */
function bashBlocks(text: string): string[] {
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
}

describe("the travel skill", () => {
  it("is a named skill with a description", () => {
    const head = skill.split("---")[1] ?? "";
    expect(head).toMatch(/\nname:\s*travel\n/);
    expect(head).toMatch(/\ndescription:\s*\S/);
  });

  it("plans the morning, waits for the human, and resumes the same day", () => {
    for (const s of ["date +%F", "kf status --all --json", "carry-over", "wait for the human to approve", "Batch 1", "Calibration",
      "same-day re-entry", "do not rebuild the plan", "`## YYYY-MM-DD`", "progress.md", "estimates.md", "slots=N", "default 3"]) {
      expect(skill, s).toContain(s);
    }
  });

  it("prints the progress block with every field", () => {
    for (const s of ["Tick N — running: A/SLOTS | done: X | blocked: Z | queued: R | points: P", "⏸ Needs you (decide)", "▶ Running",
      "✓ Waiting to merge (do this on GitHub)", "! gh pr merge <n> --squash", "docsBranch", "awaiting push", "<worktree path>"]) {
      expect(skill, s).toContain(s);
    }
  });

  it("keeps sequential pairs apart and independent items in their own worktrees", () => {
    expect(skill).toContain("`sequential` pair is never dispatched in the same tick");
    expect(skill).toContain("two independent items run in two worktrees");
    expect(skill).toContain("estimates overlap");
  });

  it("handles every drive stop code and state", () => {
    for (const code of [...DRIVE_STOP_CODES, "crashed", "ready"]) expect(skill, code).toContain(`\`${code}\``);
    expect(skill).toContain("waiting-to-merge");
    expect(skill).toContain("blocked");
    expect(skill).toMatch(/one retry/);
  });

  it("only starts and reads drives: no approve, archive, stage, ship or merge among the commands it runs, and never --watch", () => {
    const blocks = bashBlocks(skill);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/kf (approve|archive|stage|ship|cancel)\b/);
      expect(block).not.toMatch(/gh pr merge|git merge|git push/);
      expect(block).not.toMatch(/--watch|--follow/);
    }
    for (const forbidden of ["`kf approve`", "`kf archive`", "`kf stage`", "`gh pr merge`"]) expect(skill).toContain(forbidden);
    for (const line of skill.split("\n").filter((l) => l.includes("--watch"))) expect(line).toMatch(/do not pass|Never/);
    expect(skill).toContain("do not pass `--watch`");
    expect(skill).not.toContain("kf travel");
  });

  it("states the ownership rule, and the phase skills honour it", () => {
    expect(skill).toMatch(/`driving` or `blocked` means travel owns/);
    for (const other of ["kanban-flow", "kanban-implement"]) {
      const text = readFileSync(join(PKG_ROOT, "skills", other, "SKILL.md"), "utf8");
      expect(text, other).toMatch(/`driving` or `blocked`/);
      expect(text, other).toContain(".kf/travel/progress.md");
    }
  });

  it("ships its references and an executable estimates script", () => {
    for (const ref of ["daily-plan.md", "ledger-format.md", "estimation.md"]) {
      expect(existsSync(join(DIR, "references", ref)), ref).toBe(true);
      expect(skill).toContain(`references/${ref}`);
    }
    const script = join(DIR, "scripts", "estimates");
    expect(readFileSync(script, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(statSync(script).mode & 0o111).not.toBe(0);
  });

  it("documents the estimates row fields in order and the sizes", () => {
    const estimation = read("references", "estimation.md");
    expect(estimation).toContain("date · id · feature · kind · est · actual · work · review · files · rounds · path · tier · gap · estmin");
    for (const s of ["| S | 1 |", "| M | 2 |", "| L | 4 |", "| XL | 8 |", "should split", "≥ 20 measured rows", "last 30", "median of `work ÷ estmin`",
      "clamped to 0.5–3", "file count is not corrected", "10 tasks"]) {
      expect(estimation, s).toContain(s);
    }
    const ledger = read("references", "ledger-format.md");
    for (const state of ["queued", "driving", "waiting-to-merge", "blocked", "done", "carry-over"]) expect(ledger, state).toContain(`\`${state}\``);
  });
});
