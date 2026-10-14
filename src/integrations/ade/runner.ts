import { spawnSync } from "node:child_process";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
  /** argv[0] could not be spawned at all (binary missing). */
  missing: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Bounded subprocess call for ADE CLIs. Never throws on a non-zero exit — the
 * caller decides; ENOENT (binary absent) is reported via `missing`.
 */
export function runCli(bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): CliResult {
  const res = spawnSync(bin, args, {
    encoding: "utf8",
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const missing = res.error !== undefined && "code" in res.error && res.error.code === "ENOENT";
  const killed = res.error !== undefined && "code" in res.error && res.error.code === "ETIMEDOUT";
  return {
    code: res.status ?? (killed || res.signal === "SIGTERM" ? 124 : 1),
    stdout: res.stdout ?? "",
    stderr: `${res.stderr ?? ""}${killed ? `\ntimed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : ""}`.trim(),
    missing,
  };
}

/** runCli + JSON.parse on stdout; throws a compact Error on any failure. */
export function runCliJson(bin: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): unknown {
  const res = runCli(bin, args, opts);
  if (res.missing) throw new Error(`${bin} not found`);
  if (res.code !== 0) throw new Error(`${bin} ${args.join(" ")} exited ${res.code}${res.stderr ? `: ${res.stderr.split("\n").slice(0, 3).join("\n")}` : ""}`);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`${bin} ${args.join(" ")} returned unparseable output`);
  }
}
