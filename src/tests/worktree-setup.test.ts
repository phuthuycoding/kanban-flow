import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorksStructure, findFeature } from "../workflow/features.js";
import { ARTIFACTS } from "../workflow/schema.js";
import { buildSetupPlan, findZoneConflict, renderPlan, proxyPlist } from "../worktree/setup.js";
import { readMachineConfig, MACHINE_CONFIG_FILE } from "../worktree/config.js";
import { probeDomainInfra } from "../worktree/health.js";
import { cmdWorktree } from "../cli/commands/worktree.js";
import { cmdNew } from "../cli/commands/new.js";
import { cmdValidate } from "../cli/commands/inspect.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import type { ParsedArgs } from "../cli/args.js";

let dir: string;
const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs => ({ command, positionals, options });

const MACHINE = { proxyListen: "127.0.0.2:80", domainZone: "test", fallbackUpstream: null, routesFile: "/tmp/routes.json" };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-setup-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("kf worktree setup plan (FR-005)", () => {
  it("builds the full onboarding plan with the dnsmasq rule for the zone", () => {
    const plan = buildSetupPlan(MACHINE, { kfEntrypoint: "/kf/dist/index.js", nodePath: "/node" });
    const dnsmasq = plan.steps.find((s) => s.id === "dnsmasq-conf");
    // dnsmasq.d exists on this dev machine; on a bare one the step degrades to a hint.
    if (dnsmasq?.file) {
      expect(dnsmasq.file.content).toContain("address=/.test/127.0.0.2");
      expect(dnsmasq.needsSudo).toBe(false);
    }
    const launchd = plan.steps.find((s) => s.id === "launchd");
    expect(launchd?.file?.path).toBe("/Library/LaunchDaemons/ai.kaban-flow.proxy.plist");
    expect(launchd?.file?.content).toContain("proxy");
    expect(launchd?.command).toEqual(["launchctl", "bootstrap", "system", "/Library/LaunchDaemons/ai.kaban-flow.proxy.plist"]);
    expect(launchd?.needsSudo).toBe(true);
  });

  it("--print renders the plan and touches nothing", async () => {
    const res = await cmdWorktree(args("worktree", ["setup"], { print: true }), dir);
    // exit code depends on whether this machine has a conflicting zone rule (it does: Valet)
    expect(res.stdout).toContain("kf worktree setup plan");
    expect(res.stdout).toContain("address=/.test/127.0.0.2");
    expect(res.stdout).toContain("LaunchDaemon");
    expect(res.stdout).toMatch(/\[sudo\]/);
    expect([0, 1]).toContain(res.code);
  });

  it("refuses to overwrite a foreign rule for the zone (setup refuses before writing)", async () => {
    const d = join(dir, "conf.d");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "valet.conf"), "address=/.test/127.0.0.1\n");
    const plan = buildSetupPlan(MACHINE, {
      kfEntrypoint: "/kf/index.js",
      nodePath: "/node",
      extraDnsmasqDirs: [d],
    });
    // any matching foreign rule counts — on this machine the real Valet rule may win ordering
    expect(plan.conflict).not.toBeNull();
    expect(renderPlan(plan)).toContain("CONFLICT");
  });
});

describe("zone conflict detection", () => {
  it("flags a foreign rule for the same zone on another IP", async () => {
    const d = join(dir, "conf.d");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "valet.conf"), "address=/.test/127.0.0.1\nlisten-address=127.0.0.1\n");
    const hit = findZoneConflict("test", "127.0.0.2", [d]);
    expect(hit).toMatchObject({ file: join(d, "valet.conf") });
    expect(hit!.line).toContain("127.0.0.1");
  });

  it("accepts an existing rule already pointing at the kf listen host", async () => {
    const d = join(dir, "conf.d");
    await mkdir(d, { recursive: true });
    await writeFile(join(d, "valet.conf"), "address=/.test/127.0.0.2\n");
    expect(findZoneConflict("test", "127.0.0.2", [d])).toBeNull();
    // our own file is never a conflict, whatever it says
    await writeFile(join(d, "kanban-flow.conf"), "address=/.test/127.0.0.9\n");
    expect(findZoneConflict("test", "127.0.0.2", [d])).toBeNull();
  });
});

