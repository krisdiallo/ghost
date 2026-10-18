// Publish an actual completed external-agent run; no mission policy lives here.
import assert from "node:assert/strict";
import { readFile, writeFile, copyFile, mkdir, stat } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const input = resolve(process.env.GHOST_AGENT_DIR ?? "work/survey-agent-01");
const output = resolve("docs/progress/survey");
const read = async (name) =>
  JSON.parse(await readFile(join(input, name), "utf8"));
const trace = await read("trace.json");
const world = await read("final-snapshot.json");
const attestation = await read("agent-attestation.json");
assert.equal(trace.events.at(-1).tool, "session_end");
assert.ok(
  world.bodies.every((b) => !b.lease),
  "publish after cleanup",
);
assert.ok(
  !/"leaseId"\s*:/.test(JSON.stringify(trace)),
  "never publish lease capabilities",
);
assert.deepEqual(trace.browserErrors, [], "publish passing browser captures");
const viewed = new Set(attestation.viewedObservationSteps);
const unavailable = new Set(attestation.unavailableImageSteps);
const images = trace.events.filter((e) => e.image);
await mkdir(join(output, "frames"), { recursive: true });
for (const e of images) {
  assert.ok(
    e.image.path.startsWith("frames/") &&
      basename(e.image.path) === e.image.path.slice(7),
  );
  assert.ok(
    viewed.has(e.index) || unavailable.has(e.index),
    "classify actual image delivery",
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
  "agent-highlights.mp4",
  "highlights.json",
  "review.json",
  "review-survey-mobile.jpg",
  "review-survey-map.jpg",
  "review-survey-ledger.jpg",
  "final-console.jpg",
  "survey-ledger.jpg",
  "survey-map.jpg",
  "survey-mobile.jpg",
])
  await copyFile(join(input, name), join(output, name));
