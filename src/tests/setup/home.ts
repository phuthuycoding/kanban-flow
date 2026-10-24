import { mkdtempSync, rmSync } from "node:fs";
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

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kfw-home-"));
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = prevUserProfile;
  rmSync(home, { recursive: true, force: true });
});
