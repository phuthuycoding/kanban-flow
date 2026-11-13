import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  planInstall,
  planUninstall,
  runInstallCommand,
  type Ctx,
  type Given,
  type Prompter,
} from "../integrations/install-onboarding.js";
import { PromptAbort, type Choice } from "../project/prompts.js";
import { agentLabel } from "../integrations/agents.js";
import type { cmdInstall, cmdUninstall } from "../integrations/install.js";
import { ensureWorksStructure } from "../workflow/features.js";

type StepKind = "mode" | "agents" | "scope" | "purge" | "removeUser" | "confirm";

type Call =
  | { kind: StepKind; via: "select"; question: string; choices: readonly Choice[]; initial: number }
  | { kind: "agents"; via: "many"; question: string; options: readonly string[]; initial: ReadonlySet<number> };

type Answers = Partial<{
  mode: string;
  agents: string[];
  scope: string;
  purge: string;
  removeUser: string;
  confirm: string;
}>;

// Choices are matched by their first word ("Quick — ...", "global ...", "Yes — ...") so the
// tests do not depend on the decoration around it.
const firstWord = (label: string): string => label.trim().split(/[\s—:(),-]+/)[0].toLowerCase();

const indexOfWord = (choices: readonly Choice[], word: string): number =>
  choices.findIndex((c) => firstWord(c.label) === word.toLowerCase());

const optionIsAgent = (option: string, id: string): boolean =>
  option.split(/[^A-Za-z0-9]+/).includes(id) || option.includes(agentLabel(id));

function classify(question: string, choices: readonly Choice[]): StepKind {
  const words = choices.map((c) => firstWord(c.label));
  if (words.includes("quick") && words.includes("customize")) return "mode";
  if (words.includes("global") || words.includes("workspace")) return "scope";
  if (words.includes("cancel")) return "confirm";
  if (words.includes("yes") && words.includes("no")) return /user scope/i.test(question) ? "removeUser" : "purge";
  throw new Error(`unrecognised select question: ${question} [${choices.map((c) => c.label).join(" | ")}]`);
}

function scripted(answers: Answers) {
  const calls: Call[] = [];
  const printed: string[] = [];
  const prompter: Prompter = {
    async select(question, choices, initial) {
      const kind = classify(question, choices);
      calls.push({ kind, via: "select", question, choices, initial });
      const wanted = answers[kind as Exclude<StepKind, "agents">];
      if (wanted === undefined) throw new Error(`unexpected ${kind} step: ${question}`);
      const idx = indexOfWord(choices, wanted);
      if (idx < 0) throw new Error(`no '${wanted}' choice in ${kind} step: ${choices.map((c) => c.label).join(" | ")}`);
      return idx;
    },
    async many(question, options, initial) {
      calls.push({ kind: "agents", via: "many", question, options, initial });
      if (answers.agents === undefined) throw new Error(`unexpected agents step: ${question}`);
      return answers.agents.map((id) => {
        const idx = options.findIndex((o) => optionIsAgent(o, id));
        if (idx < 0) throw new Error(`no '${id}' option in agents step: ${options.join(" | ")}`);
        return idx;
      }).sort((a, b) => a - b);
    },
    print(line) {
      printed.push(line);
    },
  };
  return { prompter, calls, printed };
}

const refusingPrompter = (): Prompter => ({
  async select(question) {
    throw new Error(`no question expected, got select: ${question}`);
  },
  async many(question) {
    throw new Error(`no question expected, got many: ${question}`);
  },
  print() {},
});

const ctxOf = (over: Partial<Ctx> = {}): Ctx => ({
  cwd: "/tmp/kf-onboarding-cwd",
  projectRoot: null,
  configuredScope: "global",
  workspace: { folder: "/tmp/kf-onboarding-ws", create: false },
  hasUserPlugin: async () => false,
  purgeTargets: [],
  ...over,
});

