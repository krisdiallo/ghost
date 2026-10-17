import { test } from "node:test";
import assert from "node:assert/strict";
import { Simulation, SimError } from "../src/simulation.js";

function setup() {
  let now = 0;
  const sim = new Simulation(
    () => now,
    () => 1_000_000 + now,
  );
  return {
    sim,
    advance: (ms: number) => {
      now += ms;
      sim.tick();
    },
  };
}
const fails = (code: string) => (error: unknown) =>
  error instanceof SimError && error.code === code;

test("exclusive leases, defaults, privacy, release and invalid tokens", () => {
  const { sim } = setup();
  const lease = sim.possess("rover-01");
  assert.equal(lease.expiresAt, 1_060_000);
  assert.equal(sim.discover("rover").resources[0]!.available, false);
  assert.throws(() => sim.possess("rover-01"), fails("RESOURCE_BUSY"));
  assert.throws(() => sim.observe("wrong"), fails("INVALID_LEASE"));
  assert.ok(!JSON.stringify(sim.snapshot()).includes(lease.leaseId));
  assert.ok(!JSON.stringify(sim.discover()).includes(lease.leaseId));
  sim.release(lease.leaseId);
  sim.release(lease.leaseId);
  assert.throws(() => sim.observe(lease.leaseId), fails("LEASE_RELEASED"));
  assert.equal(sim.discover("rover").resources[0]!.available, true);
});

test("expiry cancels motion without applying its future target", () => {
  const { sim, advance } = setup();
  const { leaseId } = sim.possess("rover-01", 5);
  sim.act(leaseId, { type: "move", x: 1, z: 1.4 });
  advance(500);
  const during = sim.observe(leaseId).body.position;
  assert.notDeepEqual(during, [-6, 0.45, 3]);
  advance(5000);
  const body = sim.snapshot().bodies.find((b) => b.kind === "rover")!;
  assert.equal(body.action!.status, "cancelled");
  assert.deepEqual(body.position, during);
  assert.equal(body.lease, null);
  assert.throws(
    () => sim.act(leaseId, { type: "stop" }),
    fails("LEASE_EXPIRED"),
  );
  assert.throws(() => sim.observe(leaseId), fails("LEASE_EXPIRED"));
  assert.deepEqual(sim.release(leaseId), { released: true });
  sim.possess("rover-01");
});

test("release and explicit stop cancel; commands serialize; snapshots are isolated and ordered", () => {
  const { sim, advance } = setup();
  const { leaseId } = sim.possess("rover-01");
  const revisions: number[] = [];
  sim.subscribe(() => revisions.push(sim.snapshot().revision));
  sim.act(leaseId, { type: "move", x: 1, z: 1.4 });
  assert.throws(
    () => sim.act(leaseId, { type: "inspect", objectId: "crate-07" }),
    fails("ACTION_BUSY"),
  );
  advance(400);
  sim.act(leaseId, { type: "stop" });
  const stopped = sim.observe(leaseId).body.position;
  advance(5000);
  assert.deepEqual(sim.observe(leaseId).body.position, stopped);
  sim.act(leaseId, { type: "move", x: 2, z: 1 });
  sim.release(leaseId);
  advance(5000);
  assert.equal(sim.snapshot().bodies[1]!.action!.status, "cancelled");
  assert.ok(revisions.every((v, i) => !i || v > revisions[i - 1]!));
  const snapshot = sim.snapshot();
  snapshot.bodies[1]!.position[0] = 999;
  assert.notEqual(sim.snapshot().bodies[1]!.position[0], 999);
});

test("typed commands, per-body capabilities, bounds and lease budget are enforced", () => {
  const { sim } = setup();
  const { leaseId } = sim.possess("rover-01", 5);
  for (const command of [
    { type: "move", x: NaN, z: 0 },
    { type: "move", x: 0, z: 0, speed: 500 },
    { type: "teleport" },
    { type: "move", x: "1", z: 0 },
  ]) {
    assert.throws(
      () => sim.tool("act", { leaseId, command }),
      fails("INVALID_COMMAND"),
    );
  }
  assert.throws(
    () => sim.act(leaseId, { type: "move", x: 20, z: 0 }),
    fails("OUT_OF_BOUNDS"),
  );
  assert.throws(
    () => sim.act(leaseId, { type: "move", x: 0, z: 0, y: 3 }),
    fails("INVALID_COMMAND"),
  );
  assert.throws(
    () => sim.act(leaseId, { type: "takeoff" }),
    fails("INVALID_COMMAND"),
  );
  assert.throws(
    () => sim.act(leaseId, { type: "move", x: 9, z: 6 }),
    fails("LEASE_TOO_SHORT"),
  );
  assert.equal(sim.observe(leaseId).body.action, null);
  assert.throws(
    () => sim.tool("possess", { resourceId: "drone-01", ttlSeconds: 301 }),
    fails("INVALID_COMMAND"),
  );
  assert.throws(() => sim.possess("missing"), fails("RESOURCE_NOT_FOUND"));
});

