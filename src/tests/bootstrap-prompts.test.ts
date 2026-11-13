import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// System boundary: the terminal line reader. Answers come from a script the test sets per case.
const script = vi.hoisted(() => ({ answer: (_q: string): string => "", asked: [] as string[], closed: 0, throwOnAsk: undefined as Error | undefined }));
vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: async (q: string): Promise<string> => {
      script.asked.push(q);
      if (script.throwOnAsk) throw script.throwOnAsk;
      return script.answer(q);
    },
    close: (): void => { script.closed += 1; },
  }),
}));

import { askAll, bootstrapDefaults, onboardAnswers, promptAnswers, selectOption } from "../project/bootstrap.js";

type Key = { name: string; ctrl?: boolean };
const press = (...keys: Key[]): void => {
  for (const key of keys) process.stdin.emit("keypress", "", key);
};

let root: string;
let rawCalls: boolean[];
let written: string[];
const original = {
  setRawMode: (process.stdin as { setRawMode?: unknown }).setRawMode,
};

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "kf-prompts-")));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test Author"]);
  // The project layer wins over the global and workspace layers, so pinning the person-level
  // values here keeps every expectation independent of any config above the temporary project.
  mkdirSync(join(root, ".kf"));
  writeFileSync(join(root, ".kf", "config.json"), JSON.stringify({
    schema: "kanban-flow", reviewer: "Test Author", agents: ["claude"], skills: { scope: "global" },
  }));
  rawCalls = [];
  written = [];
  script.answer = () => "";
  script.asked = [];
  script.closed = 0;
  script.throwOnAsk = undefined;
  (process.stdin as unknown as { setRawMode: (mode: boolean) => void }).setRawMode = (mode: boolean) => { rawCalls.push(mode); };
  vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
  vi.spyOn(process.stdin, "pause").mockImplementation(() => process.stdin);
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
});
afterEach(() => {
  vi.restoreAllMocks();
  process.stdin.removeAllListeners("keypress");
  if (original.setRawMode === undefined) delete (process.stdin as { setRawMode?: unknown }).setRawMode;
  else (process.stdin as { setRawMode?: unknown }).setRawMode = original.setRawMode;
  rmSync(root, { recursive: true, force: true });
});

describe("selecting an option on a terminal", () => {
  const options = ["first", "second", "third"];

  it("starts on the first option and Enter accepts it", async () => {
    const chosen = selectOption("Pick:", options);
    press({ name: "return" });
    expect(await chosen).toBe(0);
    expect(written.join("")).toContain("Pick:");
    expect(written.join("")).toContain("❯ first");
  });

  it("moves down with the arrow key", async () => {
    const chosen = selectOption("Pick:", options);
    press({ name: "down" }, { name: "down" }, { name: "return" });
    expect(await chosen).toBe(2);
  });

  it("wraps around in both directions", async () => {
    const up = selectOption("Pick:", options);
    press({ name: "up" }, { name: "return" });
    expect(await up).toBe(2);

    const down = selectOption("Pick:", options);
    press({ name: "down" }, { name: "down" }, { name: "down" }, { name: "return" });
    expect(await down).toBe(0);
  });

  it("jumps to an option by its digit and ignores a digit past the end", async () => {
    const jump = selectOption("Pick:", options);
    press({ name: "2" }, { name: "return" });
    expect(await jump).toBe(1);

    const past = selectOption("Pick:", options);
    press({ name: "9" }, { name: "x" }, { name: "return" });
    expect(await past).toBe(0);
  });

  it("redraws over the previous menu after a key", async () => {
    const chosen = selectOption("Pick:", options);
    press({ name: "down" }, { name: "return" });
    await chosen;
    expect(written.join("")).toContain("\x1b[4A\x1b[J");
  });

  it("switches raw mode on while waiting and off again after Enter, and stops listening", async () => {
    const chosen = selectOption("Pick:", options);
    expect(rawCalls).toEqual([true]);
    expect(process.stdin.listenerCount("keypress")).toBe(1);
    press({ name: "return" });
    await chosen;
    expect(rawCalls).toEqual([true, false]);
    expect(process.stdin.listenerCount("keypress")).toBe(0);
  });

  it("rejects on Ctrl+C with a message naming --defaults, and restores the terminal", async () => {
    const chosen = selectOption("Pick:", options);
    press({ name: "c", ctrl: true });
    await expect(chosen).rejects.toThrow("Setup aborted (Ctrl+C). Re-run with --defaults to skip prompts.");
    expect(rawCalls).toEqual([true, false]);
    expect(process.stdin.listenerCount("keypress")).toBe(0);
  });

  it("treats a plain c as an ordinary key", async () => {
    const chosen = selectOption("Pick:", options);
    press({ name: "c" }, { name: "return" });
    expect(await chosen).toBe(0);
  });
});

