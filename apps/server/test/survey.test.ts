import { test } from "node:test";
import assert from "node:assert/strict";
import { surveyCell, SURVEY_GRID, telemetryVisible } from "@ghost/shared";
import { SurveyTracker } from "../src/survey.js";
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
  assert.equal(limits.telemetryOcclusion, true);
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
  sim.act(leaseId, { type: "move", x: -4, y: 12, z: -3 });
  advance(5000);
  sim.act(leaseId, { type: "move", x: -12, y: 12, z: -30 });
  advance(4000);
  assert.equal(sim.observe(leaseId).body.action?.status, "running");
  assert.equal(sim.discover().survey.coveredCells, 0);
  advance(20000);
  assert.equal(sim.observe(leaseId).body.action?.status, "completed");
  assert.equal(sim.discover().survey.coveredCells, 0);
  sim.act(leaseId, { type: "move", x: -12, y: 3.4, z: -30 });
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

test("survey samples line-of-sight checkpoints, excludes structures and retains occluded unknowns", () => {
  const { sim } = setup();
  const survey = sim.discover().survey;
  assert.ok(survey.blockedCells > 0);
  assert.equal(survey.totalCells + survey.blockedCells, 96);
  assert.equal(
    survey.rows.join("").replace(/[^x]/g, "").length,
    survey.blockedCells,
  );
  const tracker = new SurveyTracker();
  const body = {
    ...sim.snapshot().bodies.find((b) => b.kind === "drone")!,
    position: [-15, 3.4, -12.5] as [number, number, number],
  };
  const point = surveyCell(3, 2).center;
  assert.ok(Math.hypot(...point.map((v, i) => v - body.position[i]!)) < 9);
  assert.equal(telemetryVisible(body, point), false);
  tracker.record(body, [], 1);
  assert.equal(tracker.snapshot().rows[2]![3], "0");
  body.position = [-15, 3.4, -21.5];
  assert.equal(telemetryVisible(body, point), true);
  tracker.record(body, [], 2);
  assert.equal(tracker.snapshot().rows[2]![3], "1");
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