const priority = world.objects.find((o) => /priority/i.test(o.label));
const arm = world.bodies.find((b) => b.kind === "arm");
const drone = world.bodies.find((b) => b.kind === "drone");
const inspected = world.objects.filter((o) => o.inspectedBy.length);
const verification = {
  at: trace.endedAt,
  source:
    "Authority state checked after the agent finished; not supplied during its mission.",
  taggedCargo: world.objects.length,
  inspectedCargo: inspected.length,
  allTaggedCargoInspected: inspected.length === world.objects.length,
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
  floorCellsCovered: world.survey.coveredCells,
  floorCellsTotal: world.survey.totalCells,
  surveyKnownCargo: world.survey.knownCargo.length,
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
  recorderErrors: trace.events.filter((e) => e.tool === "recorder_error"),
  exportError: trace.events.at(-1).exportError ?? null,
  mcpErrors: trace.events
    .filter((e) => e.isError)
    .map((e) => ({ index: e.index, tool: e.tool, result: e.result })),
  presentationErrors: trace.events
    .filter((e) => e.presentationError)
    .map((e) => ({ index: e.index, error: e.presentationError })),
};
await writeFile(
  join(output, "verification.json"),
  JSON.stringify(verification, null, 2) + "\n",
);
const movie = JSON.parse(
  (
    await promisify(execFile)("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size",
      "-of",
      "json",
      join(output, "agent-mission-4x.mp4"),
    ])
  ).stdout,
).format;
const previewKb = Math.round(
  (await stat(join(output, "survey-mobile.jpg"))).size / 1024,
);
const movieKb = Math.round(Number(movie.size) / 1024);
const highlightsKb = Math.round(
  (await stat(join(output, "agent-highlights.mp4"))).size / 1024,
);
const calls = trace.events.filter((e) =>
  ["discover", "possess", "observe", "act", "release"].includes(e.tool),
).length;
const percent = Math.floor(
  (world.survey.coveredCells / world.survey.totalCells) * 100,
);
const firstImage = images.find((e) => viewed.has(e.index));
await writeFile(
  join(output, "README.md"),
  `# GHOST · search history meets a fresh agent

${trace.startedAt} · actual independent Codex agent run

**${inspected.length}/${world.objects.length} tagged crates inspected; ${verification.priorityDispatchVerified ? "priority dispatch verified" : "priority dispatch not verified"}.** The agent recorded ${world.survey.coveredCells}/${world.survey.totalCells} floor cells (${percent}%) through stationary analytic observations. ${verification.allTaggedCargoInspected ? "Post-run authority checks confirmed all tagged cargo was inspected." : "Post-run checks found uninspected cargo: " + verification.uninspectedCargo.join(", ") + "."} This does not certify exhaustive visual or elevated-rack coverage.

![The actual mobile survey ledger — ${previewKb} KB](survey-mobile.jpg)

Only this ${previewKb} KB preview loads automatically. [24-second edited highlights — ${highlightsKb} KB](agent-highlights.mp4?raw=true). Three chronological excerpts from the actual recording; gaps are omitted. [Watch the full actual run at 4× speed — ${Math.round(Number(movie.duration))} seconds, ${movieKb} KB](agent-mission-4x.mp4?raw=true).

- [Actual survey map](survey-map.jpg?raw=true)
- [Final warehouse console](final-console.jpg?raw=true)
- [An actual sensor image viewed by the agent](${firstImage.image.path}?raw=true)
- [Original redacted MCP trace](trace.json)
- [Fresh-context prompt, image-viewing attestation and final report](agent-attestation.json)
- [Post-run authority verification](verification.json)
- [Separate post-control mobile check](review-survey-mobile.jpg?raw=true) · [capture provenance](review.json)
- [Highlights cut list](highlights.json)

## What changed

Discovery now exposes analytic telemetry ranges, inspection distances, camera view/aim bounds, drone flight limits and arm gripper preset positions. A shared 12 × 8 survey grid records fully observed floor cells, and a cargo ledger retains actual observations and successful inspections across body switches. Unknown cargo IDs and a ground-truth inventory count are never supplied by discovery. Agents still choose their own bodies, search positions and actions.

A cell is credited only by a stationary observation whose analytic footprint covers its whole floor area at Y 0.55 m. Moving polls do not credit swept paths. History is shared across clients, is historical rather than a current occupancy guarantee, and clears on reset/restart. Images have scene occlusion; analytic telemetry does not. A survey finding is separate from an inspection, and inspection text does not imply visible damage textures.

## The independent run

The agent started with no inherited chat or repository context. It was given a general mission, the actual MCP schemas and recorder transport instructions. No cargo locations, IDs, expected findings, route or body sequence were supplied. It was instructed to avoid source/docs, spectator DOM and snapshot APIs. This was instruction-bound, not a restricted-filesystem benchmark.

${attestation.finalReport}

Control lasted about 13 minutes 44 seconds; the full session also includes the requested post-control spectator pause and export. There were ${calls} recorded MCP calls, excluding aggregated motion polls. The agent directly viewed ${viewed.size} sensor images. ${unavailable.size ? "Unavailable image observations: " + [...unavailable].join(", ") + "." : "No image deliveries were reported unavailable."} The trace preserves ${verification.mcpErrors.length} MCP tool errors and ${verification.presentationErrors.length} recorder presentation errors, plus ${verification.recorderErrors.length} recorder command errors. Export status: ${verification.exportError ?? "completed"}. Cleanup checks: leases ${verification.allLeasesReleased ? "released" : "not fully released"}, arm ${verification.armHomeAndEmpty ? "home and empty" : "not restored"}, drone ${verification.droneLanded ? "landed" : "not landed"}.

This run had a 100-call budget, compared with 60 in the [initial run](../agent/README.md), and its objective explicitly requested systematic search using observation history. They are two real examples, not a controlled performance comparison. The deterministic all-cell unit test is a separate scripted correctness check and is not presented as agent behavior.

The recorder forwards externally chosen MCP commands and saves exact sensor images plus continuous browser capture. It contains no model, mission planner or route. Mobile/ledger/map stills were captured after the mission and were not supplied to the agent. The mobile preview uses the final contrast correction; the continuous recording preserves the UI as it ran. Manufact hosting, ChatGPT OAuth, physical collision avoidance and a guaranteed exhaustive inventory planner remain outside this result.
`,
);
await writeFile(
  resolve("docs/progress/latest/README.md"),
  `# GHOST · latest visual progress

[New fresh-agent run: search coverage, cargo inspections and dispatch verification](../survey/README.md)

![Actual mobile cargo ledger — ${previewKb} KB](../survey/survey-mobile.jpg)

[24-second edited highlights — ${highlightsKb} KB](../survey/agent-highlights.mp4?raw=true). [Full actual mission at 4× speed — ${movieKb} KB](../survey/agent-mission-4x.mp4?raw=true). The report contains original sensor frames, the MCP trace, independent post-run checks and remaining gaps.

Earlier reports: [Initial fresh-agent mission](../agent/README.md) · [Body cameras and MCP Apps](../vision/README.md). The Manufact endpoint and ChatGPT OAuth are still pending.
`,
);
console.log(
  JSON.stringify({
    verification,
    videoKb: movieKb,
    previewKb,
    recordedMcpCalls: calls,
  }),
);
