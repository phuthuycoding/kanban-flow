import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";

const DIR = join(PKG_ROOT, "assets", "skills", "travel");
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

  it("lists both gone-docs decisions in the daily plan's Needs you", () => {
    const plan = read("references", "daily-plan.md");
    expect(plan).toContain("`canonical docs for <f> never landed`");
    expect(plan).toContain("`run <remedy> first, then re-run kf status --all: canonical docs for <f> are not proven landed (<reason>); if they still are not, re-land them on a fresh docs branch for a PR with kf archive <f>, or leave them`");
  });

  it("prints the progress block with every field", () => {
    for (const s of ["Tick N — running: A/SLOTS | done: X | blocked: Z | queued: R | points: P", "⏸ Needs you (decide)", "▶ Running",
      "✓ Waiting to merge (do this on GitHub)", "! gh pr merge <n>", "docsBranch", "awaiting push", "not proven merged (<reason>) — ! <command>", "review PASS but not closed", "<worktree path>",
      "canonical docs for <f> never landed (<reason>): re-land them on a fresh docs branch for a PR with kf archive <f>, or leave them",
      "run git remote set-head origin -a first, then re-run kf status --all: canonical docs for <f> are not proven landed (<reason>); if they still are not, re-land them on a fresh docs branch for a PR with kf archive <f>, or leave them",
      "run git remote add origin <url> first, then ",
      "not proven merged (<reason>) — <next>", "`kind: \"lookup-rerun\"`", "the entry's `next` copied verbatim",
      "re-run kf status --all once the merged-PR lookup can run, or re-land them on a fresh docs branch with kf archive <f>"]) {
      expect(skill, s).toContain(s);
    }
    for (const text of [skill, read("references", "ledger-format.md"), read("references", "daily-plan.md")]) {
      expect(text).not.toContain("gh pr merge <n> --squash");
      expect(text).not.toMatch(/gh pr merge \d+ --squash/);
    }
  });

  it("keeps sequential pairs apart and independent items in their own worktrees", () => {
    expect(skill).toContain("`sequential` pair is never dispatched in the same tick");
    expect(skill).toContain("two independent items run in two worktrees");
    expect(skill).toContain("estimates overlap");
    expect(skill).toMatch(/`sequential` partners \(if any\) are all `done`/);
    expect(skill).toMatch(/a partner that is `driving`, `waiting-to-merge` or `blocked` still blocks/);
  });

  it("adds a seat's duration to work and, for a review seat, to review as well, unless the item's ledger is timestamped", () => {
    expect(skill).toMatch(/add the seat's reported duration to the item's `work=<n>`, and for a review seat also to its `review=<n>`/);
    // Implementation-phase minutes come from kf loop-stats when the ledger is timestamped, so the step must say the sum excludes them.
    const step = skill.split("\n").find((l) => l.includes("add the seat's reported duration")) ?? "";
    expect(step).toMatch(/timestamped/);
    expect(skill).not.toMatch(/\(`review=<n>` for a review seat\)/);
  });

  it("dispatches seats in the background so another item advances while they run", () => {
    expect(skill).toMatch(/dispatches an item's seats \([^)]*\) in the background and advances another item while they run/i);
  });

  it("never force-pushes in any bash block of the skill or its references", () => {
    const texts = [skill, read("references", "daily-plan.md"), read("references", "ledger-format.md"), read("references", "estimation.md")];
    for (const text of texts) {
      for (const block of bashBlocks(text)) {
        // Join backslash-continued lines so a flag on a continuation line is still seen.
        const joined = block.replace(/\\\r?\n/g, " ");
        expect(joined).not.toMatch(/git push\b[^\n]*(--force|--force-with-lease|\s-f\b|\s\+[^\s]+)/);
      }
    }
  });

  it("defines driving, blocked and waiting-to-merge without any drive status", () => {
    const ledger = read("references", "ledger-format.md");
    expect(skill).toMatch(/`driving`[^\n]*(travel session|this session)[^\n]*(running|runs)[^\n]*phases/i);
    expect(skill).toMatch(/`blocked`[^\n]*reason[^\n]*next command/i);
    expect(skill).toMatch(/`waiting-to-merge`[^\n]*review[^\n]*PASS[^\n]*PR[^\n]*open/i);
    for (const stop of ["REQUIREMENT_BUG", "plan change", "fix-loop breaker"]) expect(skill, stop).toContain(stop);
    expect(ledger).toMatch(/`blocked`[^\n]*reason[^\n]*next command/i);
    expect(ledger).toMatch(/`waiting-to-merge`[^\n]*review[^\n]*PASS[^\n]*PR[^\n]*open/i);
  });

  it("never calls kf drive anywhere in the skill, its references or its script", () => {
    const texts = [skill, read("references", "daily-plan.md"), read("references", "ledger-format.md"), read("references", "estimation.md"), read("scripts", "estimates")];
    for (const text of texts) {
      expect(text).not.toMatch(/kf drive/);
      expect(text).not.toMatch(/--status --json/);
      expect(text).not.toContain("re-adopt");
    }
  });

  it("runs the phase skills itself, up to slots=N items, each in its own worktree, dispatching seats in the background", () => {
    expect(skill).toMatch(/slots=N/);
    expect(skill).toMatch(/up to `?slots=N`? (started )?items/i);
    expect(skill).toMatch(/own (item )?worktree/i);
    expect(skill).toMatch(/runs? (each|every) item's phase skills (itself|itself\b)|phase skills itself/i);
    expect(skill).toMatch(/background/i);
    expect(skill).toMatch(/advance[^\n]*another item[^\n]*(while|run)|while[^\n]*(seats?|subagents?)[^\n]*(run|running)[^\n]*advance/i);
  });

  it("makes slots=1 behave like one kanban-flow session", () => {
    expect(skill).toMatch(/`slots=1`[^\n]*one kanban-flow session/i);
  });

  it("resumes after compaction from the travel ledger then the item's loop ledger, restarting no item", () => {
    expect(skill).toMatch(/compaction/i);
    expect(skill).toMatch(/\.kf\/travel\/progress\.md[\s\S]{0,400}loop\/progress\.md/);
    expect(skill).toMatch(/restarts? no item|never restarts? an item|does not restart/i);
  });

  it("never approves, archives, merges or pushes to main, and runs no backward, planning or backlog stage move, and never --watch", () => {
    const blocks = bashBlocks(skill);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/kf (approve|archive|ship|cancel)\b/);
      expect(block).not.toMatch(/kf stage\s+\S+\s+(planning|backlog)\b/);
      expect(block).not.toMatch(/gh pr merge|git merge/);
      expect(block).not.toMatch(/git push[^\n]*\b(main|master)\b/);
      expect(block).not.toMatch(/--watch|--follow/);
    }
    for (const forbidden of ["`kf approve`", "`kf archive`", "`gh pr merge`"]) expect(skill).toContain(forbidden);
    expect(skill).not.toContain("kf travel");
  });

  it("allows the forward stage moves and the item-branch push and pull request inside the item worktree", () => {
    const rule = skill.split("\n").find((l) => /never approves, archives, merges/.test(l)) ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/never runs[^.]*`kf stage`/);
    expect(rule).not.toMatch(/never runs[^.]*`git push`/);
    expect(skill).toMatch(/forward[^\n]*`kf stage`|`kf stage`[^\n]*forward/i);
    expect(skill).toContain("gh pr create");
    expect(skill).toMatch(/item branch/i);
    expect(skill).toMatch(/push(es)? (to|of) (the )?(default branch|main)|push to main/i);
    expect(skill).toMatch(/(backward|planning|backlog)[^\n]*`kf stage|`kf stage[^\n]*(backward|planning|backlog)/i);
  });

  it("states the ownership rule, and the phase skills honour it", () => {
    expect(skill).toMatch(/`driving` or `blocked` means travel owns/);
    for (const other of ["flow", "implement"]) {
      const text = readFileSync(join(PKG_ROOT, "assets", "skills", other, "SKILL.md"), "utf8");
      expect(text, other).toMatch(/`driving` or `blocked`/);
      expect(text, other).toContain(".kf/travel/progress.md");
    }
  });

  it("names the owner by the owner token on the travel ledger line", () => {
    for (const other of ["flow", "implement"]) {
      const text = readFileSync(join(PKG_ROOT, "assets", "skills", other, "SKILL.md"), "utf8");
      expect(text, other).toContain("a session that is not travel never runs a task loop for an `owner=travel` line");
      expect(text, other).toContain("`owner=human`");
    }
  });

  it("sizes by kind and measures a carried line against its first estimate", () => {
    expect(skill).toContain("estimates size <minutes> <files> .kf/travel/estimates.md <kind>");
    const measure = bashBlocks(skill).find((b) => b.includes("estimates measure")) ?? "";
    expect(measure).toContain("--est <est0>");
    expect(measure).toContain("--estmin <n>");
    expect(skill).toContain("A carried line keeps its first `est0` and `estmin`");
    expect(skill).not.toContain("learn=no");
    for (const ref of ["ledger-format.md", "estimation.md"]) {
      const text = read("references", ref);
      for (const s of ["est0=<size>"]) expect(text, `${ref} ${s}`).toContain(s);
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
    expect(estimation).not.toContain("runs[]");
    const ledger = read("references", "ledger-format.md");
    for (const state of ["queued", "driving", "waiting-to-merge", "blocked", "done", "carry-over"]) expect(ledger, state).toContain(`\`${state}\``);
  });
});
