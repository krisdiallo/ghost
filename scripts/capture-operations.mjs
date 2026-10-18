import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../apps/server/dist/http.js";
import { publicResult } from "./lib/agent-evidence.mjs";
const out = resolve(
  process.env.GHOST_OPERATIONS_CAPTURE_DIR ?? "work/captures/operations",
);
await mkdir(out, { recursive: true });
const w = await startWarehouse(0),
  url = "http://127.0.0.1:" + w.server.address().port;
const client = new Client({
  name: "Operator handoff regression",
  version: "1",
});
let browser, page, cdp;
const events = [],
  errors = [],
  frames = [],
  writes = [];
async function call(name, input = {}) {
  const r = await client.callTool({ name, arguments: input });
  events.push({ tool: name, ...publicResult(r) });
  const img = r.content.find((c) => c.type === "image");
  if (img)
    await writeFile(
      join(out, "operator-sensor.jpg"),
      Buffer.from(img.data, "base64"),
    );
  assert.ok(!r.isError, JSON.stringify(publicResult(r)));
  return r.structuredContent;
}
async function wait(fn, timeout = 25000) {
  const end = Date.now() + timeout;
  while (!(await fn())) {
    assert.ok(Date.now() < end, "Expected operation completed before deadline");
    await new Promise((r) => setTimeout(r, 150));
  }
}
async function shot(name) {
  await page.screenshot({ path: join(out, name + ".jpg"), quality: 80 });
}
try {
  let executablePath = process.env.GHOST_BROWSER_PATH;
  try {
    await access("/usr/bin/chromium");
    executablePath ??= "/usr/bin/chromium";
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
  const context = await browser.newContext({
    viewport: { width: 1512, height: 1100 },
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  assert.equal((await client.listTools()).tools.length, 17);
  await page.goto(url);
  await page.getByText("Systems live", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Start operations", exact: true })
    .click();
  await page.waitForTimeout(2200);
  await shot("working-warehouse");
  assert.ok(
    w.sim.snapshot().bodies.filter((b) => b.action?.status === "running")
      .length >= 2,
    "Rover and drone actually move",
  );
  await page
    .getByRole("button", { name: "Enter immersive view", exact: true })
    .click();
  cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", (e) => {
    const path = join(
      out,
      "frame-" + String(frames.length).padStart(5, "0") + ".jpg",
    );
    frames.push({ path, at: e.metadata.timestamp });
    writes.push(writeFile(path, Buffer.from(e.data, "base64")));
    void cdp
      .send("Page.screencastFrameAck", { sessionId: e.sessionId })
      .catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    maxWidth: 1080,
    maxHeight: 786,
    everyNthFrame: 6,
  });
  await page
    .locator(".scene .fleet-ops")
    .getByRole("button", { name: "Drop box ahead of Scout", exact: true })
    .click();
  await wait(() => w.operations.state().incidents.some((i) => !i.resolvedAt));
  const incident = w.operations.state().incidents.find((i) => !i.resolvedAt);
  assert.equal(incident.resourceId, "rover-01");
  assert.equal(incident.code, "PATH_BLOCKED");
  const halted = [
    ...w.sim.snapshot().bodies.find((b) => b.id === "rover-01").position,
  ];
  await page.waitForTimeout(750);
  assert.deepEqual(
    w.sim.snapshot().bodies.find((b) => b.id === "rover-01").position,
    halted,
  );
  await shot("incident-raised");
  // This is a scripted rehearsal of operator tool calls, not an independent ChatGPT run.
  const lease = await call("possess", {
    resourceId: incident.resourceId,
    owner: "ChatGPT · operator",
    ttlSeconds: 120,
  });
  const observed = await call("observe", {
    leaseId: lease.leaseId,
    image: true,
  });
  assert.ok(observed.frame);
  await page.waitForTimeout(500);
  await shot("operator-possessed");
  await call("operations", {
    action: "recover_box",
    incidentId: incident.id,
    leaseId: lease.leaseId,
  });
  await page
    .locator(".scene .fleet-ops")
    .getByRole("button", { name: "Follow recovery vehicle", exact: true })
    .click();
  await wait(() => w.operations.state().recovery?.phase === "loading", 70000);
  await page.waitForTimeout(1700);
  await shot("mule-loading");
  await wait(() => w.operations.state().recovery?.phase === "transporting");
  await page.waitForTimeout(1300);
  await shot("mule-carrying");
  await wait(() => w.operations.state().recovery?.phase === "parked", 70000);
  await page.waitForTimeout(500);
  await shot("box-staged");
  assert.equal(w.operations.state().obstructions[0].id, incident.obstacleId);
  const stagedCenter = w.operations
    .state()
    .obstructions[0].min.map(
      (v, i) => (v + w.operations.state().obstructions[0].max[i]) / 2,
    );
  assert.ok(
    stagedCenter.every(
      (v, i) =>
        Math.abs(v - w.operations.state().recovery.destination[i]) < 1e-6,
    ),
  );
  console.log(
    "Recorded Mule approaching, loading, transporting and staging the same box.",
  );
  await page
    .locator(".scene .fleet-ops")
    .getByRole("button", { name: "Focus affected device", exact: true })
    .click();
  const target = [-10, halted[1], Math.max(-18, halted[2] - 2)];
  await call("act", {
    leaseId: lease.leaseId,
    command: { type: "move", x: target[0], z: target[2] },
  });
  await wait(
    () =>
      w.sim.snapshot().bodies.find((b) => b.id === "rover-01").action.status ===
      "completed",
  );
  await call("operations", {
    action: "resume",
    incidentId: incident.id,
    leaseId: lease.leaseId,
  });
  await wait(() =>
    w.sim
      .snapshot()
      .bodies.find((b) => b.id === "rover-01")
      .lease?.owner.startsWith("Local autonomy"),
  );
  assert.ok(w.operations.state().incidents[0].resolvedAt);
  assert.equal(w.operations.state().obstructions.length, 1);
  await page.waitForTimeout(900);
  await shot("operations-restored");
  await wait(() =>
    w.sim
      .snapshot()
      .objects.find((o) => o.id === "crate-12")
      .inspectedBy.includes("rover-01"),
  );
  // Continue the same session into a controlled workflow experiment.
  await page
    .getByRole("button", { name: "Exit immersive view", exact: true })
    .click();
  await page.locator(".topbar .lab-nav-link").click();
  await page.getByText("Lab connected", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Run aisle fit comparison/ }).click();
  await wait(() => {
    const runs = w.lab.list().runs;
    return runs.length === 2 && runs.every((r) => r.status !== "running");
  });
  await page
    .getByRole("button", { name: "Compare selected (2)", exact: true })
    .click();
  await page.getByRole("region", { name: "Experiment comparison" }).waitFor();
  await shot("sandbox-comparison");
  const runs = w.lab.list().runs;
  assert.ok(
    runs.some((r) => r.status === "failed") &&
      runs.some((r) => r.status === "completed"),
  );
  assert.equal(w.lab.compare(runs.map((r) => r.id)).comparable, true);
  assert.equal(w.operations.state().obstructions.length, 1);
  assert.ok(w.operations.state().running);
  assert.deepEqual(errors, []);
  await cdp.send("Page.stopScreencast");
  await Promise.all(writes);
  const manifest = join(out, "frames.txt");
  await writeFile(
    manifest,
    frames
      .map(
        (f, i) =>
          "file '" +
          f.path +
          "'\nduration " +
          (i + 1 < frames.length ? Math.max(0.04, frames[i + 1].at - f.at) : 1),
      )
      .join("\n") + "\n",
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
    manifest,
    "-vf",
    "scale=960:-2,setpts=PTS/2",
    "-r",
    "15",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "29",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(out, "incident-to-experiment-2x.mp4"),
  ]);
  await context.close();
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page = await phone.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("Systems live", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        (visualViewport?.width ?? innerWidth) + 1,
    ),
  );
  await shot("working-mobile");
  const proof = {
    driver:
      "Scripted real browser + official MCP SDK rehearsal; not a recorded ChatGPT conversation",
    ongoingJobs: true,
    sweptStopBeforeBox: true,
    incidentRaised: true,
    operatorPossession: true,
    actualSensorImage: true,
    operatorClearance: true,
    physicalRecoveryVehicle: true,
    sameBoxPersistedInStaging: true,
    manualMotionVerification: true,
    autonomyResumed: true,
    subsequentCargoInspection: true,
    isolatedExperimentComparison: true,
    phoneNoOverflow: true,
    browserErrors: errors,
    incident: w.operations.state().incidents[0],
    events,
  };
  assert.ok(!JSON.stringify(proof).includes('"leaseId"'));
  await writeFile(
    join(out, "verification.json"),
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(
    "Passed: working fleet → floor obstruction → incident → real MCP operator recovery → autonomy resumes → isolated experiment comparison; phone fits.",
  );
} catch (e) {
  try {
    await shot("failure");
    await writeFile(
      join(out, "failure.txt"),
      await page.locator("body").innerText(),
    );
  } catch {}
  throw e;
} finally {
  await Promise.allSettled([client.close(), browser?.close(), w.close()]);
}
