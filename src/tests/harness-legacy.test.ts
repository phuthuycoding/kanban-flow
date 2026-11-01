import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDoctor, runDoctorFixes, type DoctorFinding } from "../project/doctor.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import { readProjectConfig } from "../project/config.js";
import { findFeature, AmbiguousFeatureError } from "../workflow/features.js";
import { PKG_ROOT } from "../shared/paths.js";
import type { ParsedArgs } from "../cli/args.js";

const KF = join(PKG_ROOT, "dist", "index.js");
const LEGACY = ["main", "roles", "stages", "runners", "parallel", "retries", "maxLoops", "budget"] as const;
const META_LEFTOVERS = ["drive", "runs", "sessions", "tasks"] as const;
const TS = "20260916_1800";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;
const children: ChildProcess[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-hlegacy-"));
});
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
});

/** Run the real built CLI. */
function kf(cwd: string, ...argv: string[]): { code: number; out: string } {
  const r = spawnSync(process.execPath, [KF, ...argv], { cwd, encoding: "utf8", env: process.env });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

const configFile = () => join(root, ".kf", "config.json");

async function readRaw(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(configFile(), "utf8")) as Record<string, unknown>;
}

/** A project as `kf init --minimal` leaves it, with its harness block replaced by `harness`. */
async function projectWithHarness(harness: unknown): Promise<Record<string, unknown>> {
  expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
  const cfg = await readRaw();
  if (harness === undefined) delete cfg.harness;
  else cfg.harness = harness;
  await writeFile(configFile(), JSON.stringify(cfg, null, 2));
  return cfg;
}

/** Every file under a directory, path → contents, for proving nothing was written. */
async function snapshot(dir: string, base = dir): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, await snapshot(full, base));
    else out[full.slice(base.length)] = await readFile(full, "utf8");
  }
  return out;
}

const withCode = (findings: DoctorFinding[], code: string) => findings.filter((f) => f.message.includes(code));
const text = (f: DoctorFinding) => `${f.message} ${f.action ?? ""}`;

const VERIFY = { task: [["npm", "test"]], stage: [["npm", "run", "lint"]] };

/** Every legacy key, each with a value an earlier release accepted. */
function fullLegacyBlock(): Record<string, unknown> {
  return {
    main: "architect",
    roles: { architect: { runner: "claude" }, coder: "claude" },
    stages: { implementation: ["coder"], dones: ["architect"] },
    runners: { claude: { start: ["claude", "{prompt}"], resume: ["claude", "--resume", "{session}"] } },
    parallel: 2,
    retries: 0,
    maxLoops: 4,
    budget: { maxRuns: 9 },
  };
}

/** Every legacy key, each with a type no earlier release accepted. */
function wrongTypedLegacyBlock(): Record<string, unknown> {
  return { main: 7, roles: "x", stages: "nobody", runners: [], parallel: "3", retries: {}, maxLoops: null, budget: [] };
}

