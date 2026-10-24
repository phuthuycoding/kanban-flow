import { describe, it, expect } from "vitest";

import { patternsOverlap, filesOverlap, nextToStart, blockedBy, progressState } from "../harness/scheduler.js";
import type { PlannedTask } from "../workflow/tasks.js";
import type { TaskStateName } from "../workflow/features.js";

function task(id: string, files: string[] | null, dependencies: string[] = []): PlannedTask {
  return { id, description: id, dependencies, role: "-", files };
}

function states(map: Record<string, TaskStateName>): Record<string, { state: TaskStateName }> {
  return Object.fromEntries(Object.entries(map).map(([id, state]) => [id, { state }]));
}

describe("patternsOverlap", () => {
  it.each([
    ["src/a.ts", "src/", true],
    ["src", "src/a.ts", true],
    ["./src/a.ts", "`src/`", true],
    ["src/a/*.ts", "src/b/*.ts", false],
    ["*", "anything/at/all.ts", true],
    ["**", "src/a.ts", true],
    [".", "src/a.ts", true],
    ["src/a.ts", "src/b.ts", false],
    ["src/**", "src/x/y.ts", true],
    ["docs/a.md", "docs/a.md", true],
    ["src/a", "src/ab", false],
    ["src/a", "src/ab/c.ts", false],
    ["src/a*.ts", "src/b.ts", true],
    ["src/a/*.ts", "src/a/x.ts", true],
  ])("%s ~ %s = %s", (a, b, expected) => {
    expect(patternsOverlap(a, b)).toBe(expected);
    expect(patternsOverlap(b, a)).toBe(expected);
  });
});

describe("filesOverlap", () => {
  it("treats unknown files as overlapping everything", () => {
    expect(filesOverlap(null, ["src/a.ts"])).toBe(true);
    expect(filesOverlap(["src/a.ts"], null)).toBe(true);
    expect(filesOverlap(null, null)).toBe(true);
  });
  it("compares every pair of patterns", () => {
    expect(filesOverlap(["a/x.ts", "b/y.ts"], ["c/z.ts", "b/"])).toBe(true);
    expect(filesOverlap(["a/x.ts"], ["b/y.ts"])).toBe(false);
    expect(filesOverlap([], ["b/y.ts"])).toBe(false);
  });
});

describe("scheduler (TC-011)", () => {
  const tasks = [
    task("A", ["src/a/x.ts"]),
    task("B", ["src/b/x.ts"]),
    task("C", ["src/c/x.ts"]),
    task("D", ["src/a/"]),
    task("E", null),
    task("F", ["src/f/x.ts"]),
    task("G", ["**"]),
    task("Z", ["src/z.ts"]),
    task("H", ["src/h.ts"], ["Z"]),
  ];

  it("steps through completions with exact pick sets", () => {
    const s: Record<string, TaskStateName> = { Z: "blocked" };
    const pick = (): string[] => nextToStart({ tasks, states: states(s), parallel: 3 });

    const first = pick();
    expect(first).toEqual(["A", "B", "C"]);
    for (const id of first) s[id] = "running";

    expect(pick()).toEqual([]);

    s.A = "done";
    // D overlaps nothing running now, so it may take the freed slot; F comes later in plan order.
    expect(pick()).toEqual(["D"]);
    s.D = "running";
    s.B = "done";
    expect(pick()).toEqual(["F"]);
    s.F = "running";
    s.C = "done";
    expect(pick()).toEqual([]);

    s.D = "done";
    expect(pick()).toEqual([]);
    s.F = "done";
    // Nothing running: E (files unknown) goes alone, G is not picked beside it.
    expect(pick()).toEqual(["E"]);
    s.E = "running";
    expect(pick()).toEqual([]);
    s.E = "done";
    expect(pick()).toEqual(["G"]);
    s.G = "running";
    expect(pick()).toEqual([]);
    s.G = "done";
    expect(pick()).toEqual([]);

    expect(blockedBy(tasks, states(s))).toEqual({ H: "Z" });
    expect(progressState({ tasks, states: states(s), parallel: 3 })).toBe("stuck");
  });

  it("never starts D alongside A", () => {
    expect(nextToStart({ tasks: [tasks[0]!, tasks[3]!], states: {}, parallel: 5 })).toEqual(["A"]);
    expect(nextToStart({ tasks: [tasks[3]!, tasks[0]!], states: states({ A: "running" }), parallel: 5 })).toEqual([]);
  });

  it("starts E and G only alone", () => {
    const withE = [tasks[0]!, tasks[4]!];
    expect(nextToStart({ tasks: withE, states: {}, parallel: 5 })).toEqual(["A"]);
    expect(nextToStart({ tasks: [tasks[4]!, tasks[0]!], states: {}, parallel: 5 })).toEqual(["E"]);
    expect(nextToStart({ tasks: [tasks[6]!, tasks[0]!], states: {}, parallel: 5 })).toEqual(["G"]);
    expect(nextToStart({ tasks: [tasks[6]!, tasks[0]!], states: states({ A: "verifying" }), parallel: 5 })).toEqual([]);
  });

  it("honours parallel 1", () => {
    const t = [tasks[0]!, tasks[1]!];
    expect(nextToStart({ tasks: t, states: {}, parallel: 1 })).toEqual(["A"]);
    expect(nextToStart({ tasks: t, states: states({ A: "merging" }), parallel: 1 })).toEqual([]);
  });

  it("waits for dependencies and ignores non-startable states", () => {
    const t = [task("A", ["a"]), task("B", ["b"], ["A"]), task("C", ["c"])];
    expect(nextToStart({ tasks: t, states: states({ C: "failed" }), parallel: 3 })).toEqual(["A"]);
    expect(nextToStart({ tasks: t, states: states({ A: "done", C: "ready" }), parallel: 3 })).toEqual(["B", "C"]);
  });

  it("counts caller-supplied running ids against the bound", () => {
    const t = [task("A", ["a"]), task("B", ["b"])];
    expect(nextToStart({ tasks: t, states: {}, running: ["X"], parallel: 1 })).toEqual([]);
  });

  it("propagates blocked transitively and never starts H", () => {
    const st = states({ Z: "blocked" });
    const t = [...tasks, task("J", ["src/j.ts"], ["H"])];
    expect(blockedBy(t, st)).toMatchObject({ H: "Z", J: "Z" });
    expect(nextToStart({ tasks: t, states: { ...st, A: { state: "done" } }, parallel: 9 })).not.toContain("H");
    expect(blockedBy(t, states({ Z: "failed" })).H).toBe("Z");
  });
});

describe("progressState", () => {
  const t = [task("A", ["a"]), task("B", ["b"], ["A"])];
  it("reports done, running and stuck", () => {
    expect(progressState({ tasks: t, states: states({ A: "done", B: "done" }), parallel: 2 })).toBe("done");
    expect(progressState({ tasks: t, states: states({ A: "running" }), parallel: 2 })).toBe("running");
    expect(progressState({ tasks: t, states: {}, parallel: 2 })).toBe("running");
    expect(progressState({ tasks: t, states: states({ A: "failed" }), parallel: 2 })).toBe("stuck");
    expect(progressState({ tasks: t, states: states({ A: "blocked", B: "pending" }), parallel: 2 })).toBe("stuck");
  });
});
