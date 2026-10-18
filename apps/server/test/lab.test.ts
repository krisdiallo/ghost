import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation, SimError } from "../src/simulation.js";
import { ExperimentLab, experimentTemplates } from "../src/lab.js";
import type {
  SandboxDetail,
  RunDetail,
  WarehouseDefinition,
  ExperimentComparison,
} from "@ghost/shared";
function setup() {
  let time = 0;
  const live = new Simulation(
    () => time,
    () => 1_000_000 + time,
  );
  const lab = new ExperimentLab(
    live,
    () => time,
    () => 1_000_000 + time,
  );
  return {
    live,
    lab,
    advance: (ms: number) => {
      for (let x = 0; x < ms; x += 50) {
        time += Math.min(50, ms - x);
        lab.tick();
      }
    },
  };
}
const code = (expected: string) => (e: unknown) =>
  e instanceof SimError && e.code === expected;
test("sandbox clones, leases, reset and edits are isolated; revisions reject lost writes", () => {
  const { live, lab } = setup();
  const before = live.snapshot();
  const a = lab.tool("sandbox_create", { name: "A" }) as SandboxDetail;
  const b = lab.tool("sandbox_create", {
    name: "B",
    sourceSandboxId: a.sandbox.id,
  }) as SandboxDetail;
  const lease = lab.tool("possess", {
    sandboxId: a.sandbox.id,
    resourceId: "rover-01",
  }) as { leaseId: string };
  assert.equal(
    lab.worldFor("observe", { leaseId: lease.leaseId }).observe(lease.leaseId)
      .body.id,
    "rover-01",
  );
  assert.equal(live.snapshot().bodies[1]!.lease, null);
  assert.equal(lab.inspectDraft(b.sandbox.id).snapshot.bodies[1]!.lease, null);
  assert.throws(
    () =>
      lab.tool("sandbox_update", {
        sandboxId: a.sandbox.id,
        expectedRevision: 0,
        definition: a.definition,
      }),
    code("RESOURCE_BUSY"),
  );
  lab.tool("release", { leaseId: lease.leaseId });
  const d = structuredClone(a.definition);
  d.name = "Edited A";
  lab.tool("sandbox_update", {
    sandboxId: a.sandbox.id,
    expectedRevision: 0,
    definition: d,
  });
  assert.throws(
    () =>
      lab.tool("sandbox_update", {
        sandboxId: a.sandbox.id,
        expectedRevision: 0,
        definition: d,
      }),
    code("REVISION_CONFLICT"),
  );
  assert.deepEqual(live.snapshot().bodies, before.bodies);
  assert.equal(lab.inspectDraft(b.sandbox.id).definition.name, "B");
  assert.ok(!JSON.stringify(lab.list()).includes(lease.leaseId));
});
test("standard and compact drones run the same real workflow with preserved failures and comparable reports", () => {
  const { lab, live, advance } = setup();
  const template = experimentTemplates()[0]!;
  const ids: string[] = [];
  for (const variant of template.variants) {
    const d = lab.tool("sandbox_create", {
      name: variant.name,
    }) as SandboxDetail;
    const device = structuredClone(template.device);
    device.profile.scale = variant.scale;
    const updated = lab.tool("sandbox_add_device", {
      sandboxId: d.sandbox.id,
      expectedRevision: 0,
      device,
    }) as SandboxDetail;
    const run = lab.tool("experiment_run", {
      sandboxId: d.sandbox.id,
      workflow: template.workflow,
      playbackRate: 8,
    }) as RunDetail;
    ids.push(run.run.id);
    assert.equal(updated.definition.devices.length, 5);
  }
  advance(15000);
  const a = lab.inspect(ids[0]!, true),
    b = lab.inspect(ids[1]!, true);
  assert.equal(a.run.status, "failed");
  assert.equal(a.run.error?.code, "PATH_BLOCKED");
  assert.equal(a.run.metrics.blockedMoves, 1);
  assert.equal(b.run.status, "completed");
  assert.deepEqual(b.run.metrics.inspectedCargo, ["crate-12"]);
  assert.equal(b.run.metrics.safeEndState, true);
  assert.ok(a.run.metrics.allLeasesReleased && b.run.metrics.allLeasesReleased);
  const c = lab.compare(ids);
  assert.equal(c.comparable, true);
  assert.equal(c.completedRuns, 1);
  assert.equal(c.delta, null);
  assert.equal(live.snapshot().objects[1]!.inspectedBy.length, 0);
  assert.ok(!JSON.stringify({ a, b, c }).includes("leaseId"));
});
test("virtual results are playback-independent; frozen runs survive draft edits and JSON round trips", () => {
  const { lab, advance } = setup();
  const t = experimentTemplates()[0]!;
  const d = lab.tool("sandbox_create", { name: "Compact" }) as SandboxDetail;
  const def: WarehouseDefinition = structuredClone(d.definition);
  def.devices.push({
    ...t.device,
    profile: { ...t.device.profile, scale: 0.7 },
  });
  def.workflow = t.workflow;
  const edited = lab.tool("sandbox_update", {
    sandboxId: d.sandbox.id,
    expectedRevision: 0,
    definition: def,
  }) as SandboxDetail;
  const a = lab.tool("experiment_run", {
    sandboxId: d.sandbox.id,
    playbackRate: 1,
  }) as RunDetail;
  const b = lab.tool("experiment_run", {
    sandboxId: d.sandbox.id,
    playbackRate: 8,
  }) as RunDetail;
  def.devices.at(-1)!.profile.scale = 1.1;
  lab.tool("sandbox_update", {
    sandboxId: d.sandbox.id,
    expectedRevision: 1,
    definition: def,
  });
  advance(30000);
  const x = lab.inspect(a.run.id, false).run,
    y = lab.inspect(b.run.id, false).run;
  assert.equal(x.status, "completed");
  assert.deepEqual(x.metrics, y.metrics);
  assert.equal(x.definition.devices.at(-1)!.profile.scale, 0.7);
  const imported = lab.tool("sandbox_create", {
    name: "Imported",
    definition: JSON.parse(JSON.stringify(edited.definition)),
  }) as SandboxDetail;
  assert.deepEqual(imported.definition.obstacles, edited.definition.obstacles);
  assert.deepEqual(imported.definition.workflow, edited.definition.workflow);
});
test("cancellation, timeout, unsafe endings and mismatched comparisons are explicit and release capabilities", () => {
  const { lab, advance } = setup();
  const t = experimentTemplates()[0]!;
  const d = lab.tool("sandbox_create", {
    name: "Cancellation",
  }) as SandboxDetail;
  const simple = {
    ...t.workflow,
    actors: { vehicle: "drone-01" },
    steps: [{ actor: "vehicle", command: { type: "takeoff" } }],
  };
  const a = lab.tool("experiment_run", {
    sandboxId: d.sandbox.id,
    workflow: simple,
  }) as RunDetail;
  lab.tool("experiment_cancel", { runId: a.run.id });
  assert.equal(lab.inspect(a.run.id, false).run.status, "cancelled");
  assert.equal(
    lab.inspect(a.run.id, false).run.metrics.allLeasesReleased,
    true,
  );
  const b = lab.tool("experiment_run", {
    sandboxId: d.sandbox.id,
    workflow: simple,
  }) as RunDetail;
  advance(2000);
  assert.equal(
    lab.inspect(b.run.id, false).run.error?.code,
    "UNSAFE_END_STATE",
  );
  const timeout = {
    ...simple,
    maxSimulatedSeconds: 5,
    steps: [
      { actor: "vehicle", command: { type: "takeoff" } },
      { actor: "vehicle", command: { type: "move", x: 10, y: 10, z: -3 } },
    ],
  };
  const c = lab.tool("experiment_run", {
    sandboxId: d.sandbox.id,
    workflow: timeout,
    playbackRate: 8,
  }) as RunDetail;
  advance(2000);
  assert.equal(lab.inspect(c.run.id, false).run.error?.code, "RUN_TIMEOUT");
  const cmp = lab.tool("experiment_compare", {
    runIds: [a.run.id, c.run.id],
  }) as ExperimentComparison;
  assert.equal(cmp.comparable, false);
  assert.ok(cmp.reasons.length >= 2);
});
test("invalid structures, spawns, parameters and excessive arm payload are rejected", () => {
  const { lab } = setup();
  const d = lab.tool("sandbox_create", { name: "Validation" }) as SandboxDetail;
  const invalid = structuredClone(d.definition);
  invalid.obstacles[0]!.min[0] = 100;
  assert.throws(
    () =>
      lab.tool("sandbox_update", {
        sandboxId: d.sandbox.id,
        expectedRevision: 0,
        definition: invalid,
      }),
    code("INVALID_DEFINITION"),
  );
  const device = {
    id: "bad",
    kind: "drone",
    label: "Bad spawn",
    position: [-25, 0.4, -16],
  };
  assert.throws(
    () =>
      lab.tool("sandbox_add_device", {
        sandboxId: d.sandbox.id,
        expectedRevision: 0,
        device,
      }),
    code("INVALID_DEFINITION"),
  );
  const def = structuredClone(d.definition);
  def.cargo[0]!.massKg = 20;
  const updated = lab.tool("sandbox_update", {
    sandboxId: d.sandbox.id,
    expectedRevision: 0,
    definition: def,
  }) as SandboxDetail;
  const lease = lab.tool("possess", {
    sandboxId: updated.sandbox.id,
    resourceId: "arm-01",
  }) as { leaseId: string };
  lab.tool("act", {
    leaseId: lease.leaseId,
    command: { type: "preset", preset: "reach" },
  });
  assert.throws(
    () =>
      lab.tool("act", {
        leaseId: lease.leaseId,
        command: { type: "grasp", objectId: "crate-07" },
      }),
    code("PAYLOAD_EXCEEDED"),
  );
});

