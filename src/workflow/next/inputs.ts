import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { readDeveloperCeiling } from "../../cli/commands/tasks.js";
import { parseMarkdownTable, readMarkdownSection, splitFrontmatter } from "../../shared/frontmatter.js";
import { runGit } from "../../shared/git.js";
import type { Feature } from "../features.js";
import { ARTIFACTS } from "../schema.js";
import { checkTaskGraph, taskView } from "../tasks.js";
import { verifyLogPath } from "../verify.js";
import type { InputsRead, LoopInputs, LoopTask, TestType, VerifyRun } from "./types.js";

const TEST_TYPE_ORDER: TestType[] = ["Unit", "Integration", "UI", "E2E"];
const SHA = /\b[0-9a-f]{7,40}\b/;
const VERIFY_HEADER = /^## kf verify (\S+) exit=(-?\d+)\s*$/;

const bodyOf = (dir: string, file: string): string | null => {
  const path = join(dir, file);
  return existsSync(path) ? splitFrontmatter(readFileSync(path, "utf8")).body : null;
};

function inlineWaves(planBody: string | null): Set<number> {
  const waves = new Set<number>();
  if (planBody === null) return waves;
  for (const m of planBody.matchAll(/^Execution: wave (\d+) inline\s*$/gm)) waves.add(Number(m[1]));
  return waves;
}

function refIds(text: string): Set<string> {
  return new Set([...text.matchAll(/\b(?:FR|UC)-\d+\b/g)].map((m) => m[0]));
}

