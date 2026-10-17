import { findFeature, writeFeatureMeta } from "../../workflow/features.js";
import { readProjectConfig } from "../../project/config.js";
import { findRoot, gh } from "./helpers.js";
import { shipPublish, shipMerge, shipRelease, shipChangelog, type StepResult } from "../../ship/steps.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/**
 * `kf ship <feature>` — resumable shipping pipeline for items in the `shipping` stage.
 * Steps: publish (push + PR + record meta.pr) → merge gate → release → changelog.
 * Each enabled step runs once and is stamped into `meta.ship`, so re-runs resume at
 * the first unfinished step. Disabled steps are recorded as "skipped" — manual territory.
 */
export async function cmdShip(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const name = args.positionals[0];
  if (!name) return { code: 1, stdout: "Usage: kf ship <feature> [--draft] [--skip-release] [--skip-changelog]", stderr: "missing feature" };
  const root = await findRoot(cwd);
  if (!root.ok) return { code: 1, stdout: root.err!, stderr: "no works" };
  const f = findFeature(root.root, name);
  if (!f) return { code: 1, stdout: `Unknown feature '${name}'. Run: kf list`, stderr: "unknown feature" };
  if (!f.meta) return { code: 1, stdout: "Feature metadata is missing.", stderr: "metadata missing" };

  if (f.stage !== "shipping") {
    return {
      code: 1,
      stdout: `'${name}' is in ${f.stage} — ship runs in the shipping stage.\n  PASS review → kf stage ${name} shipping first. Nothing to ship? kf archive ${name} works straight from review.`,
      stderr: "wrong stage",
    };
  }

  const project = readProjectConfig(root.root);
  const cfg = project.ship;
  if (!cfg?.enabled) {
    return {
      code: 1,
      stdout:
        `Ship automation is off for this project (ship.enabled not set in .kf/config.json).\n\nManual ship checklist for '${name}':\n` +
        `  1. push the branch:   git push -u origin ${f.meta.worktree?.branch ?? "<branch>"}\n` +
        `  2. open the PR:       gh pr create${project.repository ? ` -R ${project.repository}` : ""}\n` +
        `  3. record it:         kf issues link ${name} <pr-url> --pr\n` +
        `  4. merge / release / changelog — human steps\n` +
        `  5. deliver:           kf archive ${name}\n\n` +
        `Enable the pipeline with "ship": { "enabled": true, "merge": "manual", "release": true, "changelog": true }.`,
      stderr: "ship disabled",
    };
  }
  if (!project.repository) {
    return { code: 1, stdout: `No repository configured — set "repository": "owner/name" in .kf/config.json (kf ship needs gh).`, stderr: "no repository" };
  }

  const repo = project.repository;
  const wantRelease = cfg.release && !args.options["skip-release"];
  const wantChangelog = cfg.changelog && !args.options["skip-changelog"];
  const lines: string[] = [];
  let ship = { ...f.meta.ship };

  const fail = (r: StepResult): CmdResult => ({ code: 1, stdout: [...lines, `✗ ${r.line}`].join("\n"), stderr: "ship step failed" });

  // Step 1 — publish (skipped once meta.pr exists).
  const pub = shipPublish(root.root, f, repo, gh, { draft: Boolean(args.options.draft) });
  if (pub.stamp) { Object.assign(ship, { published: pub.stamp.published }); f.meta = { ...f.meta, pr: pub.stamp.pr as string | undefined ?? f.meta.pr, ship }; await writeFeatureMeta(f.dir, f.meta); }
  lines.push(`${pub.ok ? "✓" : "✗"} ${pub.line}`);
  if (!pub.ok) return fail({ ...pub, line: pub.line });

  // Step 2 — merge gate.
  const m = shipMerge(f, repo, cfg, gh);
  if (m.stamp) { Object.assign(ship, m.stamp); f.meta = { ...f.meta, ship }; await writeFeatureMeta(f.dir, f.meta); }
  lines.push(`${m.ok ? "✓" : "✗"} ${m.line}`);
  if (!m.ok) return fail(m);
  if (!m.proceed) return { code: 0, stdout: [...lines, "", `Not ready to archive — ${m.line.includes("waiting") ? "waiting on the merge." : "see above."}`].join("\n") };

  // Step 3 — release (per config/override).
  if (ship.release === undefined) {
    if (!wantRelease) {
      ship = { ...ship, release: "skipped" };
      f.meta = { ...f.meta, ship };
      await writeFeatureMeta(f.dir, f.meta);
      lines.push("- release: skipped (manual)");
    } else {
      const r = shipRelease(root.root, f, repo, gh);
      if (r.stamp) { Object.assign(ship, r.stamp); f.meta = { ...f.meta, ship }; await writeFeatureMeta(f.dir, f.meta); }
      lines.push(`${r.ok ? "✓" : "✗"} ${r.line}`);
      if (!r.ok) return fail(r);
    }
  } else {
    lines.push(`- release: already ${ship.release}${ship.releaseTag ? ` (${ship.releaseTag})` : ""}`);
  }

  // Step 4 — changelog (per config/override).
  if (ship.changelog === undefined) {
    if (!wantChangelog) {
      ship = { ...ship, changelog: "skipped" };
      f.meta = { ...f.meta, ship };
      await writeFeatureMeta(f.dir, f.meta);
      lines.push("- changelog: skipped (manual)");
    } else {
      const c = shipChangelog(root.root, f);
      Object.assign(ship, c.stamp ?? {});
      f.meta = { ...f.meta, ship };
      await writeFeatureMeta(f.dir, f.meta);
      lines.push(`✓ ${c.line}`);
    }
  } else {
    lines.push(`- changelog: already ${ship.changelog}`);
  }

  lines.push("", `✓ Ship complete for '${name}'. Deliver with: kf archive ${name}`);
  return { code: 0, stdout: lines.join("\n") };
}
