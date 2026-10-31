import type { ParsedArgs } from "../args.js";
import type { CmdResult } from "../result.js";

export const SHIP_DEPRECATED = "kf ship is deprecated: review opens the PR; merge on GitHub; kf status closes the item";

/**
 * `kf ship <feature>` — kept only as a deprecated alias so old scripts and muscle memory get a
 * pointer instead of "unknown command". It reads and writes nothing: review opens the PR, the
 * merge happens on GitHub, and `kf status` closes the item.
 */
export async function cmdShip(_args: ParsedArgs, _cwd: string): Promise<CmdResult> {
  return { code: 1, stdout: SHIP_DEPRECATED, stderr: "deprecated" };
}
