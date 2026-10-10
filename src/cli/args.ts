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
    help: "Usage: kf init [path] [--defaults] [--minimal] [--context <ctx>] [--agent <id> ...]  — onboarding: asks setup questions on a TTY (defaults when non-TTY or --defaults), seeds .kf config + installs skills globally (linked under ~/.<agent>/skills; the setup question or skills.scope in .kf/config.json picks project instead); --minimal skips the questions, not the scaffolding (still writes .kf config, skills and AGENTS.md; only the template/hook/rule files are left out)",
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
  issues: {
    help: "Usage: kf issues [--state open|closed|all] [--limit <n>] [--json] | kf issues view <n> | kf issues create <feature> [--title <t>] [--label <l> ...] | kf issues link <feature> <n|url> | kf issues sync <feature>  — GitHub issues on the project's repository (.kf/config.json), via gh",
    allowPositionals: true,
    options: {
      state: { type: "string" },
      limit: { type: "string" },
      title: { type: "string" },
      label: { type: "string", multiple: true },
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
    help: "Usage: kf status [--change <feature>] [--all] [--json]  — artifact checklist, Next step, approval state and recorded bypasses",
    options: {
      change: { type: "string" },
      all: { type: "boolean", short: "a" },
      json: { type: "boolean" },
    },
  },
  instruct: {
    help: "Usage: kf instruct <artifact|use-case> [--change <feature>] [--id UC-###]  — print the template, current execution id and exact output path (--id also accepts UC-###-<slug>)",
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
    help: "Usage: kf validate [--change <feature>] [--all] [--strict] [--json]  — report gate, traceability, secret and bypass issues (exit 1 on failure)",
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
  autoconfig: {
    help: "Usage: kf autoconfig  — print a briefing for an agent to configure this project: context, setup checklist, effective review rules and the workflow guide",
    options: {},
  },
  doctor: {
    help: "Usage: kf doctor [--fix] [--json]  — diagnose the project: stage dirs, config, work item metadata, skill state at the configured scope (missing, stale, broken links); exits 1 when something is broken. --fix applies the repairs that need no human decision (missing stage dirs, a missing or stale config field, a missing repository link, missing or stale skills)",
    options: {
      fix: { type: "boolean" },
      json: { type: "boolean" },
    },
  },
  install: {
    help: "Usage: kf install [--agent <id> ...] [--scope global|project] [--global|--project]  — install the 8 kanban skills for agent skill dirs (default agent: claude). Scope defaults to skills.scope in .kf/config.json, then global: global links skills into ~/.<agent>/skills so one set serves every project (copies instead when linking fails); project copies into {root}/.<agent>/skills. Global also removes the project's copies unless it declared skills.scope: \"project\". Agents: claude, codex, gemini, kiro, cursor, opencode, devin",
    options: {
      agent: { type: "string", multiple: true },
      scope: { type: "string" },
      global: { type: "boolean" },
      project: { type: "boolean" },
    },
  },
  uninstall: {
    help: "Usage: kf uninstall [--agent <id> ...] [--scope global|project] [--global|--project] [--purge] [--force]  — remove the 8 kanban skills at the given scope (default agent: claude; default scope: skills.scope in .kf/config.json, then global). --purge also deletes .works/, .kf/ and kanban doc dirs (asks first; --force skips the prompt)",
    options: {
      agent: { type: "string", multiple: true },
      scope: { type: "string" },
      global: { type: "boolean" },
      project: { type: "boolean" },
      purge: { type: "boolean" },
      force: { type: "boolean" },
    },
  },
  cancel: {
    help: 'Usage: kf cancel <feature> --reason "<why>" [--by <name>] [--purge-docs] [--force] [--skip-hooks]  — stop a work item for good, recording who dropped it and why; reopen later with kf stage <feature> <its old stage>',
    allowPositionals: true,
    options: {
      reason: { type: "string" },
      by: { type: "string" },
      "purge-docs": { type: "boolean" },
      force: { type: "boolean", short: "f" },
      "skip-hooks": { type: "boolean" },
    },
  },
  run: {
    help: "Usage: kf run <feature> [--stage <s>] [--role <r>] [--fresh] [--detach] [--timeout <min>] [--dry-run]  — run the roles assigned to the work item's stage (harness.stages) as worker agents, in order, and record each run",
    allowPositionals: true,
    options: {
      stage: { type: "string" },
      role: { type: "string" },
      agent: { type: "string" },
      fresh: { type: "boolean" },
      detach: { type: "boolean" },
      timeout: { type: "string" },
      "dry-run": { type: "boolean" },
      supervise: { type: "string" },
    },
  },
  runs: {
    help: "Usage: kf runs [<feature>] [--json]  — list worker runs (role, runner, stage, status, STATUS line) for one or all open work items",
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
    },
  },
  worktree: {
    help: "Usage: kf worktree <create|remove|list|setup> [feature] [--force] [--json] [--print]  — manage per-item git worktrees and their .test domains; 'setup' is the one-time machine onboarding (dnsmasq + proxy daemon, needs sudo)",
    allowPositionals: true,
    options: {
      force: { type: "boolean", short: "f" },
      json: { type: "boolean" },
      print: { type: "boolean" },
    },
  },
  proxy: {
    help: "Usage: kf proxy serve [--listen <host:port>] [--routes <file>] [--fallback <host:port|off>]  — run the machine-wide *.test reverse proxy (foreground; launchd keeps it alive)",
    allowPositionals: true,
    options: {
      listen: { type: "string" },
      routes: { type: "string" },
      fallback: { type: "string" },
    },
  },
  contexts: {
    help: "Usage: kf contexts [--json]  — list the declared contexts and the ones work items actually use; prints a survey brief when none are declared",
    options: {
      json: { type: "boolean" },
    },
  },
  harness: {
    help: "Usage: kf harness [--json]  — show the multi-agent harness: stage to role chains, role to runner, and whether each runner CLI is on PATH",
    options: {
      json: { type: "boolean" },
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
