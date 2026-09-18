import { parseArgs } from "node:util";

export interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, unknown>;
}

export interface CmdSpec {
  options?: {
    [opt: string]: {
      type: "string" | "boolean";
      short?: string;
      default?: string | boolean;
      multiple?: boolean;
    };
  };
  allowPositionals?: boolean;
  help?: string;
}

type OptDef = {
  type: "string" | "boolean";
  short?: string;
  default?: string | boolean | string[] | boolean[];
  multiple?: boolean;
};

const COMMANDS: Record<string, CmdSpec> = {
  init: {
    help: "Usage: kf init [path] [--defaults] [--minimal] [--context <ctx>] [--agent <id> ...]  — onboarding: asks setup questions on a TTY (defaults when non-TTY or --defaults), seeds .kf config + installs skills; --minimal only creates .works/ + docs roots",
    allowPositionals: true,
    options: {
      context: { type: "string", short: "c" },
      interactive: { type: "boolean", short: "i" },
      defaults: { type: "boolean" },
      minimal: { type: "boolean" },
      agent: { type: "string", multiple: true },
    },
  },
  new: {
    help: "Usage: kf new <feature> [--context <ctx>] [--type feature|bug]  — create a work item in .works/brainstorm",
    allowPositionals: true,
    options: {
      context: { type: "string", short: "c" },
      goal: { type: "string", short: "g" },
      type: { type: "string", short: "t" },
    },
  },
  list: {
    help: "Usage: kf list [--json]",
    options: {
      json: { type: "boolean" },
    },
  },
  show: {
    help: "Usage: kf show <feature> [--json]",
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
    },
  },
  view: {
    help: "Usage: kf view [--json]  — workflow metrics by stage, kind, context and approval",
    options: {
      json: { type: "boolean" },
    },
  },
  dashboard: {
    help: "Usage: kf dashboard [--port <n>]  — start a local analytics dashboard with metrics and charts (default port 8787)",
    options: {
      port: { type: "string", short: "p" },
    },
  },
  status: {
    help: "Usage: kf status [--change <feature>] [--all] [--json]",
    options: {
      change: { type: "string" },
      all: { type: "boolean", short: "a" },
      json: { type: "boolean" },
    },
  },
  instruct: {
    help: "Usage: kf instruct <artifact|use-case> [--change <feature>] [--id UC-###]",
    allowPositionals: true,
    options: {
      change: { type: "string" },
      id: { type: "string" },
      json: { type: "boolean" },
    },
  },
  templates: {
    help: "Usage: kf templates [--json]",
    options: {
      json: { type: "boolean" },
    },
  },
  validate: {
    help: "Usage: kf validate [--change <feature>] [--all] [--strict] [--json]",
    options: {
      change: { type: "string" },
      all: { type: "boolean", short: "a" },
      strict: { type: "boolean" },
      json: { type: "boolean" },
    },
  },
  stage: {
    help: "Usage: kf stage <feature> <next-stage> [--skip-hooks]  — move feature to next stage",
    allowPositionals: true,
    options: {
      force: { type: "boolean", short: "f" },
      "skip-hooks": { type: "boolean" },
    },
  },
  approve: {
    help: "Usage: kf approve <feature> [--by <name>]  — approve Phase 2 execution contract (Human gate)",
    allowPositionals: true,
    options: {
      by: { type: "string" },
    },
  },
  archive: {
    help: "Usage: kf archive <feature> [--skip-hooks]  — close a work item in dones; features sync canonical docs, bugs retain related docs",
    allowPositionals: true,
    options: {
      force: { type: "boolean", short: "f" },
      "skip-specs": { type: "boolean" },
      "skip-hooks": { type: "boolean" },
    },
  },
  rules: {
    help: "Usage: kf rules [--stack <id> ...] [--list] [--force]  — copy stack best-practice review rules into .kf/review/rules (auto-detects stack; packs: node, go, rust, python, php, ruby, java)",
    options: {
      stack: { type: "string", multiple: true },
      list: { type: "boolean" },
      force: { type: "boolean", short: "f" },
    },
  },
  install: {
    help: "Usage: kf install [--agent <id> ...]  — copy the 8 kanban skills into each agent's skill dir (default: claude). Agents: claude, codex, gemini, kiro, cursor, opencode",
    options: {
      agent: { type: "string", multiple: true },
    },
  },
  uninstall: {
    help: "Usage: kf uninstall [--agent <id> ...]  — remove the 8 kanban skills from each agent's skill dir (default: claude)",
    options: {
      agent: { type: "string", multiple: true },
    },
  },
  help: {
    help: "Usage: kf help [command]",
    allowPositionals: true,
  },
  version: {},
};

export function parseArgsCli(argv: string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const spec = COMMANDS[command];
  if (!spec) return { command, positionals: argv.slice(1), options: {} };
  const opts: Record<string, OptDef> = {};
  for (const [k, v] of Object.entries(spec.options ?? {})) {
    const d: OptDef = { type: v.type };
    if (v.short !== undefined) d.short = v.short;
    if (v.default !== undefined) d.default = v.default;
    if (v.multiple !== undefined) d.multiple = v.multiple;
    opts[k] = d;
  }
  opts.help = { type: "boolean", short: "h" };
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: opts,
    allowPositionals: spec.allowPositionals ?? false,
    strict: true,
  });
  return { command, positionals, options: values as Record<string, unknown> };
}

export function commandHelp(command: string): string {
  const spec = COMMANDS[command];
  if (!spec) return `Unknown command: ${command}. Use "kf help".`;
  return spec.help ?? `kf ${command}`;
}

export function allCommands(): string[] {
  return Object.keys(COMMANDS);
}
