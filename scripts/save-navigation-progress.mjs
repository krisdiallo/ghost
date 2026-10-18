// Publish completed experiment evidence, preserving the original trace/images.
import assert from "node:assert/strict";
import { readFile, writeFile, copyFile, mkdir, stat } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const input = resolve(
  process.env.GHOST_AGENT_DIR ?? "work/navigation-agent-01",
);
const validation = resolve(
  process.env.GHOST_NAV_CAPTURE_DIR ?? "work/captures/navigation",
);
const output = resolve("docs/progress/navigation");
const read = async (name) =>
  JSON.parse(await readFile(join(input, name), "utf8"));
const trace = await read("trace.json"),
  world = await read("final-snapshot.json"),
  attestation = await read("agent-attestation.json");
assert.equal(trace.events.at(-1).tool, "session_end");
assert.equal(world.survey.coverageModel, "visible-floor-checkpoints");
assert.ok(world.bodies.every((b) => !b.lease));
assert.ok(!/"leaseId"\s*:/.test(JSON.stringify(trace)));
const checks = JSON.parse(
  await readFile(join(validation, "verification.json"), "utf8"),
);
assert.ok(
  checks.roverPathBlocked &&
    checks.cameraOcclusion &&
    checks.blockedLanding &&
    checks.gimbalDuringFlight &&
    checks.poseUnchangedBetweenAims &&
    checks.phoneGimbalControls,
);
assert.deepEqual(checks.browserErrors, []);
assert.deepEqual(trace.browserErrors, []);
await mkdir(join(output, "validation"), { recursive: true });
await mkdir(join(output, "frames"), { recursive: true });
for (const name of [
  "verification.json",
  "rover-blocked-sensor.jpg",
  "route-blocked.jpg",
  "blocked-map.jpg",
  "drone-down.jpg",
  "drone-side.jpg",
  "gimbal-in-warehouse.jpg",
  "mobile-gimbal.jpg",
  "navigation-check-4x.mp4",
])
  await copyFile(join(validation, name), join(output, "validation", name));
const viewed = new Set(attestation.viewedObservationSteps),
  unavailable = new Set(attestation.unavailableImageSteps);
for (const e of trace.events.filter((e) => e.image)) {
  assert.ok(
    e.image.path.startsWith("frames/") &&
      basename(e.image.path) === e.image.path.slice(7),
  );
  assert.ok(
    viewed.has(e.index) || unavailable.has(e.index),
    "classify every image delivery",
  );
  const bytes = await readFile(join(input, e.image.path));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    e.image.sha256,
  );
  await copyFile(join(input, e.image.path), join(output, e.image.path));
  try {
    const name = `step-${String(e.index).padStart(3, "0")}.jpg`;
    await copyFile(join(input, name), join(output, name));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const name of [
  "trace.json",
  "agent-attestation.json",
  "agent-mission-4x.mp4",
  "final-console.jpg",
  "survey-ledger.jpg",
  "survey-map.jpg",
  "survey-mobile.jpg",
])
  await copyFile(join(input, name), join(output, name));
const priority = world.objects.find((o) => /priority/i.test(o.label)),
  arm = world.bodies.find((b) => b.kind === "arm"),
  drone = world.bodies.find((b) => b.kind === "drone");
