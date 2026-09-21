import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeContext, suggestContext, effectiveDefaultContext, declaredDefaultContext, contextsInUse, checkContext } from "../project/contexts.js";
import { readProjectConfig } from "../project/config.js";
import { writeFeatureMeta } from "../workflow/features.js";
import { ensureWorksStructure } from "../workflow/features.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdContexts } from "../cli/commands/contexts.js";
import { cmdInit } from "../cli/commands/init.js";
import { seedHarness } from "../harness/config.js";
import { cmdAutoconfig } from "../cli/commands/autoconfig.js";
import { askAll, saveConfig } from "../project/bootstrap.js";
import * as bootstrap from "../project/bootstrap.js";
import { dashboardData } from "../dashboard/dashboard.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let dir: string;

/** A project with .works/ and a hand-written config, so each test states the exact config shape. */
async function project(config?: Record<string, unknown>): Promise<void> {
  ensureWorksStructure(dir);
  if (config) {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "20260920_1200", ...config }));
  }
}

async function workItem(name: string, context: string): Promise<void> {
  const path = join(dir, ".works", "brainstorm", `${name}_20260920_1200`);
  await mkdir(path, { recursive: true });
  await writeFeatureMeta(path, { schema: "kanban-flow", feature: name, context, created: "20260920_1200" });
}

const brainstormEntries = (): string[] => readdirSync(join(dir, ".works", "brainstorm"));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-ctx-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("comparing context names", () => {
  it("folds case, so one name cannot become two docs trees", () => {
    expect(normalizeContext("Auth")).toBe(normalizeContext("auth"));
    expect(normalizeContext("AUTH")).toBe(normalizeContext("auth"));
    expect(normalizeContext("auth")).toBe("auth");
    expect(normalizeContext("  auth  ")).toBe("auth");
  });

  it("suggests a near miss and stays quiet on a far one", () => {
    const declared = ["auth", "billing", "catalog"];
    // Budget comes from the longer name, so dropping characters does not shrink the allowance.
    expect(suggestContext("au", ["auth"])).toBe("auth");
    expect(suggestContext("biling", declared)).toBe("billing");
    expect(suggestContext("Auth", declared)).toBe("auth");
    expect(suggestContext("zzzzzz", declared)).toBeNull();
    expect(suggestContext("auth", [])).toBeNull();
    // Two unrelated single characters are one edit apart; that is not a near miss.
    expect(suggestContext("b", ["a"])).toBeNull();
  });

  it("only ever suggests a name the guard then accepts", () => {
    const cfg = { contexts: ["auth", "billing", "catalog"] };
    const suggestions = ["biling", "aut", "catalogg", "Billing"].map((t) => suggestContext(t, cfg.contexts));
    expect(suggestions.filter(Boolean).length, "these typos should all be close enough to suggest").toBe(4);
    for (const s of suggestions) {
      if (s === null) continue;
      expect(checkContext(s, cfg).ok, s).toBe(true);
    }
  });
});

describe("the declared context list in the config", () => {
  it("accepts a valid list and an absent one", async () => {
    await project({ contexts: ["auth", "billing"] });
    expect(readProjectConfig(dir).contexts).toEqual(["auth", "billing"]);

    await rm(join(dir, ".kf", "config.json"));
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", defaultContext: "legacy" }));
    expect(readProjectConfig(dir).contexts).toBeUndefined();
  });

  it("rejects an empty list, a non-array, a bad name and a case-duplicate", async () => {
    const bad: Array<[unknown, RegExp]> = [
      [[], /contexts must be a non-empty array/],
      ["auth", /contexts must be a non-empty array/],
      [[1, 2], /contexts must be a non-empty array/],
      // One bad entry among good ones must fail too: a per-entry check, not an any-entry one.
      [["auth", 1], /contexts must be a non-empty array/],
      [["au th"], /context/],
      [["auth", "Auth"], /twice/],
    ];
    for (const [contexts, message] of bad) {
      await mkdir(join(dir, ".kf"), { recursive: true });
      await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", contexts }));
      expect(() => readProjectConfig(dir), JSON.stringify(contexts)).toThrow(message);
    }
  });

  it("treats an empty declared list as no list at all", () => {
    // readProjectConfig rejects `contexts: []`, so this guards checkContext against any other
    // caller handing it an empty array: nothing declared must never mean everything refused.
    expect(checkContext("anything", { contexts: [] }).ok).toBe(true);
    expect(effectiveDefaultContext({ contexts: [] })).toBe("app");
    // null, not undefined: the dashboard writes this value straight into its JSON payload.
    expect(declaredDefaultContext({ contexts: [] })).toBeNull();
  });

  it("takes the default from the list, leaving no second field to drift out of sync", () => {
    expect(effectiveDefaultContext({ contexts: ["auth", "billing"] })).toBe("auth");
    // A stale defaultContext is ignored rather than rejected: one source of truth cannot conflict.
    expect(effectiveDefaultContext({ contexts: ["auth"], defaultContext: "billing" })).toBe("auth");
    expect(effectiveDefaultContext({ defaultContext: "legacy" })).toBe("legacy");
    expect(effectiveDefaultContext({})).toBe("app");
  });

  it("never yields a default that its own guard would refuse", () => {
    const shapes = [
      { contexts: ["auth", "billing"] },
      { contexts: ["auth"], defaultContext: "billing" },
      { contexts: ["Auth"] },
      { defaultContext: "legacy" },
      {},
    ];
    const expected = ["auth", "auth", "Auth", "legacy", "app"];
    for (const [i, cfg] of shapes.entries()) {
      // Ask the real guard, not a re-implementation of it: that is the claim being made.
      expect(checkContext(effectiveDefaultContext(cfg), cfg).ok, JSON.stringify(cfg)).toBe(true);
      // The shapes with no `contexts` pass the guard vacuously, so pin their value too.
      expect(effectiveDefaultContext(cfg), JSON.stringify(cfg)).toBe(expected[i]);
    }
  });
});