describe("a config still holding removed harness keys", () => {
  it.each([
    ["verify only", { verify: VERIFY }],
    ["the full legacy block", { ...fullLegacyBlock(), verify: VERIFY }],
    ["legacy keys of the wrong type", { ...wrongTypedLegacyBlock(), verify: VERIFY }],
  ])("loads with %s and no command reports an invalid config", async (_name, harness) => {
    await projectWithHarness(harness);
    expect(() => readProjectConfig(root)).not.toThrow();
    expect(readProjectConfig(root).harness?.verify).toEqual(VERIFY);
    for (const argv of [["status"], ["validate", "--all"], ["doctor"]]) {
      const res = kf(root, ...argv);
      expect(res.out, argv.join(" ")).not.toContain("Invalid project config");
    }
    expect(runDoctor(root).findings.some((f) => f.message.includes("Invalid project config"))).toBe(false);
  });

  it("kf doctor gives a verify-only config no legacy warning", async () => {
    await projectWithHarness({ verify: VERIFY });
    const findings = runDoctor(root).findings;
    expect(findings.some((f) => f.message.includes("Invalid project config"))).toBe(false);
    expect(withCode(findings, "harness_legacy_key")).toEqual([]);
  });

  it.each([
    ["the full legacy block", fullLegacyBlock()],
    ["legacy keys of the wrong type", wrongTypedLegacyBlock()],
  ])("kf doctor warns once per legacy key in %s and names kf doctor --fix", async (_name, legacy) => {
    await projectWithHarness({ ...legacy, verify: VERIFY });
    const findings = withCode(runDoctor(root).findings, "harness_legacy_key");
    expect(findings).toHaveLength(LEGACY.length);
    for (const key of LEGACY) {
      const forKey = findings.filter((f) => new RegExp(`\\b${key}\\b`).test(f.message));
      expect(forKey, key).toHaveLength(1);
      expect(forKey[0].level, key).toBe("WARNING");
      expect(text(forKey[0]), key).toContain("kf doctor --fix");
    }
  });

  it("kf doctor warns only about the legacy keys present", async () => {
    await projectWithHarness({ roles: "x", budget: [], verify: VERIFY });
    const findings = withCode(runDoctor(root).findings, "harness_legacy_key");
    expect(findings).toHaveLength(2);
    expect(findings.filter((f) => /\broles\b/.test(f.message))).toHaveLength(1);
    expect(findings.filter((f) => /\bbudget\b/.test(f.message))).toHaveLength(1);
  });

  it("kf doctor without --fix changes no file", async () => {
    await projectWithHarness({ ...wrongTypedLegacyBlock(), verify: VERIFY });
    const before = await snapshot(root);
    expect((await cmdDoctor(args("doctor"), root)).stdout).toContain("harness_legacy_key");
    expect(await snapshot(root)).toEqual(before);
  });
});

describe("kf doctor --fix on removed harness keys", () => {
  it("removes every legacy key and keeps harness.verify and every other key as written", async () => {
    const cfg = await projectWithHarness({ ...fullLegacyBlock(), verify: VERIFY });
    cfg.worktree = { enabled: false };
    cfg.reviewer = "someone";
    await writeFile(configFile(), JSON.stringify(cfg, null, 2));

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.code, res.stdout).toBe(0);

    const expected = { ...cfg, harness: { verify: VERIFY } };
    const after = await readFile(configFile(), "utf8");
    expect(JSON.parse(after)).toEqual(expected);
    expect(after.trimEnd()).toBe(JSON.stringify(expected, null, 2));
    expect(withCode(runDoctor(root).findings, "harness_legacy_key")).toEqual([]);
    expect(readProjectConfig(root).harness?.verify).toEqual(VERIFY);
  });

  it("removes legacy keys of the wrong type", async () => {
    await projectWithHarness({ ...wrongTypedLegacyBlock(), verify: VERIFY });
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect((await readRaw()).harness).toEqual({ verify: VERIFY });
    expect(withCode(runDoctor(root).findings, "harness_legacy_key")).toEqual([]);
  });

  it("drops a harness block left empty by the removal", async () => {
    const cfg = await projectWithHarness(fullLegacyBlock());
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    const after = await readRaw();
    expect(after).not.toHaveProperty("harness");
    const { harness: _dropped, ...rest } = cfg;
    expect(after).toEqual(rest);
  });

  it("keeps a config's four-space indentation", async () => {
    const cfg = await projectWithHarness({ ...fullLegacyBlock(), verify: VERIFY });
    await writeFile(configFile(), JSON.stringify(cfg, null, 4));
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect((await readFile(configFile(), "utf8")).trimEnd()).toBe(JSON.stringify({ ...cfg, harness: { verify: VERIFY } }, null, 4));
  });

  it("changes nothing on a verify-only config", async () => {
    await projectWithHarness({ verify: VERIFY });
    const before = await readFile(configFile(), "utf8");
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(await readFile(configFile(), "utf8")).toBe(before);
  });
});

