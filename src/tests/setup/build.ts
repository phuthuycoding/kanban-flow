import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// Detached runs spawn `node dist/index.js`, so the suite needs a current build.
// tsc exit 2 means type errors but the JS was still emitted, so dist is usable and the suite
// continues (type errors are `npm run typecheck`'s job); any other failure leaves dist unreliable.
export function buildDist(cwd: string): void {
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], { cwd, stdio: "inherit" });
  if (r.status === 0) return;
  if (r.status === 2) {
    process.stderr.write("build setup: tsc exited 2 — type errors, dist emitted, continuing\n");
    return;
  }
  throw new Error(`build setup: tsc exited ${r.status}`, r.error ? { cause: r.error } : undefined);
}

export default function setup(): void {
  buildDist(process.cwd());
}
