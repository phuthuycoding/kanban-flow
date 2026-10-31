import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { runDoctor } from "../project/doctor.js";
import { cmdDoctor } from "../cli/commands/doctor.js";
import { cmdInit } from "../cli/commands/init.js";
import type { ParsedArgs } from "../cli/args.js";

const args = (command: string, positionals: string[] = [], options: Record<string, unknown> = {}): ParsedArgs =>
  ({ command, positionals, options });

let root: string;

async function project(): Promise<void> {
  expect((await cmdInit(args("init", [], { minimal: true, context: "app" }), root)).code).toBe(0);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kf-doctor-upgrade-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("kf doctor on a project upgraded from a release with dones and shipping", () => {
  it("reports items left in .works/dones and .works/shipping with the migration hint", async () => {
    await project();
    await mkdir(join(root, ".works", "dones", "old_20260101_0000"), { recursive: true });
    await mkdir(join(root, ".works", "shipping", "wip_20260102_0000"), { recursive: true });

    const legacy = runDoctor(root).findings.filter((f) => f.area.startsWith(".works/") && f.area !== ".works/");
    expect(legacy.map((f) => f.area)).toEqual([".works/shipping/", ".works/dones/"]);
    expect(legacy.every((f) => f.level === "WARNING" && f.action === "run kf status to migrate them")).toBe(true);
    expect(legacy.find((f) => f.area === ".works/dones/")?.message).toContain("holds old_20260101_0000");
    expect(legacy.find((f) => f.area === ".works/shipping/")?.message).toContain("holds wip_20260102_0000");

    await rm(join(root, ".works", "dones"), { recursive: true });
    await rm(join(root, ".works", "shipping"), { recursive: true });
    expect(runDoctor(root).findings).toEqual([]);
  });

  it("--fix renames a customised dones.sh to done.sh instead of restoring the pack's done.sh over it", async () => {
    await project();
    const hooks = join(root, ".kf", "hooks");
    await mkdir(hooks, { recursive: true });
    // The project opted into the hook pack, so the restore would otherwise copy the pack's done.sh in.
    await writeFile(join(hooks, "lib-github.sh"), "# lib\n");
    const custom = "#!/usr/bin/env bash\n# our own AC gate\nexit 0\n";
    await writeFile(join(hooks, "dones.sh"), custom);

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("renamed .kf/hooks/dones.sh to done.sh (content kept)");
    expect(res.stdout).not.toContain("restored .kf/hooks/done.sh");
    expect(await readFile(join(hooks, "done.sh"), "utf8")).toBe(custom);
    expect(existsSync(join(hooks, "dones.sh"))).toBe(false);
    expect(runDoctor(root).findings.some((f) => f.message.includes("dones.sh"))).toBe(false);
  });

  it("--fix renames a project's own dones.sh without installing the hook pack it never used", async () => {
    await project();
    const hooks = join(root, ".kf", "hooks");
    await mkdir(hooks, { recursive: true });
    const custom = "#!/usr/bin/env bash\n# our own AC gate\nexit 0\n";
    await writeFile(join(hooks, "dones.sh"), custom);

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("renamed .kf/hooks/dones.sh to done.sh (content kept)");
    expect(res.stdout).not.toContain("restored .kf/hooks/");
    expect(await readdir(hooks)).toEqual(["done.sh"]);
    expect(runDoctor(root).findings.filter((f) => f.area === ".kf/hooks")).toEqual([]);
    expect((await cmdDoctor(args("doctor", [], { fix: true }), root)).stdout).not.toContain("restored .kf/hooks/");
    expect(await readdir(hooks)).toEqual(["done.sh"]);
  });

  it("--fix leaves dones.sh alone once a done.sh exists", async () => {
    await project();
    const hooks = join(root, ".kf", "hooks");
    await mkdir(hooks, { recursive: true });
    await writeFile(join(hooks, "dones.sh"), "#!/usr/bin/env bash\n# old\n");
    await writeFile(join(hooks, "done.sh"), "#!/usr/bin/env bash\n# new\n");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).not.toContain("renamed");
    expect(await readFile(join(hooks, "done.sh"), "utf8")).toBe("#!/usr/bin/env bash\n# new\n");
    expect(await readFile(join(hooks, "dones.sh"), "utf8")).toBe("#!/usr/bin/env bash\n# old\n");
  });

  it("reports a .gitignore without .kf/travel/ and --fix adds it once", async () => {
    execFileSync("git", ["init", "-q", root]);
    await project();
    await writeFile(join(root, ".gitignore"), "node_modules/\n.works/\n.worktrees/\n");

    const finding = runDoctor(root).findings.find((f) => f.area === ".gitignore");
    expect(finding?.level).toBe("WARNING");
    expect(finding?.message).toContain(".kf/travel/ is not ignored");
    expect(finding?.action).toBe("kf doctor --fix (adds .kf/travel/ to .gitignore)");

    const res = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(res.stdout).toContain("added .kf/travel/ to .gitignore");
    const after = await readFile(join(root, ".gitignore"), "utf8");
    expect(after.split("\n").filter((l) => l === ".kf/travel/")).toHaveLength(1);
    expect(after.startsWith("node_modules/\n.works/\n.worktrees/\n")).toBe(true);
    expect(runDoctor(root).findings.some((f) => f.area === ".gitignore")).toBe(false);

    const again = await cmdDoctor(args("doctor", [], { fix: true }), root);
    expect(again.stdout).not.toContain("added .kf/travel/");
  });

  it("only adds the travel entry, leaving other missing entries to the project", async () => {
    execFileSync("git", ["init", "-q", root]);
    await project();
    await writeFile(join(root, ".gitignore"), "node_modules/\n");
    await cmdDoctor(args("doctor", [], { fix: true }), root);
    const after = await readFile(join(root, ".gitignore"), "utf8");
    expect(after).toContain(".kf/travel/");
    expect(after).not.toContain(".works/");
    expect(after).not.toContain(".worktrees/");
  });
});
