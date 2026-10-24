import { chmodSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Fake agent CLIs for harness tests: a bash script per name that records its
 * argv, then prints/exits/sleeps according to FAKE_<NAME>_* env vars. A resume
 * call (argv contains -r, -s or "resume") uses the FAKE_<NAME>_RESUME_* variants.
 *
 * When the prompt names a `TASK-###`, every variable also has a `_TASK_###` form
 * (FAKE_<NAME>_STDOUT_TASK_001 ...) that wins over the unsuffixed one. After the
 * sleep the fake edits its cwd (WRITE, RENAME, DELETE, then SCRIPT — see FakeScenario),
 * so a worker killed mid-sleep leaves the tree untouched. Every call is appended to
 * `<name>.calls.jsonl`.
 */
export interface FakeCall {
  argv: string[];
  /** Physical cwd of the call (symlinks resolved). */
  cwd: string;
  pid: number;
  /** Epoch ms. */
  start: number;
  end: number;
  /** First TASK-### found in the prompt's first line, else anywhere in it; null when none. */
  task: string | null;
}

export interface FakeScenario {
  stdout?: string; exit?: number; sleep?: number; resumeStdout?: string; resumeExit?: number; list?: string;
  /** Files written verbatim (no trailing newline added), keyed by path relative to the call's cwd. */
  write?: Record<string, string>;
  delete?: string[];
  /** old => new, relative to the call's cwd. */
  rename?: Record<string, string>;
  /** Shell snippet run with `bash -c` in the call's cwd, after the file edits. */
  script?: string;
}

export interface FakeCli {
  dir: string;
  argv(name: string): string[];
  /** PID of the last fake invocation (the script's own $$). */
  pid(name: string): number | null;
  prompt(name: string): string;
  /** Every call to `name`, oldest first (the file is append-only). */
  calls(name: string): FakeCall[];
  /** Set (or, for undefined fields, unset) the FAKE_* variables; `task` ("TASK-001") targets the per-task form. */
  scenario(name: string, s: FakeScenario, task?: string): void;
  install(): () => void;
  /** Clear every FAKE_* scenario variable so one test cannot leak into the next. */
  resetScenarios(): void;
  remove(): void;
}

/** Appends one JSON line per fake call; takes the file, start ms, pid, cwd, task, then the call's argv. */
const RECORD_CALL = String.raw`use strict;
use Time::HiRes qw(time);
my ($file, $start, $pid, $cwd, $task, @argv) = @ARGV;
my $end = int(time() * 1000);
sub js { my $s = shift; $s =~ s/(["\\])/\\$1/g; $s =~ s/\n/\\n/g; $s =~ s/\r/\\r/g; $s =~ s/\t/\\t/g; $s =~ s/([\x00-\x1f])/sprintf("\\u%04x", ord($1))/ge; return '"' . $s . '"'; }
my $line = '{"argv":[' . join(",", map { js($_) } @argv) . '],"cwd":' . js($cwd) . ',"pid":' . $pid . ',"start":' . $start . ',"end":' . $end . ',"task":' . ($task eq "" ? "null" : js($task)) . "}\n";
open(my $fh, ">>", $file) or die "open $file: $!";
flock($fh, 2);
print $fh $line;
close $fh;
`;

export function fakeCli(base: string, names: string[]): FakeCli {
  const dir = join(base, "fake-bin");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".record.pl"), RECORD_CALL, "utf8");
  for (const name of names) {
    const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const script = `#!/usr/bin/env bash
if [ "$1" = list ]; then m=$(cat "${dir}/${name}.marker" 2>/dev/null); printf '%s' "\${FAKE_${upper}_LIST:-[]}" | sed "s|{marker}|$m|g"; exit 0; fi
start=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000')
printf '%s\\0' "$@" > "${dir}/${name}.argv"
echo $$ > "${dir}/${name}.pid"
prompt=""
for a in "$@"; do case "$a" in kf-run:*) printf '%s' "\${a%%$'\\n'*}" > "${dir}/${name}.marker"; prompt="$a";; esac; done
[ -z "$prompt" ] && prompt="$*"
task=""
if [[ "\${prompt%%$'\\n'*}" =~ TASK-[0-9]+ ]]; then task="\${BASH_REMATCH[0]}"
elif [[ "$prompt" =~ TASK-[0-9]+ ]]; then task="\${BASH_REMATCH[0]}"; fi
tasku="\${task//-/_}"
resume=0
for a in "$@"; do case "$a" in -r|-s|resume) resume=1;; esac; done
# get SUFFIX: REPLY = FAKE_<NAME>_SUFFIX_<TASK> when set, else FAKE_<NAME>_SUFFIX; returns 1 when neither is set.
get() {
  local v
  if [ -n "$task" ]; then v="FAKE_${upper}_$1_$tasku"; if [ -n "\${!v+x}" ]; then REPLY="\${!v}"; return 0; fi; fi
  v="FAKE_${upper}_$1"; if [ -n "\${!v+x}" ]; then REPLY="\${!v}"; return 0; fi
  return 1
}
code=0
if [ "$resume" = 1 ] && get RESUME_STDOUT; then out="$REPLY"; get RESUME_EXIT && code="$REPLY"
elif get STDOUT; then out="$REPLY"; get EXIT && code="$REPLY"
else out=$'STATUS: DONE\\nSummary: fake ok'; get EXIT && code="$REPLY"; fi
get SLEEP && [ -n "$REPLY" ] && sleep "$REPLY"
if get WRITE; then while IFS= read -r line; do [ -z "$line" ] && continue; f="\${line%%=*}"; mkdir -p "$(dirname "$f")"; printf '%s' "\${line#*=}" > "$f"; done <<< "$REPLY"; fi
if get RENAME; then while IFS= read -r line; do [ -z "$line" ] && continue; to="\${line#*=>}"; mkdir -p "$(dirname "$to")"; mv "\${line%%=>*}" "$to"; done <<< "$REPLY"; fi
if get DELETE; then while IFS= read -r line; do [ -z "$line" ] && continue; rm -rf -- "$line"; done <<< "$REPLY"; fi
if get SCRIPT; then bash -c "$REPLY" >&2 || code=1; fi
perl "${dir}/.record.pl" "${dir}/${name}.calls.jsonl" "$start" "$$" "$(pwd -P)" "$task" "$@"
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
    calls: (name) => {
      const file = join(dir, `${name}.calls.jsonl`);
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as FakeCall);
    },
    scenario: (name, s, task) => {
      const tail = task ? `_${task.replace(/-/g, "_")}` : "";
      const set = (suffix: string, value: string | number | undefined) => {
        if (value === undefined) delete process.env[key(name, suffix + tail)];
        else process.env[key(name, suffix + tail)] = String(value);
      };
      const lines = (v: string[] | undefined) => v?.join("\n");
      const pairs = (v: Record<string, string> | undefined, sep: string) => v && Object.entries(v).map(([k, x]) => `${k}${sep}${x}`).join("\n");
      set("STDOUT", s.stdout); set("EXIT", s.exit); set("SLEEP", s.sleep);
      set("RESUME_STDOUT", s.resumeStdout); set("RESUME_EXIT", s.resumeExit);
      if (!task) set("LIST", s.list);
      set("WRITE", pairs(s.write, "=")); set("DELETE", lines(s.delete)); set("RENAME", pairs(s.rename, "=>")); set("SCRIPT", s.script);
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