describe("kf init on a config holding removed harness keys", () => {
  it.each([
    ["kf init --minimal", { minimal: true }],
    ["kf init --defaults (bootstrap)", { defaults: true }],
  ])("%s leaves the legacy keys in place", async (_name, options) => {
    const harness = { ...fullLegacyBlock(), verify: VERIFY };
    await projectWithHarness(harness);
    expect((await cmdInit(args("init", [], options), root)).code).toBe(0);
    expect((await readRaw()).harness).toEqual(harness);
    expect(withCode(runDoctor(root).findings, "harness_legacy_key")).toHaveLength(LEGACY.length);
  });

  it.each([
    ["kf init --minimal", { minimal: true }],
    ["kf init --defaults (bootstrap)", { defaults: true }],
  ])("%s keeps legacy keys of the wrong type", async (_name, options) => {
    const harness = { ...wrongTypedLegacyBlock(), verify: VERIFY };
    await projectWithHarness(harness);
    expect((await cmdInit(args("init", [], options), root)).code).toBe(0);
    expect((await readRaw()).harness).toEqual(harness);
  });

  it.each([
    ["kf init --minimal", { minimal: true }],
    ["kf init --defaults (bootstrap)", { defaults: true }],
  ])("a fresh %s writes a config with no harness block", async (_name, options) => {
    expect((await cmdInit(args("init", [], options), root)).code).toBe(0);
    const cfg = await readRaw();
    expect(cfg.schema).toBe("kanban-flow");
    expect(cfg).not.toHaveProperty("harness");
  });
});

/** A dead pid: above the default pid_max on Linux and macOS. */
const DEAD_PID = 2 ** 22 + 12345;

function leftovers(supervisorPid: number, runPid: number): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    drive: { id: "drv-1", status: "running", step: "review", loops: 0, runs: 1, configHash: "h", supervisorPid, startedAt: now, updatedAt: now },
    runs: [{ id: "run-a", role: "reviewer", runner: "codex", stage: "review", mode: "start", at: now, log: "runs/run-a.log", status: "running", pid: runPid }],
    sessions: { reviewer: "session-1" },
    tasks: { "TASK-001": { state: "done", attempts: 1, updatedAt: now } },
  };
}

async function item(name: string, extra: Record<string, unknown>): Promise<{ file: string; kept: Record<string, unknown> }> {
  const dir = join(root, ".works", "implementation", `${name}_${TS}`);
  await mkdir(dir, { recursive: true });
  const kept = { schema: "kanban-flow", feature: name, context: "app", created: TS, executionId: "run-1" };
  const file = join(dir, ".kfw.json");
  await writeFile(file, JSON.stringify({ ...kept, ...extra }, null, 2));
  return { file, kept };
}

/** A process that stays alive until the test kills it, standing in for a pre-upgrade worker. */
function liveWorker(): ChildProcess {
  // The extra argv makes its command line look like a kf drive; a bare node process would not.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "dist/index.js", "drive"], { stdio: "ignore" });
  children.push(child);
  return child;
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
};

