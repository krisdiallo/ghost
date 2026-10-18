import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  writeFile,
  access,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { WAREHOUSE } from "@ghost/shared";
import { chromium } from "playwright";
import { startWarehouse } from "../apps/server/dist/http.js";

const output = resolve(process.env.GHOST_CAPTURE_DIR ?? "work/captures");
await mkdir(output, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), "ghost-capture-"));
const authority = await startWarehouse(0);
const url = `http://127.0.0.1:${authority.server.address().port}`;
let executablePath = process.env.GHOST_BROWSER_PATH;
if (!executablePath) {
  try {
    await access("/usr/bin/chromium");
    executablePath = "/usr/bin/chromium";
  } catch {
    /* CI uses Playwright's installed Chromium. */
  }
}
let browser;
try {
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
} catch (error) {
  await authority.close();
  throw error;
}
const errors = [];
const captures = [];
function monitor(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready(page) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText("Systems live", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    return canvas && canvas.width > 100 && canvas.height > 100;
  });
  await page.evaluate(() => document.fonts.ready);
  await wait(1000);
  if (await page.locator(".scene-fallback").isVisible()) {
    await page.screenshot({
      path: join(output, "capture-failure.png"),
      fullPage: true,
    });
    throw new Error("Warehouse render failed: " + JSON.stringify(errors));
  }
}
async function screenshot(page, name, options = {}) {
  await page.screenshot({ path: join(output, name), ...options });
  captures.push(name);
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-6000);
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed: ${stderr}`)),
    );
  });
}
try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1280 },
    deviceScaleFactor: 1,
  });
  const page = await desktop.newPage();
  monitor(page);
  await ready(page);
  await screenshot(page, "ghost-warehouse.png", { fullPage: true });
  await page.locator(".scene").screenshot({
    path: join(output, "ghost-overview-small.jpg"),
    type: "jpeg",
    quality: 52,
  });
  captures.push("ghost-overview-small.jpg");
  await page.getByRole("button", { name: "Mission view", exact: true }).click();
  await wait(1000);
  await screenshot(page, "ghost-mission-bay.png", { fullPage: true });
  await page
    .getByRole("button", { name: "Reset warehouse view", exact: true })
    .click();
  await wait(1000);
  // Verify reset after manual orbit while already in facility mode. Comparing
  // small rendered images tolerates the rotor animation, but catches a no-op camera reset.
  await wait(700);
  const baseline = await page
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  const orbitArea = await page.locator(".scene").boundingBox();
  await page.mouse.move(
    orbitArea.x + orbitArea.width * 0.55,
    orbitArea.y + orbitArea.height * 0.55,
  );
  await page.mouse.down();
  await page.mouse.move(
    orbitArea.x + orbitArea.width * 0.55 + 120,
    orbitArea.y + orbitArea.height * 0.55 + 40,
    { steps: 12 },
  );
  await page.mouse.up();
  await wait(450);
  const orbited = await page
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  await page
    .getByRole("button", { name: "Reset warehouse view", exact: true })
    .click();
  await wait(1500);
  const restored = await page
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  async function difference(first, second, evaluator = page) {
    return evaluator.evaluate(
      async ([a, b]) => {
        async function pixels(source) {
          const image = new Image();
          image.src = "data:image/jpeg;base64," + source;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, 64, 64);
          return context.getImageData(0, 0, 64, 64).data;
        }
        const [x, y] = await Promise.all([pixels(a), pixels(b)]);
        let total = 0;
        for (let i = 0; i < x.length; i++)
          if (i % 4 !== 3) total += Math.abs(x[i] - y[i]);
        return total / (64 * 64 * 3 * 255);
      },
      [first.toString("base64"), second.toString("base64")],
    );
  }
  await Promise.all([
    writeFile(join(output, "camera-baseline.jpg"), baseline),
    writeFile(join(output, "camera-orbited.jpg"), orbited),
    writeFile(join(output, "camera-restored.jpg"), restored),
  ]);
  const orbitDifference = await difference(baseline, orbited);
  const resetDifference = await difference(baseline, restored);
  console.log("Camera preset verification:", {
    orbitDifference,
    resetDifference,
  });
  assert.ok(
    orbitDifference > 0.02,
    "manual orbit changes the rendered facility view",
  );
  assert.ok(
    resetDifference < 0.025,
    `reset restores the overview after orbit (difference ${resetDifference})`,
  );
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await wait(1500);
  const zoomed = await page
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  const zoomDifference = await difference(restored, zoomed);
  assert.ok(
    zoomDifference > 0.02,
    "zoom button changes the rendered camera distance",
  );
  await page.getByRole("button", { name: "Pan camera", exact: true }).click();
  await page.mouse.move(
    orbitArea.x + orbitArea.width * 0.55,
    orbitArea.y + orbitArea.height * 0.45,
  );
  await page.mouse.down();
  await page.mouse.move(
    orbitArea.x + orbitArea.width * 0.55 + 110,
    orbitArea.y + orbitArea.height * 0.45 + 50,
    { steps: 12 },
  );
  await page.mouse.up();
  await wait(700);
  const panned = await page
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  const panDifference = await difference(zoomed, panned);
  assert.ok(panDifference > 0.02, "pan tool translates the rendered view");
  await page.getByRole("button", { name: "Orbit camera", exact: true }).click();
  await page
    .getByRole("button", { name: "Reset warehouse view", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enter immersive view", exact: true })
    .click();
  await wait(1000);
  const immersiveBounds = await page.locator(".viewport").boundingBox();
  assert.equal(immersiveBounds.width, 1440, "immersive view fills the window");
  assert.equal(immersiveBounds.height, 1280);
  await screenshot(page, "ghost-immersive.png");
  const sceneBounds = await page.locator(".scene").boundingBox();
  await page
    .getByRole("button", { name: "Select Sentinel", exact: true })
    .click();
  await wait(1200);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await wait(1200);
  await screenshot(page, "ghost-camera-mount.png");
  const cameraMount = authority.sim
    .snapshot()
    .bodies.find((body) => body.kind === "camera");
  assert.deepEqual(
    cameraMount.position,
    [-30.2, 10, 8],
    "camera is fixed high in the southwest corner",
  );
  await page
    .getByRole("button", { name: "Reset warehouse view", exact: true })
    .click();
  await wait(1000);
  const travel = { roverFarthestZ: 3, droneFarthestZ: -3, droneMaxY: 0.4 };
  // Observe authority travel independently of expensive software-GL screenshots.
  const watchTravel = authority.sim.subscribe(() => {
    const state = authority.sim.snapshot();
    const rover = state.bodies.find((body) => body.kind === "rover");
    const drone = state.bodies.find((body) => body.kind === "drone");
    travel.roverFarthestZ = Math.min(travel.roverFarthestZ, rover.position[2]);
    travel.droneFarthestZ = Math.min(travel.droneFarthestZ, drone.position[2]);
    travel.droneMaxY = Math.max(travel.droneMaxY, drone.position[1]);
  });
  await page.getByRole("button", { name: "Run tour", exact: true }).click();
  const start = Date.now();
  const frames = [];
  const milestones = new Set();
  while (Date.now() - start < 150000) {
    const at = Date.now();
    const before = authority.sim.snapshot();
    const path = join(
      scratch,
      `frame-${String(frames.length).padStart(5, "0")}.png`,
    );
    await page.screenshot({ path });
    frames.push({ path, at });
    const state = authority.sim.snapshot();
    const rover = state.bodies.find((body) => body.kind === "rover");
    const drone = state.bodies.find((body) => body.kind === "drone");
    const arm = state.bodies.find((body) => body.kind === "arm");
    const beforeRover = before.bodies.find((body) => body.kind === "rover");
    const beforeDrone = before.bodies.find((body) => body.kind === "drone");
    const beforeArm = before.bodies.find((body) => body.kind === "arm");
    travel.roverFarthestZ = Math.min(travel.roverFarthestZ, rover.position[2]);
    travel.droneFarthestZ = Math.min(travel.droneFarthestZ, drone.position[2]);
    travel.droneMaxY = Math.max(travel.droneMaxY, drone.position[1]);
    const candidates = [
      [
        "ghost-rover-aisle.png",
        rover.position[2] < -16 && beforeRover.position[2] < -16,
      ],
      [
        "ghost-drone-docks.png",
        drone.position[2] < -28 && beforeDrone.position[2] < -28,
      ],
      [
        "ghost-camera.png",
        state.bodies.find((b) => b.kind === "camera").lease?.owner ===
          "Ghost · guided demo" &&
          before.bodies.find((b) => b.kind === "camera").lease?.owner ===
            "Ghost · guided demo",
      ],
      [
        "ghost-rover.png",
        rover.lease?.owner === "Ghost · guided demo" &&
          beforeRover.lease?.owner === "Ghost · guided demo",
      ],
      [
        "ghost-drone.png",
        drone.airborne &&
          drone.position[1] > 1 &&
          beforeDrone.airborne &&
          beforeDrone.position[1] > 1,
      ],
      [
        "ghost-arm.png",
        arm.lease?.owner === "Ghost · guided demo" &&
          beforeArm.lease?.owner === "Ghost · guided demo",
      ],
    ];
    for (const [name, condition] of candidates)
      if (
        condition &&
        !milestones.has(name) &&
        process.env.GHOST_CAPTURE_REPLAY_STILLS !== "1"
      ) {
        await copyFile(path, join(output, name));
        captures.push(name);
        milestones.add(name);
      }
    if (!state.demo.running) {
      assert.equal(state.demo.error, null, "guided mission has no errors");
      assert.ok(
        state.mission.every((step) => step.complete),
        "all four mission steps complete",
      );
      assert.ok(
        state.bodies.every((body) => !body.lease),
        "all guided leases are released",
      );
      await wait(500);
      await screenshot(page, "ghost-mission-complete.png", { fullPage: true });
      break;
    }
    await wait(Math.max(0, 125 - (Date.now() - at)));
  }
  watchTravel();
  const final = authority.sim.snapshot();
  assert.ok(
    final.mission.every((step) => step.complete),
    "mission completed before timeout",
  );
  assert.ok(
    travel.roverFarthestZ <= -17,
    "rover actually visits the storage aisle",
  );
  assert.ok(
    travel.droneFarthestZ <= -29 && travel.droneMaxY >= 8.9,
    "drone surveys loading docks above the racks",
  );
  // Brief tour moments can fall between frames on a slow renderer. Replay only
  // missing stills through the real HTTP tools, holding the actual body pose
  // until capture finishes. The video above remains the original live tour.
  const replayedCaptures = [];
  if (milestones.size < 6) {
    const post = async (path, input = {}) => {
      const response = await fetch(url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      assert.ok(response.ok, "checkpoint replay uses successful HTTP commands");
      return response.json();
    };
    const tool = (name, input) => post(`/api/tools/${name}`, input);
    const missing = (name) => !milestones.has(name);
    const record = async (name) => {
      if (!missing(name)) return;
      await wait(1200);
      await screenshot(page, name);
      milestones.add(name);
      replayedCaptures.push(name);
    };
    const withBody = async (kind, title, run) => {
      const { leaseId } = await tool("possess", {
        resourceId: `${kind}-01`,
        owner: "Visual checkpoint replay",
        ttlSeconds: 120,
      });
      const act = async (command) => {
        const result = await tool("act", { leaseId, command });
        const deadline = Date.now() + 30000;
        while (result.action.status === "running") {
          const observation = await tool("observe", { leaseId });
          if (observation.body.action.status === "completed") break;
          assert.ok(
            Date.now() < deadline,
            "checkpoint motion completes on the server clock",
          );
          await wait(100);
        }
      };
      try {
        await page
          .getByRole("button", { name: `Select ${title}`, exact: true })
          .click();
        await run(act);
      } finally {
        await tool("release", { leaseId });
      }
    };
    await post("/api/reset");
    if (missing("ghost-camera.png"))
      await withBody("camera", "Sentinel", async (act) => {
        await act({ type: "inspect", objectId: "crate-07" });
        await record("ghost-camera.png");
      });
    if (missing("ghost-rover.png") || missing("ghost-rover-aisle.png"))
      await withBody("rover", "Scout", async (act) => {
        await record("ghost-rover.png");
        if (missing("ghost-rover-aisle.png")) {
          await act({ type: "move", x: -10, z: 3 });
          await act({ type: "move", x: -10, z: -18 });
          await record("ghost-rover-aisle.png");
        }
      });
    if (missing("ghost-drone.png") || missing("ghost-drone-docks.png"))
      await withBody("drone", "Wisp", async (act) => {
        await act({ type: "takeoff" });
        await act({ type: "move", x: -4, y: 9, z: -3 });
        await record("ghost-drone.png");
        if (missing("ghost-drone-docks.png")) {
          await act({ type: "move", x: 10, y: 9, z: -30 });
          await record("ghost-drone-docks.png");
        }
      });
    if (missing("ghost-arm.png"))
      await withBody("arm", "Atlas", async (act) => {
        await act({ type: "preset", preset: "reach" });
        await act({ type: "grasp", objectId: "crate-07" });
        await act({ type: "preset", preset: "drop" });
        await record("ghost-arm.png");
      });
  }
  assert.equal(
    milestones.size,
    6,
    "captured actual body, storage aisle and dock states",
  );
  await page
    .getByRole("button", { name: "Exit immersive view", exact: true })
    .click();
  const concat =
    frames
      .map(
        (frame, i) =>
          `file '${frame.path}'\nduration ${i + 1 < frames.length ? (frames[i + 1].at - frame.at) / 1000 : 1}`,
      )
      .join("\n") + `\nfile '${frames.at(-1).path}'\n`;
  const list = join(scratch, "frames.txt");
  await writeFile(list, concat);
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    "scale=1280:-2",
    "-r",
    "24",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(output, "ghost-demo.mp4"),
  ]);
  captures.push("ghost-demo.mp4");
  const crop = `crop=${Math.floor(sceneBounds.width)}:${Math.floor(sceneBounds.height)}:${Math.floor(sceneBounds.x)}:${Math.floor(sceneBounds.y)},fps=3,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer`;
  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-filter_complex",
    crop,
    "-loop",
    "0",
    join(output, "ghost-demo.gif"),
  ]);
  captures.push("ghost-demo.gif");
  await desktop.close();

  // Exercise the touch layout through real browser controls, including a manual rover inspection.
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1.5,
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  monitor(phone);
  await ready(phone);
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile layout has no horizontal overflow",
  );
  await screenshot(phone, "ghost-mobile.png", { fullPage: true });
  await phone
    .getByRole("button", { name: "Reset warehouse", exact: true })
    .tap();
  await phone
    .getByRole("dialog")
    .getByRole("button", { name: "Reset warehouse", exact: true })
    .tap();
  await phone.locator(".body-card").filter({ hasText: "Scout" }).tap();
  await phone.getByLabel("Lease duration").selectOption("120");
  await phone.getByRole("button", { name: "Possess body", exact: true }).tap();
  await phone.getByText("YOU ARE IN CONTROL", { exact: true }).waitFor();
  await phone.locator(".inspector").scrollIntoViewIfNeeded();
  await screenshot(phone, "ghost-mobile-controls.png");
  await phone
    .getByRole("button", { name: "Enter immersive view", exact: true })
    .tap();
  await phone.getByRole("button", { name: "Zoom in", exact: true }).tap();
  await phone.getByRole("button", { name: "Pan camera", exact: true }).tap();
  await screenshot(phone, "ghost-mobile-immersive.png");
  const touchBefore = await phone
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  const phoneArea = await phone.locator(".scene").boundingBox();
  const touch = await mobile.newCDPSession(phone);
  const cx = phoneArea.x + phoneArea.width * 0.5,
    cy = phoneArea.y + phoneArea.height * 0.42;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - 35, y: cy },
      { x: cx + 35, y: cy },
    ],
  });
  for (let step = 1; step <= 6; step++)
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: cx - 35 - step * 3, y: cy + step * 4 },
        { x: cx + 35 + step * 6, y: cy + step * 4 },
      ],
    });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await wait(500);
  const touchAfter = await phone
    .locator(".scene")
    .screenshot({ type: "jpeg", quality: 65 });
  const touchDifference = await difference(touchBefore, touchAfter, phone);
  assert.ok(
    touchDifference > 0.015,
    "two-finger touch pan and pinch change the rendered mobile view",
  );
  await touch.detach();
  const mapBounds = await phone.locator(".warehouse-map svg").boundingBox();
  // Use the wide cross-aisle for touch input: a pixel can span more than the
  // rover's 5 cm side clearance in narrow storage gaps. Exact aisle waypoints
  // are exercised by the guided tour and server navigation tests.
  await phone.touchscreen.tap(
    mapBounds.x + mapBounds.width * (44 / 64),
    mapBounds.y + mapBounds.height * (37 / 44),
  );
  await phone.waitForFunction(() =>
    document.querySelector(".pilot-dock")?.textContent.includes("IN MOTION"),
  );
  const mapTarget = authority.sim
    .snapshot()
    .bodies.find((b) => b.kind === "rover").action.target;
  assert.ok(
    Math.abs(mapTarget[0] - 12) < 0.4 && Math.abs(mapTarget[2] - 3) < 0.4,
    "phone map sends the selected warehouse destination to the authority",
  );
  await phone.getByRole("button", { name: "Stop", exact: true }).tap();
  await phone
    .getByRole("button", { name: "Exit immersive view", exact: true })
    .tap();
  await phone
    .locator(".destination-grid")
    .getByRole("button", { name: /Inspection bay/ })
    .tap();
  await phone
    .getByRole("button", { name: /Scan priority cargo/ })
    .waitFor({ state: "visible" });
  await phone.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Scan priority cargo"))
        ?.matches(":disabled"),
  );
  await phone.getByRole("button", { name: /Scan priority cargo/ }).tap();
  await phone.getByRole("button", { name: "Observation", exact: false }).tap();
  await phone
    .locator(".observation-panel .inspection-result")
    .first()
    .waitFor();
  assert.match(
    await phone.locator(".observation-panel").innerText(),
    /Seal intact/,
  );
  await phone.locator(".inspector").scrollIntoViewIfNeeded();
  await screenshot(phone, "ghost-mobile-observation.png");
  await phone.getByRole("button", { name: "Control", exact: true }).tap();
  await phone.getByRole("button", { name: /Release body/ }).tap();
  assert.ok(authority.sim.snapshot().bodies.every((body) => !body.lease));
  assert.deepEqual(errors, [], "no browser runtime or console errors");
  const report = {
    capturedAt: new Date().toISOString(),
    facility: { ...WAREHOUSE, area: WAREHOUSE.width * WAREHOUSE.depth },
    viewport: { width: 1440, height: 1280 },
    mobile: { width: 390, height: 844 },
    mission: final.mission,
    durationSeconds: (frames.at(-1).at - start) / 1000,
    frameCount: frames.length,
    cameraMount: {
      position: cameraMount.position,
      pan: cameraMount.pan,
      tilt: cameraMount.tilt,
    },
    cameraReset: { orbitDifference, resetDifference },
    cameraTools: {
      panDifference,
      zoomDifference,
      touchDifference,
      immersive: true,
    },
    warehouseTravel: travel,
    replayedCaptures,
    manualRoverInspection: "Seal intact. Label verified. Cleared for dispatch.",
    browserErrors: errors,
    captures,
  };
  await writeFile(
    join(output, "capture-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await mobile.close();
  await desktop.close();
} finally {
  await browser.close();
  await authority.close();
  await rm(scratch, { recursive: true, force: true });
}
