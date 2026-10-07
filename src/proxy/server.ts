import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { statSync } from "node:fs";

import { readRoutes, type RouteEntry } from "../worktree/routes.js";

const LOOP_GUARD = "kf-proxy";

export interface ProxyOptions {
  routesFile: string;
  /** Unrouted hosts forward here (`host:port`); null → 502 with the route list. */
  fallbackUpstream: string | null;
}

/**
 * Routes are owned by other processes (`kf worktree create/remove`), so the table is
 * re-read whenever the file's mtime changes — no restart, no stale routes after teardown.
 */
function routeFor(routesFile: string, host: string, cache: { mtimeMs: number; routes: Record<string, RouteEntry> }): RouteEntry | null {
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(routesFile).mtimeMs;
  } catch {
    cache.mtimeMs = 0;
    cache.routes = {};
    return null;
  }
  if (mtimeMs !== cache.mtimeMs) {
    cache.routes = readRoutes(routesFile).routes;
    cache.mtimeMs = mtimeMs;
  }
  return cache.routes[host] ?? null;
}

function hostOnly(hostHeader: string | undefined): string {
  return (hostHeader ?? "").split(":")[0].toLowerCase();
}

function badGateway(res: ServerResponse, routesFile: string, reason: string): void {
  let known: string[] = [];
  try {
    known = Object.keys(readRoutes(routesFile).routes);
  } catch {
    known = [];
  }
  res.writeHead(502, { "content-type": "text/plain" });
  res.end(`kf proxy: ${reason}\nknown routes: ${known.length > 0 ? known.join(", ") : "(none)"}\n`);
}

function forward(req: IncomingMessage, res: ServerResponse, target: { host: string; port: number }, setGuard: boolean, routesFile: string): void {
  const headers = { ...req.headers };
  if (setGuard) headers["x-forwarded-by"] = LOOP_GUARD;
  const upstream = httpRequest(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) badGateway(res, routesFile, `upstream ${target.host}:${target.port} unreachable`);
    else res.destroy();
  });
  req.pipe(upstream);
}

function tunnel(req: IncomingMessage, clientSocket: Socket, head: Buffer, target: { host: string; port: number }): void {
  const upstream = netConnect(target.port, target.host, () => {
    // Replay the original upgrade request; the upstream's own 101 goes back through the pipe.
    const lines: string[] = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
}

/** `kf proxy serve` — one machine-wide router: Host `<feature>.<baseDomain>` → `127.0.0.1:<port>`. */
export function createProxyServer(opts: ProxyOptions): Server {
  const cache = { mtimeMs: 0, routes: {} as Record<string, RouteEntry> };
  const server = createServer((req, res) => {
    const host = hostOnly(req.headers.host);
    const route = routeFor(opts.routesFile, host, cache);
    if (route) {
      forward(req, res, { host: "127.0.0.1", port: route.port }, false, opts.routesFile);
      return;
    }
    if (req.headers["x-forwarded-by"] === LOOP_GUARD) {
      badGateway(res, opts.routesFile, `refusing to forward '${host}' — it would loop back through this proxy`);
      return;
    }
    if (opts.fallbackUpstream) {
      const fb = opts.fallbackUpstream;
      const sep = fb.lastIndexOf(":");
      const port = Number(fb.slice(sep + 1));
      if (sep < 1 || !Number.isInteger(port)) {
        badGateway(res, opts.routesFile, `invalid fallbackUpstream '${fb}'`);
        return;
      }
      forward(req, res, { host: fb.slice(0, sep), port }, true, opts.routesFile);
      return;
    }
    badGateway(res, opts.routesFile, `no route for host '${host}'`);
  });

  server.on("upgrade", (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
    const host = hostOnly(req.headers.host);
    const route = routeFor(opts.routesFile, host, cache);
    if (route) {
      tunnel(req, clientSocket, head, { host: "127.0.0.1", port: route.port });
      return;
    }
    if (req.headers["x-forwarded-by"] !== LOOP_GUARD && opts.fallbackUpstream) {
      const fb = opts.fallbackUpstream;
      const sep = fb.lastIndexOf(":");
      const port = Number(fb.slice(sep + 1));
      if (sep > 0 && Number.isInteger(port)) {
        tunnel(req, clientSocket, head, { host: fb.slice(0, sep), port });
        return;
      }
    }
    clientSocket.destroy();
  });

  return server;
}