const kinds = (calls: Call[]) => calls.map((c) => c.kind);
const stepLabels = (calls: Call[]) =>
  calls.filter((c) => c.kind !== "mode").map((c) => /^Step (\d+\/\d+) — /.exec(c.question)?.[1] ?? `unlabelled: ${c.question}`);
const selectCall = (calls: Call[], kind: StepKind) => {
  const c = calls.find((x) => x.kind === kind);
  if (!c || c.via !== "select") throw new Error(`no ${kind} select was asked; asked: ${kinds(calls).join(", ")}`);
  return c;
};

describe("planInstall setup mode", () => {
  it("Quick inside a project installs claude at the configured project scope without further questions", async () => {
    const { prompter, calls } = scripted({ mode: "Quick" });
    const plan = await planInstall({}, ctxOf({ projectRoot: "/tmp/kf-proj", configuredScope: "project" }), prompter);

    expect(plan).toEqual({ agents: ["claude"], scope: "project", removeUserPlugin: false });
    expect(kinds(calls)).toEqual(["mode"]);
    const mode = selectCall(calls, "mode");
    expect(mode.question).not.toMatch(/^Step /);
    expect(mode.choices.map((c) => c.label)).toEqual(["Quick — claude, scope project", "Customize — choose each step"]);
  });

  it("Quick outside a project installs claude at global scope and labels it so", async () => {
    const { prompter, calls } = scripted({ mode: "Quick" });
    const plan = await planInstall({}, ctxOf(), prompter);

    expect(plan).toEqual({ agents: ["claude"], scope: "global", removeUserPlugin: false });
    expect(kinds(calls)).toEqual(["mode"]);
    expect(selectCall(calls, "mode").choices[0].label).toBe("Quick — claude, scope global");
  });

  it("Customize asks agents, scope and confirm as Step 1/3..3/3 and returns the chosen values", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude", "codex"], scope: "global", confirm: "Install" });
    const plan = await planInstall({}, ctxOf({ projectRoot: "/tmp/kf-proj", configuredScope: "project" }), prompter);

    expect(kinds(calls)).toEqual(["mode", "agents", "scope", "confirm"]);
    expect(stepLabels(calls)).toEqual(["1/3", "2/3", "3/3"]);
    expect(plan).toEqual({ agents: ["claude", "codex"], scope: "global", removeUserPlugin: false });
  });

  it("starts the agents step with only claude selected", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "global", confirm: "Install" });
    await planInstall({}, ctxOf(), prompter);

    const agents = calls.find((c) => c.via === "many");
    if (!agents || agents.via !== "many") throw new Error("agents step was not asked");
    const claudeIdx = agents.options.findIndex((o) => optionIsAgent(o, "claude"));
    expect(claudeIdx).toBeGreaterThanOrEqual(0);
    expect([...agents.initial]).toEqual([claudeIdx]);
  });
});

