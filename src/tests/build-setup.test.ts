import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDist } from "./setup/build.js";

vi.setConfig({ testTimeout: 60_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "build-setup");
const BUILD_SETUP = resolve(HERE, "setup", "build.ts");
const WARNING = "build setup: tsc exited 2 — type errors, dist emitted, continuing";

let scratch: string;

const baseConfig = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    compilerOptions: { target: "es2022", module: "esnext", strict: true, outDir: "dist", types: [], ...extra },
    include: ["src"],
  });

function seed(source: string, config: string | null = baseConfig()): void {
  mkdirSync(join(scratch, "src"), { recursive: true });
  writeFileSync(join(scratch, "src", "a.ts"), source);
  if (config !== null) writeFileSync(join(scratch, "tsconfig.build.json"), config);
}

let stderrText: () => string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "kf-build-setup-"));
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  stderrText = () => spy.mock.calls.map((c) => String(c[0])).join("");
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe("buildDist", () => {
  it("returns quietly and emits js when the project type-checks", () => {
    seed("export const x: number = 1;\n");
    expect(() => buildDist(scratch)).not.toThrow();
    expect(stderrText()).not.toContain("build setup:");
    expect(existsSync(join(scratch, "dist", "a.js"))).toBe(true);
  });

  it("warns and continues when tsc exits 2 on type errors, with js emitted", () => {
    seed('export const x: number = "s";\n');
    expect(() => buildDist(scratch)).not.toThrow();
    expect(stderrText()).toContain(`${WARNING}\n`);
    expect(existsSync(join(scratch, "dist", "a.js"))).toBe(true);
  });

  it("throws naming the status when tsconfig.build.json is missing", () => {
    seed("export const x = 1;\n", null);
    expect(() => buildDist(scratch)).toThrowError(new Error("build setup: tsc exited 1"));
    expect(stderrText()).not.toContain("continuing");
  });

  it("throws naming the status when noEmitOnError blocks emit on a type error", () => {
    seed('export const x: number = "s";\n', baseConfig({ noEmitOnError: true }));
    expect(() => buildDist(scratch)).toThrowError(new Error("build setup: tsc exited 1"));
    expect(stderrText()).not.toContain("continuing");
    expect(existsSync(join(scratch, "dist", "a.js"))).toBe(false);
  });
});

describe("build setup as vitest globalSetup", () => {
  it("passes diagnostics through and lets the suite run when tsc exits 2", () => {
    copyFileSync(join(FIXTURES, "vitest.config.ts.txt"), join(scratch, "vitest.config.ts"));
    copyFileSync(join(FIXTURES, "tsconfig.build.json"), join(scratch, "tsconfig.build.json"));
    copyFileSync(join(FIXTURES, "scratch.test.js.txt"), join(scratch, "scratch.test.js"));
    mkdirSync(join(scratch, "src"));
    copyFileSync(join(FIXTURES, "bad.ts.txt"), join(scratch, "src", "bad.ts"));

    const vitestBin = createRequire(import.meta.url).resolve("vitest/vitest.mjs");
    const r = spawnSync(process.execPath, [vitestBin, "run"], {
      cwd: scratch,
      encoding: "utf8",
      env: { ...process.env, BUILD_SETUP_PATH: BUILD_SETUP },
    });
    const output = `${r.stdout}\n${r.stderr}`;

    expect(output).toContain("TS2322");
    expect(output).toContain(WARNING);
    expect(output).toMatch(/1 passed/);
    expect(r.status).toBe(0);
    expect(readFileSync(join(scratch, "dist", "bad.js"), "utf8")).toContain("export const x");
  });
});
