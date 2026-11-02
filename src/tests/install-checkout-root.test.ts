import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readlink, symlink } from "node:fs/promises";
import { existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PKG_AGENTS_DIR, installAgentsTo, linkOrCopySkillsTo } from "../integrations/install.js";
import { copyName } from "../integrations/managed.js";

// Ownership of a link is decided by what sits at the package root, never by the directory's name:
// the checkout dir here is deliberately called "my-checkout".
let dir: string;
let checkout: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-checkout-root-"));
  checkout = join(dir, "my-checkout");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function packageRoot(pluginJson: string | null): Promise<void> {
  await mkdir(join(checkout, "agents"), { recursive: true });
  await mkdir(join(checkout, "skills", "review"), { recursive: true });
  await writeFile(join(checkout, "agents", "scout.md"), "scout of a checkout");
  await writeFile(join(checkout, "skills", "review", "SKILL.md"), "review of a checkout");
  if (pluginJson !== null) {
    await mkdir(join(checkout, ".claude-plugin"), { recursive: true });
    await writeFile(join(checkout, ".claude-plugin", "plugin.json"), pluginJson);
  }
}

async function agentLink(): Promise<string> {
  const target = join(dir, "agents");
  await mkdir(target, { recursive: true });
  await symlink(join(checkout, "agents", "scout.md"), join(target, "scout.md"), "file");
  return target;
}

async function skillLink(): Promise<string> {
  const skills = join(dir, "skills-home");
  await mkdir(skills, { recursive: true });
  await symlink(join(checkout, "skills", "review"), join(skills, copyName("review")), "dir");
  return skills;
}

describe("an agent link into a checkout of this package", () => {
  it("is treated as ours and relinked when the package root holds the kf plugin manifest", async () => {
    await packageRoot('{"name":"kf"}');
    const target = await agentLink();
    const res = await installAgentsTo(target, "link");
    expect(res.code).toBe(0);
    expect(await readlink(join(target, "scout.md"))).toBe(join(PKG_AGENTS_DIR, "scout.md"));
    expect(res.stdout).not.toContain("scout.md");
  });

  it("is foreign and left untouched when the manifest names another plugin", async () => {
    await packageRoot('{"name":"other"}');
    const target = await agentLink();
    const res = await installAgentsTo(target, "link");
    expect(await readlink(join(target, "scout.md"))).toBe(join(checkout, "agents", "scout.md"));
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain("scout.md");
  });

  it("is foreign and left untouched when the package root has no manifest", async () => {
    await packageRoot(null);
    const target = await agentLink();
    const res = await installAgentsTo(target, "link");
    expect(await readlink(join(target, "scout.md"))).toBe(join(checkout, "agents", "scout.md"));
    expect(res.stdout).toContain("left untouched");
  });
});

describe("a skill link into a checkout of this package", () => {
  it("is treated as ours and relinked when the package root holds the kf plugin manifest", async () => {
    await packageRoot('{"name":"kf"}');
    const skills = await skillLink();
    const res = await linkOrCopySkillsTo(skills);
    expect(res.code).toBe(0);
    const entry = join(skills, copyName("review"));
    // The owned link is replaced by a rendered copy, never kept as a link.
    expect(lstatSync(entry).isSymbolicLink()).toBe(false);
    expect(existsSync(join(entry, "SKILL.md"))).toBe(true);
    expect(res.stdout).not.toContain("left untouched");
  });

  it("is foreign and left untouched when the manifest names another plugin", async () => {
    await packageRoot('{"name":"other"}');
    const skills = await skillLink();
    const res = await linkOrCopySkillsTo(skills);
    expect(await readlink(join(skills, copyName("review")))).toBe(join(checkout, "skills", "review"));
    expect(res.stdout).toContain("left untouched");
    expect(res.stdout).toContain(copyName("review"));
  });

  it("is foreign and left untouched when the package root has no manifest", async () => {
    await packageRoot(null);
    const skills = await skillLink();
    const res = await linkOrCopySkillsTo(skills);
    expect(await readlink(join(skills, copyName("review")))).toBe(join(checkout, "skills", "review"));
    expect(res.stdout).toContain("left untouched");
  });
});