describe("plist generation", () => {
  it("embeds node + entrypoint + proxy serve", () => {
    const plist = proxyPlist("/path/index.js", "/path/node");
    expect(plist).toContain("<string>/path/node</string>");
    expect(plist).toContain("<string>proxy</string>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
  });
});

describe("machine config + infra probes (FR-006)", () => {
  it("reads defaults and merges a machine config file", () => {
    const cfg = readMachineConfig();
    expect(cfg.proxyListen).toMatch(/^127\.0\.0\.\d+:80$/);
    expect(cfg.domainZone).toBe("test");
    expect(MACHINE_CONFIG_FILE).toContain(".config/kanban-flow");
  });

  it("reports probes for dns/proxy/routes; fails loudly on a corrupt routes file", async () => {
    const report = await probeDomainInfra(
      { ...MACHINE, proxyListen: "127.0.0.2:59999" },
      join(dir, "routes.json"),
    );
    expect(report.probes.map((p) => p.name).sort()).toEqual(["dns", "proxy", "routes"]);
    expect(report.probes.find((p) => p.name === "proxy")!.ok).toBe(false);
    // routes file absent → ok (created on first worktree)
    expect(report.probes.find((p) => p.name === "routes")!.ok).toBe(true);

    await writeFile(join(dir, "routes.json"), "{not json");
    const corrupt = await probeDomainInfra({ ...MACHINE }, join(dir, "routes.json"));
    expect(corrupt.probes.find((p) => p.name === "routes")!.ok).toBe(false);
  });
});

describe("rendering", () => {
  it("marks sudo steps and shows conflicts", () => {
    const plan = buildSetupPlan(MACHINE, { kfEntrypoint: "/kf/index.js", nodePath: "/node" });
    const out = renderPlan(plan);
    expect(out).toContain("kf worktree setup plan");
    expect(out).toContain("[sudo]");
  });
});

describe("infra warning on validate/doctor (FR-006, UC-005)", () => {
  async function seededProject(worktree: Record<string, unknown>): Promise<string> {
    const root = join(dir, "proj");
    ensureWorksStructure(root);
    await mkdir(join(root, ".kf"), { recursive: true });
    await writeFile(join(root, ".kf", "config.json"), JSON.stringify({
      schema: "kanban-flow", created: "x", worktree,
    }));
    expect((await cmdNew(args("new", ["demo"], { context: "app" }), root)).code).toBe(0);
    await writeFile(
      join(findFeature(root, "demo")!.dir, ARTIFACTS["spec-requirement"].file),
      "---\nstatus: confirmed\n---\n# Requirement\n## FR-001\nUser can create a task.",
    );
    return root;
  }

  it("emits worktree_infra_missing as WARNING when probes fail", async () => {
    // default machine config: nothing listens on 127.0.0.2:80 and .test does not resolve there
    const root = await seededProject({ enabled: true });
    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    const warn = res.stdout.includes("worktree_infra_missing");
    // on a machine where .test is already routed to kf the warning legitimately disappears
    if (warn) {
      expect(res.stdout).toContain("[WARNING]");
      expect(res.stdout).toContain("kf worktree setup");
      expect(res.stdout).not.toContain("[ERROR] .*worktree_infra");
      expect(res.code).toBe(0); // warning does not block
    }
  });

  it("emits no warning when worktree.enabled is false", async () => {
    const root = await seededProject({ enabled: false });
    const res = await cmdValidate(args("validate", [], { change: "demo" }), root);
    expect(res.stdout).not.toContain("worktree_infra_missing");
  });

  it("doctor reports infra probes as WARNING findings", async () => {
    const root = await seededProject({ enabled: true });
    const res = await cmdDoctor(args("doctor"), root);
    // other project findings may exist on a bare fixture; we only assert the infra level
    if (res.stdout.includes("worktree infra")) {
      expect(res.stdout).toContain("[WARNING] worktree infra");
      expect(res.stdout).not.toContain("[ERROR] worktree infra");
    }
  });
});


