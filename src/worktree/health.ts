import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { connect } from "node:net";

import { readRoutes } from "./routes.js";
import { splitListen, type MachineConfig } from "./config.js";

export interface InfraProbe {
  name: string;
  ok: boolean;
  detail: string;
}

export interface InfraReport {
  probes: InfraProbe[];
  ok: boolean;
}

const PROBE_TIMEOUT_MS = 1000;

/**
 * `dns.lookup` (not `dns.resolve`) is deliberate: lookup goes through getaddrinfo, which is
 * the only path that honours `/etc/resolver/<zone>` on macOS — the file setup writes.
 */
async function probeDns(zone: string, expectedHost: string): Promise<InfraProbe> {
  const name = `kf-probe.${zone}`;
  try {
    const { address } = await lookup(name);
    return {
      name: "dns",
      ok: address === expectedHost,
      detail: address === expectedHost
        ? `${name} resolves to ${expectedHost}`
        : `${name} resolves to ${address}, expected ${expectedHost}`,
    };
  } catch (err) {
    return { name: "dns", ok: false, detail: `${name} does not resolve (${err instanceof Error ? err.message : String(err)})` };
  }
}

function probeTcp(listen: string): Promise<InfraProbe> {
  const { host, port } = splitListen(listen);
  return new Promise((resolveProbe) => {
    const socket = connect(port, host, () => {
      socket.destroy();
      resolveProbe({ name: "proxy", ok: true, detail: `kf proxy listening on ${listen}` });
    });
    socket.setTimeout(PROBE_TIMEOUT_MS, () => {
      socket.destroy();
      resolveProbe({ name: "proxy", ok: false, detail: `no listener on ${listen} (timeout)` });
    });
    socket.on("error", (err) => {
      resolveProbe({ name: "proxy", ok: false, detail: `no listener on ${listen} (${err.message})` });
    });
  });
}

function probeRoutesFile(routesFile: string): InfraProbe {
  if (!existsSync(routesFile)) {
    return { name: "routes", ok: true, detail: `${routesFile} absent — created on first worktree` };
  }
  try {
    readRoutes(routesFile);
    return { name: "routes", ok: true, detail: `${routesFile} readable` };
  } catch (err) {
    return { name: "routes", ok: false, detail: `${routesFile}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Does this machine's domain infra exist? Warning-level signal — never a gate. */
export async function probeDomainInfra(machine: MachineConfig, routesFile: string): Promise<InfraReport> {
  const { host } = splitListen(machine.proxyListen);
  const probes = [
    await probeDns(machine.domainZone, host),
    await probeTcp(machine.proxyListen),
    probeRoutesFile(routesFile),
  ];
  return { probes, ok: probes.every((p) => p.ok) };
}
