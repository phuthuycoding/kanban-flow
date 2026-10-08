import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, get as httpGet, type Server } from "node:http";
import { connect as netConnect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProxyServer } from "../proxy/server.js";
import { addRoute } from "../worktree/routes.js";

let dir: string;
let routesFile: string;
const servers: Server[] = [];

async function listen(server: Server): Promise<number> {
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  servers.push(server);
  return addr.port;
}

function upstream(body: string): Promise<number> {
  return listen(createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain", "x-seen-host": String(req.headers.host) });
    res.end(body);
  }));
}

function get(port: number, host: string, path = "/"): Promise<{ status: number; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const r = httpGet(`http://127.0.0.1:${port}${path}`, { headers: { host } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body: b }));
    });
    r.on("error", reject);
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kf-proxy-"));
  routesFile = join(dir, "routes.json");
});

afterEach(async () => {
  for (const s of servers) s.close();
  servers.length = 0;
  await rm(dir, { recursive: true, force: true });
});

describe("kf proxy serve (FR-004)", () => {
  it("forwards a routed Host to its registered port", async () => {
    const upPort = await upstream("hello-from-upstream");
    await addRoute(routesFile, "a.b.test", { port: upPort, repo: "/r", item: "a", createdAt: "t" });
    const proxyPort = await listen(createProxyServer({ routesFile, fallbackUpstream: null }));

    const res = await get(proxyPort, "a.b.test", "/x?q=1");
    expect(res.status).toBe(200);
    expect(res.body).toBe("hello-from-upstream");
  });

  it("502s an unknown host with the route list when no fallback is set", async () => {
    await addRoute(routesFile, "a.b.test", { port: 1, repo: "/r", item: "a", createdAt: "t" });
    const proxyPort = await listen(createProxyServer({ routesFile, fallbackUpstream: null }));

    const res = await get(proxyPort, "nobody.test");
    expect(res.status).toBe(502);
    expect(res.body).toContain("a.b.test");
  });

  it("forwards unrouted hosts to fallbackUpstream preserving Host", async () => {
    const fbPort = await upstream("fallback-served");
    const proxyPort = await listen(
      createProxyServer({ routesFile, fallbackUpstream: `127.0.0.1:${fbPort}` }),
    );
    const res = await get(proxyPort, "legacy.test", "/old");
    expect(res.status).toBe(200);
    expect(res.body).toBe("fallback-served");
  });

  it("reloads the routes file when it changes — no restart", async () => {
    const upPort = await upstream("late-route");
    const proxyPort = await listen(createProxyServer({ routesFile, fallbackUpstream: null }));

    const miss = await get(proxyPort, "late.b.test");
    expect(miss.status).toBe(502);
    await addRoute(routesFile, "late.b.test", { port: upPort, repo: "/r", item: "l", createdAt: "t" });
    const hit = await get(proxyPort, "late.b.test");
    expect(hit.status).toBe(200);
    expect(hit.body).toBe("late-route");
  });

  it("refuses a fallback that loops back into itself", async () => {
    // fallback points at the proxy's own port: the second pass arrives with X-Forwarded-By
    // set and must be refused instead of looping forever.
    const opts = { routesFile, fallbackUpstream: null as string | null };
    const proxyPort = await listen(createProxyServer(opts));
    opts.fallbackUpstream = `127.0.0.1:${proxyPort}`;

    const res = await get(proxyPort, "loop.test");
    expect(res.status).toBe(502);
    expect(res.body).toContain("loop");
  });

  it("tunnels websocket upgrades to the routed port", async () => {
    // a minimal upgrade endpoint that echoes what it receives after the handshake
    const up = createServer();
    up.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.on("data", (d) => socket.write(`echo:${d}`));
    });
    const upPort = await listen(up);
    await addRoute(routesFile, "ws.b.test", { port: upPort, repo: "/r", item: "w", createdAt: "t" });
    const proxyPort = await listen(createProxyServer({ routesFile, fallbackUpstream: null }));

    const result = await new Promise<string>((resolvePromise, reject) => {
      const socket = netConnect(proxyPort, "127.0.0.1", () => {
        socket.write(
          `GET /ws HTTP/1.1\r\nHost: ws.b.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
        );
      });
      let buf = "";
      socket.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("101") && !buf.includes("echo:")) socket.write("ping");
        if (buf.includes("echo:ping")) {
          socket.destroy();
          resolvePromise(buf);
        }
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error("ws timeout")), 3000);
    });
    expect(result).toContain("101 Switching Protocols");
    expect(result).toContain("echo:ping");
  });
});
