import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { splitListen, type MachineConfig } from "./config.js";

/**
 * Onboarding plan: the files and commands that put `*.<domainZone>` on the kf proxy.
 * Everything needing root runs through `sudo kf worktree setup` once; `--print` shows
 * the same plan without touching the machine.
 */

export interface SetupStep {
  id: string;
  /** What the step changes. */
  description: string;
  /** File to write (skipped when content already matches). */
  file?: { path: string; content: string };
  /** Shell command to run after file writes. */
  command?: string[];
  needsSudo: boolean;
}

export interface SetupPlan {
  steps: SetupStep[];
  /** Existing rule pointing the same zone at a different IP — setup refuses to overwrite it. */
  conflict: { file: string; line: string } | null;
}

const BREW_PREFIXES = ["/opt/homebrew", "/usr/local"];

function dnsmasqConfDir(): string | null {
  for (const prefix of BREW_PREFIXES) {
    if (existsSync(join(prefix, "etc", "dnsmasq.d"))) return join(prefix, "etc", "dnsmasq.d");
  }
  for (const prefix of BREW_PREFIXES) {
    if (existsSync(join(prefix, "etc", "dnsmasq.conf"))) return join(prefix, "etc", "dnsmasq.d");
  }
  return null;
}

/** All dirs dnsmasq actually reads: the brew conf-dir plus every `conf-dir=` include it names. */
function dnsmasqConfDirs(): string[] {
  const main = dnsmasqConfDir();
  const dirs = new Set<string>(main ? [main] : []);
  // `conf-dir=/path,*.conf` lines can appear in the main conf or any included file — Valet
  // hides its tld rule behind one, so scanning only the brew dir would miss it.
  const seen = new Set<string>();
  const scanFile = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch {
      return;
    }
    for (const line of content.split("\n")) {
      const m = /^\s*conf-dir=([^,\s]+)/.exec(line);
      if (m) dirs.add(m[1].replace(/\/$/, ""));
    }
  };
  for (const prefix of BREW_PREFIXES) {
    const mainConf = join(prefix, "etc", "dnsmasq.conf");
    if (existsSync(mainConf)) scanFile(mainConf);
  }
  // Mutating `dirs` while iterating is safe: Set iteration visits entries added mid-loop,
  // which is exactly how nested conf-dir includes get picked up.
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".conf"))) scanFile(join(dir, f));
    } catch {
      /* unreadable dir — treated as absent */
    }
  }
  return [...dirs];
}

/**
 * Find an existing `address=/<zone>/<ip>` rule pointing somewhere else (e.g. Valet).
 * `dirs` is the full list to scan — callers pass `dnsmasqConfDirs()` plus any extras;
 * tests supply their own directory list.
 */
export function findZoneConflict(zone: string, expectedHost: string, dirs: string[]): { file: string; line: string } | null {
  const pattern = new RegExp(`^\\s*address=/(\\.${escapeRegex(zone)}|${escapeRegex(zone)})/(\\S+)`);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".conf"))) {
      const path = join(dir, file);
      let content: string;
      try {
        content = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      for (const line of content.split("\n")) {
        const m = pattern.exec(line);
        if (m && m[2] !== expectedHost && !file.startsWith("kanban-flow")) {
          return { file: path, line: line.trim() };
        }
      }
    }
  }
  return null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function proxyPlist(kfEntrypoint: string, nodePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.kaban-flow.proxy</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${kfEntrypoint}</string>
    <string>proxy</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/kf-proxy.log</string>
  <key>StandardErrorPath</key><string>/tmp/kf-proxy.err.log</string>
</dict>
</plist>
`;
}

export function buildSetupPlan(machine: MachineConfig, opts: { kfEntrypoint: string; nodePath: string; extraDnsmasqDirs?: string[] }): SetupPlan {
  const { host, port } = splitListen(machine.proxyListen);
  const confDir = dnsmasqConfDir();
  const zone = machine.domainZone;
  const steps: SetupStep[] = [];

  if (confDir) {
    steps.push({
      id: "dnsmasq-conf",
      description: `Route *.${zone} to the kf proxy at ${host}`,
      file: { path: join(confDir, "kanban-flow.conf"), content: `# kanban-flow worktree domains\naddress=/.${zone}/${host}\n` },
      needsSudo: false,
    });
  } else {
    steps.push({
      id: "dnsmasq-missing",
      description: "dnsmasq not found — install and configure it manually",
      command: ["brew", "install", "dnsmasq"],
      needsSudo: false,
    });
  }

  const resolverFile = join("/etc/resolver", zone);
  if (!existsSync(resolverFile)) {
    steps.push({
      id: "resolver",
      description: `Send .${zone} lookups to local dnsmasq`,
      file: { path: resolverFile, content: `nameserver 127.0.0.1\n` },
      needsSudo: true,
    });
  }

  const plistPath = join("/Library/LaunchDaemons", "ai.kaban-flow.proxy.plist");
  steps.push({
    id: "launchd",
    description: `Run kf proxy serve on ${host}:${port} at boot`,
    file: { path: plistPath, content: proxyPlist(opts.kfEntrypoint, opts.nodePath) },
    command: ["launchctl", "bootstrap", "system", plistPath],
    needsSudo: true,
  });
  if (confDir) {
    steps.push({
      id: "dnsmasq-reload",
      description: "Restart dnsmasq to pick up the new rule",
      command: ["brew", "services", "restart", "dnsmasq"],
      needsSudo: true,
    });
  }

  const conflict = findZoneConflict(zone, host, [...dnsmasqConfDirs(), ...(opts.extraDnsmasqDirs ?? [])]);
  return { steps, conflict };
}

export function renderPlan(plan: SetupPlan): string {
  const lines = ["kf worktree setup plan:", ""];
  for (const s of plan.steps) {
    lines.push(`${s.needsSudo ? "[sudo]" : "[user]"} ${s.description}`);
    if (s.file) lines.push(`  write ${s.file.path}:\n${s.file.content.split("\n").map((l) => `    ${l}`).join("\n")}`);
    if (s.command) lines.push(`  run: ${s.command.join(" ")}`);
  }
  if (plan.conflict) {
    lines.push("", `CONFLICT: ${plan.conflict.file} already routes this zone:`);
    lines.push(`  ${plan.conflict.line}`);
    lines.push("Remove that rule first — kf refuses to take over another tool's DNS.");
  }
  return lines.join("\n");
}
