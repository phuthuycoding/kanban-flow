import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The package root, resolved from this file's location (src/tests/fixtures/lib). */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const FIXTURES = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_NAME = "@phuthuycoding/kanban-flow";

export interface Consumer {
  /** The project a program that depends on the package would live in. */
  dir: string;
  /** An empty HOME the spawned process runs with. */
  home: string;
  /** Write `source` as `<dir>/<file>` (ES module) and run it with node, cwd set to the project. */
  run(source: string, args?: string[], file?: string): SpawnSyncReturns<string>;
  /** Run a script and parse the one JSON document it prints; a failed run fails with its stderr. */
  runJson<T>(source: string, args?: string[]): T;
  cleanup(): void;
}

/**
 * A temp project whose `node_modules/@phuthuycoding/kanban-flow` is a symlink to the package root, so an
 * import of the package name resolves through its `exports` map exactly as an installed copy's would.
 */
export function createConsumer(): Consumer {
  const dir = mkdtempSync(join(tmpdir(), "kfw-consumer-"));
  const home = mkdtempSync(join(tmpdir(), "kfw-consumer-home-"));
  mkdirSync(join(dir, "node_modules", "@phuthuycoding"), { recursive: true });
  symlinkSync(PACKAGE_ROOT, join(dir, "node_modules", PACKAGE_NAME), "dir");

  const run = (source: string, args: string[] = [], file = "probe.mjs"): SpawnSyncReturns<string> => {
    writeFileSync(join(dir, file), source);
    return spawnSync(process.execPath, [file, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
  };

  const runJson = <T>(source: string, args: string[] = []): T => {
    const res = run(source, args);
    if (res.status !== 0) throw new Error(`probe exited ${res.status}: ${res.stderr}`);
    return JSON.parse(res.stdout) as T;
  };

  return {
    dir,
    home,
    run,
    runJson,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}
