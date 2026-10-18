// Scripted regression evidence, explicitly separate from a fresh-agent mission.
import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../apps/server/dist/http.js";
import { publicResult, privateArguments } from "./lib/agent-evidence.mjs";
const output = resolve(
  process.env.GHOST_NAV_CAPTURE_DIR ?? "work/captures/navigation",
);
await mkdir(output, { recursive: true });
const warehouse = await startWarehouse(0),
  url = `http://127.0.0.1:${warehouse.server.address().port}`;
const client = new Client({
    name: "Scripted navigation regression",
    version: "1",
  }),
  leases = new Map(),
  events = [],
  errors = [];
let browser, context, page, recorder;
const frames = [],
  writes = [];
const call = async (tool, args, note = "") => {
  const result = await client.callTool({
    name: tool,
    arguments: privateArguments(tool, args, leases),
  });
  if (tool === "possess" && !result.isError)
    leases.set(args.resourceId, result.structuredContent.leaseId);
  const publicData = publicResult(result);
  events.push({ tool, input: args, note, ...publicData });
  return publicData;
};
const ok = async (tool, args, note) => {
  const result = await call(tool, args, note);
  assert.equal(result.isError, false, JSON.stringify(result));
  return result.result;
};
const act = (resourceId, command) =>
  ok("act", { leaseRef: resourceId, command });
