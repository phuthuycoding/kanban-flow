import { execFileSync } from "node:child_process";

// Detached runs spawn `node dist/index.js`, so the suite needs a current build.
export default function setup(): void {
  execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
}