test(
  "MCP HTTP and stdio expose experiment tools and share sandbox lease authority",
  { timeout: 20000 },
  async () => {
    const { startWarehouse } = await import("../src/http.js");
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );
    const { StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/streamableHttp.js"
    );
    const { StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    );
    const w = await startWarehouse(0);
    const port = (w.server.address() as { port: number }).port;
    const http = new Client({ name: "lab-http-test", version: "1" });
    const stdio = new Client({ name: "lab-stdio-test", version: "1" });
    try {
      await http.connect(
        new StreamableHTTPClientTransport(
          new URL("http://127.0.0.1:" + port + "/mcp"),
        ),
      );
      await stdio.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ["apps/server/dist/index.js"],
          env: { ...process.env, GHOST_PORT: String(port) },
          stderr: "pipe",
        }),
      );
      const names = (await stdio.listTools()).tools.map((t) => t.name);
      assert.equal(names.length, 17);
      assert.ok(
        names.includes("sandbox_add_device") &&
          names.includes("experiment_compare"),
      );
      const call = async (
        client: InstanceType<typeof Client>,
        name: string,
        args: Record<string, unknown>,
      ) => {
        const r = await client.callTool({ name, arguments: args });
        return {
          error: !!r.isError,
          value: JSON.parse(
            (r.content as { type: string; text: string }[])[0]!.text,
          ),
        };
      };
      const d = (
        await call(http, "sandbox_create", { name: "MCP operator trial" })
      ).value as SandboxDetail;
      const a = await call(stdio, "possess", {
        sandboxId: d.sandbox.id,
        resourceId: "rover-01",
      });
      const b = await call(http, "possess", {
        sandboxId: d.sandbox.id,
        resourceId: "rover-01",
      });
      assert.equal(b.value.code, "RESOURCE_BUSY");
      const o = await call(http, "observe", { leaseId: a.value.leaseId });
      assert.equal(o.value.body.id, "rover-01");
      assert.equal(w.sim.snapshot().bodies[1]!.lease, null);
      assert.ok(!JSON.stringify(d).includes(a.value.leaseId));
      await call(stdio, "release", { leaseId: a.value.leaseId });
      const t = experimentTemplates()[0]!;
      await call(http, "sandbox_add_device", {
        sandboxId: d.sandbox.id,
        expectedRevision: 0,
        device: { ...t.device, profile: { ...t.device.profile, scale: 0.7 } },
      });
      const r = await call(stdio, "experiment_run", {
        sandboxId: d.sandbox.id,
        workflow: t.workflow,
        playbackRate: 8,
      });
      assert.equal(r.error, false);
      await call(http, "experiment_cancel", { runId: r.value.run.id });
      const cancelled = await call(stdio, "experiment_inspect", {
        runId: r.value.run.id,
        includeSnapshot: true,
      });
      assert.equal(cancelled.value.run.status, "cancelled");
      assert.equal(cancelled.value.run.metrics.allLeasesReleased, true);
    } finally {
      await Promise.allSettled([http.close(), stdio.close()]);
      await w.close();
    }
  },
);