/** Per TC block of the test case file: the FR/UC ids it names and its test types. */
function readTestCases(dir: string): { refs: Set<string>; types: TestType[] }[] {
  const body = bodyOf(dir, ARTIFACTS["test-cases"].file);
  if (body === null) return [];
  const cases: { refs: Set<string>; types: TestType[] }[] = [];
  for (const block of body.split(/^(?=## TC-\d+)/m).filter((b) => /^## TC-\d+/.test(b))) {
    const table = parseMarkdownTable(block);
    if (!table) continue;
    const field = (name: string): string => table.rows.find((r) => r[0]?.trim().toLowerCase() === name)?.[1] ?? "";
    const refs = refIds(`${field("requirement reference")} ${field("use case reference")}`);
    const typeText = field("test type").toLowerCase();
    const types = TEST_TYPE_ORDER.filter((t) => new RegExp(`\\b${t.toLowerCase()}\\b`).test(typeText));
    cases.push({ refs, types });
  }
  return cases;
}

function readLevel(dir: string, kind: "feature" | "bug"): string | null {
  const body = bodyOf(dir, ARTIFACTS["spec-requirement"].file);
  if (body === null) return null;
  const scope = kind === "bug" ? body : (readMarkdownSection(body, "Test Strategy") ?? "");
  const label = kind === "bug" ? "Test Level" : "Level";
  const m = new RegExp(`^\\s*[-*]\\s*${label}:[ \\t]*(.*)$`, "im").exec(scope);
  const value = m?.[1].trim().toLowerCase();
  return value ? value : null;
}

function bugTasks(dir: string): LoopTask[] | null {
  const path = join(dir, "tasks.md");
  if (!existsSync(path)) return null;
  const found: { id: string; regression: boolean }[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const box = /^\s*-\s\[[ xX]\]\s+(.*)$/.exec(line);
    const id = box ? /\bTASK-\d+\b/.exec(box[1]) : null;
    if (box && id) found.push({ id: id[0], regression: /\bregression\b/i.test(box[1]) });
  }
  if (found.length === 0) return null;
  return found.map((t) => ({
    id: t.id,
    dependencies: [],
    files: null,
    wave: 1,
    overlaps: found.filter((o) => o.id !== t.id).map((o) => o.id),
    inline: false,
    testTypes: t.regression ? ["Unit"] : [],
  }));
}

function loopFiles(dir: string, suffix: string): { id: string; path: string }[] {
  const loop = join(dir, "loop");
  if (!existsSync(loop)) return [];
  return readdirSync(loop).flatMap((name) => {
    const m = new RegExp(`^task-(\\d+)-${suffix}$`).exec(name);
    return m ? [{ id: `TASK-${m[1]}`, path: join(loop, name) }] : [];
  });
}

// A section opens only on a heading or a line that starts with the label, so prose mentions do not.
const COMMITS_LABEL = /^(?:#+\s*|\**)Commits created/;
// A commit line: an optional bullet, then a (possibly backticked) sha as the first token.
const COMMIT_LINE = /^\s*(?:[-*]\s+)?`?([0-9a-f]{7,40})\b/;

function commitsOfReport(text: string): string[] | null {
  const shas: string[] = [];
  const add = (sha: string): void => {
    if (!shas.includes(sha)) shas.push(sha);
  };
  let found = false;
  let open = false;
  for (const line of text.split("\n")) {
    const label = COMMITS_LABEL.exec(line);
    if (label) {
      found = true;
      open = true;
      const onLabel = SHA.exec(line.slice(label[0].length).replace(/^[*_]*\s*:?/, ""));
      if (onLabel) add(onLabel[0]);
      continue;
    }
    if (line.startsWith("#")) {
      open = false;
      continue;
    }
    if (!open) continue;
    const sha = COMMIT_LINE.exec(line);
    if (sha) add(sha[1]);
  }
  return found ? shas : null;
}

// task-NNN-report.md first, then task-NNN-fix-R-report.md by ascending numeric R, then the other
// task-NNN-fix-<name>-report.md (fix-past-cap, …) by name. The test-writer's and automation-writer's
// fix-round reports (…-tests-report.md, …-e2e-report.md) are not developer reports.
function reportFiles(dir: string): { id: string; path: string }[] {
  const loop = join(dir, "loop");
  if (!existsSync(loop)) return [];
  const fixes = readdirSync(loop).flatMap((name) => {
    const m = /^task-(\d+)-fix-(.+)-report\.md$/.exec(name);
    if (!m || /-(?:tests|e2e)$/.test(m[2])) return [];
    return [{ id: `TASK-${m[1]}`, round: /^\d+$/.test(m[2]) ? Number(m[2]) : null, name: m[2], path: join(loop, name) }];
  });
  const numeric = fixes.filter((f) => f.round !== null).sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  const named = fixes.filter((f) => f.round === null).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return [...loopFiles(dir, "report\\.md"), ...numeric, ...named];
}

function parseVerifyLog(text: string): VerifyRun[] {
  const runs: { ts: number; exit: number; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    const h = VERIFY_HEADER.exec(line);
    if (h) runs.push({ ts: Date.parse(h[1]), exit: Number(h[2]), lines: [] });
    else if (runs.length > 0) runs[runs.length - 1].lines.push(line);
  }
  return runs.map((r) => ({ ts: r.ts, exit: r.exit, text: r.lines.join("\n") }));
}

function readGitLog(root: string, feature: Feature): { sha: string; ts: number }[] | string {
  const wt = feature.meta?.worktree;
  const inWorktree = wt?.path !== undefined && existsSync(wt.path);
  const dir = inWorktree ? wt.path : root;
  const ref = inWorktree && wt.branch ? wt.branch : "HEAD";
  // Outside any repository there is no history to schedule against, which is not a read failure.
  // The exit status of rev-parse decides it, so a localized git message cannot change the outcome.
  if (runGit(dir, ["rev-parse", "--is-inside-work-tree"]).code !== 0) return [];
  const res = runGit(dir, ["log", "--format=%H %ct", "-n", "1000", ref, "--"]);
  if (res.code !== 0) return `git log ${ref} failed (exit ${res.code}) in ${dir}: ${res.stderr.trim()}`;
  return res.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ct] = l.split(" ");
      return { sha, ts: Number(ct) * 1000 };
    })
    .reverse();
}

export function readLoopInputs(root: string, feature: Feature): InputsRead {
  const kind = feature.meta?.kind === "bug" ? "bug" : "feature";

  const ceiling = readDeveloperCeiling(root);
  if ("failed" in ceiling) return { ok: false, reason: ceiling.failed };

  let tasks: LoopTask[];
  if (kind === "bug") {
    const read = bugTasks(feature.dir);
    if (read === null) {
      return { ok: false, reason: `'${feature.name}' has no TASK-### checkbox lines in tasks.md; write '- [ ] 1. TASK-001: <what to do>' lines into tasks.md so kf next can schedule them.` };
    }
    tasks = read;
  } else {
    const errors = checkTaskGraph(feature).filter((f) => f.severity === "ERROR");
    if (errors.length > 0) {
      return { ok: false, reason: [`Task graph of '${feature.name}' is invalid; fix the plan:`, ...errors.map((f) => `ERROR ${f.code}: ${f.message}`)].join("\n") };
    }
    const view = taskView(feature);
    if (view.length === 0) return { ok: false, reason: `'${feature.name}' has no planned tasks; fill the Task Breakdown of the implementation plan.` };
    const inline = inlineWaves(bodyOf(feature.dir, ARTIFACTS["implementation-plan"].file));
    const cases = readTestCases(feature.dir);
    tasks = view.map((t) => {
      const refs = refIds(t.refs ?? "");
      const types = new Set(cases.filter((c) => [...c.refs].some((r) => refs.has(r))).flatMap((c) => c.types));
      return {
        id: t.id,
        dependencies: t.dependencies,
        files: t.files,
        wave: t.wave,
        overlaps: t.overlaps.map((o) => o.task),
        inline: inline.has(t.wave),
        testTypes: TEST_TYPE_ORDER.filter((x) => types.has(x)),
      };
    });
  }

  const reportCommits: Record<string, string[]> = {};
  for (const f of reportFiles(feature.dir)) {
    const shas = commitsOfReport(readFileSync(f.path, "utf8"));
    if (shas === null) continue;
    reportCommits[f.id] = [...(reportCommits[f.id] ?? []), ...shas.filter((s) => !(reportCommits[f.id] ?? []).includes(s))];
  }

  const verifyRuns: Record<string, VerifyRun[]> = {};
  for (const f of loopFiles(feature.dir, "verify\\.log")) {
    const path = verifyLogPath(feature.dir, f.id);
    verifyRuns[f.id] = parseVerifyLog(readFileSync(path, "utf8"));
  }

  const gitLog = readGitLog(root, feature);
  if (typeof gitLog === "string") return { ok: false, reason: gitLog };

  const inputs: LoopInputs = {
    feature: feature.name,
    kind,
    level: readLevel(feature.dir, kind),
    tasks,
    ceiling,
    reportCommits,
    verifyRuns,
    gitLog,
  };
  return { ok: true, inputs };
}