describe("planInstall scope step", () => {
  it("marks project unavailable outside a project and preselects global", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "global", confirm: "Install" });
    await planInstall({}, ctxOf({ projectRoot: null, configuredScope: "global" }), prompter);

    const scope = selectCall(calls, "scope");
    const projectIdx = indexOfWord(scope.choices, "project");
    expect(projectIdx).toBeGreaterThanOrEqual(0);
    expect(scope.choices[projectIdx].unavailable).toBe("no .works/ — run kf init");
    expect(scope.initial).toBe(indexOfWord(scope.choices, "global"));
  });

  it("keeps project available inside a project and preselects the configured project scope", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "project", confirm: "Install" });
    const plan = await planInstall({}, ctxOf({ projectRoot: "/tmp/kf-proj", configuredScope: "project" }), prompter);

    const scope = selectCall(calls, "scope");
    const projectIdx = indexOfWord(scope.choices, "project");
    expect(scope.choices[projectIdx].unavailable).toBeUndefined();
    expect(scope.initial).toBe(projectIdx);
    expect(plan).toEqual({ agents: ["claude"], scope: "project", removeUserPlugin: false });
  });

  it("marks workspace unavailable when a non-claude agent is selected", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude", "codex"], scope: "global", confirm: "Install" });
    await planInstall({}, ctxOf(), prompter);

    const scope = selectCall(calls, "scope");
    const wsIdx = indexOfWord(scope.choices, "workspace");
    expect(wsIdx).toBeGreaterThanOrEqual(0);
    expect(scope.choices[wsIdx].unavailable).toBe("workspace scope supports claude only");
  });

  it("marks workspace unavailable with the resolver's reason when no workspace folder resolves", async () => {
    const reason = "no workspace folder above this directory";
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "global", confirm: "Install" });
    await planInstall({}, ctxOf({ workspace: { unavailable: reason } }), prompter);

    const scope = selectCall(calls, "scope");
    expect(scope.choices[indexOfWord(scope.choices, "workspace")].unavailable).toBe(reason);
  });

  it("keeps workspace available for claude alone when a workspace folder resolves", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "workspace", confirm: "Install" });
    const plan = await planInstall({}, ctxOf(), prompter);

    const scope = selectCall(calls, "scope");
    expect(scope.choices[indexOfWord(scope.choices, "workspace")].unavailable).toBeUndefined();
    expect(plan).toEqual({ agents: ["claude"], scope: "workspace", removeUserPlugin: false });
  });
});

describe("planInstall with some choices given", () => {
  it("skips the mode and agents steps when agents are given and numbers scope 1/2 and confirm 2/2", async () => {
    const { prompter, calls } = scripted({ scope: "global", confirm: "Install" });
    const plan = await planInstall({ agents: ["codex"] }, ctxOf(), prompter);

    expect(kinds(calls)).toEqual(["scope", "confirm"]);
    expect(stepLabels(calls)).toEqual(["1/2", "2/2"]);
    expect(plan).toEqual({ agents: ["codex"], scope: "global", removeUserPlugin: false });
  });

  it("asks nothing when agents and scope are given", async () => {
    const given: Given = { agents: ["codex"], scope: "global" };
    const plan = await planInstall(given, ctxOf({ hasUserPlugin: async () => true }), refusingPrompter());

    expect(plan).toEqual({ agents: ["codex"], scope: "global", removeUserPlugin: false });
  });

  it("does not ask to remove the user-scope plugin when every choice is given", async () => {
    const plan = await planInstall(
      { agents: ["claude"], scope: "workspace" },
      ctxOf({ hasUserPlugin: async () => true }),
      refusingPrompter(),
    );

    expect(plan).toEqual({ agents: ["claude"], scope: "workspace", removeUserPlugin: false });
  });
});

describe("planInstall confirm step", () => {
  it("returns cancelled and asks nothing more when Cancel is chosen", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "global", confirm: "Cancel" });
    const plan = await planInstall({}, ctxOf(), prompter);

    expect(plan).toEqual({ cancelled: true });
    expect(kinds(calls)).toEqual(["mode", "agents", "scope", "confirm"]);
  });
});

