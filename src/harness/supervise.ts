import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { findFeature, writeFeatureMeta, type RunRecord } from "../workflow/features.js";
import type { Stage } from "../workflow/schema.js";
import { readProjectConfig } from "../project/config.js";
import { PKG_ROOT } from "../shared/paths.js";
import { executeChain, newChainId, type ChainResultSummary } from "./chain.js";
import { resolveChain, type Assignment } from "./prompt.js";

/** Stored so the detached supervisor can rebuild the chain without the parent process. */
export interface ChainPlan {
  id: string;
  root: string;
  feature: string;
  stage: Stage;
  roles: string[];
  fresh: boolean;
  timeoutMs: number;
}

function chainPlanPath(dir: string, id: string): string {
  return join(dir, "runs", `chain-${id}.json`);
}

/**
 * Detach a chain: the supervisor is another `kf` process, so it survives the
 * caller's exit and can update metadata when the workers finish, on any OS.
 */
export async function startDetached(root: string, featureName: string, chain: Assignment[], opts: { fresh: boolean; timeoutMs: number }): Promise<RunRecord> {
  const feature = findFeature(root, featureName);
  if (!feature?.meta) throw new Error(`Work item '${featureName}' has no metadata.`);
  const id = newChainId();
  const plan: ChainPlan = {
    id, root, feature: featureName, stage: chain[0].stage,
    roles: chain.map((a) => a.role), fresh: opts.fresh, timeoutMs: opts.timeoutMs,
  };
  mkdirSync(join(feature.dir, "runs"), { recursive: true });
  writeFileSync(chainPlanPath(feature.dir, id), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const entry = join(PKG_ROOT, "dist", "index.js");
  const child = spawn(process.execPath, [entry, "run", featureName, "--supervise", id], { cwd: root, detached: true, stdio: "ignore" });
  const supervisorPid = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => resolve(child.pid!));
  });
  child.unref();
  const record: RunRecord = {
    id, role: chain[0].role, runner: chain[0].runnerName, stage: chain[0].stage, mode: "start",
    at: new Date().toISOString(), log: join("runs", `${id}.log`), status: "running", supervisorPid,
    chain: { id, index: 1, total: chain.length },
  };
  await writeFeatureMeta(feature.dir, { ...feature.meta, runs: [...(feature.meta.runs ?? []), record] });
  return record;
}

/** Entry point of the detached process: rebuild the chain from its plan and run it. */
export async function superviseRun(root: string, featureName: string, chainId: string): Promise<ChainResultSummary> {
  const feature = findFeature(root, featureName);
  if (!feature) {
    const orphanDir = join(root, ".works", "harness");
    mkdirSync(orphanDir, { recursive: true });
    const orphan = join(orphanDir, `orphan-${chainId}.json`);
    writeFileSync(orphan, `${JSON.stringify({ chainId, feature: featureName, at: new Date().toISOString(), reason: "work item folder not found" }, null, 2)}\n`);
    throw new Error(`Work item '${featureName}' not found; wrote ${orphan}`);
  }
  const path = chainPlanPath(feature.dir, chainId);
  if (!existsSync(path)) throw new Error(`Chain plan not found: ${path}`);
  const plan = JSON.parse(readFileSync(path, "utf8")) as ChainPlan;
  const harness = readProjectConfig(root).harness;
  const chain: Assignment[] = [];
  for (const role of plan.roles) {
    const resolved = resolveChain(harness, feature, root, { stage: plan.stage, role });
    if (!resolved.ok) throw new Error(`Cannot resume chain ${chainId}: ${resolved.reason}`);
    chain.push(...resolved.chain);
  }
  return executeChain(root, featureName, chain, { fresh: plan.fresh, timeoutMs: plan.timeoutMs, firstRunId: chainId });
}
