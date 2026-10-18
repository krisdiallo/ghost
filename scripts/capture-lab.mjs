import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../apps/server/dist/http.js";
import { publicResult } from "./lib/agent-evidence.mjs";

const output = resolve(
  process.env.GHOST_LAB_CAPTURE_DIR ?? "work/captures/lab",
);
await mkdir(output, { recursive: true });
const w = await startWarehouse(0),
  url = "http://127.0.0.1:" + w.server.address().port;
const original = w.sim.snapshot();
const client = new Client({ name: "Experiment lab regression", version: "1" });
const events = [],
  errors = [],
  frames = [],
  writes = [];
let browser, context, page, recorder;
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const safe = publicResult(r);
  events.push({ tool: name, input: args, ...safe });
  assert.ok(!r.isError, JSON.stringify(safe));
  return r;
};
const value = async (name, args) => (await call(name, args)).structuredContent;
try {
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
    viewport: { width: 1512, height: 1100 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  assert.equal((await client.listTools()).tools.length, 17);
  await page.goto(url + "/#lab");
  await page.getByText("Lab connected", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "lab-empty.jpg"), quality: 80 });
  recorder = await context.newCDPSession(page);
  recorder.on("Page.screencastFrame", (e) => {
    const path = join(
      output,
      "frame-" + String(frames.length).padStart(5, "0") + ".jpg",
    );
    frames.push({ path, at: e.metadata.timestamp });
    writes.push(writeFile(path, Buffer.from(e.data, "base64")));
    void recorder
      .send("Page.screencastFrameAck", { sessionId: e.sessionId })
      .catch(() => {});
  });
  await recorder.send("Page.startScreencast", {
    format: "jpeg",
    quality: 55,
    maxWidth: 1080,
    maxHeight: 786,
    everyNthFrame: 8,
  });
  await page.getByRole("button", { name: /Run aisle fit comparison/ }).click();
  await page.waitForFunction(
    () => {
      const rows = [...document.querySelectorAll(".lab-run")];
      return (
        rows.length === 2 &&
        rows.some((r) => r.textContent.includes("Completed")) &&
        rows.some((r) => r.textContent.includes("Failed"))
      );
    },
    null,
    { timeout: 35000 },
  );
  await page
    .getByRole("button", { name: "Compare selected (2)", exact: true })
    .click();
  await page.getByRole("region", { name: "Experiment comparison" }).waitFor();
  assert.match(
    await page.locator(".lab-comparison").innerText(),
    /Same starting conditions/,
  );
  await page.locator(".lab-header").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "lab-comparison-desktop.jpg"),
    quality: 82,
  });
  await page
    .locator(".lab-comparison")
    .screenshot({ path: join(output, "comparison-table.jpg"), quality: 85 });
  const state = await value("sandbox_list", {});
  const standard = state.runs.find((r) => r.sandboxName === "Standard drone"),
    compact = state.runs.find((r) => r.sandboxName === "Compact drone");
  const a = await value("experiment_inspect", {
    runId: standard.id,
    includeSnapshot: true,
  });
  const b = await value("experiment_inspect", {
    runId: compact.id,
    includeSnapshot: true,
  });
  assert.equal(a.run.error.code, "PATH_BLOCKED");
  assert.equal(b.run.status, "completed");
  assert.deepEqual(b.run.metrics.inspectedCargo, ["crate-12"]);
  assert.ok(a.run.metrics.allLeasesReleased && b.run.metrics.safeEndState);
  assert.equal(a.run.scenarioHash, b.run.scenarioHash);
  assert.equal(a.run.workflowHash, b.run.workflowHash);
  const comparison = await value("experiment_compare", {
    runIds: [standard.id, compact.id],
  });
  assert.ok(comparison.comparable);
  assert.equal(comparison.delta, null);
  // Select the failed trial, retaining its original error and unchanged physical pose.
  await page
    .locator(".lab-run")
    .filter({ hasText: "Standard drone" })
    .locator("button")
    .click();
  await page.getByText("PATH_BLOCKED", { exact: true }).first().waitFor();
  await page.locator(".lab-header").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "lab-blocked-run.jpg"),
    quality: 82,
  });
  const imageResult = await call("experiment_inspect", {
    runId: compact.id,
    imageResourceId: "camera-01",
  });
  const jpeg = imageResult.content.find((c) => c.type === "image");
  assert.ok(jpeg);
  const bytes = Buffer.from(jpeg.data, "base64");
  await writeFile(join(output, "trial-camera.jpg"), bytes);
  assert.equal(imageResult.structuredContent.frame.width, 640);
  assert.ok(!JSON.stringify(imageResult.structuredContent).includes(jpeg.data));
  // The browser exposes the same image tool, with frozen revision metadata.
  await page
    .locator(".lab-fleet-strip button")
    .filter({ hasText: "Sentinel" })
    .click();
  await page
    .getByRole("button", { name: "Capture trial sensor frame", exact: true })
    .click();
  await page.locator(".lab-sensor-figure img").waitFor();
  await page
    .locator(".lab-sensor-figure")
    .screenshot({ path: join(output, "trial-sensor-ui.jpg"), quality: 85 });
  // Edit a draft after the runs. It must not rewrite their frozen inputs.
  await page.locator(".lab-draft").filter({ hasText: "Compact drone" }).click();
  await page.getByRole("tab", { name: "fleet", exact: true }).click();
  await page.getByLabel("Body type").selectOption("rover");
  await page
    .getByLabel("New device name", { exact: true })
    .fill("Backup rover");
  await page
    .getByRole("button", { name: "＋ Add device to draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("✓ Draft saved", { exact: false }).waitFor();
  await page
    .locator(".lab-inspector")
    .screenshot({ path: join(output, "device-editor.jpg"), quality: 80 });
  await page.getByRole("button", { name: "Focus device", exact: true }).click();
  await page.waitForTimeout(900);
  assert.equal(
    await page
      .getByRole("button", { name: "Focus device", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page
    .locator(".lab-center")
    .screenshot({ path: join(output, "device-focus.jpg"), quality: 82 });
  await page.getByRole("tab", { name: "layout", exact: true }).click();
  await page
    .getByRole("button", { name: "＋ Add temporary barrier", exact: true })
    .click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("✓ Draft saved", { exact: false }).waitFor();
  const edited = await value("sandbox_inspect", {
    sandboxId: compact.sandboxId,
  });
  assert.equal(edited.definition.devices.length, 6);
  assert.equal(edited.definition.obstacles.length, 48);
  const frozen = await value("experiment_inspect", { runId: compact.id });
  assert.equal(frozen.run.definition.devices.length, 5);
  assert.equal(frozen.run.definition.obstacles.length, 47);
  await page.getByRole("tab", { name: "workflow", exact: true }).click();
  await page
    .locator(".lab-inspector")
    .screenshot({ path: join(output, "workflow-editor.jpg"), quality: 80 });
  const download = page.waitForEvent("download");
  await page
    .locator(".lab-draft-actions")
    .getByRole("button", { name: "Export JSON", exact: true })
    .click();
  const exported = await download;
  await exported.saveAs(join(output, "exported-sandbox.json"));
  await page.getByText("Import a saved sandbox", { exact: true }).click();
  await page
    .getByLabel("Sandbox JSON import", { exact: true })
    .fill(JSON.stringify(edited.definition));
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".lab-draft").length === 3,
  );
  assert.deepEqual(w.sim.snapshot().bodies, original.bodies);
  assert.deepEqual(w.sim.snapshot().objects, original.objects);
  await recorder.send("Page.stopScreencast");
  await Promise.all(writes);
  await context.close();
  const list = join(output, "frames.txt");
  await writeFile(
    list,
    frames
      .map(
        (f, i) =>
          "file '" +
          f.path +
          "'\nduration " +
          (i + 1 < frames.length ? Math.max(0.04, frames[i + 1].at - f.at) : 1),
      )
      .join("\n") +
      "\nfile '" +
      frames.at(-1).path +
      "'\n",
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
    list,
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
    join(output, "experiment-lab-2x.mp4"),
  ]);
  context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "/#lab");
  await page
    .locator(".lab-draft")
    .filter({ hasText: "Compact drone" })
    .first()
    .click();
  await page.getByRole("button", { name: "Top view", exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
    "phone has no horizontal overflow",
  );
  await page
    .locator(".lab-center")
    .screenshot({ path: join(output, "lab-mobile-preview.jpg"), quality: 82 });
  await page.getByRole("tab", { name: "workflow", exact: true }).click();
  await page
    .getByLabel("Workflow name", { exact: true })
    .fill("Phone inspection replay");
  await page.getByRole("button", { name: /Save & run experiment$/ }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".lab-live-results .lab-report-actions")
        ?.textContent.includes("All trial leases released"),
    null,
    { timeout: 35000 },
  );
  await page
    .locator(".lab-live-results")
    .screenshot({ path: join(output, "lab-mobile-result.jpg"), quality: 85 });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(w.sim.snapshot().objects, original.objects);
  const proof = {
    driver:
      "Scripted UI and real MCP SDK regression; not an independent agent mission",
    mainWarehouseUnchanged: true,
    isolatedClones: true,
    standardBlocked: true,
    compactCompleted: true,
    comparableInputs: true,
    frozenRunInputs: true,
    temporaryDeviceEditing: true,
    layoutEditing: true,
    definitionExportImport: true,
    phoneWorkflowRun: true,
    phoneNoOverflow: true,
    trialSensorImageSha256: createHash("sha256").update(bytes).digest("hex"),
    browserErrors: errors,
    comparison,
    events,
  };
  assert.ok(!JSON.stringify(proof).includes('"leaseId"'));
  await writeFile(
    join(output, "verification.json"),
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(
    "Experiment lab passed: isolated A/B runs, actual MCP image, editable devices/layout/workflow, frozen evidence, export/import and phone replay.",
  );
} catch (error) {
  try {
    await page?.screenshot({ path: join(output, "failure.jpg"), quality: 75 });
    await writeFile(
      join(output, "failure-text.txt"),
      await page.locator("body").innerText(),
    );
  } catch {}
  throw error;
} finally {
  await Promise.allSettled([client.close(), browser?.close(), w.close()]);
}
