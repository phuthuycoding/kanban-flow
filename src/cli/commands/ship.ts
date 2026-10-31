import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export const shipDeprecated = (feature = "<feature>") =>
  `kf ship is deprecated: review opens the PR; merge on GitHub; kf status --change ${feature} closes the item`;

/**
 * `kf ship <feature>` — kept only as a deprecated alias so old scripts and muscle memory get a
 * pointer instead of "unknown command". It reads and writes nothing: review opens the PR, the
 * merge happens on GitHub, and `kf status --change <feature>` closes the item.
 */
export async function cmdShip(args: ParsedArgs, _cwd: string): Promise<CmdResult> {
  return { code: 1, stdout: shipDeprecated(args.positionals[0]), stderr: "deprecated" };
}