test("stale previews cannot start trials; continuation retains failure; dwell budgets are enforced", () => {
  const { lab, advance } = setup();
  const draft = lab.tool("sandbox_create", {
    name: "Revision and dwell",
  }) as SandboxDetail;
  const workflow = {
    name: "Recovery sequence",
    actors: { vehicle: "drone-01" },
    stopOnError: false,
    requireSafeEnd: true,
    maxSimulatedSeconds: 30,
    steps: [
      { actor: "vehicle", command: { type: "takeoff" } },
      { actor: "vehicle", command: { type: "move", x: 5, y: 2.8, z: -16 } },
      { actor: "vehicle", command: { type: "land" }, dwellSeconds: 2 },
    ],
  };
  lab.tool("sandbox_update", {
    sandboxId: draft.sandbox.id,
    expectedRevision: 0,
    definition: draft.definition,
  });
  assert.throws(
    () =>
      lab.tool("experiment_run", {
        sandboxId: draft.sandbox.id,
        expectedRevision: 0,
        workflow,
      }),
    code("REVISION_CONFLICT"),
  );
  const started = lab.tool("experiment_run", {
    sandboxId: draft.sandbox.id,
    expectedRevision: 1,
    workflow,
    playbackRate: 8,
  }) as RunDetail;
  advance(3000);
  const result = lab.inspect(started.run.id, false).run;
  assert.equal(result.sourceRevision, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "PATH_BLOCKED");
  assert.equal(result.metrics.completedSteps, 2);
  assert.equal(result.metrics.failedSteps, 1);
  assert.ok(result.metrics.safeEndState && result.metrics.allLeasesReleased);
  assert.equal(result.metrics.simulatedSeconds, 4);
  const dwell = {
    ...workflow,
    maxSimulatedSeconds: 5,
    steps: [
      { actor: "vehicle", command: { type: "takeoff" }, dwellSeconds: 10 },
    ],
  };
  const timed = lab.tool("experiment_run", {
    sandboxId: draft.sandbox.id,
    workflow: dwell,
    playbackRate: 8,
  }) as RunDetail;
  advance(1000);
  assert.equal(lab.inspect(timed.run.id, false).run.error?.code, "RUN_TIMEOUT");
});

