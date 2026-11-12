import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { PKG_ROOT } from "../shared/paths.js";
import { filesOverlap, patternsOverlap } from "../workflow/allowlist.js";

const SCRIPT = join(PKG_ROOT, "assets", "skills", "travel", "scripts", "estimates");

function overlapCli(a: string[], b: string[]): boolean {
  const r = spawnSync(process.execPath, [SCRIPT, "overlap", a.join(","), b.join(",")], { encoding: "utf8" });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim() === "sequential";
}

const CASES: Array<[string[], string[]]> = [
  [["src/a.ts"], ["src/a.ts"]],
  [["src/a.ts"], ["src/b.ts"]],
  [["src/**"], ["src/cli/x.ts"]],
  [["src/cli/*.ts"], ["src/workflow/*.ts"]],
  [["src/cli/*.ts"], ["src/cli/commands/x.ts"]],
  [["./src/a.ts"], ["src/a.ts"]],
  [["src/"], ["src/a.ts"]],
  [["`src/a.ts`"], ["docs/a.md"]],
  [["**"], ["docs/a.md"]],
  [["*"], ["docs/a.md"]],
  [["."], ["docs/a.md"]],
  [["src/ab.ts"], ["src/a"]],
  [["docs/a.md", "src/a.ts"], ["tests/b.ts", "src/*.ts"]],
  [["docs/a.md", "src/a.ts"], ["tests/b.ts", "lib/c.ts"]],
  [["src/[ab].ts"], ["src/a.ts"]],
  [["src/a?.ts"], ["docs/x.md"]],
];

describe("travel overlap copy", () => {
  it.each(CASES)("agrees with the scheduler for %j vs %j", (a, b) => {
    expect(overlapCli(a, b)).toBe(filesOverlap(a.map((p) => p.replace(/`/g, "")), b.map((p) => p.replace(/`/g, ""))));
  });

  it("agrees on single patterns", () => {
    for (const [a, b] of CASES) {
      for (const x of a) for (const y of b) {
        expect(overlapCli([x], [y]), `${x} ${y}`).toBe(patternsOverlap(x, y));
      }
    }
  });
});
