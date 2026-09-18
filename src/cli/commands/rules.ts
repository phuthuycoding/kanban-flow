import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";

import { findWorksRoot } from "../../workflow/features.js";
import { detectStack, STACK_IDS } from "../../project/config.js";
import { PKG_STACK_RULES_DIR } from "../../shared/paths.js";
import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

/** Copy stack-specific review rules from the package into .kf/review/rules/. */
export async function cmdRules(args: ParsedArgs, cwd: string): Promise<CmdResult> {
  const root = findWorksRoot(cwd) ?? cwd;
  const detected = detectStack(root);
  const available = STACK_IDS.filter((id) =>
    existsSync(join(PKG_STACK_RULES_DIR, `${id}.md`)),
  );

  if (args.options.list) {
    return {
      code: 0,
      stdout: [
        `Detected stack: ${detected ?? "unknown"}`,
        `Available rule packs: ${available.join(", ") || "none"}`,
      ].join("\n"),
    };
  }

  const requested = args.options.stack;
  const stacks = Array.isArray(requested)
    ? requested.map(String)
    : typeof requested === "string"
      ? [requested]
      : detected
        ? [detected]
        : [];

  if (stacks.length === 0) {
    return {
      code: 1,
      stdout: `Cannot detect project stack. Pass --stack <id>. Available: ${available.join(", ")}`,
      stderr: "no stack detected",
    };
  }
  const invalid = stacks.filter((s) => !(available as string[]).includes(s));
  if (invalid.length > 0) {
    return {
      code: 1,
      stdout: `Unknown stack '${invalid.join(", ")}'. Available: ${available.join(", ")}`,
      stderr: "unknown stack",
    };
  }

  const force = Boolean(args.options.force);
  const rulesDir = join(root, ".kf", "review", "rules");
  const lines: string[] = [];
  for (const stack of stacks) {
    const src = join(PKG_STACK_RULES_DIR, `${stack}.md`);
    const dest = join(rulesDir, `${stack}.md`);
    if (existsSync(dest)) {
      if (readFileSync(dest, "utf8") === readFileSync(src, "utf8")) {
        lines.push(`· ${stack}: already installed`);
        continue;
      }
      if (!force) {
        lines.push(
          `⚠ ${stack}: exists with local changes — skipped (use --force to overwrite)`,
        );
        continue;
      }
      mkdirSync(rulesDir, { recursive: true });
      await copyFile(src, dest);
      lines.push(`✓ ${stack}: overwritten → ${dest}`);
      continue;
    }
    mkdirSync(rulesDir, { recursive: true });
    await copyFile(src, dest);
    lines.push(`✓ ${stack}: installed → ${dest}`);
  }
  lines.push("");
  lines.push("kanban-review loads these rules automatically (project → user → package).");
  return { code: 0, stdout: lines.join("\n") };
}
