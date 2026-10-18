import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
const exec = promisify(execFile);
const image = process.env.GHOST_TEST_IMAGE ?? "ghost:manufact";
const name = `ghost-smoke-${process.pid}`;
const token = randomBytes(32).toString("base64url");
const docker = (...args) =>
  exec("docker", ["--config", "work/docker", ...args], {
    env: { ...process.env, GHOST_ACCESS_TOKEN: token },
    timeout: 30_000,
  });
try {
  await docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::3000",
    "--env",
    "GHOST_ACCESS_TOKEN",
    "--env",
    "GHOST_ORIGIN=https://ghost.example",
    image,
  );
  const address = (await docker("port", name, "3000/tcp")).stdout.trim();
  const url = `http://${address}`;
  const headers = { Host: "ghost.example" };
  // Node fetch intentionally replaces Host; use HTTP to exercise the gateway host.
  const fetch = (target, options = {}) =>
    new Promise((resolve, reject) => {
      const { body, ...settings } = options;
      const req = httpRequest(target, settings, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode,
              headers: Object.fromEntries(
                Object.entries(res.headers)
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value.join(", ") : value,
                  ]),
              ),
            }),
          ),
        );
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(body);
    });
  const deadline = Date.now() + 15000;
  while (true) {
    try {
      if (
        (
          await fetch(url + "/api/health", {
            headers,
            signal: AbortSignal.timeout(1000),
          })
        ).ok
      )
        break;
    } catch {
      /* Wait for the owned container. */
    }
    if (Date.now() >= deadline)
      throw new Error(
        "Container did not become healthy: " +
          (await docker("logs", name)).stderr.slice(-1500),
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await fetch(url + "/api/snapshot", { headers })).status, 401);
  assert.match(
    await (await fetch(url, { headers })).text(),
    /Warehouse access key/,
  );
  let id = 0;
  const rpc = async (method, params) => {
    const response = await fetch(url + "/mcp", {
      method: "POST",
      headers: {
        ...headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    const reply = JSON.parse(
      response.headers.get("content-type").includes("event-stream")
        ? body
            .split("\n")
            .find((line) => line.startsWith("data: "))
            .slice(6)
        : body,
    );
    assert.ok(!reply.error, "MCP request succeeds");
    return reply.result;
  };
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "container-smoke", version: "1.0" },
  });
  assert.equal(initialized.serverInfo.name, "ghost");
  assert.equal((await rpc("tools/list", {})).tools.length, 5);
  const discover = await rpc("tools/call", { name: "discover", arguments: {} });
  assert.equal(discover.structuredContent.resources.length, 4);
  const possession = await rpc("tools/call", {
    name: "possess",
    arguments: { resourceId: "rover-01", owner: "Container smoke" },
  });
  const leaseId = possession.structuredContent.leaseId;
  assert.ok(leaseId);
  const snapshot = await (
    await fetch(url + "/api/snapshot", {
      headers: { ...headers, Authorization: `Bearer ${token}` },
    })
  ).json();
  assert.equal(
    snapshot.bodies.find((body) => body.id === "rover-01").lease.owner,
    "Container smoke",
  );
  assert.ok(!JSON.stringify(snapshot).includes(leaseId));
  await rpc("tools/call", { name: "release", arguments: { leaseId } });
  console.log(
    "Container passed: protected console/API, MCP initialization, five tools, shared rover possession and release.",
  );
} finally {
  await docker("rm", "--force", name).catch(() => {});
}
