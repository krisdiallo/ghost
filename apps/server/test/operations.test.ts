import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation, SimError } from "../src/simulation.js";
import { Operations } from "../src/operations.js";
function setup() {
  let now = 0;
  const sim = new Simulation(
      () => now,
      () => 100000 + now,
    ),
    ops = new Operations(
      sim,
      () => now,
      () => 100000 + now,
    );
  const advance = (ms: number) => {
    for (let i = 0; i < ms; i += 50) {
      now += 50;
      sim.tick();
      ops.tick();
    }
  };
  return { sim, ops, advance };
}
test("ongoing jobs stop before a newly placed box; operator possession, clearance and return resume actual work", async () => {
  const { sim, ops, advance } = setup();
  ops.start();
  advance(4000);
  assert.equal(
    ops.state().jobs.find((j) => j.resourceId === "rover-01")!.status,
    "working",
  );
  const before = sim
    .snapshot()
    .bodies.find((b) => b.id === "rover-01")!.position;
  await ops.tool({ action: "place_box" });
  advance(6000);
  const incident = ops.state().incidents.find((i) => !i.resolvedAt)!;
  assert.ok(incident);
  assert.equal(incident.code, "PATH_BLOCKED");
  const stopped = sim.snapshot().bodies.find((b) => b.id === "rover-01")!;
  assert.ok(stopped.position[2] < before[2]);
  assert.equal(stopped.action?.status, "cancelled");
  assert.equal(stopped.lease, null);
  const pose = [...stopped.position];
  advance(3000);
  assert.deepEqual(
    sim.snapshot().bodies.find((b) => b.id === stopped.id)!.position,
    pose,
  );
  const lease = sim.possess(stopped.id, 120, "ChatGPT operator").leaseId;
  const observed = sim.observe(lease);
  assert.equal(observed.body.lastBlocked?.obstacleId, incident.obstacleId);
  await ops.tool({
    action: "clear_box",
    incidentId: incident.id,
    leaseId: lease,
  });
  assert.equal(ops.state().obstructions.length, 0);
  // Operator physically advances the rover, then explicitly hands work back.
  sim.act(lease, { type: "move", x: -10, z: pose[2]! - 2 });
  advance(1500);
  await ops.tool({ action: "resume", incidentId: incident.id, leaseId: lease });
  advance(18000);
  assert.ok(ops.state().incidents[0]!.resolvedAt);
  assert.ok(
    ops.state().jobs.find((j) => j.resourceId === "rover-01")!.cycles >= 0,
  );
  assert.ok(
    sim
      .snapshot()
      .objects.find((o) => o.id === "crate-12")!
      .inspectedBy.includes("rover-01"),
  );
  assert.ok(!JSON.stringify(ops.state()).includes(lease));
  ops.close();
});
test("external possession yields only the internal autonomy lease, and an uncleared route cannot be resumed", async () => {
  const { sim, ops, advance } = setup();
  ops.start();
  advance(4000);
  const operator = sim.possess("drone-01", 120, "Operator").leaseId;
  advance(100);
  assert.equal(
    ops.state().jobs.find((j) => j.resourceId === "drone-01")!.status,
    "operator",
  );
  assert.throws(
    () => sim.possess("drone-01", 120, "Another operator"),
    (e: unknown) => e instanceof SimError && e.code === "RESOURCE_BUSY",
  );
  await ops.tool({ action: "place_box" });
  advance(5000);
  const i = ops.state().incidents.find((i) => i.resourceId === "rover-01")!;
  assert.ok(i);
  const rover = sim.possess("rover-01").leaseId;
  await assert.rejects(
    () => ops.tool({ action: "resume", incidentId: i.id, leaseId: rover }),
    (e: unknown) => e instanceof SimError && e.code === "PATH_BLOCKED",
  );
  await assert.rejects(
    () =>
      ops.tool({ action: "clear_box", incidentId: i.id, leaseId: operator }),
    (e: unknown) => e instanceof SimError && e.code === "WRONG_BODY",
  );
  ops.reset();
  assert.equal(ops.state().incidents.length, 0);
  assert.equal(ops.state().obstructions.length, 0);
  assert.equal(sim.observe(operator).body.id, "drone-01");
  sim.release(operator);
  sim.release(rover);
  ops.close();
});
test("a box is copied into an isolated warehouse definition and cannot be placed in a body", async () => {
  const { sim, ops } = setup();
  await assert.rejects(() => ops.tool({ action: "place_box", x: -6, z: 3 }));
  await ops.tool({ action: "place_box", x: -10, z: -6 });
  const def = sim.definition("Clone");
  assert.ok(def.obstacles.some((o) => o.id.startsWith("ops-box-")));
  const clone = new Simulation(undefined, undefined, def);
  assert.equal(clone.snapshot().operations, undefined);
  const t = clone.possess("rover-01").leaseId;
  clone.act(t, { type: "move", x: -10, z: 3 });
  assert.equal(ops.state().incidents.length, 0);
  ops.close();
});
test("routine work continues for multiple cycles and pause/resume does not repeat applied arm commands", () => {
  const { sim, ops, advance } = setup();
  ops.start();
  advance(4500);
  ops.pause();
  advance(5000);
  ops.start();
  advance(180000);
  assert.deepEqual(ops.state().incidents, []);
  assert.ok(
    ops.state().jobs.find((j) => j.resourceId === "rover-01")!.cycles >= 2,
  );
  assert.ok(
    ops.state().jobs.find((j) => j.resourceId === "drone-01")!.cycles >= 1,
  );
  assert.equal(
    ops.state().jobs.find((j) => j.resourceId === "arm-01")!.status,
    "complete",
  );
  assert.equal(
    sim.snapshot().objects.find((o) => o.id === "crate-07")!.heldBy,
    null,
  );
  ops.close();
});
