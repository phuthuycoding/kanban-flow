import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HEAD = "REPO=<owner/repo>; SHA=<full sha>; WATCH=<seconds>;";

const doc = readFileSync(join(ROOT, "skills", "kanban-review", "references", "ci-watch.md"), "utf8");
const start = doc.indexOf(HEAD);
const documented = doc.slice(start, doc.indexOf("\n```", start));
// Real time is shrunk so the 60s settle window and 20s polls run in a couple of seconds.
const loop = documented
  .replace(HEAD, "REPO=o/r; SHA=abc123; WATCH=30;")
  .replaceAll("sleep 20", "sleep 1")
  .replace("settle=$((SECONDS+60))", "settle=$((SECONDS+2))");

/** A conclusion of `in_progress` lists the run as still running. The workflow id defaults to one per workflow name. */
type Run = [id: number, conclusion: string, workflow: string, workflowId?: number];

/** Runs the documented loop against a stub `gh` whose n-th call lists `calls[n]` (the last entry repeats). */
async function watch(calls: Run[][], script = loop): Promise<{ status: number | null; calls: number; stdout: string }> {
  const dir = await mkdtemp(join(tmpdir(), "kf-ci-watch-settle-"));
  const ids = new Map<string, number>();
  const row = ([id, c, w, wid]: Run): string => {
    if (!ids.has(w)) ids.set(w, 100 + ids.size);
    const [status, conclusion] = c === "in_progress" ? ["in_progress", "-"] : ["completed", c];
    return `${id}\t${status}\t${conclusion}\t${wid ?? ids.get(w)}\t${w}\thttps://example.test/${id}\n`;
  };
  try {
    for (const [i, runs] of calls.entries()) {
      await writeFile(join(dir, `runs-${i}.tsv`), runs.map(row).join(""));
    }
    const last = calls.length - 1;
    await writeFile(join(dir, "gh"), [
      "#!/bin/sh",
      `n=$(cat '${join(dir, "count")}' 2>/dev/null || echo 0)`,
      `echo $((n+1)) > '${join(dir, "count")}'`,
      `[ "$n" -gt ${last} ] && n=${last}`,
      `cat '${dir}'/runs-$n.tsv`,
      "",
    ].join("\n"), { mode: 0o755 });
    const res = spawnSync("bash", ["-c", script], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8", timeout: 20_000 });
    const count = Number(readFileSync(join(dir, "count"), "utf8").trim());
    return { status: res.status, calls: count, stdout: res.stdout };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("the CI watcher's settle window", () => {
  it("shrinks the documented loop", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(loop).not.toContain("sleep 20");
    expect(loop).toContain("settle=$((SECONDS+2))");
  });

  it("waits out the settle window before reporting a cancelled run", async () => {
    const res = await watch([[[1, "success", "CI"], [2, "cancelled", "Lint"]]]);
    expect(res.status).toBe(5);
    expect(res.calls).toBeGreaterThan(1);
  });

  it("counts a cancelled workflow green when a later run of it on the sha succeeded during the window", async () => {
    const res = await watch([
      [[1, "cancelled", "CI"]],
      [[1, "cancelled", "CI"], [2, "success", "CI"]],
    ]);
    expect(res.status).toBe(0);
  });

  it("counts a cancelled workflow green when a later run of it already succeeded", async () => {
    expect((await watch([[[1, "cancelled", "CI"], [2, "success", "CI"]]])).status).toBe(0);
  });

  it("keeps a cancelled run open when only another workflow or an earlier run succeeded", async () => {
    expect((await watch([[[1, "cancelled", "CI"], [2, "success", "Lint"]]])).status).toBe(5);
    expect((await watch([[[1, "success", "CI"], [2, "cancelled", "CI"]]])).status).toBe(5);
  });

  it("still calls a failed run red when a later run of the same workflow succeeded", async () => {
    expect((await watch([[[1, "failure", "CI"], [2, "success", "CI"]]])).status).toBe(1);
  });

  it("keeps a cancelled run open when only another workflow file with the same name succeeded", async () => {
    expect((await watch([[[1, "cancelled", "CI", 7], [2, "success", "CI", 8]]])).status).toBe(5);
  });

  it("starts the settle window again when a run goes back to running between two completed sets", async () => {
    const res = await watch([
      [[1, "success", "CI"], [2, "cancelled", "Lint"]],
      [[1, "success", "CI"], [2, "in_progress", "Lint"]],
      [[1, "success", "CI"], [2, "success", "Lint"]],
    ]);
    expect(res.status).toBe(0);
    // The third call sees the final set for the first time, so it only opens a new window.
    expect(res.calls).toBeGreaterThan(3);
  });

  it("never decides on an unsettled run set at the deadline, and says why it stopped", async () => {
    const short = loop.replace("WATCH=30;", "WATCH=1;").replace("settle=$((SECONDS+2))", "settle=$((SECONDS+10))");
    const finished = await watch([[[1, "success", "CI"]]], short);
    expect(finished.status).toBe(4);
    expect(finished.stdout).toContain("every run finished but the run set had not held still for 60s");
    expect(finished.stdout).not.toContain("CI still running");
    expect((await watch([[[1, "success", "CI"], [2, "cancelled", "Lint"]]], short)).status).toBe(4);
    const pending = await watch([[[1, "in_progress", "CI"]]], short);
    expect(pending.status).toBe(4);
    expect(pending.stdout).toContain("CI still running");
  });
});