const inspected = world.objects.filter((o) => o.inspectedBy.length);
const verification = {
  at: trace.endedAt,
  source:
    "Authority checked after the fresh agent finished control; not supplied during its decisions.",
  taggedCargo: world.objects.length,
  inspectedCargo: inspected.length,
  uninspectedCargo: world.objects
    .filter((o) => !o.inspectedBy.length)
    .map((o) => o.id),
  priorityDispatchVerified: Boolean(
    priority?.inspectedBy.length &&
      !priority.heldBy &&
      priority.position[0] === 6 &&
      priority.position[1] === 0.55 &&
      priority.position[2] === 2,
  ),
  visibleCheckpoints: world.survey.coveredCells,
  eligibleCheckpoints: world.survey.totalCells,
  structuralPointsExcluded: world.survey.blockedCells,
  allLeasesReleased: world.bodies.every((b) => !b.lease),
  armHomeAndEmpty: arm.preset === "home" && !arm.heldObjectId,
  droneLanded: !drone.airborne && Math.abs(drone.position[1] - 0.4) < 1e-6,
  bodiesUsed: [
    ...new Set(
      trace.events
        .filter((e) => e.tool === "possess" && !e.isError)
        .map((e) => e.input.resourceId),
    ),
  ],
  agentViewedImages: viewed.size,
  unavailableImageSteps: [...unavailable],
  toolErrors: trace.events
    .filter((e) => e.isError)
    .map((e) => ({ index: e.index, tool: e.tool, result: e.result })),
  recorderErrors: trace.events.filter(
    (e) => e.tool === "recorder_error" || e.presentationError,
  ),
  exportError: trace.events.at(-1).exportError ?? null,
};
await writeFile(
  join(output, "verification.json"),
  JSON.stringify(verification, null, 2) + "\n",
);
const probe = async (name) =>
  JSON.parse(
    (
      await promisify(execFile)("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration,size",
        "-of",
        "json",
        join(output, name),
      ])
    ).stdout,
  ).format;
const checkMovie = await probe("validation/navigation-check-4x.mp4"),
  agentMovie = await probe("agent-mission-4x.mp4");
const kb = (n) => Math.round(Number(n) / 1024),
  previewKb = kb((await stat(join(output, "validation/drone-side.jpg"))).size);
