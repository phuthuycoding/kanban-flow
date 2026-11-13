import { execFileSync } from "node:child_process";

/** git user.name, else $USER, else "human". */
export function detectReviewer(root = process.cwd()): string {
  try {
    const name = execFileSync("git", ["-C", root, "config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (name) return name;
  } catch (err) {
    if (!(err instanceof Error && (("status" in err && err.status === 1) || ("code" in err && err.code === "ENOENT")))) throw err;
  }
  return process.env.USER || process.env.USERNAME || "human";
}