describe("work items still holding drive, runs, sessions and tasks", () => {
  it("kf doctor warns once per item and names each live pid with stop this process yourself", async () => {
    await projectWithHarness(undefined);
    const worker = liveWorker();
    const supervisor = liveWorker();
    await item("alpha", leftovers(supervisor.pid!, worker.pid!));
    await item("bravo", leftovers(DEAD_PID, DEAD_PID));
    await item("clean", {});

    const findings = withCode(runDoctor(root).findings, "meta_legacy_run_state");
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.level).toBe("WARNING");
      expect(text(f)).toContain("kf doctor --fix");
    }
    const liveFinding = findings.filter((f) => `${f.area} ${f.message}`.includes("alpha"));
    expect(liveFinding, JSON.stringify(findings)).toHaveLength(1);
    expect(liveFinding[0].message).toContain(String(supervisor.pid));
    expect(liveFinding[0].message).toContain(String(worker.pid));
    expect(liveFinding[0].message).toContain("looks like a kf drive from before the upgrade");
    expect(liveFinding[0].message).toContain("stop it");
    const deadFinding = findings.filter((f) => `${f.area} ${f.message}`.includes("bravo"));
    expect(deadFinding, JSON.stringify(findings)).toHaveLength(1);
  });

  it("kf doctor without --fix leaves the items unchanged", async () => {
    await projectWithHarness(undefined);
    await item("alpha", leftovers(process.pid, process.pid));
    const before = await snapshot(root);
    expect((await cmdDoctor(args("doctor"), root)).stdout).toContain("meta_legacy_run_state");
    expect(await snapshot(root)).toEqual(before);
  });

  it("kf doctor --fix strips the four keys of an item with no live pid and keeps every other field", async () => {
    await projectWithHarness(undefined);
    const dead = await item("bravo", leftovers(DEAD_PID, DEAD_PID));

    await cmdDoctor(args("doctor", [], { fix: true }), root);

    const after = JSON.parse(await readFile(dead.file, "utf8")) as Record<string, unknown>;
    for (const key of META_LEFTOVERS) expect(after, key).not.toHaveProperty(key);
    expect(after).toEqual(dead.kept);
    expect(withCode(runDoctor(root).findings, "meta_legacy_run_state")).toEqual([]);
  });

  it("kf doctor --fix leaves an item naming a live pid byte-identical, reports the pid and kills no process", async () => {
    await projectWithHarness(undefined);
    const worker = liveWorker();
    const live = await item("alpha", leftovers(DEAD_PID, worker.pid!));
    const dead = await item("bravo", leftovers(DEAD_PID, DEAD_PID));
    const liveText = await readFile(live.file, "utf8");

    const res = await runDoctorFixes(root);

    expect(await readFile(live.file, "utf8")).toBe(liveText);
    expect(res.fixed.some((l) => l.includes("alpha_"))).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].level).toBe("ERROR");
    expect(res.failures[0].area).toContain("alpha_");
    expect(res.failures[0].message).toContain(String(worker.pid));
    expect(res.failures[0].message).toContain("stop");
    expect(JSON.parse(await readFile(dead.file, "utf8"))).toEqual(dead.kept);
    expect(isAlive(worker.pid!)).toBe(true);
    expect(worker.exitCode).toBeNull();
    expect(worker.signalCode).toBeNull();
  });

  it("kf doctor --fix strips an item whose recorded pid now belongs to an unrelated process", async () => {
    await projectWithHarness(undefined);
    // A recycled pid: alive, but not kf, so nothing there needs stopping first.
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
    children.push(unrelated);
    const recycled = await item("recycled", leftovers(DEAD_PID, unrelated.pid!));

    const res = await runDoctorFixes(root);

    expect(res.failures).toEqual([]);
    const after = JSON.parse(await readFile(recycled.file, "utf8")) as Record<string, unknown>;
    for (const key of META_LEFTOVERS) expect(after, key).not.toHaveProperty(key);
    expect(after).toEqual(recycled.kept);
    expect(isAlive(unrelated.pid!)).toBe(true);
  });

  it("kf doctor reports no live pid for an unrelated process holding a recorded pid", async () => {
    await projectWithHarness(undefined);
    const unrelated = spawn("sleep", ["30"], { stdio: "ignore" });
    children.push(unrelated);
    await item("recycled", leftovers(DEAD_PID, unrelated.pid!));

    const finding = withCode(runDoctor(root).findings, "meta_legacy_run_state")[0];
    expect(finding.message).not.toContain("looks like a kf drive");
    expect(finding.message).not.toContain(String(unrelated.pid));
  });

  it("kf doctor --fix exits 1 for an item naming a live pid", async () => {
    await projectWithHarness(undefined);
    await item("alpha", leftovers(DEAD_PID, liveWorker().pid!));
    const res = kf(root, "doctor", "--fix");
    expect(res.code, res.out).toBe(1);
    expect(res.out.split("\n").filter((l) => l.includes("[ERROR]") && l.includes("alpha_")), res.out).toHaveLength(1);
  });

  it.each([
    ["four spaces", "    "],
    ["a tab", "\t"],
  ])("kf doctor --fix keeps an item meta indented with %s", async (_name, indent) => {
    await projectWithHarness(undefined);
    const { file, kept } = await item("indented", leftovers(DEAD_PID, DEAD_PID));
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    await writeFile(file, `${JSON.stringify(parsed, null, indent)}\n`);

    await cmdDoctor(args("doctor", [], { fix: true }), root);

    expect(await readFile(file, "utf8")).toBe(`${JSON.stringify(kept, null, indent)}\n`);
  });

  it("kf doctor --fix reports an ambiguous item as an error and still fixes the others", async () => {
    await projectWithHarness(undefined);
    // `a_<TS>_<TS>` parses to the name `a_<TS>`, which is also the folder of the item named `a`.
    const first = await item("a", leftovers(DEAD_PID, DEAD_PID));
    const second = await item(`a_${TS}`, leftovers(DEAD_PID, DEAD_PID));
    const firstText = await readFile(first.file, "utf8");

    const res = await runDoctorFixes(root);

    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].level).toBe("ERROR");
    expect(res.failures[0].area).toContain(`a_${TS}/.kfw.json`);
    expect(res.failures[0].message).toContain("Ambiguous");
    expect(await readFile(first.file, "utf8")).toBe(firstText);
    expect(JSON.parse(await readFile(second.file, "utf8"))).toEqual(second.kept);
  });

  it("kf doctor's live-pid finding tells the user to stop the pid first, then run kf doctor --fix", async () => {
    await projectWithHarness(undefined);
    const worker = liveWorker();
    await item("alpha", leftovers(DEAD_PID, worker.pid!));

    const finding = withCode(runDoctor(root).findings, "meta_legacy_run_state")[0];
    expect(finding.action).toContain(String(worker.pid));
    expect(finding.action).toContain("then kf doctor --fix");
    expect(finding.action).not.toContain("removes");
  });

  it("findFeature throws an AmbiguousFeatureError for a name two items answer to", async () => {
    await projectWithHarness(undefined);
    await item("a", {});
    await item(`a_${TS}`, {});

    let caught: unknown;
    try {
      findFeature(root, `a_${TS}`);
    } catch (err) {
      caught = err;
    }
    expect(typeof AmbiguousFeatureError).toBe("function");
    expect(caught).toBeInstanceOf(AmbiguousFeatureError);
    expect((caught as Error).message).toContain("Ambiguous");
  });

  it("kf doctor --fix names an unparseable item meta, leaves it unchanged and still fixes the others", async () => {
    await projectWithHarness(undefined);
    const broken = join(root, ".works", "implementation", `broken_${TS}`);
    await mkdir(broken, { recursive: true });
    const brokenText = '{ "schema": "kanban-flow", "drive": ';
    await writeFile(join(broken, ".kfw.json"), brokenText);
    const ok = await item("ok", leftovers(DEAD_PID, DEAD_PID));

    let syntaxText = "";
    try {
      JSON.parse(brokenText);
    } catch (err) {
      syntaxText = (err as SyntaxError).message;
    }
    expect(syntaxText).not.toBe("");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain(`broken_${TS}`);
    const errors = res.stdout.split("\n").filter((l) => l.includes("[ERROR]") && l.includes(`broken_${TS}`));
    expect(errors, res.stdout).toHaveLength(1);
    expect(errors[0]).toContain(syntaxText);
    expect(await readFile(join(broken, ".kfw.json"), "utf8")).toBe(brokenText);
    expect(JSON.parse(await readFile(ok.file, "utf8"))).toEqual(ok.kept);
  });

  it.skipIf(process.getuid?.() === 0)("kf doctor --fix reports an item it cannot rewrite as an error, not as fixed, and still fixes the others", async () => {
    await projectWithHarness(undefined);
    const ok = await item("alpha", leftovers(DEAD_PID, DEAD_PID));
    const locked = await item("bravo", leftovers(DEAD_PID, DEAD_PID));
    const lockedDir = join(root, ".works", "implementation", `bravo_${TS}`);
    const lockedText = await readFile(locked.file, "utf8");

    // A read-only folder makes the temp-file-and-rename write fail while the file itself stays readable.
    await chmod(lockedDir, 0o555);
    let res: { code: number; out: string };
    try {
      res = kf(root, "doctor", "--fix");
    } finally {
      await chmod(lockedDir, 0o755);
    }

    expect(res.code, res.out).toBe(1);
    expect(JSON.parse(await readFile(ok.file, "utf8"))).toEqual(ok.kept);
    expect(await readFile(locked.file, "utf8")).toBe(lockedText);

    const lines = res.out.split("\n");
    const fixedAt = lines.findIndex((l) => l.startsWith("Fixed ("));
    if (fixedAt !== -1) {
      const end = lines.findIndex((l, i) => i > fixedAt && l.trim() === "");
      const fixedBlock = lines.slice(fixedAt, end === -1 ? undefined : end).join("\n");
      expect(fixedBlock).not.toContain(`bravo_${TS}`);
    }
    const errors = lines.filter((l) => l.includes("[ERROR]") && l.includes(`bravo_${TS}/.kfw.json`));
    expect(errors, res.out).toHaveLength(1);
    expect(errors[0]).toContain("EACCES");
  });
});

