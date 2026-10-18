import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  stat,
  access,
} from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const input = resolve(process.env.GHOST_AGENT_DIR ?? "work/live-agent-01");
const output = resolve("docs/progress/agent");
const read = async (name) =>
  JSON.parse(await readFile(join(input, name), "utf8"));
const trace = await read("trace.json");
const snapshot = await read("final-snapshot.json");
const attestation = await read("agent-attestation.json");
assert.equal(trace.events.at(-1).tool, "session_end", "publish a finished run");
assert.ok(
  snapshot.bodies.every((body) => !body.lease),
  "session cleanup must finish",
);
assert.ok(
  !/"leaseId"\s*:/.test(JSON.stringify(trace)),
  "never publish capabilities",
);
const observed = new Set(attestation.viewedObservationSteps);
const unavailable = new Set(attestation.unavailableImageSteps);
const images = trace.events.filter((event) => event.image);
await mkdir(join(output, "frames"), { recursive: true });
for (const event of images) {
  assert.ok(
    event.image.path.startsWith("frames/") &&
      basename(event.image.path) === event.image.path.slice(7),
  );
  const data = await readFile(join(input, event.image.path));
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    event.image.sha256,
  );
  assert.ok(
    observed.has(event.index) || unavailable.has(event.index),
    "record actual image delivery status",
  );
  await copyFile(join(input, event.image.path), join(output, event.image.path));
  const screen = `step-${String(event.index).padStart(3, "0")}.jpg`;
  try {
    await access(join(input, screen));
    await copyFile(join(input, screen), join(output, screen));
  } catch {
    /* A recording timeout can leave no UI still. */
  }
}
for (const name of [
  "trace.json",
  "agent-attestation.json",
  "agent-mission-4x.mp4",
  "final-console.jpg",
])
  await copyFile(join(input, name), join(output, name));
const inspected = snapshot.objects.filter(
  (object) => object.inspectedBy.length > 0,
);
const priority = snapshot.objects.find((object) =>
  /priority/i.test(object.label),
);
const arm = snapshot.bodies.find((body) => body.kind === "arm");
const drone = snapshot.bodies.find((body) => body.kind === "drone");
const dispatch =
  priority &&
  priority.inspectedBy.length > 0 &&
  !priority.heldBy &&
  priority.position[0] === arm.position[0] + 2 &&
  priority.position[2] === arm.position[2] + 2 &&
  priority.position[1] === 0.55;
