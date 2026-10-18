import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentBoxHit, sensorPose, telemetryVisible } from "@ghost/shared";
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
test("swept segments catch thin barriers, tangencies, parallel paths and endpoint collisions", () => {
  const box = {
    id: "thin",
    label: "Thin barrier",
    kind: "wall" as const,
    min: [-0.1, 0, -2] as [number, number, number],
    max: [0.1, 4, 2] as [number, number, number],
  };
  assert.ok(segmentBoxHit([-20, 1, 0], [20, 1, 0], box)! > 0);
  assert.equal(segmentBoxHit([-20, 5, 0], [20, 5, 0], box), null);
  assert.notEqual(segmentBoxHit([-20, 4, 2], [20, 4, 2], box), null);
  assert.equal(segmentBoxHit([1, 1, -10], [1, 1, 10], box), null);
  assert.notEqual(segmentBoxHit([1, 1, -10], [1, 1, 10], box, [1, 0, 0]), null);
  assert.notEqual(segmentBoxHit([-2, 1, 0], [0, 1, 0], box), null);
});
test("rover rejects tunnelling through racks without changing pose/action, then accepts aisle waypoints", () => {
  const { sim, advance } = setup();
  const id = sim.possess("rover-01", 300).leaseId;
  const before = sim.observe(id);
  assert.throws(
    () => sim.act(id, { type: "move", x: -6, z: -30 }),
    (error) => {
      assert.ok(error instanceof SimError);
      assert.equal(error.code, "PATH_BLOCKED");
      assert.match(String(error.details?.obstacleId), /^rack-/);
      return true;
    },
  );
  const rejected = sim.observe(id);
  assert.deepEqual(rejected.body.position, before.body.position);
  assert.deepEqual(rejected.body.action, before.body.action);
  sim.act(id, { type: "move", x: -10, z: 3 });
  advance(3000);
  sim.act(id, { type: "move", x: -10, z: -18 });
  advance(13000);
  assert.deepEqual(sim.observe(id).body.position, [-10, 0.45, -18]);
  sim.act(id, { type: "inspect", objectId: "crate-12" });
  assert.match(sim.observe(id).inspection!.condition, /abrasion/);
});
test("drone can overfly racks but cannot descend or land through them", () => {
  const { sim, advance } = setup();
  const id = sim.possess("drone-01", 300).leaseId;
  sim.act(id, { type: "takeoff" });
  advance(2000);
  sim.act(id, { type: "move", x: -4, y: 11, z: -3 });
  advance(5000);
  sim.act(id, { type: "move", x: 15, y: 11, z: -16 });
  advance(12000);
  const before = sim.observe(id).body;
  assert.throws(() => sim.act(id, { type: "land" }), fails("PATH_BLOCKED"));
  assert.throws(
    () => sim.act(id, { type: "move", x: 15, y: 2, z: -16 }),
    fails("PATH_BLOCKED"),
  );
  const after = sim.observe(id).body;
  assert.deepEqual(after.position, before.position);
  assert.equal(after.airborne, true);
  sim.act(id, { type: "move", x: 10, y: 11, z: -30 });
  advance(8000);
  sim.act(id, { type: "move", x: 10, y: 3.4, z: -30 });
  advance(4000);
  sim.act(id, { type: "land" });
  advance(2000);
  assert.equal(sim.observe(id).body.airborne, false);
});
test("drone gimbal aims during flight without replacing motion, and world aim survives a heading change", () => {
  const { sim, advance } = setup();
  const id = sim.possess("drone-01", 300).leaseId;
  const takeoff = sim.act(id, { type: "takeoff" }).action.id;
  sim.act(id, { type: "look", pan: 0, tilt: -90 });
  const flying = sim.observe(id).body;
  assert.equal(flying.action!.id, takeoff);
  assert.equal(flying.action!.status, "running");
  advance(2000);
  sim.act(id, { type: "look", pan: 0, tilt: -45 });
  const before = sensorPose(sim.observe(id).body);
  sim.act(id, { type: "move", x: 1, z: -3, y: 2.8 });
  advance(3000);
  const body = sim.observe(id).body,
    after = sensorPose(body);
  assert.equal(body.pan, 0);
  assert.equal(body.tilt, -45);
  assert.equal(body.heading, Math.PI / 2);
  assert.deepEqual(
    after.target.map((v, i) => v - after.position[i]!),
    before.target.map((v, i) => v - before.position[i]!),
  );
  const camera = sim.possess("camera-01").leaseId;
  assert.throws(
    () =>
      sim.tool("act", {
        leaseId: camera,
        command: { type: "look", pan: 0, tilt: -90 },
      }),
    fails("INVALID_COMMAND"),
  );
});
test("camera cannot detect or inspect cargo through a rack; a clear mobile sightline can", () => {
  const { sim } = setup();
  const id = sim.possess("camera-01").leaseId;
  const camera = sim.observe(id).body;
  const target: [number, number, number] = [-8.4, 0.55, -18];
  const dx = target[0] - camera.position[0],
    dz = target[2] - camera.position[2];
  sim.act(id, {
    type: "look",
    pan: (Math.atan2(dx, dz) * 180) / Math.PI,
    tilt:
      (Math.atan2(target[1] - camera.position[1], Math.hypot(dx, dz)) * 180) /
      Math.PI,
  });
  assert.ok(!sim.observe(id).objects.some((o) => o.id === "crate-12"));
  assert.throws(
    () => sim.act(id, { type: "inspect", objectId: "crate-12" }),
    fails("OUT_OF_REACH"),
  );
  const rover = {
    ...sim.snapshot().bodies.find((b) => b.kind === "rover")!,
    position: [-10, 0.45, -18] as [number, number, number],
    heading: Math.PI,
  };
  assert.equal(telemetryVisible(rover, target), true);
});
