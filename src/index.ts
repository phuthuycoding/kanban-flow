#!/usr/bin/env node
import { parseArgsCli, allCommands, commandHelp, type ParsedArgs } from "./cli/args.js";
import { cmdInit } from "./cli/commands/init.js";
import { cmdNew } from "./cli/commands/new.js";
import { cmdList, cmdShow, cmdView, cmdStatus, cmdValidate } from "./cli/commands/inspect.js";
import { cmdInstruct, cmdTemplates } from "./cli/commands/artifacts.js";
import { cmdRules } from "./cli/commands/rules.js";
import { cmdAutoconfig } from "./cli/commands/autoconfig.js";
import type { CmdResult } from "./cli/result.js";
import { cmdStage } from "./cli/commands/stage.js";
import { cmdArchive } from "./cli/commands/archive.js";
import { cmdApprove } from "./cli/commands/approve.js";
import { cmdInstall, cmdUninstall } from "./integrations/install.js";
import { cmdDashboard } from "./dashboard/dashboard.js";
import { parseAgentIds } from "./integrations/agents.js";
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
  const topic = parts[0];
  if (topic) return { code: 0, stdout: commandHelp(topic) };
  const cmds = allCommands().map((c) => `  ${c.padEnd(12)} ${commandHelp(c).split("\n")[0]}`).join("\n");
  return {
    code: 0,
    stdout: `kaban-flow CLI v${PKG_VERSION}\n\nUsage: kf <command> [args]\n\nCommands:\n${cmds}\n\nRun "kf help <command>" for details.`,
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
  if (parsed.options.help) return help([parsed.command]);
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
    case "approve":
      return cmdApprove(parsed, cwd);
    case "rules":
      return cmdRules(parsed, cwd);
    case "autoconfig":
      return cmdAutoconfig(parsed, cwd);
    case "install":
      return cmdInstall(parseAgentIds(parsed.options.agent), { cwd });
    case "uninstall":
      return cmdUninstall(parseAgentIds(parsed.options.agent), {
        cwd,
        purge: Boolean(parsed.options.purge),
        force: Boolean(parsed.options.force),
      });
    default:
      return { code: 1, stdout: commandHelp(parsed.command), stderr: `unknown command: ${parsed.command}` };
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