const wait = async (resourceId) => {
  const deadline = Date.now() + 30000;
  while (
    (await ok("observe", { leaseRef: resourceId })).body.action?.status ===
    "running"
  ) {
    assert.ok(Date.now() < deadline, "motion settles");
    await new Promise((r) => setTimeout(r, 120));
  }
};
const image = async (resourceId, name) => {
  const result = await client.callTool({
    name: "observe",
    arguments: privateArguments(
      "observe",
      { leaseRef: resourceId, image: true },
      leases,
    ),
  });
  assert.ok(!result.isError, JSON.stringify(publicResult(result)));
  const jpeg = result.content.find((c) => c.type === "image");
  assert.ok(jpeg);
  const data = Buffer.from(jpeg.data, "base64");
  await writeFile(join(output, name), data);
  events.push({
    tool: "observe",
    input: { leaseRef: resourceId, image: true },
    ...publicResult(result),
    image: {
      path: name,
      sha256: createHash("sha256").update(data).digest("hex"),
    },
  });
  return {
    result: result.structuredContent,
    hash: createHash("sha256").update(data).digest("hex"),
  };
};
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  let executablePath = process.env.GHOST_BROWSER_PATH;
  if (!executablePath)
    try {
      await access("/usr/bin/chromium");
      executablePath = "/usr/bin/chromium";
    } catch {}
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("Systems live", { exact: true }).waitFor();
  recorder = await context.newCDPSession(page);
  recorder.on("Page.screencastFrame", (event) => {
    const path = join(
      output,
      `video-frame-${String(frames.length).padStart(5, "0")}.jpg`,
    );
    frames.push({ path, at: event.metadata.timestamp });
    writes.push(writeFile(path, Buffer.from(event.data, "base64")));
    void recorder
      .send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(() => {});
  });
  await recorder.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    maxWidth: 960,
    maxHeight: 734,
    everyNthFrame: 8,
  });
  const discovery = await ok("discover", {});
  assert.ok(discovery.navigation.obstacles.length > 0);
  assert.equal(discovery.survey.coverageModel, "visible-floor-checkpoints");
  await ok("possess", {
    resourceId: "rover-01",
    ttlSeconds: 120,
    owner: "Scripted navigation check",
  });
  const rejected = await call(
    "act",
    { leaseRef: "rover-01", command: { type: "move", x: -6, z: -30 } },
    "Expected rejection: direct route crosses a rack.",
  );
  assert.equal(rejected.isError, true);
  assert.equal(rejected.result.code, "PATH_BLOCKED");
  const rover = await image("rover-01", "rover-blocked-sensor.jpg");
  assert.deepEqual(rover.result.body.position, [-6, 0.45, 3]);
  assert.ok(rover.result.body.lastBlocked);
  await page.locator(".map-route-error").waitFor();
  await page.screenshot({
    path: join(output, "route-blocked.jpg"),
    quality: 80,
  });
  await page
    .locator(".warehouse-map")
    .screenshot({ path: join(output, "blocked-map.jpg"), quality: 85 });
  await ok("release", { leaseRef: "rover-01" });
  leases.delete("rover-01");
  // The high-mounted camera must not detect or inspect through a packed rack.
  const fixed = await ok("possess", {
    resourceId: "camera-01",
    ttlSeconds: 120,
    owner: "Scripted occlusion check",
  });
  const [cx, cy, cz] = fixed.resource.position;
  const dx = -8.4 - cx,
    dy = 0.55 - cy,
    dz = -18 - cz;
  await act("camera-01", {
    type: "look",
    pan: (Math.atan2(dx, dz) * 180) / Math.PI,
    tilt: (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI,
  });
  const occluded = await ok("observe", { leaseRef: "camera-01" });
  assert.equal(occluded.limits.telemetryOcclusion, true);
  assert.ok(!occluded.objects.some((o) => o.id === "crate-12"));
  const hiddenInspection = await call(
    "act",
    {
      leaseRef: "camera-01",
      command: { type: "inspect", objectId: "crate-12" },
    },
    "Expected rejection: packed rack blocks camera sightline.",
  );
  assert.equal(hiddenInspection.isError, true);
  assert.equal(hiddenInspection.result.code, "OUT_OF_REACH");
  await ok("release", { leaseRef: "camera-01" });
  leases.delete("camera-01");
  await page
    .locator(".fleet-list button")
    .filter({ hasText: "Wisp" })
    .first()
    .click();
  await page.getByRole("button", { name: "Body camera", exact: true }).click();
  await ok("possess", {
    resourceId: "drone-01",
    ttlSeconds: 300,
    owner: "Scripted navigation check",
  });
  const takeoff = await act("drone-01", { type: "takeoff" });
  await act("drone-01", { type: "look", pan: 0, tilt: -90 });
  const inflight = await ok("observe", { leaseRef: "drone-01" });
  assert.equal(inflight.body.action.id, takeoff.action.id);
  assert.equal(inflight.body.action.status, "running");
  await wait("drone-01");
  await act("drone-01", { type: "move", x: -4, y: 9, z: -3 });
  await wait("drone-01");
  const down = await image("drone-01", "drone-down.jpg");
  await act("drone-01", { type: "look", pan: -90, tilt: -12 });
  const side = await image("drone-01", "drone-side.jpg");
  assert.deepEqual(down.result.body.position, side.result.body.position);
  assert.equal(down.result.body.heading, side.result.body.heading);
  assert.notEqual(down.hash, side.hash);
  await page.screenshot({
    path: join(output, "gimbal-in-warehouse.jpg"),
    quality: 80,
  });
  await act("drone-01", { type: "move", x: 5, y: 9, z: -16 });
  await wait("drone-01");
  const blockedLanding = await call(
    "act",
    { leaseRef: "drone-01", command: { type: "land" } },
    "Expected rejection: rack beneath the aircraft.",
  );
  assert.equal(blockedLanding.isError, true);
  assert.equal(blockedLanding.result.code, "PATH_BLOCKED");
  const airborne = await ok("observe", { leaseRef: "drone-01" });
  assert.equal(airborne.body.airborne, true);
  await act("drone-01", { type: "move", x: -4, y: 9, z: -3 });
  await wait("drone-01");
  await act("drone-01", { type: "land" });
  await wait("drone-01");
  await ok("release", { leaseRef: "drone-01" });
  leases.delete("drone-01");
  await recorder.send("Page.stopScreencast");
  await Promise.all(writes);
  await context.close();
  assert.ok(frames.length > 1);
  const recording = join(output, "video-frames.txt");
  await writeFile(
    recording,
    frames
      .map(
        (frame, i) =>
          `file '${frame.path}'\nduration ${i + 1 < frames.length ? Math.max(0.04, frames[i + 1].at - frame.at) : 1}`,
      )
      .join("\n") + `\nfile '${frames.at(-1).path}'\n`,
  );
  await promisify(execFile)("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    recording,
    "-vf",
    "scale=768:-2,setpts=PTS/4",
    "-r",
    "15",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "30",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(output, "navigation-check-4x.mp4"),
  ]);
  // Own a body through actual phone controls; one UI page at a time avoids background capture stalls.
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.bringToFront();
  await page.goto(url);
  await page
    .locator(".fleet-list button")
    .filter({ hasText: "Wisp" })
    .first()
    .click();
  await page.getByRole("button", { name: "Possess body", exact: true }).click();
  await page.getByRole("button", { name: /Take off$/ }).click();
  const downButton = page.getByRole("button", {
    name: "Look down",
    exact: true,
  });
  await downButton.click();
  assert.equal(
    warehouse.sim.snapshot().bodies.find((b) => b.kind === "drone").tilt,
    -90,
  );
  await page
    .locator(".gimbal-controls")
    .screenshot({ path: join(output, "mobile-gimbal.jpg"), quality: 85 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  await page.getByRole("button", { name: /Land$/ }).waitFor();
  // Wait for takeoff completion before the UI's serialized land command.
  const land = page.getByRole("button", { name: /Land$/ });
  await land.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector(".body-controls")?.disabled,
  );
  await land.click();
  await page.waitForFunction(
    () => !document.querySelector(".body-controls")?.disabled,
  );
  await page.getByRole("button", { name: "Release body", exact: true }).click();
  assert.ok(warehouse.sim.snapshot().bodies.every((b) => !b.lease));
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(
      {
        driver: "Scripted regression; not an independent agent mission",
        roverPathBlocked: true,
        cameraOcclusion: true,
        blockedLanding: true,
        gimbalDuringFlight: true,
        poseUnchangedBetweenAims: true,
        downImageSha256: down.hash,
        sideImageSha256: side.hash,
        phoneGimbalControls: true,
        browserErrors: errors,
        allLeasesReleased: true,
        events,
      },
      null,
      2,
    ),
  );
  console.log(
    "Navigation passed: swept-path rejection, blocked landing, in-flight gimbal, distinct actual JPEGs and phone controls.",
  );
} finally {
  for (const [resourceId] of leases)
    try {
      await call("release", { leaseRef: resourceId });
    } catch {}
  await Promise.allSettled([
    client.close(),
    browser?.close(),
    warehouse.close(),
  ]);
}