describe("planInstall user-scope plugin removal", () => {
  const wsCtx = () => ctxOf({ workspace: { folder: "/tmp/kf-onboarding-ws", create: false }, hasUserPlugin: async () => true });

  it("asks before confirm with No preselected and returns removeUserPlugin true on Yes", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "workspace", removeUser: "Yes", confirm: "Install" });
    const plan = await planInstall({}, wsCtx(), prompter);

    expect(kinds(calls)).toEqual(["mode", "agents", "scope", "removeUser", "confirm"]);
    const removal = selectCall(calls, "removeUser");
    expect(removal.question).toMatch(/^Step 3\/4 — /);
    expect(removal.question).toContain("/tmp/kf-onboarding-ws");
    expect(removal.initial).toBe(indexOfWord(removal.choices, "no"));
    expect(selectCall(calls, "confirm").question).toMatch(/^Step 4\/4 — /);
    expect(plan).toEqual({ agents: ["claude"], scope: "workspace", removeUserPlugin: true });
  });

  it("returns removeUserPlugin false on No", async () => {
    const { prompter } = scripted({ mode: "Customize", agents: ["claude"], scope: "workspace", removeUser: "No", confirm: "Install" });
    const plan = await planInstall({}, wsCtx(), prompter);

    expect(plan).toEqual({ agents: ["claude"], scope: "workspace", removeUserPlugin: false });
  });

  it("does not ask when the workspace scope is chosen and no user-scope plugin exists", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "workspace", confirm: "Install" });
    await planInstall({}, ctxOf({ hasUserPlugin: async () => false }), prompter);

    expect(kinds(calls)).toEqual(["mode", "agents", "scope", "confirm"]);
  });

  it("does not ask when a scope other than workspace is chosen", async () => {
    const { prompter, calls } = scripted({ mode: "Customize", agents: ["claude"], scope: "global", confirm: "Install" });
    await planInstall({}, wsCtx(), prompter);

    expect(kinds(calls)).toEqual(["mode", "agents", "scope", "confirm"]);
  });
});

describe("planUninstall", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "kfw-onboarding-"));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  async function projectCtx(): Promise<Ctx> {
    const root = join(tmp, "proj");
    await mkdir(join(root, ".works"), { recursive: true });
    await mkdir(join(root, ".kf"), { recursive: true });
    return ctxOf({
      cwd: root,
      projectRoot: root,
      configuredScope: "project",
      purgeTargets: [join(root, ".works"), join(root, ".kf")],
    });
  }

  it("asks agents, scope, purge and confirm as Step 1/4..4/4 and confirms a chosen purge", async () => {
    const ctx = await projectCtx();
    const { prompter, calls, printed } = scripted({ agents: ["claude"], scope: "project", purge: "Yes", confirm: "Uninstall" });
    const plan = await planUninstall({}, ctx, prompter);

    expect(kinds(calls)).toEqual(["agents", "scope", "purge", "confirm"]);
    expect(stepLabels(calls)).toEqual(["1/4", "2/4", "3/4", "4/4"]);
    const summary = [...printed, selectCall(calls, "confirm").question].join("\n");
    expect(summary).toContain(".works");
    expect(summary).toContain(".kf");
    expect(plan).toEqual({ agents: ["claude"], scope: "project", purge: true, purgeConfirmed: true });
  });

  it("preselects No at the purge step", async () => {
    const ctx = await projectCtx();
    const { prompter, calls } = scripted({ agents: ["claude"], scope: "project", purge: "No", confirm: "Uninstall" });
    const plan = await planUninstall({}, ctx, prompter);

    const purge = selectCall(calls, "purge");
    expect(purge.initial).toBe(indexOfWord(purge.choices, "no"));
    expect(plan).toEqual({ agents: ["claude"], scope: "project", purge: false, purgeConfirmed: false });
  });

  it("skips the purge step in a workspace folder holding only .kf/", async () => {
    const ws = join(tmp, "ws");
    await mkdir(join(ws, ".kf"), { recursive: true });
    await writeFile(join(ws, ".kf", "workspace.json"), "{}\n");
    const { prompter, calls } = scripted({ agents: ["claude"], scope: "global", confirm: "Uninstall" });
    const plan = await planUninstall({}, ctxOf({ cwd: ws, projectRoot: null, purgeTargets: [] }), prompter);

    expect(kinds(calls)).toEqual(["agents", "scope", "confirm"]);
    expect(stepLabels(calls)).toEqual(["1/3", "2/3", "3/3"]);
    expect(plan).toEqual({ agents: ["claude"], scope: "global", purge: false, purgeConfirmed: false });
  });

  it("keeps project selectable outside a project", async () => {
    const { prompter, calls } = scripted({ agents: ["claude"], scope: "project", confirm: "Uninstall" });
    await planUninstall({}, ctxOf({ projectRoot: null, purgeTargets: [] }), prompter);

    const scope = selectCall(calls, "scope");
    expect(scope.choices[indexOfWord(scope.choices, "project")].unavailable).toBeUndefined();
  });

  it("asks agents, purge and confirm as Step 1/3..3/3 when the scope is given", async () => {
    const ctx = await projectCtx();
    const { prompter, calls } = scripted({ agents: ["claude"], purge: "No", confirm: "Uninstall" });
    const plan = await planUninstall({ scope: "project" }, ctx, prompter);

    expect(kinds(calls)).toEqual(["agents", "purge", "confirm"]);
    expect(stepLabels(calls)).toEqual(["1/3", "2/3", "3/3"]);
    expect(plan).toEqual({ agents: ["claude"], scope: "project", purge: false, purgeConfirmed: false });
  });

  it("skips the purge step when --purge is given and confirms it at the confirm step", async () => {
    const ctx = await projectCtx();
    const { prompter, calls } = scripted({ agents: ["claude"], scope: "project", confirm: "Uninstall" });
    const plan = await planUninstall({ purge: true }, ctx, prompter);

    expect(kinds(calls)).toEqual(["agents", "scope", "confirm"]);
    expect(stepLabels(calls)).toEqual(["1/3", "2/3", "3/3"]);
    expect(plan).toEqual({ agents: ["claude"], scope: "project", purge: true, purgeConfirmed: true });
  });

  it("asks nothing when agents, scope and purge are given outside a project", async () => {
    const plan = await planUninstall(
      { agents: ["claude"], scope: "global", purge: false },
      ctxOf({ projectRoot: null, purgeTargets: [] }),
      refusingPrompter(),
    );

    expect(plan).toEqual({ agents: ["claude"], scope: "global", purge: false, purgeConfirmed: false });
  });

  it("asks nothing when agents and scope are given and there is no project data to purge", async () => {
    const plan = await planUninstall(
      { agents: ["claude"], scope: "global" },
      ctxOf({ projectRoot: null, purgeTargets: [] }),
      refusingPrompter(),
    );

    expect(plan).toEqual({ agents: ["claude"], scope: "global", purge: false, purgeConfirmed: false });
  });

  it("returns cancelled when Cancel is chosen at the confirm step", async () => {
    const ctx = await projectCtx();
    const { prompter } = scripted({ agents: ["claude"], scope: "project", purge: "Yes", confirm: "Cancel" });
    const plan = await planUninstall({}, ctx, prompter);

    expect(plan).toEqual({ cancelled: true });
  });
});

