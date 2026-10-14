import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/**
 * Every test gets a throwaway HOME. Global-scope skill installs write into
 * `~/.<agent>/skills`, and os.homedir() resolves $HOME at call time — without this
 * seam a `cmdInit`/`cmdInstall` in any test would link skills into the developer's
 * real home dir. USERPROFILE covers the Windows resolution path.
 *
 * KF_ADE_SYNC=off keeps ADE sync (orca/herdr CLIs) out of tests by default —
 * a machine where those apps are installed would otherwise get real repo-add /
 * workspace-open calls. ade-sync.test.ts re-enables it with fake binaries.
 */
let home: string;
let prevHome: string | undefined;
let prevUserProfile: string | undefined;
let prevAdeSync: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kfw-home-"));
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevAdeSync = process.env.KF_ADE_SYNC;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.KF_ADE_SYNC = "off";
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
  if (prevAdeSync === undefined) delete process.env.KF_ADE_SYNC;
  else process.env.KF_ADE_SYNC = prevAdeSync;
  rmSync(home, { recursive: true, force: true });
});
