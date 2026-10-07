import { existsSync, readFileSync } from "node:fs";

import { writeFileAtomic } from "../shared/paths.js";

/**
 * Machine-global routing table for `kf proxy serve`. One file serves every repo,
 * so a port is only free when no route AND no item registry claims it.
 */
export interface RouteEntry {
  port: number;
  repo: string;
  item: string;
  createdAt: string;
}

export interface RoutesFile {
  version: 1;
  routes: Record<string, RouteEntry>;
}

export function readRoutes(file: string): RoutesFile {
  if (!existsSync(file)) return { version: 1, routes: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in proxy routes file: ${file}`, { cause: err });
    }
    throw err;
  }
  const doc = raw as Partial<RoutesFile> | null;
  if (!doc || typeof doc !== "object" || !doc.routes || typeof doc.routes !== "object") {
    throw new Error(`Invalid proxy routes file: ${file}`);
  }
  return { version: 1, routes: doc.routes };
}

/** Ports currently claimed by routes, for allocation collision checks. */
export function portsInUse(file: string): Set<number> {
  const inUse = new Set<number>();
  for (const entry of Object.values(readRoutes(file).routes)) inUse.add(entry.port);
  return inUse;
}

export async function addRoute(file: string, domain: string, entry: RouteEntry): Promise<void> {
  const doc = readRoutes(file);
  doc.routes[domain] = entry;
  await writeFileAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
}

export async function removeRoute(file: string, domain: string): Promise<boolean> {
  const doc = readRoutes(file);
  if (!(domain in doc.routes)) return false;
  delete doc.routes[domain];
  await writeFileAtomic(file, `${JSON.stringify(doc, null, 2)}\n`);
  return true;
}
