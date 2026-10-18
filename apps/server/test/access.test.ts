import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startWarehouse } from "../src/http.js";
import { accessConfig, platformHosts, WarehouseAccess } from "../src/access.js";
import { request, type IncomingMessage, type ServerResponse } from "node:http";

test("platform hosts are scoped to this deployment's trusted runtime identity", () => {
  assert.deepEqual(platformHosts(3000, {}), []);
  assert.deepEqual(platformHosts(3000, { FLY_APP_NAME: "*.flycast" }), []);
  const hosts = platformHosts(3000, { FLY_APP_NAME: "ghost-runtime-1", FLY_PRIVATE_IP: "fdaa:0:1::2" });
  assert.ok(hosts.includes("ghost-runtime-1.flycast"));
  assert.ok(hosts.includes("ghost-runtime-1.internal:3000"));
  assert.ok(hosts.includes("[fdaa:0:1::2]:3000"));
  assert.ok(!hosts.includes("other-runtime.flycast"));
});

test("platform routing preserves authentication and browser origin protection", async () => {
  const previous = process.env.FLY_APP_NAME;
  process.env.FLY_APP_NAME = "ghost-runtime-test";
  let warehouse;
  try {
    warehouse = await startWarehouse(0, "127.0.0.1", undefined, {
      origin: "https://ghost.example",
      accessToken: "x".repeat(40),
    });
  } finally {
    if (previous === undefined) delete process.env.FLY_APP_NAME;
    else process.env.FLY_APP_NAME = previous;
  }
  const port = (warehouse.server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}`;
  const headers = { Host: "ghost-runtime-test.flycast" };
  const status = (path: string, requestHeaders: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = request(url + path, { headers: requestHeaders }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on("error", reject);
      req.end();
    });
  try {
    assert.equal(await status("/api/health", headers), 200);
    assert.equal(await status("/api/snapshot", headers), 401);
    assert.equal(await status("/api/snapshot", {
      ...headers, Authorization: `Bearer ${"x".repeat(40)}`,
    }), 200);
    assert.equal(await status("/api/health", { Host: "other-runtime.flycast" }), 403);
    assert.equal(await status("/api/snapshot", {
      ...headers, Authorization: `Bearer ${"x".repeat(40)}`, Origin: "https://evil.example",
    }), 403);
  } finally {
    await warehouse.close();
  }
});

test("remote configuration fails closed; browser cookies are secure on HTTPS", () => {
  assert.throws(() => accessConfig("0.0.0.0", {}), /Remote binding requires/);
  assert.throws(
    () => accessConfig("127.0.0.1", { origin: "https://ghost.example" }),
    /Remote binding requires/,
  );
  assert.throws(
    () =>
      accessConfig("0.0.0.0", {
        origin: "https://ghost.example",
        accessToken: "weak",
      }),
    /32–512/,
  );
  assert.throws(
    () =>
      accessConfig("0.0.0.0", {
        origin: "https://ghost.example/path",
        accessToken: "x".repeat(40),
      }),
    /exact HTTP/,
  );
  const token = randomBytes(32).toString("base64url");
  const config = accessConfig("0.0.0.0", {
    origin: "https://ghost.example",
    accessToken: token,
  });
  assert.equal(config.secure, true);
  let cookie = "";
  const res = {
    setHeader: (_name: string, value: string) => {
      cookie = value;
    },
  } as unknown as ServerResponse;
  const access = new WarehouseAccess(token, true);
  assert.equal(access.login(token, res), "ok");
  assert.match(
    cookie,
    /HttpOnly; SameSite=Lax; Path=\/; Max-Age=28800; Secure/,
  );
  assert.ok(!cookie.includes(token));
  const req = { headers: { cookie: cookie.split(";")[0] } } as IncomingMessage;
  assert.equal(access.authorized(req), true);
  access.logout(req, res);
  assert.equal(access.authorized(req), false);
  for (let i = 0; i < 29; i++)
    assert.equal(access.login("wrong", res), "invalid");
  assert.equal(access.login(token, res), "limited");
});

test(
  "private HTTP/SSE/MCP and stdio share a protected authority; login/logout cannot bypass it",
  { timeout: 20000 },
  async () => {
    const token = randomBytes(32).toString("base64url");
    const warehouse = await startWarehouse(0, "127.0.0.1", undefined, {
      accessToken: token,
    });
    const port = (warehouse.server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${token}` };
    const clients: Client[] = [];
    const streamAbort = new AbortController();
    try {
      const landing = await fetch(url);
      assert.match(await landing.text(), /Warehouse access key/);
      assert.equal(landing.headers.get("cache-control"), "no-store");
      assert.equal((await fetch(url + "/api/health")).status, 200);
      for (const [path, method] of [
        ["/api/snapshot", "GET"],
        ["/api/events", "GET"],
        ["/ghost.svg", "GET"],
        ["/api/access", "GET"],
        ["/mcp", "POST"],
        ["/api/tools/possess", "POST"],
        ["/api/demo/start", "POST"],
        ["/api/demo/stop", "POST"],
        ["/api/reset", "POST"],
      ] as const) {
        assert.equal((await fetch(url + path, { method })).status, 401, path);
        assert.equal(
          (
            await fetch(url + path, {
              method,
              headers: { Authorization: "Bearer wrong" },
            })
          ).status,
          401,
          path,
        );
      }
      assert.ok(warehouse.sim.snapshot().bodies.every((b) => !b.lease));
      const login = (value: string, origin: string | undefined = url) =>
        fetch(url + "/auth/login", {
          method: "POST",
          redirect: "manual",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(origin ? { Origin: origin } : {}),
          },
          body: new URLSearchParams({ token: value }),
        });
      assert.equal((await login(token, "https://evil.example")).status, 403);
      assert.equal((await login(token, "")).status, 403);
      assert.equal((await login("wrong")).status, 401);
      const signedIn = await login(token);
      assert.equal(signedIn.status, 303);
      const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
      assert.ok(!cookie.includes(token));
      assert.equal(
        (await fetch(url, { headers: { Cookie: cookie } })).status,
        200,
      );
      assert.equal(
        (
          await fetch(url + "/api/reset", {
            method: "POST",
            headers: { Cookie: cookie },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + "/api/reset", {
            method: "POST",
            headers: { Cookie: cookie, Origin: "https://evil.example" },
          })
        ).status,
        403,
      );
      const a = new Client({ name: "remote-test", version: "1.0" });
      clients.push(a);
      await a.connect(
        new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
          requestInit: { headers },
        }),
      );
      assert.equal((await a.listTools()).tools.length, 5);
      const possession = await a.callTool({
        name: "possess",
        arguments: { resourceId: "rover-01", owner: "Remote test" },
      });
      const leaseId = (possession.structuredContent as { leaseId: string })
        .leaseId;
      assert.ok(leaseId);
      const snapshot = await (
        await fetch(url + "/api/snapshot", { headers: { Cookie: cookie } })
      ).json();
      assert.equal(
        snapshot.bodies.find((b: { id: string }) => b.id === "rover-01").lease
          .owner,
        "Remote test",
      );
      assert.ok(!JSON.stringify(snapshot).includes(leaseId));
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (v): v is [string, string] => v[1] !== undefined,
        ),
      );
      const stdio = new Client({ name: "private-stdio-test", version: "1.0" });
      clients.push(stdio);
      await stdio.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ["apps/server/dist/index.js"],
          env: { ...env, GHOST_PORT: String(port), GHOST_ACCESS_TOKEN: token },
          stderr: "pipe",
        }),
      );
      const busy = await stdio.callTool({
        name: "possess",
        arguments: { resourceId: "rover-01" },
      });
      assert.equal(busy.isError, true);
      await a.callTool({ name: "release", arguments: { leaseId } });
      const events = await fetch(url + "/api/events", {
        headers: { Cookie: cookie },
        signal: streamAbort.signal,
      });
      assert.match(events.headers.get("content-type")!, /event-stream/);
      const reader = events.body!.getReader();
      assert.ok((await reader.read()).value?.length);
      const logout = await fetch(url + "/auth/logout", {
        method: "POST",
        redirect: "manual",
        headers: { Cookie: cookie, Origin: url },
      });
      assert.equal(logout.status, 303);
      warehouse.sim.reset(); // A publication closes streams whose session was revoked.
      assert.equal((await reader.read()).done, true);
      assert.equal(
        (await fetch(url + "/api/snapshot", { headers: { Cookie: cookie } }))
          .status,
        401,
      );
      assert.equal(
        (await fetch(url + "/api/snapshot", { headers })).status,
        200,
      );
    } finally {
      streamAbort.abort();
      await Promise.allSettled(clients.map((c) => c.close()));
      await warehouse.close();
    }
  },
);