describe("runInstallCommand dispatch", () => {
  let dir: string;
  let bin: string;
  let log: string;
  let prevPath: string | undefined;

  // A `claude` on PATH that appends its argv to a log and answers `plugin list --json` with "[]".
  async function writeStub(): Promise<void> {
    const script = [
      "#!/bin/sh",
      'echo "$*" >> "$KF_STUB_LOG"',
      'if [ "$1 $2" = "plugin list" ]; then echo "[]"; fi',
      "exit 0",
      "",
    ].join("\n");
    await writeFile(join(bin, "claude"), script);
    await chmod(join(bin, "claude"), 0o755);
  }

  const calls = async () => (existsSync(log) ? (await readFile(log, "utf8")).split("\n").filter(Boolean) : []);
  const tree = (root: string) => (readdirSync(root, { recursive: true }) as string[]).map(String).sort();

  const projDir = () => join(dir, "proj");
  const plainDir = () => join(dir, "plain");

  type InstallFn = typeof cmdInstall;
  type UninstallFn = typeof cmdUninstall;

  // Planner spies for the non-TTY path: being called at all is the failure.
  const spies = () => ({
    planInstall: vi.fn(async () => {
      throw new Error("planInstall must not run");
    }),
    planUninstall: vi.fn(async () => {
      throw new Error("planUninstall must not run");
    }),
    cmdInstall: vi.fn<InstallFn>(async () => ({ code: 0, stdout: "spy install" })),
    cmdUninstall: vi.fn<UninstallFn>(async () => ({ code: 0, stdout: "spy uninstall" })),
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kfw-onboarding-dispatch-"));
    bin = join(dir, "bin");
    log = join(dir, "claude.log");
    await mkdir(bin);
    await writeStub();
    prevPath = process.env.PATH;
    process.env.PATH = `${bin}:${prevPath}`;
    process.env.KF_STUB_LOG = log;
    await mkdir(projDir());
    ensureWorksStructure(projDir());
    await mkdir(join(projDir(), ".kf"), { recursive: true });
    await mkdir(plainDir());
  });

  afterEach(async () => {
    process.env.PATH = prevPath;
    delete process.env.KF_STUB_LOG;
    await rm(dir, { recursive: true, force: true });
  });

  describe("off a TTY", () => {
    it("calls cmdInstall exactly as today for kf install and never plans", async () => {
      const d = spies();
      await runInstallCommand("install", {}, projDir(), false, d);

      expect(d.planInstall).not.toHaveBeenCalled();
      expect(d.planUninstall).not.toHaveBeenCalled();
      expect(d.cmdUninstall).not.toHaveBeenCalled();
      expect(d.cmdInstall).toHaveBeenCalledTimes(1);
      expect(d.cmdInstall).toHaveBeenCalledWith([], { cwd: projDir(), scope: undefined });
    });

    it("passes agent and scope options through unchanged for kf install", async () => {
      const d = spies();
      await runInstallCommand("install", { agent: "codex", scope: "global" }, projDir(), false, d);

      expect(d.planInstall).not.toHaveBeenCalled();
      expect(d.cmdInstall).toHaveBeenCalledWith(["codex"], { cwd: projDir(), scope: "global" });
    });

    it("calls cmdUninstall exactly as today for kf uninstall and never plans", async () => {
      const d = spies();
      await runInstallCommand("uninstall", {}, projDir(), false, d);

      expect(d.planInstall).not.toHaveBeenCalled();
      expect(d.planUninstall).not.toHaveBeenCalled();
      expect(d.cmdInstall).not.toHaveBeenCalled();
      expect(d.cmdUninstall).toHaveBeenCalledTimes(1);
      expect(d.cmdUninstall).toHaveBeenCalledWith([], { cwd: projDir(), scope: undefined, purge: false, force: false });
    });

    it("calls cmdUninstall exactly as today for kf uninstall --purge without --force", async () => {
      const d = spies();
      await runInstallCommand("uninstall", { purge: true }, projDir(), false, d);

      expect(d.planUninstall).not.toHaveBeenCalled();
      expect(d.cmdUninstall).toHaveBeenCalledWith([], { cwd: projDir(), scope: undefined, purge: true, force: false });
    });

    it("keeps refusing kf uninstall --purge without --force and deletes nothing", async () => {
      const res = await runInstallCommand("uninstall", { purge: true }, projDir(), false);

      expect(res.code).toBe(1);
      expect(res.stdout).toContain("re-run with --force");
      expect(existsSync(join(projDir(), ".works"))).toBe(true);
      expect(existsSync(join(projDir(), ".kf"))).toBe(true);
    });

    it("installs without any local-scope plugin call", async () => {
      const res = await runInstallCommand("install", {}, projDir(), false);

      expect(res.code).toBe(0);
      expect((await calls()).filter((c) => c.includes("--scope local"))).toEqual([]);
    });
  });

  describe("on a TTY", () => {
    it("calls cmdInstall exactly as today without asking when agents and scope are given", async () => {
      const d = spies();
      await runInstallCommand("install", { agent: "codex", scope: "global" }, projDir(), true, {
        prompter: refusingPrompter(),
        cmdInstall: d.cmdInstall,
        cmdUninstall: d.cmdUninstall,
      });

      expect(d.cmdInstall).toHaveBeenCalledTimes(1);
      expect(d.cmdInstall).toHaveBeenCalledWith(["codex"], { cwd: projDir(), scope: "global" });
    });

    it("calls cmdUninstall exactly as today without asking when every choice is given", async () => {
      const d = spies();
      await runInstallCommand("uninstall", { agent: "claude", scope: "global" }, plainDir(), true, {
        prompter: refusingPrompter(),
        cmdInstall: d.cmdInstall,
        cmdUninstall: d.cmdUninstall,
      });

      expect(d.cmdUninstall).toHaveBeenCalledTimes(1);
      expect(d.cmdUninstall).toHaveBeenCalledWith(["claude"], { cwd: plainDir(), scope: "global", purge: false, force: false });
    });

    it("runs cmdInstall with the planned agents and scope", async () => {
      const d = spies();
      const { prompter } = scripted({ mode: "Customize", agents: ["claude", "codex"], scope: "global", confirm: "Install" });
      await runInstallCommand("install", {}, projDir(), true, { prompter, cmdInstall: d.cmdInstall, cmdUninstall: d.cmdUninstall });

      expect(d.cmdInstall).toHaveBeenCalledTimes(1);
      expect(d.cmdInstall).toHaveBeenCalledWith(["claude", "codex"], { cwd: projDir(), scope: "global", removeUserPlugin: false });
    });

    it("runs cmdUninstall with the planned purge already confirmed", async () => {
      const d = spies();
      const { prompter } = scripted({ agents: ["claude"], scope: "project", purge: "Yes", confirm: "Uninstall" });
      await runInstallCommand("uninstall", {}, projDir(), true, { prompter, cmdInstall: d.cmdInstall, cmdUninstall: d.cmdUninstall });

      expect(d.cmdUninstall).toHaveBeenCalledTimes(1);
      expect(d.cmdUninstall).toHaveBeenCalledWith(["claude"], {
        cwd: projDir(),
        scope: "project",
        purge: true,
        purgeConfirmed: true,
        force: false,
      });
    });

    it("exits 0 with Nothing changed when the install is cancelled, touching neither disk nor claude", async () => {
      const projBefore = tree(projDir());
      const homeBefore = tree(process.env.HOME!);
      const { prompter } = scripted({ mode: "Customize", agents: ["claude"], scope: "global", confirm: "Cancel" });
      const res = await runInstallCommand("install", {}, projDir(), true, { prompter });

      expect(res).toEqual({ code: 0, stdout: "Nothing changed." });
      expect(await calls()).toEqual([]);
      expect(tree(projDir())).toEqual(projBefore);
      expect(tree(process.env.HOME!)).toEqual(homeBefore);
    });

    it("exits 0 with Nothing changed when the uninstall is cancelled and keeps project data", async () => {
      const projBefore = tree(projDir());
      const { prompter } = scripted({ agents: ["claude"], scope: "project", purge: "Yes", confirm: "Cancel" });
      const res = await runInstallCommand("uninstall", {}, projDir(), true, { prompter });

      expect(res).toEqual({ code: 0, stdout: "Nothing changed." });
      expect(await calls()).toEqual([]);
      expect(tree(projDir())).toEqual(projBefore);
    });

    it("exits 1 with Aborted when a prompt is aborted, without calling the command", async () => {
      const d = spies();
      const aborting: Prompter = {
        async select() {
          throw new PromptAbort("aborted");
        },
        async many() {
          throw new PromptAbort("aborted");
        },
        print() {},
      };
      const res = await runInstallCommand("install", {}, projDir(), true, { prompter: aborting, cmdInstall: d.cmdInstall, cmdUninstall: d.cmdUninstall });

      expect(res).toEqual({ code: 1, stdout: "Aborted — nothing changed.", stderr: "aborted" });
      expect(d.cmdInstall).not.toHaveBeenCalled();
    });
  });
});