describe("kf init --minimal on an existing config", () => {
  function gitWithOrigin(): void {
    execFileSync("git", ["init", "-q", root], { stdio: "pipe" });
    execFileSync("git", ["-C", root, "remote", "add", "origin", "https://github.com/acme/widgets.git"], { stdio: "pipe" });
  }

  it("fills a missing repository from the origin remote and leaves legacy keys untouched", async () => {
    gitWithOrigin();
    const harness = { ...fullLegacyBlock(), verify: VERIFY };
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(configFile(), JSON.stringify({ schema: "kanban-flow", created: "x", agents: ["claude"], harness }, null, 2));

    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);

    const cfg = await readRaw();
    expect(cfg.repository).toBe("acme/widgets");
    expect(cfg.harness).toEqual(harness);
    expect(cfg.created).toBe("x");
  });

  it("fills a missing schema and created alongside the repository", async () => {
    gitWithOrigin();
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(configFile(), JSON.stringify({ agents: ["claude"] }, null, 2));

    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);

    const cfg = await readRaw();
    expect(cfg.schema).toBe("kanban-flow");
    expect(typeof cfg.created).toBe("string");
    expect(cfg.repository).toBe("acme/widgets");
  });

  it("keeps a repository the config already names", async () => {
    gitWithOrigin();
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(configFile(), JSON.stringify({ schema: "kanban-flow", created: "x", repository: "other/repo" }, null, 2));

    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);

    expect((await readRaw()).repository).toBe("other/repo");
  });

  it("adds only the missing keys to the raw file and keeps ship, legacy statusMap keys and indent as written", async () => {
    gitWithOrigin();
    const original = {
      schema: "kanban-flow",
      created: "x",
      agents: ["claude"],
      ship: { mode: "pr", base: "main" },
      project: { owner: "acme", number: 3, statusMap: { dones: "Closed", shipping: "Shipping", review: "In review" } },
      harness: { ...fullLegacyBlock(), verify: VERIFY },
    };
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(configFile(), `${JSON.stringify(original, null, 4)}\n`);

    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);

    expect(await readFile(configFile(), "utf8")).toBe(`${JSON.stringify({ ...original, repository: "acme/widgets" }, null, 4)}\n`);
  });

  it("adds a missing schema and created to the raw file without disturbing the other keys", async () => {
    gitWithOrigin();
    const original = { agents: ["claude"], ship: { mode: "pr" }, project: { owner: "acme", number: 3, statusMap: { dones: "Closed" } } };
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(configFile(), `${JSON.stringify(original, null, 4)}\n`);

    expect((await cmdInit(args("init", [], { minimal: true }), root)).code).toBe(0);

    const after = await readFile(configFile(), "utf8");
    const cfg = JSON.parse(after) as Record<string, unknown>;
    expect(cfg).toMatchObject({ ...original, schema: "kanban-flow", repository: "acme/widgets" });
    expect(typeof cfg.created).toBe("string");
    expect(after).toContain('\n    "ship": {\n        "mode": "pr"\n    }');
  });
});
