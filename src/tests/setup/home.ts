import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/**
 * Every test gets a throwaway HOME. Global-scope skill installs write into
 * `~/.<agent>/skills`, and os.homedir() resolves $HOME at call time — without this
 * seam a `cmdInit`/`cmdInstall` in any test would link skills into the developer's
 * real home dir. USERPROFILE covers the Windows resolution path.
 */
let home: string;
let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevAllowLink: string | undefined;
let prevPath: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kfw-home-"));
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // A stub `claude` first on PATH, so no test reaches the real one and CI without claude stays green.
  // `plugin list --json` answers an empty list; every other plugin call succeeds silently.
  const stubBin = join(home, ".kfw-bin");
  mkdirSync(stubBin);
  writeFileSync(join(stubBin, "claude"), '#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then echo "[]"; fi\nexit 0\n');
  chmodSync(join(stubBin, "claude"), 0o755);
  prevPath = process.env.PATH;
  process.env.PATH = `${stubBin}:${prevPath ?? ""}`;
  prevAllowLink = process.env.KF_ALLOW_WORKTREE_LINK;
  // Suites run inside linked item worktrees, whose package root the global link would otherwise refuse.
  process.env.KF_ALLOW_WORKTREE_LINK = "1";
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
  if (prevPath === undefined) delete process.env.PATH;
  else process.env.PATH = prevPath;
  if (prevAllowLink === undefined) delete process.env.KF_ALLOW_WORKTREE_LINK;
  else process.env.KF_ALLOW_WORKTREE_LINK = prevAllowLink;
  rmSync(home, { recursive: true, force: true });
});