test("multi-actor workflows inspect and transfer cargo with independent capabilities", () => {
  const { lab, live, advance } = setup();
  const d = lab.tool("sandbox_create", {
    name: "Inspection and dispatch",
  }) as SandboxDetail;
  const result = lab.tool("experiment_run", {
    sandboxId: d.sandbox.id,
    workflow: {
      name: "Inspect then dispatch",
      actors: { eye: "camera-01", handler: "arm-01" },
      steps: [
        { actor: "eye", command: { type: "look", pan: 108, tilt: -25 } },
        { actor: "eye", command: { type: "inspect", objectId: "crate-07" } },
        { actor: "handler", command: { type: "preset", preset: "reach" } },
        { actor: "handler", command: { type: "grasp", objectId: "crate-07" } },
        { actor: "handler", command: { type: "preset", preset: "drop" } },
        { actor: "handler", command: { type: "place" } },
        { actor: "handler", command: { type: "preset", preset: "home" } },
      ],
      requireSafeEnd: true,
      stopOnError: true,
      maxSimulatedSeconds: 30,
    },
  }) as RunDetail;
  advance(1000);
  const report = lab.inspect(result.run.id, true);
  assert.equal(
    report.run.status,
    "completed",
    JSON.stringify(report.run.error),
  );
  assert.equal(report.run.metrics.completedSteps, 7);
  assert.deepEqual(report.run.metrics.inspectedCargo, ["crate-07"]);
  assert.ok(
    report.run.metrics.safeEndState && report.run.metrics.allLeasesReleased,
  );
  assert.deepEqual(
    report.snapshot!.objects.find((o) => o.id === "crate-07")!.position,
    [6, 0.55, 2],
  );
  assert.deepEqual(
    live.snapshot().objects.find((o) => o.id === "crate-07")!.position,
    [2, 0.55, 0],
  );
});