const calls = trace.events.filter((e) =>
  ["discover", "possess", "observe", "act", "release"].includes(e.tool),
).length;
const date = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
}).format(new Date(trace.startedAt));
await writeFile(
  join(output, "README.md"),
  `# GHOST · navigation and camera realism

${date} · actual app and MCP captures

**Static collision checks, occluded sensing and an independent drone gimbal are implemented.** A fresh-context agent inspected **${inspected.length}/${world.objects.length} tagged crates**, observed **${world.survey.coveredCells}/${world.survey.totalCells} eligible floor checkpoints**, and ${verification.priorityDispatchVerified ? "verified priority dispatch" : "did not verify priority dispatch"}. Remaining limitations and actual errors are below.

![Actual drone sensor after aiming sideways — ${previewKb} KB](validation/drone-side.jpg)

Only this ${previewKb} KB preview loads automatically. It is from the scripted validation, not the independent agent. [Watch the scripted navigation/gimbal check at 4× — ${Math.round(Number(checkMovie.duration))} seconds, ${kb(checkMovie.size)} KB](validation/navigation-check-4x.mp4?raw=true). [Watch the full fresh-agent mission at 4× — ${Math.round(Number(agentMovie.duration))} seconds, ${kb(agentMovie.size)} KB](agent-mission-4x.mp4?raw=true).

- [Same drone pose, camera aimed down — actual JPEG](validation/drone-down.jpg?raw=true)
- [Actual phone gimbal controls](validation/mobile-gimbal.jpg?raw=true)
- [Rejected rover route on the shared map](validation/blocked-map.jpg?raw=true)
- [Full console during blocked motion](validation/route-blocked.jpg?raw=true)
- [Fresh agent's final checkpoint/cargo ledger](survey-mobile.jpg?raw=true)
- [Original fresh-agent MCP trace](trace.json) · [context and image-viewing attestation](agent-attestation.json)
- [Independent authority verification](verification.json) · [scripted regression results](validation/verification.json)

## What is enforced

Rover/drone motions sweep a conservative body envelope over the entire straight segment. Packed rack bays, freight, walls, columns and mezzanine structures reject intersecting paths, including vertical descent and landing. A rejected move leaves the body in place, returns PATH_BLOCKED with obstacle/position/clearance, and publishes a red map marker plus activity event. Static floorplan geometry is available through MCP; it does not reveal hidden cargo IDs or an inventory count. Agents choose their own waypoints. Discovery and body limits label clearance as X/Y/Z half-extents, so clients can account for the full wheel/rotor footprint. There is no automatic path planner or rigid-body physics. Phone map taps have limited coordinate precision; use coordinate inputs or named waypoints for narrow aisles.

Telemetry and inspection now require line of sight through the same static solid envelopes. Mobile proximity telemetry is radial; rendered images use the aimed optical frustum and finer geometry. The model can conservatively reject a visible gap inside a packed rack. Other moving bodies and mission cargo are not dynamic collision obstacles, and analytic inspection text is not a visible damage texture.

Wisp's world pan/tilt gimbal aims independently of chassis motion. The scripted test changes aim while a takeoff is running and verifies that the original motion remains active. It also captures the two JPEGs above at the exact same body position and heading, verifies their different hashes, and operates the real controls at 390 px phone width. It rejects a rover crossing and landing over a rack, verifies that Sentinel cannot detect or inspect through a packed bay, then returns to clear floor and releases every lease. This is a scripted correctness regression, distinct from the fresh agent below.

## The fresh-context mission

The agent started with no inherited chat or repository context. It was supplied a general mission, actual MCP schemas and recorder transport instructions, with no cargo IDs/locations, expected conditions, body sequence or route. It was instructed to avoid source/docs and spectator APIs/DOM, and to view only its returned sensor JPEGs. This was instruction-bound, not an OS-isolated benchmark. The parent checked authority state only after control finished.

${attestation.finalReport}

The trace contains **${calls} recorded MCP calls**, excluding aggregated motion polls, and **${viewed.size} sensor images actually viewed**. Tool error responses: **${verification.toolErrors.length}**. Recorder errors: **${verification.recorderErrors.length}**. ${unavailable.size ? "Unavailable image steps: " + [...unavailable].join(", ") + "." : "No image deliveries were reported unavailable."} Export: ${verification.exportError ?? "completed"}. Cleanup: leases ${verification.allLeasesReleased ? "released" : "not fully released"}, arm ${verification.armHomeAndEmpty ? "home and empty" : "not restored"}, drone ${verification.droneLanded ? "landed" : "not landed"}.

## What the coverage number means

The new grid samples 96 floor positions. ${world.survey.blockedCells} points lie inside structures and are excluded, leaving ${world.survey.totalCells} eligible checkpoints. A point is credited only by a stationary observation with range/FOV and line of sight. Hollow points remain unknown. This does not certify full cell areas, elevated-rack coverage or exhaustive inventory. Earlier [96-cell results](../survey/README.md) used the previous non-occluding whole-cell model; scores are not directly comparable.

These examples demonstrate actual simulated embodiment through MCP. The recorder contains no model or route policy; a fresh Codex agent supplied mission decisions. It is not a standalone autonomous UI mode. Physical phone/GPU testing, Manufact hosting and ChatGPT OAuth remain pending.
`,
);
await writeFile(
  resolve("docs/progress/latest/README.md"),
  `# GHOST · latest visual progress

[Navigation realism: blocked routes, occluded sensing, drone gimbal and a fresh agent mission](../navigation/README.md)

![Actual drone sensor frame — ${previewKb} KB](../navigation/validation/drone-side.jpg)

[Short scripted navigation/gimbal recording — ${kb(checkMovie.size)} KB](../navigation/validation/navigation-check-4x.mp4?raw=true). The report includes the independent agent recording, original MCP trace and remaining gaps.

Earlier: [Shared survey experiment](../survey/README.md) · [Initial incomplete agent run](../agent/README.md) · [MCP Apps and cameras](../vision/README.md).
`,
);
console.log(JSON.stringify(verification));
