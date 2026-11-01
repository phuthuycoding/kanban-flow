import { spawnSync } from "node:child_process";

/**
 * Whether the process at `pid` looks like kf by its command line (`kanban-flow`, `dist/index.js` or a
 * `kf` word); null when ps cannot say — no ps, Windows, or ps failing for the pid.
 */
export function commandLooksLikeKf(pid: number): boolean | null {
  if (process.platform === "win32") return null;
  const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (res.error) {
    if ((res.error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw res.error;
  }
  if (res.status !== 0) return null;
  return /kanban-flow|dist\/index\.js|(^|[\s/])kf(\s|$)/.test(res.stdout);
}

export function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") return false;
    if (err instanceof Error && "code" in err && err.code === "EPERM") return true;
    throw err;
  }
}