const verification = {
  at: trace.endedAt,
  source:
    "Authority state checked after the agent finished; not supplied to the agent.",
  priorityDispatchVerified: Boolean(dispatch),
  priorityPosition: priority?.position,
  taggedCargo: snapshot.objects.length,
  inspectedCargo: inspected.length,
  inventoryComplete: inspected.length === snapshot.objects.length,
  unseenCargo: snapshot.objects
    .filter((object) => !object.inspectedBy.length)
    .map(({ id }) => id),
  allLeasesReleased: snapshot.bodies.every((body) => !body.lease),
  armHomeAndEmpty: arm.preset === "home" && !arm.heldObjectId,
  droneLanded: !drone.airborne && Math.abs(drone.position[1] - 0.4) < 1e-6,
  bodiesUsed: [
    ...new Set(
      trace.events
        .filter((event) => event.tool === "possess" && !event.isError)
        .map((event) => event.input.resourceId),
    ),
  ],
  agentViewedImages: observed.size,
  unavailableImageSteps: [...unavailable],
  mcpErrorCount: trace.events.filter((event) => event.isError).length,
};
await writeFile(
  join(output, "verification.json"),
  JSON.stringify(verification, null, 2),
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
const movieKb = Math.round(Number(movie.size) / 1024);
const preview =
  images.find((event) => event.index === 16 && observed.has(event.index)) ??
  images.find((event) => observed.has(event.index));
const previewKb = Math.round(
  (await stat(join(output, preview.image.path))).size / 1024,
);
const elapsed = Math.round(
  (new Date(trace.endedAt) - new Date(trace.startedAt)) / 1000,
);
const toolEvents = trace.events.filter((event) =>
  ["discover", "possess", "observe", "act", "release"].includes(event.tool),
);
await writeFile(
  join(output, "README.md"),
  `# GHOST · a fresh agent takes the controls

${trace.startedAt} · actual independent Codex agent session

**Verified priority dispatch; inventory incomplete.** A fresh subagent used all four body types, inspected and staged Cargo 07, and reported an abrasion on Cargo 12. It inspected ${inspected.length} of ${snapshot.objects.length} tagged crates. Cargo 18 was not found. The agent explicitly declined to claim exhaustive coverage.

![The arm sensor image the agent viewed after placing Cargo 07 — ${previewKb} KB](${preview.image.path})

Only this ${previewKb} KB image loads by default. [Watch the real run at 4× speed — ${Math.round(Number(movie.duration))} seconds, ${movieKb} KB](agent-mission-4x.mp4?raw=true). The original session lasted ${elapsed} seconds, including observation waits and model/tool latency. The recording is continuous browser capture, sped up 4×.

- [Full console at the verified placement](step-016.jpg?raw=true)
- [Drone sensor image from the storage survey](frames/sensor-042-drone-01.jpg?raw=true)
- [Public MCP action/observation trace](trace.json)
- [Fresh-context instructions and agent's final report](agent-attestation.json)
- [Authority verification after the run](verification.json)

## What the agent knew

The user requested an agent without the parent chat or repository context. We started it with no inherited conversation and supplied only a general cargo-inspection/staging objective, the actual MCP schemas, and transport instructions. It was instructed to avoid source files, spectator state and snapshot APIs. No cargo coordinates, resource order, route, crate IDs or expected conditions were supplied in its mission prompt. The old canned mission route was removed from the MCP tool description first.

MCP discovery supplies body poses and capabilities. Leased observations supply sensor-limited cargo telemetry, coordinates, and optional camera images. This run used both telemetry and images; it is not a vision-only navigation benchmark. The agent reported directly viewing ${observed.size} sensor images. The parent evaluated final authority state after the agent finished to assess coverage and cleanup.

## What happened

The agent found Priority cargo 07, chose Scout for close inspection, and received **“Seal intact. Label verified. Cleared for dispatch.”** It selected Atlas, used reach/grasp/drop/place, and verified an empty gripper, completed placement, an arm camera image of the labelled crate over the floor marker, and independent camera telemetry at **[6, 0.55, 2]**. It returned the arm home.

A later camera sweep found Cargo 12. Its analytic inspection returned **“Surface abrasion on north face. Seal intact.”** The agent reported that exception and left the storage crate in place. The image does not simulate the abrasion texture; this finding came from the inspection tool.

The agent also chose Wisp for an aerial survey, viewed storage rows, and returned the drone to land. It found no further tagged cargo and explicitly reported incomplete coverage. Ground-truth verification found **Cargo 18 remained uninspected**. All remaining leases were released. There were ${toolEvents.length} recorded MCP calls, excluding the helper's aggregated motion polls.

## A real failure, preserved

Two camera image deliveries, observations **18 and 33**, timed out in the recorder's spectator UI wait. MCP had produced those image files, but the agent did not receive/view them; it recovered with structured telemetry. Those server-captured files remain in the trace, and the attestation marks them unavailable to the agent. No camera observation success is inferred from those files.

The recorder was waiting for a camera image while the UI remained focused on another body. The committed fix focuses the observed body and preserves the actual MCP result even when presentation fails. A scripted regression test reproduces interleaved observations across two body leases. That regression test is separate from this independent-agent run.

## What is implemented

The session recorder forwards externally chosen MCP commands, keeps lease capabilities in memory, saves redacted results and exact JPEGs, polls movement when asked, and records the spectator UI. It contains no mission planner or route. In this run, the fresh Codex subagent supplied the decisions. It is not a standalone model runner or a one-click autonomous UI mode. No additional model key was required for this Codex session.

This demonstrates real agent control, body switching, rendered observations and verified cargo handling. Reliable whole-warehouse coverage remains future work. Manufact hosting and ChatGPT OAuth remain pending. [Run this with your own MCP agent](../../agent-missions.md).
`,
);
console.log(
  `Saved agent report: ${toolEvents.length} MCP calls, ${observed.size} viewed images, ${inspected.length}/${snapshot.objects.length} inspected crates, ${movieKb} KB video.`,
);
