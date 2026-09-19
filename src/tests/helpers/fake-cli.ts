import { chmodSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fake agent CLIs for harness tests: a bash script per name that records its
 * argv, then prints/exits/sleeps according to FAKE_<NAME>_* env vars. A resume
 * call (argv contains -r, -s or "resume") uses the FAKE_<NAME>_RESUME_* variants.
 */
export interface FakeCli {
  dir: string;
  argv(name: string): string[];
  /** PID of the last fake invocation (the script's own $$). */
  pid(name: string): number | null;
  prompt(name: string): string;
  scenario(name: string, s: { stdout?: string; exit?: number; sleep?: number; resumeStdout?: string; resumeExit?: number; list?: string }): void;
  install(): () => void;
  /** Clear every FAKE_* scenario variable so one test cannot leak into the next. */
  resetScenarios(): void;
  remove(): void;
}

export function fakeCli(base: string, names: string[]): FakeCli {
  const dir = join(base, "fake-bin");
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const script = `#!/usr/bin/env bash
if [ "$1" = list ]; then m=$(cat "${dir}/${name}.marker" 2>/dev/null); printf '%s' "\${FAKE_${upper}_LIST:-[]}" | sed "s|{marker}|$m|g"; exit 0; fi
printf '%s\\0' "$@" > "${dir}/${name}.argv"
echo $$ > "${dir}/${name}.pid"
for a in "$@"; do case "$a" in kf-run:*) printf '%s' "\${a%%$'\\n'*}" > "${dir}/${name}.marker";; esac; done
resume=0
for a in "$@"; do case "$a" in -r|-s|resume) resume=1;; esac; done
if [ "$resume" = 1 ] && [ -n "\${FAKE_${upper}_RESUME_STDOUT+x}" ]; then out="$FAKE_${upper}_RESUME_STDOUT"; code="\${FAKE_${upper}_RESUME_EXIT:-0}"
elif [ -n "\${FAKE_${upper}_STDOUT+x}" ]; then out="$FAKE_${upper}_STDOUT"; code="\${FAKE_${upper}_EXIT:-0}"
else out=$'STATUS: DONE\\nSummary: fake ok'; code="\${FAKE_${upper}_EXIT:-0}"; fi
[ -n "\${FAKE_${upper}_SLEEP:-}" ] && sleep "$FAKE_${upper}_SLEEP"
printf '%s\\n' "$out"
exit "$code"
`;
    writeFileSync(join(dir, name), script, "utf8");
    chmodSync(join(dir, name), 0o755);
  }
  const key = (name: string, suffix: string) => `FAKE_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${suffix}`;
  return {
    dir,
    argv: (name) => {
      const file = join(dir, `${name}.argv`);
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf8").split("\0").slice(0, -1);
    },
    pid: (name) => {
      const file = join(dir, `${name}.pid`);
      return existsSync(file) ? Number(readFileSync(file, "utf8").trim()) : null;
    },
    prompt: (name) => {
      const file = join(dir, `${name}.argv`);
      if (!existsSync(file)) return "";
      return readFileSync(file, "utf8").split("\0").find((a) => a.startsWith("kf-run:")) ?? "";
    },
    scenario: (name, s) => {
      const set = (suffix: string, value: string | number | undefined) => {
        if (value === undefined) delete process.env[key(name, suffix)];
        else process.env[key(name, suffix)] = String(value);
      };
      set("STDOUT", s.stdout); set("EXIT", s.exit); set("SLEEP", s.sleep);
      set("RESUME_STDOUT", s.resumeStdout); set("RESUME_EXIT", s.resumeExit); set("LIST", s.list);
    },
    resetScenarios: () => {
      for (const key of Object.keys(process.env)) if (key.startsWith("FAKE_")) delete process.env[key];
    },
    install: () => {
      const previous = process.env.PATH ?? "";
      // Hermetic: only the fakes plus the system dirs bash/sleep/printf live in, so real agent CLIs never resolve.
      process.env.PATH = `${dir}:/usr/bin:/bin`;
      return () => { process.env.PATH = previous; };
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