describe("kf new against a declared list", () => {
  it("refuses a typo, creates nothing, and prints the name, the suggestion and the whole list", async () => {
    await project({ contexts: ["auth", "billing", "catalog"] });
    const res = await cmdNew(args("new", ["payment-retry"], { context: "biling" }), dir);
    expect(res.code).toBe(1);
    expect(brainstormEntries()).toEqual([]);
    expect(res.stdout).toContain("biling");
    expect(res.stdout).toContain('Did you mean "billing"');
    for (const name of ["auth", "billing", "catalog"]) expect(res.stdout).toContain(name);
  });

  it("refuses a name that differs only in case, then accepts the declared spelling", async () => {
    await project({ contexts: ["auth"] });
    const bad = await cmdNew(args("new", ["x"], { context: "Auth" }), dir);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toContain('Did you mean "auth"');
    expect(brainstormEntries()).toEqual([]);

    const good = await cmdNew(args("new", ["x"], { context: "auth" }), dir);
    expect(good.code).toBe(0);
    expect(brainstormEntries()).toHaveLength(1);
  });

  it("takes the first declared context when no flag is given", async () => {
    await project({ contexts: ["billing", "catalog"] });
    const res = await cmdNew(args("new", ["x"]), dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Context: billing");
    const meta = JSON.parse(await readFile(join(dir, ".works", "brainstorm", brainstormEntries()[0], ".kfw.json"), "utf8"));
    expect(meta.context, "the default must be the first entry, not the last").toBe("billing");
  });

  it("ignores a stale defaultContext once a list is declared", async () => {
    await project({ contexts: ["billing"], defaultContext: "payments" });
    const res = await cmdNew(args("new", ["x"]), dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Context: billing");
  });

  it("restricts nothing while no list is declared", async () => {
    await project({ defaultContext: "legacy" });
    const free = await cmdNew(args("new", ["x"], { context: "anythinggoes" }), dir);
    expect(free.code).toBe(0);
    const noFlag = await cmdNew(args("new", ["y"]), dir);
    expect(noFlag.code).toBe(0);
    expect(brainstormEntries()).toHaveLength(2);
  });
});

describe("kf contexts", () => {
  it("warns about a collision in the brief, where the list is actually written", async () => {
    // The one branch whose job is to help someone write a valid list must not hide what would
    // make it invalid. Following the brief on both spellings produced an unreadable config.
    await project();
    await workItem("a", "Legacy");
    await workItem("b", "legacy");
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(text).toContain("Before you write the list");
    expect(text).toContain("differs only by case");

    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(json.undeclared.every((u: { inUseClashes: string[] }) => u.inUseClashes.length === 1)).toBe(true);
    // --json is the mode an agent reads, so the brief it carries must hold the same warning.
    expect(json.brief).toContain("Before you write the list");
    expect(json.brief).toContain("differs only by case");
    expect(json.brief).toBe((await cmdContexts(args("contexts"), dir)).stdout);
  });

  it("says nothing about collisions when there are none", async () => {
    // The warning is only useful because its absence means something. If it were unconditional,
    // or the guard inverted, every brief would carry a caution about a config that is already fine.
    await project();
    await workItem("a", "auth");
    await workItem("b", "billing");
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(text).not.toContain("Before you write the list");
    expect(text).not.toContain("differs only by case");
    expect(JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout).brief).toBe(text);
  });

  it("counts a declared name by its exact spelling, not by a case-folded match", async () => {
    // kf new accepts only an exact match, so a count that folded case would report work under
    // "Legacy" that `kf new --context Legacy` never produced and `kf new --context legacy` refuses.
    await project({ contexts: ["Legacy"] });
    await workItem("a", "legacy");
    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(json.declared).toEqual([{ name: "Legacy", count: 0, default: true }]);
    expect(json.undeclared.map((u: { context: string; count: number }) => [u.context, u.count])).toEqual([["legacy", 1]]);
  });

  it("names every partner when a name collides with a declared entry and another in use", async () => {
    // Naming only one produces two instructions that cannot both be obeyed.
    await project({ contexts: ["Auth"] });
    await workItem("a", "auth");
    await workItem("b", "AUTH");
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(text).toContain('declared "Auth"');
    expect(text).toContain("(also in use)");
    expect(text).toContain("these 3 names can be declared");
    // Three partners must read as a list, not as a chain of repeated joiners.
    expect(text).not.toMatch(/and from .* and from /);

    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    for (const u of json.undeclared) {
      expect(u.declaredClash).toBe("Auth");
      expect(u.inUseClashes.length).toBe(1);
    }
  });

  it("prints a survey brief when nothing is declared, naming the rule, the size and who decides", async () => {
    await project({ defaultContext: "app" });
    await workItem("a", "cli");
    await workItem("b", "cli");
    const res = await cmdContexts(args("contexts"), dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toMatch(/business domain, not by technical layer/);
    expect(res.stdout).toMatch(/3 to 7 names/);
    // Must not say "lowercase": contextsInUse keeps on-disk casing, and re-casing walks straight
    // into a declared-vs-in-use collision.
    expect(res.stdout).not.toMatch(/lowercase/);
    expect(res.stdout).toMatch(/match the spelling the work items use/);
    expect(res.stdout).toMatch(/Do not write the list on your own/);
    expect(res.stdout).toContain("cli (2)");
  });

  it("lists each declared context with its count, including one nobody uses yet", async () => {
    await project({ contexts: ["auth", "billing"] });
    await workItem("a", "auth");
    const text = await cmdContexts(args("contexts"), dir);
    expect(text.stdout).toMatch(/auth\s+1 work item\b/);
    expect(text.stdout).toMatch(/billing\s+0 work items/);

    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(json.declared).toEqual([
      { name: "auth", count: 1, default: true },
      { name: "billing", count: 0, default: false },
    ]);
    expect(json.restricted).toBe(true);
  });

  it("names a context in use but not declared, and changes nothing on disk", async () => {
    await project({ contexts: ["auth"] });
    await workItem("old", "legacy");
    const before = await readFile(join(dir, ".kf", "config.json"), "utf8");

    const res = await cmdContexts(args("contexts"), dir);
    expect(res.stdout).toContain("In use but not declared");
    expect(res.stdout).toContain("legacy");
    expect(await readFile(join(dir, ".kf", "config.json"), "utf8")).toBe(before);

    // Naming it is not the same as allowing it.
    expect((await cmdNew(args("new", ["z"], { context: "legacy" }), dir)).code).toBe(1);
  });
});

describe("kf init and the declared list", () => {
  it("writes a one-entry list on a fresh project and keeps a hand-edited one", async () => {
    expect((await cmdInit(args("init", [], { defaults: true, context: "cli" }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toEqual(["cli"]);
    expect(effectiveDefaultContext(readProjectConfig(dir))).toBe("cli");

    const cfg = JSON.parse(await readFile(join(dir, ".kf", "config.json"), "utf8"));
    cfg.contexts = ["auth", "billing"];
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify(cfg));
    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toEqual(["auth", "billing"]);
  });

  it("leaves a project that has a config but no .works tree unrestricted", async () => {
    // The common shape: kf init offers to gitignore .works/, so a fresh clone has config only.
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", defaultContext: "billing" }));
    expect(existsSync(join(dir, ".works"))).toBe(false);

    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toBeUndefined();
    expect((await cmdNew(args("new", ["probe"], { context: "auth" }), dir)).code).toBe(0);
  });

  it("declares nothing on a fresh project when no context was given", async () => {
    // --defaults means nobody decided, and declaring a list is a decision.
    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toBeUndefined();
    expect((await cmdNew(args("new", ["checkout"], { context: "billing" }), dir)).code).toBe(0);
    // And the survey brief stays reachable, which is the whole of FR-004.
    expect((await cmdContexts(args("contexts"), dir)).stdout).toContain("No contexts declared");
  });

  it("treats an empty .works tree as a new project, not an existing one", async () => {
    // A stray or half-initialised .works/ must not suppress the list forever.
    ensureWorksStructure(dir);
    expect((await cmdInit(args("init", [], { defaults: true, context: "cli" }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toEqual(["cli"]);
  });

  it("leaves a project with work items but no config file unrestricted", async () => {
    // .kf/ can be absent, deleted or gitignored; the config file is not what makes a project exist.
    ensureWorksStructure(dir);
    await workItem("old", "auth");
    await workItem("other", "billing");
    expect(existsSync(join(dir, ".kf", "config.json"))).toBe(false);

    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);

    expect(readProjectConfig(dir).contexts, "init must not lock out contexts already in use").toBeUndefined();
    expect((await cmdNew(args("new", ["probe"], { context: "auth" }), dir)).code).toBe(0);
  });

  it("refuses an explicit context that the declared list does not contain, before creating any docs tree", async () => {
    await project({ contexts: ["auth", "billing"] });
    const res = await cmdInit(args("init", [], { defaults: true, context: "payments" }), dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not a declared context");
    for (const d of ["requirement", "use-cases", "testplan"]) {
      expect(existsSync(join(dir, "docs", d, "payments")), d).toBe(false);
    }
  });

  it("leaves a project that predates the list unrestricted", async () => {
    await project({ defaultContext: "legacy" });
    await workItem("old", "legacy");
    await workItem("other", "somethingelse");
    const before = JSON.parse(await readFile(join(dir, ".kf", "config.json"), "utf8"));
    expect(before.contexts).toBeUndefined();

    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);

    const after = JSON.parse(await readFile(join(dir, ".kf", "config.json"), "utf8"));
    expect(after.contexts, "upgrading kf must not start refusing contexts already in use").toBeUndefined();
    expect((await cmdNew(args("new", ["z"], { context: "yetanother" }), dir)).code).toBe(0);
  });
});

describe("the machine-readable output", () => {
  it("carries the survey brief when nothing is declared, and drops it once a list exists", async () => {
    await project({ defaultContext: "app" });
    const none = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(none.restricted).toBe(false);
    expect(none.brief).toMatch(/business domain, not by technical layer/);

    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", contexts: ["auth"] }));
    const some = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(some.restricted).toBe(true);
    expect(some.brief).toBeUndefined();
  });
});

describe("the interactive setup question", () => {
  it("leaves an existing unrestricted project alone when the answer is empty", async () => {
    // Enter is not a decision. Declaring on someone's behalf locks out contexts already in use.
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", defaultContext: "legacy" }));
    await workItem("a", "billing");

    const stub = { question: async (p: string): Promise<string> => (p.includes("Contexts") ? "" : "") } as never;
    const a = await askAll(stub, dir);
    expect(a.contexts, "an empty answer must not declare a list").toEqual([]);
    expect(a.defaultContext).toBe("legacy");

    saveConfig(dir, a);
    expect(readProjectConfig(dir).contexts).toBeUndefined();
    expect((await cmdNew(args("new", ["probe"], { context: "billing" }), dir)).code).toBe(0);
  });

  it("does not record Enter as a decision about the default context", async () => {
    // The prompt has just promised "leave empty to keep this project unrestricted"; recording a
    // default there repoints every future context-less kf new at the invented fallback.
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x" }));
    await workItem("old", "shop");
    const stub = { question: async (): Promise<string> => "" } as never;
    const a = await askAll(stub, dir);
    expect(a.defaultContextStated, "Enter is not a decision").toBe(false);

    saveConfig(dir, a);
    expect(readProjectConfig(dir).defaultContext).toBeUndefined();
    expect((await cmdNew(args("new", ["x"]), dir)).stdout).toContain("Context: shop");
  });

  it("carries an explicit --context into the interactive path", async () => {
    // Without it, Enter-through on a fresh project declares nothing instead of the named context.
    const a = await askAll({ question: async (): Promise<string> => "" } as never, dir, "payments");
    expect(a.contexts).toEqual(["payments"]);
    expect(a.defaultContext).toBe("payments");
  });

  it("lists three collision partners as a list, not a chain of joiners", async () => {
    await project({ contexts: ["Auth"] });
    for (const [n, c] of [["a", "auth"], ["b", "aUth"], ["c", "AUTH"]] as const) await workItem(n, c);
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    const line = text.split("\n").find((l) => l.includes("differs only by case")) ?? "";
    expect(line).toMatch(/, .* and /);
    expect(line).not.toMatch(/and from .*and from/);
  });

  it("does record a typed list as a decision", async () => {
    ensureWorksStructure(dir);
    const a = await askAll({ question: async (p: string): Promise<string> => (p.includes("Contexts") ? "billing" : "") } as never, dir);
    expect(a.defaultContextStated).toBe(true);
  });

  it("says so in the prompt when leaving it empty keeps the project unrestricted", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", defaultContext: "legacy" }));
    const prompts: string[] = [];
    const stub = { question: async (p: string): Promise<string> => { prompts.push(p); return ""; } } as never;
    await askAll(stub, dir);
    expect(prompts.find((p) => p.includes("Contexts"))).toContain("leave empty to keep this project unrestricted");
  });

  /** Answers keyed by a fragment of the prompt, so the stub survives question reordering. */
  const stubReadline = (answers: Record<string, string>) => ({
    question: async (prompt: string): Promise<string> => {
      for (const [fragment, answer] of Object.entries(answers)) {
        if (prompt.includes(fragment)) return answer;
      }
      return "";
    },
  }) as unknown as Parameters<typeof askAll>[0];

  it("drops a case-insensitive repeat, keeping the spelling typed first", async () => {
    ensureWorksStructure(dir);
    const a = await askAll(stubReadline({ Contexts: "auth,Auth,billing" }), dir);
    // The config reader refuses a case-insensitive repeat, so the writer must never produce one.
    expect(a.contexts).toEqual(["auth", "billing"]);
    expect(a.defaultContext).toBe("auth");
  });

  it("never declares a list from an answer that parses to nothing", async () => {
    ensureWorksStructure(dir);
    for (const answer of [",", "   ", ",,,", ""]) {
      const a = await askAll(stubReadline({ Contexts: answer }), dir);
      // Declaring is a decision; a comma is not one, and neither is Enter.
      expect(a.contexts, JSON.stringify(answer)).toEqual([]);
      expect(typeof a.defaultContext, JSON.stringify(answer)).toBe("string");
    }
  });

  it("produces a list every other command then agrees with", async () => {
    ensureWorksStructure(dir);
    const a = await askAll(stubReadline({ Contexts: "AUTH,billing" }), dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", contexts: a.contexts }));
    // readProjectConfig must accept what the prompt wrote.
    expect(readProjectConfig(dir).contexts).toEqual(["AUTH", "billing"]);

    expect((await cmdNew(args("new", ["one"], { context: "AUTH" }), dir)).code).toBe(0);
    const listing = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(listing).toMatch(/AUTH\s+1 work item\b/);
    // The command must not call a context both declared and undeclared at once.
    expect(listing).not.toContain("In use but not declared");
  });
});

describe("advice the command prints", () => {
  it("does not tell you to add a name the config reader would then refuse", async () => {
    // Declared "Billing", but the work items say "billing": adding it is an illegal repeat.
    await project({ contexts: ["Billing", "auth"] });
    await workItem("a", "billing");
    await workItem("b", "billing");

    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(text).toContain("In use but not declared");
    expect(text).toContain('differs only by case from declared "Billing"');
    expect(text, "adding it is refused, so it must not be advised").not.toContain("Add the ones you want to keep");

    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(json.undeclared).toEqual([{
      context: "billing", count: 2, collidesWith: "Billing", collidesWithDeclared: true,
      declaredClash: "Billing", inUseClashes: [],
    }]);
  });

  it("still advises adding a genuinely new context, and marks the default", async () => {
    await project({ contexts: ["auth"] });
    await workItem("a", "auth");
    await workItem("b", "payments");
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(text).toContain("Add the ones you want to keep");
    expect(text).not.toContain("only by case");
    expect(text).toMatch(/auth\s+1 work item\s+\(default\)/);

    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    expect(json.undeclared).toEqual([{
      context: "payments", count: 1, collidesWith: null, collidesWithDeclared: false,
      declaredClash: null, inUseClashes: [],
    }]);
  });

  it("keeps advising the names that can be added when only some of them collide", async () => {
    // A mixed list: `payments` is addable, `billing` collides with declared `Billing`.
    await project({ contexts: ["Billing"] });
    await workItem("a", "billing");
    await workItem("b", "payments");
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    expect(text).toContain('differs only by case from declared "Billing"');
    expect(text, "payments can still be added, so the advice must survive").toContain("Add the ones you want to keep");
  });

  it("sees two undeclared spellings colliding with each other, not only with a declared name", async () => {
    // Nothing declared matches either, but adding both is still an illegal repeat.
    await project({ contexts: ["auth"] });
    await workItem("a", "Legacy");
    await workItem("b", "legacy");
    const text = (await cmdContexts(args("contexts"), dir)).stdout;
    // Neither is declared, so the message must not call the other one declared.
    expect(text).toContain('differs only by case from "Legacy" (also in use)');
    expect(text).not.toContain("declared \"");
    expect(text).toContain("only one of");
    expect(text, "adding both is refused, so neither may be advised").not.toContain("Add the ones you want to keep");

    const json = JSON.parse((await cmdContexts(args("contexts", [], { json: true }), dir)).stdout);
    const pairs = json.undeclared
      .map((u: { context: string; declaredClash: string | null; inUseClashes: string[] }) => [u.context, u.declaredClash, u.inUseClashes])
      .sort();
    expect(pairs).toEqual([["Legacy", null, ["legacy"]], ["legacy", null, ["Legacy"]]]);
  });

  it("tells you how to fix a refused context", async () => {
    await project({ contexts: ["auth"] });
    const out = (await cmdNew(args("new", ["x"], { context: "billing" }), dir)).stdout;
    expect(out).toContain("Add one by editing contexts in .kf/config.json");
  });
});

describe("writing the config", () => {
  it("rejects an invalid context name instead of writing it", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    expect(() => saveConfig(dir, {
      contexts: ["au@th"], defaultContext: "au@th", defaultContextStated: true, stacks: [], reviewer: "t",
      ignoreWorks: false, seedFeature: false, agents: ["claude"],
    })).toThrow(/context/);
  });

  it("omits the legacy default once a list declares one by position", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    saveConfig(dir, {
      contexts: ["billing"], defaultContext: "billing", defaultContextStated: true, stacks: [], reviewer: "t",
      ignoreWorks: false, seedFeature: false, agents: ["claude"],
    });
    const written = JSON.parse(readFileSync(join(dir, ".kf", "config.json"), "utf8"));
    expect(written.contexts).toEqual(["billing"]);
    expect(written.defaultContext, "a second field could only drift from contexts[0]").toBeUndefined();
  });

  it("never invents a default that would override the guess from existing work items", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await workItem("old", "auth");
    saveConfig(dir, {
      contexts: [], defaultContext: "app", defaultContextStated: false, stacks: [], reviewer: "t",
      ignoreWorks: false, seedFeature: false, agents: ["claude"],
    });
    expect(JSON.parse(readFileSync(join(dir, ".kf", "config.json"), "utf8")).defaultContext).toBeUndefined();
    // kf new must still find auth by looking at the work items, as it did before init ran.
    expect((await cmdNew(args("new", ["x"]), dir)).stdout).toContain("Context: auth");
  });

  it("cannot emit a contexts list that reading it back would refuse", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    saveConfig(dir, {
      contexts: ["auth", "Auth", "billing", "AUTH"],
      defaultContext: "auth",
      defaultContextStated: true,
      stacks: [],
      reviewer: "tester",
      ignoreWorks: false,
      seedFeature: false,
      agents: ["claude"],
    });
    // The reader rejects a case-insensitive repeat, so the writer must never produce one.
    expect(readProjectConfig(dir).contexts).toEqual(["auth", "billing"]);
  });
});

describe("the dashboard", () => {
  it("takes its context from the same place kf new does", async () => {
    await project({ contexts: ["billing", "catalog"], defaultContext: "payments" });
    expect(dashboardData(dir, {}).context).toBe("billing");
  });
});

describe("the suggestion radius", () => {
  it("does not widen without bound for a long name", () => {
    // Without the cap, a 14-character name would allow 5 edits and match something unrelated.
    // These two are 4 edits apart, which the cap refuses and an uncapped budget would accept.
    expect(suggestContext("onboardingflow", ["onboardingstep"])).toBeNull();
    expect(suggestContext("billingxxxx", ["billingyyyy"])).toBeNull();
    // Still generous enough for a real typo in a long name: 2 edits, well inside the cap.
    expect(suggestContext("notifcation", ["notifications"])).toBe("notifications");
  });
});

describe("kf autoconfig", () => {
  it("reports the declared list, or points at kf contexts when there is none", async () => {
    await project({ contexts: ["auth", "billing"] });
    const declared = (await cmdAutoconfig(args("autoconfig"), dir)).stdout;
    expect(declared).toMatch(/\[x\] Declared contexts: auth, billing/);
    // The briefing prints the default two lines above the checklist; both must agree.
    expect(declared).toContain("context: auth");

    await rm(join(dir, ".kf", "config.json"));
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", defaultContext: "app" }));
    const missing = (await cmdAutoconfig(args("autoconfig"), dir)).stdout;
    expect(missing).toContain("kf contexts");
    expect(missing).toMatch(/\[ \].*Declared contexts/);
  });
});

describe("edges nothing else reaches", () => {
  it("fails rather than pretend an empty listing when there is no project", async () => {
    const res = await cmdContexts(args("contexts"), dir);
    expect(res.code).toBe(1);
  });

  it("orders equal counts deterministically", async () => {
    await project();
    for (const [n, c] of [["a", "zebra"], ["b", "alpha"], ["c", "monkey"]] as const) await workItem(n, c);
    expect(contextsInUse(dir).map((r) => r.context)).toEqual(["alpha", "monkey", "zebra"]);
  });

  it("skips a work item whose metadata carries no context", async () => {
    await project();
    await workItem("good", "auth");
    const orphan = join(dir, ".works", "brainstorm", "orphan_20260920_1200");
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, ".kfw.json"), JSON.stringify({ schema: "kanban-flow", feature: "orphan", created: "20260920_1200" }));
    expect(contextsInUse(dir)).toEqual([{ context: "auth", count: 1 }]);
    expect((await cmdContexts(args("contexts"), dir)).code).toBe(0);
  });

  it("keeps the nearest suggestion when two are equally close", () => {
    // A stable winner matters: the message names one name, and it must be the same every run.
    expect(suggestContext("aut", ["auth", "cut"])).toBe("auth");
  });

  it("says so plainly when nothing uses a context yet", async () => {
    await project({ defaultContext: "app" });
    expect((await cmdContexts(args("contexts"), dir)).stdout).toContain("No work item uses a context yet.");
  });

  it("treats an unreadable stage directory as an existing project rather than dying", async () => {
    // Declining to declare changes nothing; declaring would be the act that locks someone out.
    ensureWorksStructure(dir);
    await chmod(join(dir, ".works", "brainstorm"), 0o000);
    try {
      const res = await cmdInit(args("init", [], { defaults: true, context: "cli" }), dir);
      expect(res.code).toBe(0);
      expect(readProjectConfig(dir).contexts).toBeUndefined();
    } finally {
      await chmod(join(dir, ".works", "brainstorm"), 0o755);
    }
  });

  it("does not count a .gitkeep as a work item", async () => {
    // Committing .works/ requires one, and counting it would silently suppress the list.
    ensureWorksStructure(dir);
    await writeFile(join(dir, ".works", "brainstorm", ".gitkeep"), "");
    expect((await cmdInit(args("init", [], { defaults: true, context: "cli" }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toEqual(["cli"]);
  });

  it("declares an explicit context on the minimal path too, on a new project only", async () => {
    // --minimal writes a config anyway; whether a decision is recorded must not hinge on a flag
    // that says nothing about contexts.
    expect((await cmdInit(args("init", [], { minimal: true, context: "payments" }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toEqual(["payments"]);

    const existing = await mkdtemp(join(tmpdir(), "kf-min-"));
    try {
      ensureWorksStructure(existing);
      await mkdir(join(existing, ".works", "brainstorm", "old_20260920_1200"), { recursive: true });
      await writeFile(join(existing, ".works", "brainstorm", "old_20260920_1200", ".kfw.json"),
        JSON.stringify({ schema: "kanban-flow", feature: "old", context: "auth", created: "20260920_1200" }));
      expect((await cmdInit(args("init", [], { minimal: true, context: "payments" }), existing)).code).toBe(0);
      expect(readProjectConfig(existing).contexts, "FR-007: never lock an existing project").toBeUndefined();
    } finally {
      await rm(existing, { recursive: true, force: true });
    }
  });

  it("records a named context on the minimal path too, even when it cannot declare one", async () => {
    // Otherwise --minimal seeds docs/payments and then sends every new item somewhere else.
    ensureWorksStructure(dir);
    await workItem("old", "shop");
    expect((await cmdInit(args("init", [], { minimal: true, context: "payments" }), dir)).code).toBe(0);
    const cfg = readProjectConfig(dir);
    expect(cfg.contexts, "FR-007: an existing project is not declared for").toBeUndefined();
    expect(cfg.defaultContext, "but the named context must not vanish").toBe("payments");
    expect((await cmdNew(args("new", ["x"]), dir)).stdout).toContain("Context: payments");
  });

  it("takes an explicit context to the question, and asks it when there is a terminal", async () => {
    // Earlier rounds called this line untestable and left the only branch that reaches the
    // interactive prompt uncovered. It is testable: force both streams to look like a terminal
    // and stand in for the prompt, so nothing blocks on real input.
    const stdinWas = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdoutWas = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const asked = vi.spyOn(bootstrap, "onboardAnswers").mockResolvedValue({
      contexts: ["payments"], defaultContext: "payments", defaultContextStated: true,
      stacks: [], reviewer: "tester", ignoreWorks: false, seedFeature: false, agents: ["claude"],
    });
    try {
      const out = await cmdInit(args("init", [], { context: "payments" }), dir);
      expect(out.code).toBe(0);
      expect(asked).toHaveBeenCalledWith(dir, "payments");
      expect(out.stdout, "a terminal means the questions were asked, not skipped").not.toContain("non-interactive");
      expect(readProjectConfig(dir).contexts).toEqual(["payments"]);
    } finally {
      asked.mockRestore();
      if (stdinWas) Object.defineProperty(process.stdin, "isTTY", stdinWas);
      if (stdoutWas) Object.defineProperty(process.stdout, "isTTY", stdoutWas);
    }
  });

  it("does not write a default the declared list would override", async () => {
    // `contexts[0]` is the default. A `defaultContext` beside it is read by nothing, so writing
    // one leaves a config that names a default the tool does not use.
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "20260920_1200", contexts: ["auth", "billing"],
      harness: seedHarness(["claude"]),
    }));
    expect((await cmdInit(args("init", [], { minimal: true, context: "billing" }), dir)).code).toBe(0);
    const cfg = readProjectConfig(dir);
    expect(cfg.defaultContext, "the list already decides the default").toBeUndefined();
    expect(cfg.contexts).toEqual(["auth", "billing"]);
    // Seeding docs at a declared context is fine — kf new --context billing can reach them.
    expect(existsSync(join(dir, "docs", "requirement", "billing"))).toBe(true);
    expect((await cmdNew(args("new", ["x"]), dir)).stdout, "and the default is untouched").toContain("Context: auth");
  });

  it("records and seeds a named context on a project kf init has already touched", async () => {
    // The shape every earlier test missed: a config carrying a harness, which is what a real
    // `kf init` writes. Guarding the config write on `!cfg.harness` made the record silently
    // skip exactly the projects someone would run `kf init --minimal --context` on twice.
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "20260920_1200", harness: seedHarness(["claude"]),
    }));
    expect((await cmdInit(args("init", [], { minimal: true, context: "payments" }), dir)).code).toBe(0);
    const cfg = readProjectConfig(dir);
    expect(cfg.defaultContext, "the named context must survive on an already-initialised project").toBe("payments");
    expect(cfg.harness, "and re-running init must not rebuild the harness under it").toBeDefined();
    // Where docs land and where new items go have to be the same place, or the tree is dead.
    for (const docsDir of ["requirement", "use-cases", "testplan"]) {
      expect(existsSync(join(dir, "docs", docsDir, "payments")), docsDir).toBe(true);
    }
    expect((await cmdNew(args("new", ["x"]), dir)).stdout).toContain("Context: payments");
  });

  it("does not declare on the minimal path when a config already exists", async () => {
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x" }));
    expect((await cmdInit(args("init", [], { minimal: true, context: "payments" }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts, "FR-007 applies to a bare config too").toBeUndefined();
  });

  it("keeps a default someone named, even on an existing project", async () => {
    // Otherwise `--context X` seeds docs/X and then sends every new item somewhere else.
    ensureWorksStructure(dir);
    await workItem("old", "auth");
    expect((await cmdInit(args("init", [], { defaults: true, context: "payments" }), dir)).code).toBe(0);
    const cfg = readProjectConfig(dir);
    expect(cfg.contexts, "FR-007 still forbids declaring on an existing project").toBeUndefined();
    expect(cfg.defaultContext, "but the named context must not vanish").toBe("payments");
    expect((await cmdNew(args("new", ["x"]), dir)).stdout).toContain("Context: payments");
  });

  it("seeds the minimal docs tree at the declared default, not a legacy field", async () => {
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", contexts: ["billing", "auth"], defaultContext: "legacy",
    }));
    expect((await cmdInit(args("init", [], { minimal: true }), dir)).code).toBe(0);
    // contexts[0] is the default; a stale defaultContext must not decide where docs land.
    expect(existsSync(join(dir, "docs", "requirement", "billing"))).toBe(true);
    expect(existsSync(join(dir, "docs", "requirement", "legacy"))).toBe(false);
  });

  it("keeps a default the project already had when nobody names one", async () => {
    // The half of the rule that had no test: existing default plus work items.
    ensureWorksStructure(dir);
    await mkdir(join(dir, ".kf"), { recursive: true });
    await writeFile(join(dir, ".kf", "config.json"), JSON.stringify({ schema: "kanban-flow", created: "x", defaultContext: "legacy" }));
    await workItem("old", "auth");
    expect((await cmdInit(args("init", [], { defaults: true }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).defaultContext).toBe("legacy");
  });

  it("does not count a timestamped file as a work item", async () => {
    // Only a folder is a work item; a stray notes file must not suppress the declaration.
    ensureWorksStructure(dir);
    await writeFile(join(dir, ".works", "brainstorm", "notes_20260101_0000.md"), "scratch");
    expect((await cmdInit(args("init", [], { defaults: true, context: "cli" }), dir)).code).toBe(0);
    expect(readProjectConfig(dir).contexts).toEqual(["cli"]);
  });

  it("refuses an invalid explicit context on the minimal path too", async () => {
    await expect(cmdInit(args("init", [], { minimal: true, context: "../escape" }), dir)).rejects.toThrow(/context/);
  });
});

describe("counting contexts on disk", () => {
  it("counts per context, busiest first, and ignores work items with none", async () => {
    await project();
    await workItem("a", "auth");
    await workItem("b", "billing");
    await workItem("c", "billing");
    expect(contextsInUse(dir)).toEqual([
      { context: "billing", count: 2 },
      { context: "auth", count: 1 },
    ]);
  });

  it("reports the spelling that is on disk, not a lowercased one", async () => {
    await project();
    await workItem("old", "Legacy");
    expect(contextsInUse(dir)).toEqual([{ context: "Legacy", count: 1 }]);
    // Following the advice this prints must not create a second tree beside the existing one.
    expect(checkContext("Legacy", { contexts: ["Legacy"] }).ok).toBe(true);
  });

  it("keeps two spellings apart, because they are two directories", async () => {
    await project();
    await workItem("upper", "Legacy");
    await workItem("lower", "legacy");
    // Collapsing them would hide the drift, and would let folder sort order pick the winner.
    // Tie order between the two spellings is locale-dependent, so compare as a set.
    const rows = contextsInUse(dir).map((r) => `${r.context}:${r.count}`).sort();
    expect(rows).toEqual(["Legacy:1", "legacy:1"]);
  });
});
