import { spawnSync } from "node:child_process";

/**
 * Whether the process at `pid` looks like kf by its command line (`kanban-flow`, `dist/index.js` or a
 * `kf` word); null when ps cannot say — no ps, Windows, ps failing, timing out or exiting non-zero.
 */
export function commandLooksLikeKf(pid: number): boolean | null {
  if (process.platform === "win32") return null;
  const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 5000 });
  if (res.error) {
    // A spawn failure with a code (ENOENT, EACCES, ETIMEDOUT, ...) only means ps cannot answer; the caller falls back to existence.
    if ("code" in res.error) return null;
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
