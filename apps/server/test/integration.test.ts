import { test } from "node:test";
import assert from "node:assert/strict";
import { get as httpGet } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startWarehouse } from "../src/http.js";
import type { Snapshot } from "@ghost/shared";

function decode(result: Awaited<ReturnType<Client["callTool"]>>) {
  const item = (result.content as { type: string; text: string }[])[0]!;
  return JSON.parse(item.text);
}
const connect = async (url: string) => {
  const client = new Client({ name: "integration-agent", version: "1.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  return client;
};

test(
  "HTTP, SSE, two independent MCP clients and stdio see a single authority",
  { timeout: 20000 },
  async () => {
    const warehouse = await startWarehouse(0);
    const port = (warehouse.server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    const clients: Client[] = [];
    const streamAbort = new AbortController();
    try {
      const a = await connect(url);
      clients.push(a);
      const b = await connect(url);
      clients.push(b);
      assert.deepEqual(
        (await a.listTools()).tools.map((t) => t.name).sort(),
        [
          "act",
          "discover",
          "observe",
          "operations",
          "possess",
          "release",
          "sandbox_add_device",
          "sandbox_create",
          "sandbox_delete",
          "sandbox_inspect",
          "sandbox_list",
          "sandbox_update",
          "experiment_cancel",
          "experiment_compare",
          "experiment_inspect",
          "experiment_run",
          "experiment_templates",
        ].sort(),
      );
      const discovery = decode(
        await a.callTool({ name: "discover", arguments: {} }),
      );
      assert.equal(discovery.mode, "live");
      assert.equal(discovery.resources.length, 4);
      assert.equal(
        discovery.resources.find((r: { kind: string }) => r.kind === "drone")
          .limits.inspectRange,
        5,
      );
      assert.equal(discovery.survey.coveredCells, 0);
      assert.deepEqual(discovery.survey.knownCargo, []);
      const lease = decode(
        await a.callTool({
          name: "possess",
          arguments: { resourceId: "rover-01", owner: "Integration ghost" },
        }),
      );
      const busy = await b.callTool({
        name: "possess",
        arguments: { resourceId: "rover-01" },
      });
      assert.equal(busy.isError, true);
      assert.equal(decode(busy).code, "RESOURCE_BUSY");
      const observed = await a.callTool({
        name: "observe",
        arguments: { leaseId: lease.leaseId },
      });
      const structured = observed.structuredContent as {
        limits: { telemetryRange: number };
        survey: { totalCells: number; blockedCells: number };
      };
      assert.equal(structured.limits.telemetryRange, 4);
      assert.equal(
        structured.survey.totalCells + structured.survey.blockedCells,
        96,
      );
      const snapshot = (await (
        await fetch(url + "/api/snapshot")
      ).json()) as Snapshot;
      assert.equal(snapshot.bodies[1]!.lease!.owner, "Integration ghost");
      assert.ok(!JSON.stringify(snapshot).includes(lease.leaseId));
      const events = await fetch(url + "/api/events", {
        signal: streamAbort.signal,
      });
      assert.match(events.headers.get("content-type")!, /event-stream/);
      const reader = events.body!.getReader();
      const first = await reader.read();
      const sse = JSON.parse(
        new TextDecoder()
          .decode(first.value)
          .split("data: ")[1]!
          .split("\n\n")[0]!,
      );
      assert.equal(sse.instanceId, snapshot.instanceId);
      assert.ok(sse.revision >= snapshot.revision);
      reader.releaseLock();
      streamAbort.abort();
      const stdio = new Client({ name: "stdio-agent", version: "1.0" });
      clients.push(stdio);
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (pair): pair is [string, string] => pair[1] !== undefined,
        ),
      );
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["apps/server/dist/index.js"],
        env: { ...env, GHOST_PORT: String(port) },
        stderr: "pipe",
      });
      await stdio.connect(transport);
      assert.equal(
        decode(
          await stdio.callTool({
            name: "discover",
            arguments: { kind: "rover" },
          }),
        ).resources[0].available,
        false,
      );
      await a.callTool({
        name: "act",
        arguments: {
          leaseId: lease.leaseId,
          command: { type: "move", x: 1, z: 1.4 },
        },
      });
      const deadline = Date.now() + 7000;
      while (
        decode(
          await a.callTool({
            name: "observe",
            arguments: { leaseId: lease.leaseId },
          }),
        ).body.action.status === "running"
      ) {
        assert.ok(
          Date.now() < deadline,
          "motion completes on the actual server clock",
        );
        await new Promise((r) => setTimeout(r, 100));
      }
      const inspect = decode(
        await a.callTool({
          name: "act",
          arguments: {
            leaseId: lease.leaseId,
            command: { type: "inspect", objectId: "crate-07" },
          },
        }),
      );
      assert.match(inspect.inspection.condition, /Seal intact/);
      await a.callTool({
        name: "release",
        arguments: { leaseId: lease.leaseId },
      });
      const next = decode(
        await b.callTool({
          name: "possess",
          arguments: { resourceId: "rover-01" },
        }),
      );
      await b.callTool({
        name: "release",
        arguments: { leaseId: next.leaseId },
      });
      assert.equal((await fetch(url + "/ghost.svg")).status, 200);
      const page = await fetch(url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /GHOST/);
      assert.equal(
        (
          await fetch(url + "/api/tools/act", {
            method: "POST",
            body: "{broken",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await new Promise<{ status: number }>((resolve, reject) => {
            httpGet(
              url + "/api/health",
              { headers: { Host: "evil.example" } },
              (response) => {
                response.resume();
                resolve({ status: response.statusCode! });
              },
            ).on("error", reject);
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + "/api/reset", {
            method: "POST",
            headers: { Origin: "https://evil.example" },
          })
        ).status,
        403,
      );
    } finally {
      streamAbort.abort();
      await Promise.allSettled(clients.map((c) => c.close()));
      await warehouse.close();
    }
  },
);

test(
  "guided four-body mission completes and can be reset for another run",
  { timeout: 140000 },
  async () => {
    const warehouse = await startWarehouse(0);
    try {
      warehouse.sim.startDemo();
      const finished = new Promise<void>((resolve, reject) => {
        const unsubscribe = warehouse.sim.subscribe(() => {
          const state = warehouse.sim.snapshot();
          if (!state.demo.running) {
            unsubscribe();
            state.demo.error ? reject(new Error(state.demo.error)) : resolve();
          }
        });
      });
      await finished;
      const snapshot = warehouse.sim.snapshot();
      assert.ok(
        snapshot.mission.every((s) => s.complete),
        JSON.stringify(snapshot.mission),
      );
      assert.ok(snapshot.bodies.every((b) => !b.lease));
      assert.equal(
        snapshot.bodies.find((b) => b.kind === "drone")!.airborne,
        false,
      );
      assert.deepEqual(snapshot.objects[0]!.position, [6, 0.55, 2]);
      assert.ok(
        snapshot.objects
          .find((o) => o.id === "crate-12")!
          .inspectedBy.includes("rover-01"),
      );
      assert.ok(
        snapshot.objects
          .find((o) => o.id === "crate-18")!
          .inspectedBy.includes("drone-01"),
      );
      warehouse.sim.reset();
      assert.ok(warehouse.sim.snapshot().mission.every((s) => !s.complete));
      warehouse.sim.startDemo();
      warehouse.sim.stopDemo();
      assert.ok(warehouse.sim.snapshot().bodies.every((b) => !b.lease));
    } finally {
      await warehouse.close();
    }
  },
);
