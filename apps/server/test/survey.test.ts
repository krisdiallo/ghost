import { test } from "node:test";
import assert from "node:assert/strict";
import { surveyCell, SURVEY_GRID } from "@ghost/shared";
import type { Command, Vec3 } from "@ghost/shared";
import { Simulation } from "../src/simulation.js";

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
test("survey knows only leased observations, preserves inspected findings across bodies and clears on reset", () => {
  const { sim, advance } = setup();
  assert.equal(sim.discover().survey.coveredCells, 0);
  assert.deepEqual(sim.discover().survey.knownCargo, []);
  const camera = sim.possess("camera-01");
  const limits = sim.discover("camera").resources[0]!.limits;
  assert.equal(limits.inspectRange, 45);
  assert.equal(limits.telemetryOcclusion, false);
  assert.equal(limits.image.occlusion, true);
  assert.throws(() => sim.observe("wrong"));
  assert.equal(sim.snapshot().survey.coveredCells, 0);
  const observation = sim.observe(camera.leaseId);
  assert.ok(observation.survey.coveredCells > 0);
  assert.ok(observation.survey.coveredCells < observation.survey.totalCells);
  assert.deepEqual(
    observation.survey.knownCargo.map((o) => o.id),
    observation.objects.map((o) => o.id),
  );
  assert.ok(observation.survey.knownCargo.every((o) => !o.condition));
  assert.ok(!JSON.stringify(observation.survey).includes("crate-18"));
  sim.act(camera.leaseId, { type: "inspect", objectId: "crate-07" });
  sim.release(camera.leaseId);
  const rover = sim.possess("rover-01");
  advance(10);
  const next = sim.observe(rover.leaseId);
  assert.ok(
    next.survey.knownCargo
      .find((o) => o.id === "crate-07")
      ?.condition?.includes("Cleared"),
  );
  assert.ok(!JSON.stringify(sim.discover()).includes(rover.leaseId));
  next.survey.rows[0] = "broken";
  assert.notEqual(sim.snapshot().survey.rows[0], "broken");
  sim.reset();
  assert.equal(sim.snapshot().survey.coveredCells, 0);
  assert.deepEqual(sim.discover().survey.knownCargo, []);
});

test("motion polls do not credit a swept path and high flight cannot survey out-of-range floor cells", () => {
  const { sim, advance } = setup();
  const { leaseId } = sim.possess("drone-01", 300);
  sim.act(leaseId, { type: "takeoff" });
  advance(2000);
  sim.act(leaseId, { type: "move", x: -25, y: 12, z: -30 });
  advance(4000);
  assert.equal(sim.observe(leaseId).body.action?.status, "running");
  assert.equal(sim.discover().survey.coveredCells, 0);
  advance(20000);
  assert.equal(sim.observe(leaseId).body.action?.status, "completed");
  assert.equal(sim.discover().survey.coveredCells, 0);
  sim.act(leaseId, { type: "move", x: -25, y: 3.4, z: -30 });
  advance(5000);
  const covered = sim.observe(leaseId).survey.coveredCells;
  assert.ok(covered > 0);
  advance(100);
  assert.equal(
    sim.observe(leaseId).survey.coveredCells,
    covered,
    "repeat does not inflate coverage",
  );
  sim.release(leaseId);
  assert.throws(() => sim.observe(leaseId));
  assert.equal(sim.discover().survey.coveredCells, covered);
});

test("a generic grid survey can cover every floor cell and find all tagged cargo without spectator state", () => {
  const { sim, advance } = setup();
  const { leaseId } = sim.possess("drone-01", 300);
  let position: Vec3 = [-4, 0.4, -3];
  const move = (command: Command, target: Vec3) => {
    sim.act(leaseId, command);
    advance(
      Math.max(
        450,
        (Math.hypot(...target.map((v, i) => v - position[i]!)) / 2.4) * 1000,
      ) + 1,
    );
    position = target;
  };
  move({ type: "takeoff" }, [-4, 2.8, -3]);
  for (let row = 0; row < SURVEY_GRID.rows; row++)
    for (let step = 0; step < SURVEY_GRID.columns; step++) {
      const column = row % 2 ? SURVEY_GRID.columns - 1 - step : step;
      const center = surveyCell(column, row).center;
      const target: Vec3 = [center[0], 3.4, center[2]];
      move({ type: "move", x: target[0], y: target[1], z: target[2] }, target);
      sim.observe(leaseId);
    }
  const survey = sim.discover().survey;
  assert.equal(survey.coveredCells, survey.totalCells);
  assert.equal(survey.totalCells, 96);
  assert.equal(survey.knownCargo.length, 3);
  assert.ok(
    survey.knownCargo.every((o) => !o.condition),
    "survey is not an inspection",
  );
  assert.ok(survey.rows.every((row) => /^1+$/.test(row)));
});

test("instant cargo transfers refresh last-seen position even within one clock timestamp", () => {
  const { sim } = setup();
  const exposed = sim.discover("arm").resources[0]!.limits.gripperPresets!;
  exposed.drop[0] = 100;
  assert.equal(
    sim.discover("arm").resources[0]!.limits.gripperPresets!.drop[0],
    6,
  );
  const camera = sim.possess("camera-01").leaseId;
  sim.observe(camera);
  const arm = sim.possess("arm-01").leaseId;
  sim.act(arm, { type: "preset", preset: "reach" });
  sim.act(arm, { type: "grasp", objectId: "crate-07" });
  sim.act(arm, { type: "preset", preset: "drop" });
  sim.act(arm, { type: "place" });
  assert.deepEqual(
    sim.observe(camera).survey.knownCargo.find((o) => o.id === "crate-07")
      ?.position,
    [6, 0.55, 2],
  );
  const unobserved = new Simulation(
    () => 0,
    () => 0,
  );
  const lease = unobserved.possess("camera-01").leaseId;
  unobserved.act(lease, { type: "inspect", objectId: "crate-07" });
  assert.equal(
    unobserved.discover().survey.coveredCells,
    0,
    "inspection findings alone do not mark floor coverage",
  );
  assert.equal(unobserved.discover().survey.knownCargo.length, 1);
});
