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
  async function difference(first, second) {
    return page.evaluate(
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
  const sceneBounds = await page.locator(".scene").boundingBox();
  await page.getByRole("button", { name: "Run guided demo" }).click();
  const start = Date.now();
  const frames = [];
  const milestones = new Set();
  while (Date.now() - start < 40000) {
    const at = Date.now();
    const path = join(
      scratch,
      `frame-${String(frames.length).padStart(5, "0")}.png`,
    );
    await page.screenshot({ path });
    frames.push({ path, at });
    const state = authority.sim.snapshot();
    const drone = state.bodies.find((body) => body.kind === "drone");
    const arm = state.bodies.find((body) => body.kind === "arm");
    const candidates = [
      [
        "ghost-camera.png",
        state.mission[0].complete && !state.mission[1].complete,
      ],
      [
        "ghost-rover.png",
        state.mission[1].complete && !state.mission[2].complete,
      ],
      ["ghost-drone.png", drone.airborne && drone.position[1] > 1],
      ["ghost-arm.png", arm.lease?.owner === "Ghost · guided demo"],
    ];
    for (const [name, condition] of candidates)
      if (condition && !milestones.has(name)) {
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
  const final = authority.sim.snapshot();
  assert.ok(
    final.mission.every((step) => step.complete),
    "mission completed before timeout",
  );
  assert.equal(milestones.size, 4, "captured each body in the actual mission");
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
  const crop = `crop=${Math.floor(sceneBounds.width)}:${Math.floor(sceneBounds.height)}:${Math.floor(sceneBounds.x)}:${Math.floor(sceneBounds.y)},fps=6,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer`;
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
  await phone.getByRole("button", { name: "Possess body", exact: true }).tap();
  await phone.getByText("YOU ARE IN CONTROL", { exact: true }).waitFor();
  await phone.locator(".inspector").scrollIntoViewIfNeeded();
  await screenshot(phone, "ghost-mobile-controls.png");
  await phone.getByRole("button", { name: /Move to point/ }).tap();
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
    cameraReset: { orbitDifference, resetDifference },
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
