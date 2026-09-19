import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dashboardData, renderDashboardHtml } from "../dashboard/dashboard.js";
import { writeFeatureMeta, executionContractHash } from "../workflow/features.js";
import { STAGES, type Stage, type WorkItemKind } from "../workflow/schema.js";
import { runInNewContext } from "node:vm";

let dir: string;

async function item(name: string, stage: Stage, kind: WorkItemKind, context: string, tasks?: string): Promise<string> {
  const path = join(dir, ".works", stage, name + "_20260917_1200");
  await mkdir(path, { recursive: true });
  await writeFeatureMeta(path, { schema: "kanban-flow", feature: name, context, created: "20260917_1200", kind });
  if (tasks) await writeFile(join(path, "tasks.md"), tasks);
  return path;
}

function browserElements() {
  return Object.fromEntries([
    "#root", "#ts", "#kpis", "#stage-chart", "#context-chart", "#approval-chart",
    "#kind-chart", "#task-chart", "#context", "#kind", "#refresh", "#error",
  ].map((id) => [id, {
    textContent: "", innerHTML: "", value: "", hidden: true, disabled: false,
    addEventListener: () => {},
  }]));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kfw-dash-"));
  for (const s of STAGES) await mkdir(join(dir, ".works", s), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("dashboardData", () => {
  it("returns all workflow stages (even empty ones)", () => {
    const d = dashboardData(dir);
    expect(d.root).toBe(dir);
    expect(d.stages.map((s) => s.id)).toEqual([...STAGES]);
    expect(d.stages.every((s) => Array.isArray(s.features))).toBe(true);
  });

  it("includes features with artifact status and next step", async () => {
    const fdir = join(dir, ".works", "brainstorm", "demo_20260917_1200");
    await mkdir(fdir, { recursive: true });
    await writeFeatureMeta(fdir, {
      schema: "kanban-flow",
      feature: "demo",
      context: "auth",
      created: "20260917_1200",
    });
    await writeFile(join(fdir, "phase-1-spec-requirement.md"), "filled body", "utf8");

    const d = dashboardData(dir);
    const brainstorm = d.stages.find((s) => s.id === "brainstorm")!;
    const f = brainstorm.features.find((x) => x.name === "demo")!;
    expect(f.context).toBe("auth");
    expect(f.artifacts.find((a) => a.id === "spec-requirement")!.status).toBe("done");
  });

  it("renders an html page", () => {
    expect(renderDashboardHtml()).toContain("<!doctype html>");
    expect(renderDashboardHtml()).toContain("kaban-flow dashboard");
  });

  it("aggregates snapshots by stage, kind and context with weighted execution task progress", async () => {
    await item("feature-a", "implementation", "feature", "auth", "- [x] Done");
    await item("bug-b", "implementation", "bug", "auth", "- [x] Done\n- [ ] Todo\n- [ ] Todo");
    await item("feature-c", "testing", "feature", "app");
    const bug = await item("bug-d", "backlog", "bug", "auth");
    await writeFile(join(bug, "phase-1-spec-requirement.md"), "---\nstatus: confirmed\n---\nBug fix scope");
    await writeFeatureMeta(bug, {
      schema: "kanban-flow", feature: "bug-d", context: "auth", created: "20260917_1200", kind: "bug",
      approval: { status: "approved", contractHash: executionContractHash(bug, "bug")! },
    });
    await item("feature-e", "brainstorm", "feature", "app");
    await item("feature-f", "dones", "feature", "app", "- [x] Archived task");
    const data = dashboardData(dir);
    expect(data.metrics).toEqual({
      total: 6, features: 4, bugs: 2, executing: 3, backlog: 1, completed: 1, completionRate: 17, bypassed: 0,
      tasks: { done: 2, total: 4, completionRate: 50, itemsTracked: 2, itemsUntracked: 1 },
    });
    expect(data.charts.byStage.find((row) => row.id === "implementation")).toMatchObject({ count: 2, features: 1, bugs: 1 });
    expect(data.charts.byContext).toEqual([
      { id: "app", label: "app", count: 3, features: 3, bugs: 0 },
      { id: "auth", label: "auth", count: 3, features: 1, bugs: 2 },
    ]);
    expect(data.charts.approvals.map((row) => row.count)).toEqual([3, 1, 0]);
    const filtered = dashboardData(dir, { context: "auth", kind: "bug" });
    expect(filtered.metrics).toMatchObject({ total: 2, bugs: 2, features: 0, backlog: 1, executing: 1 });
    expect(filtered.metrics.tasks).toMatchObject({ done: 1, total: 3, completionRate: 33 });
    expect(filtered.availableContexts.map((context) => context.id)).toEqual(["app", "auth"]);
    await writeFile(join(bug, "phase-1-spec-requirement.md"), "Changed bug fix scope");
    expect(dashboardData(dir).charts.approvals.find((row) => row.id === "changed")?.count).toBe(1);
  });

  it("returns zero counts and unknown progress for empty filters and missing task data", async () => {
    await item("feature", "implementation", "feature", "auth");
    expect(dashboardData(dir).metrics.tasks).toMatchObject({ total: 0, completionRate: null, itemsUntracked: 1 });
    const data = dashboardData(dir, { context: "missing" });
    expect(data.metrics).toMatchObject({ total: 0, completionRate: null });
    expect(data.charts.byStage.every((row) => row.count === 0)).toBe(true);
    expect(data.charts.byContext).toEqual([]);
  });

  it("groups legacy items without metadata under unknown context", async () => {
    await mkdir(join(dir, ".works", "brainstorm", "legacy_20260917_1200"));
    const data = dashboardData(dir, { context: null });
    expect(data.metrics.total).toBe(1);
    expect(data.charts.byContext).toEqual([{ id: null, label: "Không xác định", count: 1, features: 1, bugs: 0 }]);
  });

  it("renders chart labels and context options as escaped text", async () => {
    const html = renderDashboardHtml();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    const payload = '<img src=x onerror="window.injected=true">';
    const elements = browserElements();
    const data = dashboardData(dir);
    data.availableContexts = [{ id: payload, label: payload }];
    data.charts.byContext = [{ id: payload, label: payload, count: 1, features: 1, bugs: 0 }];
    runInNewContext(script, {
      document: { querySelector: (id: string) => elements[id] },
      fetch: async () => ({ ok: true, json: async () => data }),
      setInterval: () => {}, URLSearchParams,
    });
    await new Promise((resolve) => setImmediate(resolve));
    for (const id of ["#context-chart", "#context"]) {
      expect(elements[id].innerHTML).not.toContain("<img");
      expect(elements[id].innerHTML).toContain("&lt;img src=x onerror=&quot;window.injected=true&quot;&gt;");
    }
    expect(elements["#kind-chart"].innerHTML).not.toContain("NaN");
    expect(elements["#refresh"].disabled).toBe(false);
  });

  it("shows fetch errors while preserving the last rendered metrics", async () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(renderDashboardHtml())![1];
    const elements = browserElements();
    elements["#kpis"].innerHTML = "Previous metrics";
    runInNewContext(script, {
      document: { querySelector: (id: string) => elements[id] },
      fetch: async () => ({ ok: false, status: 500 }),
      setInterval: () => {}, URLSearchParams,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(elements["#error"].hidden).toBe(false);
    expect(elements["#error"].textContent).toContain("HTTP 500");
    expect(elements["#kpis"].innerHTML).toBe("Previous metrics");
    expect(elements["#refresh"].disabled).toBe(false);
  });

  it("keeps the context control intact on automatic refresh with unchanged options", async () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(renderDashboardHtml())![1];
    const elements = browserElements();
    let changes = 0;
    let markup = "";
    Object.defineProperty(elements["#context"], "innerHTML", {
      get: () => markup,
      set: (value: string) => { markup = value; changes += 1; },
    });
    let poll: () => Promise<void> = async () => {};
    runInNewContext(script, {
      document: { querySelector: (id: string) => elements[id] },
      fetch: async () => ({ ok: true, json: async () => dashboardData(dir) }),
      setInterval: (callback: () => Promise<void>) => { poll = callback; }, URLSearchParams,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await poll();
    expect(changes).toBe(1);
  });
});