test("complete rover inspection cycle uses sensor range and actual completion", () => {
  const { sim, advance } = setup();
  const { leaseId } = sim.possess("rover-01");
  assert.ok(!sim.observe(leaseId).objects.some((o) => o.id === "crate-07"));
  assert.throws(
    () => sim.act(leaseId, { type: "inspect", objectId: "crate-07" }),
    fails("OUT_OF_REACH"),
  );
  sim.act(leaseId, { type: "move", x: 1, z: 1.4 });
  advance(4500);
  assert.equal(sim.observe(leaseId).body.action!.status, "completed");
  assert.ok(
    sim
      .observe(leaseId)
      .objects.some((o) => o.id === "crate-07" && !o.condition),
  );
  sim.act(leaseId, { type: "inspect", objectId: "crate-07" });
  assert.match(sim.observe(leaseId).inspection!.condition, /Seal intact/);
  assert.equal(
    sim.snapshot().mission.find((s) => s.id === "rover")!.complete,
    true,
  );
  sim.release(leaseId);
});

test("camera field of view, airborne drone, and arm cargo transfer", () => {
  const { sim, advance } = setup();
  const camera = sim.possess("camera-01").leaseId;
  sim.act(camera, { type: "look", pan: -100, tilt: 0 });
  assert.throws(
    () => sim.act(camera, { type: "inspect", objectId: "crate-07" }),
    fails("OUT_OF_REACH"),
  );
  sim.act(camera, { type: "look", pan: 63, tilt: -13 });
  sim.act(camera, { type: "inspect", objectId: "crate-07" });
  const drone = sim.possess("drone-01").leaseId;
  assert.throws(
    () => sim.act(drone, { type: "move", x: 1, z: 0 }),
    fails("NOT_AIRBORNE"),
  );
  sim.act(drone, { type: "takeoff" });
  advance(2000);
  assert.throws(
    () => sim.act(drone, { type: "move", x: 1, z: 0, y: 9 }),
    fails("OUT_OF_BOUNDS"),
  );
  sim.act(drone, { type: "move", x: 1, z: -1.5, y: 3.4 });
  advance(3000);
  sim.act(drone, { type: "inspect", objectId: "crate-07" });
  sim.act(drone, { type: "land" });
  advance(2000);
  assert.equal(sim.observe(drone).body.airborne, false);
  const arm = sim.possess("arm-01").leaseId;
  assert.throws(
    () => sim.act(arm, { type: "grasp", objectId: "crate-07" }),
    fails("OUT_OF_REACH"),
  );
  sim.act(arm, { type: "preset", preset: "reach" });
  sim.act(arm, { type: "grasp", objectId: "crate-07" });
  sim.act(arm, { type: "preset", preset: "drop" });
  sim.act(arm, { type: "place" });
  assert.equal(
    sim.snapshot().mission.find((s) => s.id === "arm")!.complete,
    true,
  );
  assert.equal(sim.snapshot().objects[0]!.heldBy, null);
  assert.deepEqual(sim.snapshot().objects[0]!.position, [6, 0.55, 2]);
  assert.throws(() => sim.act(arm, { type: "place" }), fails("GRIPPER_EMPTY"));
});

test("reset invalidates leases and pending demo work cannot mutate the new world", async () => {
  const { sim } = setup();
  const id = sim.possess("rover-01").leaseId;
  sim.reset();
  assert.throws(() => sim.observe(id), fails("LEASE_RELEASED"));
  sim.startDemo();
  assert.equal(sim.snapshot().demo.running, true);
  assert.throws(() => sim.possess("camera-01"), fails("RESOURCE_BUSY"));
  sim.reset();
  const revision = sim.snapshot().revision;
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(sim.snapshot().revision, revision);
  assert.equal(sim.snapshot().demo.running, false);
  assert.ok(sim.snapshot().bodies.every((b) => !b.lease));
  assert.ok(sim.snapshot().mission.every((s) => !s.complete));
});
