import { parseArgs } from "node:util";

import { buildCommandTree, resolveCommandPath, verbForDispatch, type CommandNode } from "./tree.js";
import type { CmdResult } from "./result.js";
import type { WorkItemKind } from "../workflow/schema.js";

export interface ParsedArgs {
  command: string;
  positionals: string[];
  options: Record<string, unknown>;
  /** Set when invoked through a canonical noun path (kf feature|bug <verb>); the dispatcher gates on it. */
  noun?: WorkItemKind;
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
    help: "Usage: kf issues [--state open|closed|all] [--limit <n>] [--json] | kf issues view <n> | kf issues create <feature> [--title <t>] [--label <l> ...] | kf issues link <feature> <n|url> [--pr] | kf issues sync <feature> | kf issues done <feature>  — GitHub issues on the project's repository (.kf/config.json), via gh. link accepts an issue number/URL or a pull request URL/--pr; done is deprecated and forwards to kf archive",
    allowPositionals: true,
    options: {
      state: { type: "string" },
      limit: { type: "string" },
      title: { type: "string" },
      label: { type: "string", multiple: true },
      json: { type: "boolean" },
      pr: { type: "boolean" },
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
    help: "Usage: kf approve <feature> [--backlog] [--by <name>]  — approve Phase 2 execution contract (Human gate) and move the item to implementation; --backlog parks it in backlog instead",
    allowPositionals: true,
    options: {
      backlog: { type: "boolean" },
      by: { type: "string" },
    },
  },
  sync: {
    help: "Usage: kf sync  — close sweep: needs repository in .kf/config.json (exits 1 without it); closes into done every review item whose recorded PR has merged (uses gh) or whose PASS report says landing: none with nothing to land, and finalizes undelivered done items; run by hand or from cron",
    options: {},
  },
  archive: {
    help: "Usage: kf archive <feature> [--skip-hooks]  — the manual close: moves a review PASS item into done (done hook, worktree and branch teardown, canonical docs, delivered flag) once its recorded PR merged, or with landing: none and nothing ahead of origin/<default>; kf status and kf sync run the same close on their own",
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
    help: "Usage: kf install [--agent <id> ...] [--scope global|project] [--global|--project]  — install the 9 skills (8 kanban phase skills and travel) for agent skill dirs (default agent: claude), plus the 6 kanban agents (code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer) into the agents dir of runtimes that have one (Claude Code: .claude/agents). Scope defaults to skills.scope in .kf/config.json, then global: global links skills into ~/.<agent>/skills so one set serves every project (copies instead when linking fails); project copies into {root}/.<agent>/skills. Global also removes the project's copies unless it declared skills.scope: \"project\". Agents: claude, codex, gemini, kiro, cursor, opencode, devin",
    options: {
      agent: { type: "string", multiple: true },
      scope: { type: "string" },
      global: { type: "boolean" },
      project: { type: "boolean" },
    },
  },
  uninstall: {
    help: "Usage: kf uninstall [--agent <id> ...] [--scope global|project] [--global|--project] [--purge] [--force]  — remove the 9 skills (8 kanban phase skills and travel) and the 6 kanban agents (code-reviewer, scout, spec-reviewer, developer, test-writer, automation-writer) at the given scope (default agent: claude; default scope: skills.scope in .kf/config.json, then global). --purge also deletes .works/, .kf/ and kanban doc dirs (asks first; --force skips the prompt)",
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
  tasks: {
    help: "Usage: kf tasks <feature> [--json]  — list the planned tasks of a work item with wave, state, dependencies and files (read-only)",
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
    },
  },
  verify: {
    help: "Usage: kf verify <feature> --task TASK-### --base <sha> | kf verify <feature> --stage  — check a task's commits (<sha>..HEAD) against its plan Files and run harness.verify.task, or run harness.verify.stage, in the item worktree (else the project root). Exit 0 pass, 1 a verify command failed, 2 a file outside the task's Files, 3 bad input (runs nothing)",
    allowPositionals: true,
    options: {
      task: { type: "string" },
      base: { type: "string" },
      stage: { type: "boolean" },
    },
  },
  worktree: {
    help: "Usage: kf worktree <create|remove|list|setup> [feature] [--force] [--json] [--print]  — manage per-item git worktrees and their .test domains (opt-in: set \"worktree.enabled\": true in .kf/config.json to auto-provision on stage → implementation); 'setup' is the one-time machine onboarding (dnsmasq + proxy daemon, needs sudo)",
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
  ship: {
    help: "Usage: kf ship <feature>  — deprecated: exits 1 and changes nothing. Review opens the PR; merge on GitHub; kf status --change <feature> closes the item",
    allowPositionals: true,
    options: {
      draft: { type: "boolean" },
      "skip-release": { type: "boolean" },
      "skip-changelog": { type: "boolean" },
      json: { type: "boolean" },
    },
  },
  contexts: {
    help: "Usage: kf contexts [--json]  — list the declared contexts and the ones work items actually use; prints a survey brief when none are declared",
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

const COMMAND_TREE = buildCommandTree(COMMANDS);

export function commandTree(): Record<string, CommandNode> {
  return COMMAND_TREE;
}

export function parseArgsCli(argv: string[]): ParsedArgs {
  const res = resolveCommandPath(COMMAND_TREE, argv);
  const spec = res?.node.spec;
  const node = res?.node;
  if (!res || !spec || !node?.dispatch) {
    return { command: argv[0] ?? "help", positionals: argv.slice(1), options: {} };
  }
  const argvArgs = res.rest;
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
    args: argvArgs,
    options: opts,
    allowPositionals: spec.allowPositionals ?? false,
    strict: true,
  });
  for (const [k, v] of Object.entries(node.inject ?? {})) {
    (values as Record<string, unknown>)[k] ??= v;
  }
  return {
    command: node.dispatch,
    positionals,
    options: values as Record<string, unknown>,
    noun: node.noun,
  };
}

export function commandHelp(command: string): string {
  const res = resolveCommandPath(COMMAND_TREE, command.split(" "));
  return res?.node?.help ?? `Unknown command: ${command}. Use "kf help".`;
}

/** Help topic for a parsed invocation. A noun path uses the canonical verb, not the flat dispatch id. */
export function helpTopic(parsed: ParsedArgs): string {
  if (parsed.noun) {
    const verb = verbForDispatch(parsed.command);
    if (verb) return `${parsed.noun} ${verb}`;
  }
  return parsed.command;
}

/**
 * Help for a path. A full match exits 0. An unknown command exits 1. A leftover
 * token under a noun group exits 1 with that group's help and names the token.
 */
export function renderHelp(topic: string): CmdResult {
  const words = topic.split(/\s+/).filter((word) => word.length > 0);
  const res = resolveCommandPath(COMMAND_TREE, words);
  if (!res) {
    return {
      code: 1,
      stdout: `Unknown command: ${topic}. Use "kf help".`,
      stderr: `unknown command: ${words[0] ?? topic}`,
    };
  }
  const stdout = res.node.help ?? commandHelp(res.path.join(" "));
  if (!res.node.dispatch && res.rest.length > 0) {
    return { code: 1, stdout, stderr: `unknown verb: ${res.rest[0]}` };
  }
  return { code: 0, stdout };
}

/**
 * Default-branch result when parse stopped on a group or an unknown command.
 * `--help` on a known noun prints that noun. A bare noun says `missing verb`.
 */
export function unknownInvocation(parsed: ParsedArgs): CmdResult {
  const listed = commandHelp(parsed.command);
  if (listed.startsWith("Unknown command:")) {
    return { code: 1, stdout: listed, stderr: `unknown command: ${parsed.command}` };
  }
  const words = parsed.positionals.filter((word) => word !== "--help" && word !== "-h");
  if (parsed.positionals.length > 0 && words.length === 0) {
    return { code: 0, stdout: listed };
  }
  if (words.length === 0) {
    return { code: 1, stdout: listed, stderr: "missing verb" };
  }
  return { code: 1, stdout: listed, stderr: `unknown verb: ${words[0]}` };
}

export function allCommands(): string[] {
  return Object.keys(COMMANDS);
}
