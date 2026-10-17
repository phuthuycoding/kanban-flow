import type { CmdSpec } from "./args.js";
import type { WorkItemKind } from "../workflow/schema.js";

/**
 * Declarative command tree — the git-flow-style surface. A node is either a leaf
 * (spec + dispatch) or a group (children). Resolution is longest-match over argv;
 * flat legacy commands stay registered as depth-1 leaves, so nothing old breaks.
 *
 * Canonical noun commands (`kf feature <verb>`, `kf bug <verb>`) dispatch to the
 * same handlers as their flat aliases — `dispatch` is the command id the switch
 * sees, `inject` forces option values (bug start ⇒ --type bug), and `noun` marks
 * the kind gate the dispatcher checks before handing off.
 */

export interface CommandNode {
  /** Leaf only: option spec the leaf's args are parsed with (borrowed from the flat command). */
  spec?: CmdSpec;
  /** Leaf only: command id the dispatcher's switch routes on. */
  dispatch?: string;
  /** Leaf only: option values forced after parsing (e.g. bug start ⇒ type=bug). */
  inject?: Record<string, unknown>;
  /** Leaf only: work-item kind this verb applies to; mismatched items are refused. */
  noun?: WorkItemKind;
  help?: string;
  children?: Record<string, CommandNode>;
}

export interface ResolvedPath {
  node: CommandNode;
  /** Words consumed as the command path, e.g. ["feature", "start"]. */
  path: string[];
  /** Remaining argv parsed against the leaf spec. */
  rest: string[];
}

/** git-flow verbs → the flat command they dispatch to. */
const VERB_DISPATCH: Record<string, { dispatch: string; verbHelp: string }> = {
  start: { dispatch: "new", verbHelp: "create a work item in .works/brainstorm" },
  list: { dispatch: "list", verbHelp: "list work items" },
  show: { dispatch: "show", verbHelp: "show a work item" },
  move: { dispatch: "stage", verbHelp: "move a work item between stages" },
  approve: { dispatch: "approve", verbHelp: "approve the planning contract" },
  ship: { dispatch: "ship", verbHelp: "run the resumable shipping pipeline" },
  finish: { dispatch: "archive", verbHelp: "deliver: archive to dones" },
  drop: { dispatch: "cancel", verbHelp: "cancel a work item" },
  run: { dispatch: "run", verbHelp: "run the roles assigned to the current stage" },
};

function verbHelp(noun: WorkItemKind, verb: string, spec: CmdSpec): string {
  const usage = spec.help ?? "";
  // Rewrite the flat usage's command word to the canonical noun verb path.
  const rewritten = usage.replace(/^Usage: kf \S+/, `Usage: kf ${noun} ${verb}`);
  const base = rewritten !== usage ? rewritten : `Usage: kf ${noun} ${verb}`;
  return `${base}  — ${VERB_DISPATCH[verb].verbHelp}${noun === "bug" ? " (kind: bug)" : ""}`;
}

/** Build the tree: flat commands at depth 1, plus the feature/bug noun branches. */
export function buildCommandTree(commands: Record<string, CmdSpec>): Record<string, CommandNode> {
  const root: Record<string, CommandNode> = {};
  for (const [name, spec] of Object.entries(commands)) {
    root[name] = { spec, dispatch: name, help: spec.help };
  }
  for (const noun of ["feature", "bug"] as const) {
    const children: Record<string, CommandNode> = {};
    for (const [verb, { dispatch }] of Object.entries(VERB_DISPATCH)) {
      const spec = commands[dispatch];
      if (!spec) continue; // dispatch target not built yet (e.g. ship before it landed)
      children[verb] = {
        spec,
        dispatch,
        noun,
        inject: verb === "start" ? { type: noun } : undefined,
        help: verbHelp(noun, verb, spec),
      };
    }
    root[noun] = {
      help: `Usage: kf ${noun} <verb> [args]  — ${noun} lifecycle: ${Object.keys(children).join(" | ")}`,
      children,
    };
  }
  return root;
}

/**
 * Longest-match resolution over argv. Returns the node at the deepest matched
 * point plus the remaining args — even when the path stops mid-branch (a group
 * node with no spec): the caller renders that node's help as the error context.
 */
export function resolveCommandPath(
  tree: Record<string, CommandNode>, argv: string[],
): ResolvedPath | null {
  if (argv.length === 0) return null;
  let node = tree[argv[0]];
  if (!node) return null;
  const path = [argv[0]];
  let i = 1;
  while (node.children && i < argv.length && node.children[argv[i]]) {
    node = node.children[argv[i]];
    path.push(argv[i]);
    i += 1;
  }
  return { node, path, rest: argv.slice(i) };
}
