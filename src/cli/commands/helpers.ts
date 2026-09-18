import { findWorksRoot } from "../../workflow/features.js";

export async function findRoot(cwd: string): Promise<{ root: string; ok: boolean; err?: string }> {
  const root = findWorksRoot(cwd);
  if (!root) {
    return { root: "", ok: false, err: "No .works found. Run: kf init" };
  }
  return { root, ok: true };
}
