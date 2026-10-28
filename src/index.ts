#!/usr/bin/env node
import { parseArgsCli, allCommands, commandHelp, helpTopic, renderHelp, unknownInvocation, type ParsedArgs } from "./cli/args.js";
import { cmdInit } from "./cli/commands/init.js";
import { cmdNew } from "./cli/commands/new.js";
import { cmdList, cmdShow, cmdView, cmdStatus, cmdValidate } from "./cli/commands/inspect.js";
import { cmdInstruct, cmdTemplates } from "./cli/commands/artifacts.js";
import { cmdRules } from "./cli/commands/rules.js";
import { cmdAutoconfig } from "./cli/commands/autoconfig.js";
import { cmdDoctor } from "./cli/commands/doctor.js";
import { cmdRun, cmdRuns } from "./cli/commands/run.js";
import { cmdTasks } from "./cli/commands/tasks.js";
import { cmdDrive } from "./cli/commands/drive.js";
import { cmdHarness } from "./cli/commands/harness.js";
import { cmdContexts } from "./cli/commands/contexts.js";
import { cmdIssues } from "./cli/commands/issues.js";
import type { CmdResult } from "./cli/result.js";
import { cmdStage } from "./cli/commands/stage.js";
import { cmdArchive } from "./cli/commands/archive.js";
import { cmdSync } from "./cli/commands/sync.js";
import { cmdCancel } from "./cli/commands/cancel.js";
import { cmdApprove } from "./cli/commands/approve.js";
import { cmdShip } from "./cli/commands/ship.js";
import { cmdWorktree, cmdProxyServe } from "./cli/commands/worktree.js";
import { cmdInstall, cmdUninstall, scopeFromArgs } from "./integrations/install.js";
import { cmdDashboard } from "./dashboard/dashboard.js";
import { parseAgentIds } from "./integrations/agents.js";
import { nounKindGate } from "./cli/noun-gate.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG_ROOT } from "./shared/paths.js";

const PKG_VERSION: string = (JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";

function portFrom(parsed: ParsedArgs): number {
  if (parsed.options.port === undefined) return 8787;
  const raw = String(parsed.options.port);
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port '${raw}': expected an integer from 1 to 65535.`);
  }
  return n;
}

async function help(parts: string[]): Promise<CmdResult> {
  const topic = parts.join(" ");
  if (topic) return renderHelp(topic);
  const canonical = "  kf feature <verb>  — start | list | show | move | approve | ship | finish | drop | run\n  kf bug <verb>      — same lifecycle for bugs (\"bug start\" implies --type bug)";
  const cmds = allCommands().map((c) => `  ${c.padEnd(12)} ${commandHelp(c).split("\n")[0]}`).join("\n");
  return {
    code: 0,
    stdout: `kanban-flow CLI v${PKG_VERSION}\n\nUsage: kf <command> [args]\n\nCanonical (git-flow style):\n${canonical}\n\nFlat commands (permanent aliases):\n${cmds}\n\nRun "kf help <command>" or "kf help <noun> <verb>" for details.`,
  };
}

async function main(argv: string[]): Promise<CmdResult> {
  const cwd = process.cwd();

  if (argv[0] === "--version" || argv[0] === "-V") {
    return { code: 0, stdout: PKG_VERSION };
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    return help([]);
  }
  const parsed = parseArgsCli(argv);
  if (parsed.options.help) return renderHelp(helpTopic(parsed));
  if (parsed.noun) {
    const gated = nounKindGate(parsed, cwd);
    if (gated) return gated;
  }
  switch (parsed.command) {
    case "help":
      return help(parsed.positionals);
    case "version":
      return { code: 0, stdout: PKG_VERSION };
    case "init":
      return cmdInit(parsed, cwd);
    case "new":
      return cmdNew(parsed, cwd);
    case "list":
      return cmdList(parsed, cwd);
    case "show":
      return cmdShow(parsed, cwd);
    case "view":
      return cmdView(parsed, cwd);
    case "dashboard":
      return cmdDashboard(portFrom(parsed));
    case "status":
      return cmdStatus(parsed, cwd);
    case "instruct":
      return cmdInstruct(parsed, cwd);
    case "templates":
      return cmdTemplates(parsed, cwd);
    case "validate":
      return cmdValidate(parsed, cwd);
    case "stage":
      return cmdStage(parsed, cwd);
    case "archive":
      return cmdArchive(parsed, cwd);
    case "sync":
      return cmdSync(parsed, cwd);
    case "cancel":
      return cmdCancel(parsed, cwd);
    case "approve":
      return cmdApprove(parsed, cwd);
    case "rules":
      return cmdRules(parsed, cwd);
    case "autoconfig":
      return cmdAutoconfig(parsed, cwd);
    case "doctor":
      return cmdDoctor(parsed, cwd);
    case "run":
      return cmdRun(parsed, cwd);
    case "runs":
      return cmdRuns(parsed, cwd);
    case "tasks":
      return cmdTasks(parsed, cwd);
    case "drive":
      return cmdDrive(parsed, cwd);
    case "harness":
      return cmdHarness(parsed, cwd);
    case "contexts":
      return cmdContexts(parsed, cwd);
    case "issues":
      return cmdIssues(parsed, cwd);
    case "ship":
      return cmdShip(parsed, cwd);
    case "worktree":
      return cmdWorktree(parsed, cwd);
    case "proxy":
      return parsed.positionals[0] === "serve"
        ? cmdProxyServe(parsed)
        : { code: 1, stdout: commandHelp("proxy"), stderr: "unknown proxy subcommand" };
    case "install":
      return cmdInstall(parseAgentIds(parsed.options.agent), { cwd, scope: scopeFromArgs(parsed.options) });
    case "uninstall":
      return cmdUninstall(parseAgentIds(parsed.options.agent), {
        cwd,
        scope: scopeFromArgs(parsed.options),
        purge: Boolean(parsed.options.purge),
        force: Boolean(parsed.options.force),
      });
    default:
      return unknownInvocation(parsed);
  }
}

main(process.argv.slice(2)).then((r) => {
  if (r.stdout) process.stdout.write(`${r.stdout}\n`);
  if (r.stderr) process.stderr.write(`${r.stderr}\n`);
  process.exitCode = r.code;
}).catch((err: unknown) => {
  process.stderr.write(`kf: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