describe("asking the setup questions", () => {
  const rlOf = (): Parameters<typeof askAll>[0] => ({ question: async (q: string) => { script.asked.push(q); return script.answer(q); } }) as unknown as Parameters<typeof askAll>[0];

  it("leaves a project unrestricted and keeps the detected values when every answer is empty", async () => {
    const defaults = bootstrapDefaults(root);
    const answers = await askAll(rlOf(), root);
    expect(answers.contexts).toEqual([]);
    expect(answers.defaultContextStated).toBe(false);
    expect(answers.defaultContext).toBe(defaults.defaultContext);
    expect(answers.reviewer).toBe("Test Author");
    expect(answers.agents).toEqual(["claude"]);
    expect(answers.skillScope).toBe("global");
    expect(answers.seedFeature).toBe(false);
    expect(answers.repository).toBe(defaults.repository);
  });

  it("takes a typed context list, drops case-insensitive repeats and makes the first the default", async () => {
    script.answer = (q) => (q.startsWith("Contexts") ? "App, app api,API" : "");
    const answers = await askAll(rlOf(), root);
    expect(answers.contexts).toEqual(["App", "api"]);
    expect(answers.defaultContext).toBe("App");
    expect(answers.defaultContextStated).toBe(true);
  });

  it("uses the typed reviewer, stacks, agents and the no answers", async () => {
    script.answer = (q) => {
      if (q.startsWith("Default reviewer")) return "Quinn";
      if (q.startsWith("Stacks")) return "node, go";
      if (q.startsWith("Install skills for which agents")) return "Claude";
      if (q.startsWith("Install skills globally")) return "no";
      if (q.startsWith("Seed a demo")) return "yes";
      if (q.startsWith("Add .works/")) return "n";
      return "";
    };
    const answers = await askAll(rlOf(), root);
    expect(answers.reviewer).toBe("Quinn");
    expect(answers.stacks).toEqual(["node", "go"]);
    expect(answers.agents).toEqual(["claude"]);
    expect(answers.skillScope).toBe("project");
    expect(answers.seedFeature).toBe(true);
    expect(answers.ignoreWorks).toBe(false);
  });

  it("keeps the detected stacks on Enter and replaces them after a no with the typed ones", async () => {
    writeFileSync(join(root, "package.json"), "{}");
    const kept = await askAll(rlOf(), root);
    expect(kept.stacks).toEqual(["node"]);
    expect(script.asked.some((q) => q.startsWith("Detected stacks: node. Use them?"))).toBe(true);
    expect(script.asked.some((q) => q.startsWith("Stacks (comma-separated"))).toBe(false);

    script.asked = [];
    script.answer = (q) => (q.startsWith("Detected stacks") ? "n" : q.startsWith("Stacks (comma-separated") ? "go, rust" : "");
    const replaced = await askAll(rlOf(), root);
    expect(replaced.stacks).toEqual(["go", "rust"]);
    expect(script.asked.some((q) => q.startsWith("Stacks (comma-separated"))).toBe(true);
  });

  it("sets the repository from a URL, clears it with none, and keeps the old one for junk", async () => {
    script.answer = (q) => (q.startsWith("GitHub repository") ? "https://github.com/acme/app" : "");
    const set = await askAll(rlOf(), root);
    expect(set.repository).toBe("acme/app");
    expect(set.installGithubHooks).toBe(true);

    script.answer = (q) => (q.startsWith("GitHub repository") ? "none" : "");
    const cleared = await askAll(rlOf(), root);
    expect(cleared.repository).toBeUndefined();
    expect(cleared.installGithubHooks).toBeUndefined();
    expect(script.asked.filter((q) => q.startsWith("Install the GitHub sync hook pack"))).toHaveLength(1);

    script.answer = (q) => (q.startsWith("GitHub repository") ? "not a repo!" : "");
    const junk = await askAll(rlOf(), root);
    expect(junk.repository).toBeUndefined();
    expect(written.join("")).toContain("Not a GitHub repository: 'not a repo!' — keeping none.");
  });
});

describe("prompting on a terminal", () => {
  it("closes the line reader after the questions", async () => {
    await promptAnswers(root);
    expect(script.closed).toBe(1);
    expect(script.asked.length).toBeGreaterThan(3);
  });

  it("turns an aborted read into a message naming --defaults", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    script.throwOnAsk = abort;
    await expect(promptAnswers(root)).rejects.toThrow("Setup aborted (EOF/Ctrl+C). Re-run with --defaults to skip prompts.");
    expect(script.closed).toBe(1);
  });

  it("lets any other failure through unchanged", async () => {
    script.throwOnAsk = new Error("disk on fire");
    await expect(promptAnswers(root)).rejects.toThrow("disk on fire");
    expect(script.closed).toBe(1);
  });

  it("onboarding with Enter takes the quick setup defaults without asking anything", async () => {
    const pending = onboardAnswers(root);
    press({ name: "return" });
    expect(await pending).toEqual(bootstrapDefaults(root));
    expect(script.asked).toEqual([]);
  });

  it("onboarding with Down then Enter goes on to the questions", async () => {
    script.answer = (q) => (q.startsWith("Contexts") ? "web" : "");
    const pending = onboardAnswers(root);
    press({ name: "down" }, { name: "return" });
    const answers = await pending;
    expect(answers.contexts).toEqual(["web"]);
    expect(script.asked.length).toBeGreaterThan(3);
  });
});
