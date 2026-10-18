// Actual MCP image observations and a local standards-based MCP Apps host.
// This does not claim integration with a signed-in ChatGPT account.
import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startWarehouse } from "../apps/server/dist/http.js";

const output = resolve(process.env.GHOST_CAPTURE_DIR ?? "work/captures");
await mkdir(output, { recursive: true });
const warehouse = await startWarehouse(0);
const port = warehouse.server.address().port;
const url = `http://127.0.0.1:${port}`;
const client = new Client({ name: "Sensor inspection agent", version: "1.0" });
let browser;
const errors = [];
const results = [];
const hash = (value) => createHash("sha256").update(value).digest("hex");
try {
  let executablePath = process.env.GHOST_BROWSER_PATH;
  if (!executablePath) {
    try {
      await access("/usr/bin/chromium");
      executablePath = "/usr/bin/chromium";
    } catch {}
  }
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
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
  const observeTool = (await client.listTools()).tools.find(
    (tool) => tool.name === "observe",
  );
  const resourceUri = observeTool._meta?.ui?.resourceUri;
  assert.ok(resourceUri, "mcp-use advertises an MCP Apps view for observe");
  const resource = await client.readResource({ uri: resourceUri });
  const html = resource.contents[0].text;
  assert.match(resource.contents[0].mimeType, /text\/html/);
  assert.ok(!html.includes("http://ghost-render.local"));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content).slice(0, 400));
    return result;
  };
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByText("Systems live", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Body camera", exact: true }).click();
  const videoDir = join(output, "sensor-video");
  await mkdir(videoDir, { recursive: true });
  const frames = [];
  const writes = [];
  const recorder = await page.context().newCDPSession(page);
  recorder.on("Page.screencastFrame", (event) => {
    const path = join(
      videoDir,
      `frame-${String(frames.length).padStart(5, "0")}.jpg`,
    );
    frames.push({ path, at: event.metadata.timestamp });
    writes.push(writeFile(path, Buffer.from(event.data, "base64")));
    void recorder
      .send("Page.screencastFrameAck", { sessionId: event.sessionId })
      .catch(() => {});
  });
  await recorder.send("Page.startScreencast", {
    format: "jpeg",
    quality: 65,
    maxWidth: 960,
    maxHeight: 734,
    everyNthFrame: 4,
  });
  const samples = [
    ["camera-01", "Sentinel"],
    ["rover-01", "Scout"],
    ["drone-01", "Wisp"],
    ["arm-01", "Atlas"],
  ];
  for (const [resourceId, label] of samples) {
    const fleet = page.locator(".fleet-list button").filter({ hasText: label });
    if (await fleet.count()) await fleet.first().click();
    else
      await page
        .getByRole("button", { name: new RegExp(label) })
        .first()
        .click();
    const possession = (
      await call("possess", {
        resourceId,
        ttlSeconds: 120,
        owner: "Sensor inspection agent",
      })
    ).structuredContent;
    const leaseId = possession.leaseId;
    const settled = async () => {
      const deadline = Date.now() + 15000;
      while (
        (await call("observe", { leaseId })).structuredContent.body.action
          ?.status === "running"
      ) {
        assert.ok(Date.now() < deadline, "body motion completes");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    if (resourceId === "rover-01") {
      // Approach from the south so the fixed mast camera faces the cargo.
      for (const destination of [
        { x: 2, z: 3 },
        { x: 2, z: 2.1 },
      ]) {
        await call("act", {
          leaseId,
          command: { type: "move", ...destination },
        });
        await settled();
      }
      const scan = await call("act", {
        leaseId,
        command: { type: "inspect", objectId: "crate-07" },
      });
      assert.match(JSON.stringify(scan.structuredContent), /Seal intact/);
    }
    if (resourceId === "drone-01") {
      await call("act", { leaseId, command: { type: "takeoff" } });
      const deadline = Date.now() + 15000;
      while (
        (await call("observe", { leaseId })).structuredContent.body.action
          ?.status === "running"
      ) {
        assert.ok(Date.now() < deadline, "takeoff completes");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await call("act", {
        leaseId,
        command: { type: "move", x: -4, y: 9, z: -3 },
      });
      await settled();
    }
    if (resourceId === "arm-01") {
      await call("act", {
        leaseId,
        command: { type: "preset", preset: "reach" },
      });
      const deadline = Date.now() + 10000;
      while (
        (await call("observe", { leaseId })).structuredContent.body.action
          ?.status === "running"
      ) {
        assert.ok(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const started = Date.now();
    const result = await call("observe", { leaseId, image: true });
    const captureMs = Date.now() - started;
    const image = result.content.find((item) => item.type === "image");
    assert.equal(image.mimeType, "image/jpeg");
    const bytes = Buffer.from(image.data, "base64");
    assert.equal(
      bytes.readUInt16BE(0),
      0xffd8,
      "a real JPEG, not a text placeholder",
    );
    assert.ok(bytes.length > 4000, "render contains warehouse detail");
    assert.ok(
      !JSON.stringify(result.structuredContent).includes(image.data),
      "base64 is not duplicated in model text",
    );
    assert.ok(
      !JSON.stringify(result).includes(leaseId),
      "result contains no private lease capability",
    );
    assert.equal(result._meta.frameData, image.data);
    const publicFrame = (
      await (await fetch(url + "/api/frames/" + resourceId)).json()
    ).frame;
    assert.equal(
      publicFrame.data,
      image.data,
      "spectator sees the exact agent frame",
    );
    assert.equal(publicFrame.id, result.structuredContent.frame.id);
    await writeFile(join(output, `ghost-sensor-${resourceId}.jpg`), bytes);
    // Choose the fleet button; accessible selection remains available in POV.
    const panel = page.locator(".sensor-floating");
    const toggle = panel.getByRole("button", { name: /AGENT VISION/ });
    if ((await toggle.getAttribute("aria-expanded")) === "false")
      await toggle.click();
    await panel.locator("img").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(output, `ghost-pov-${resourceId}.jpg`),
      quality: 80,
    });
    await call("release", { leaseId });
    results.push({
      resourceId,
      frameId: publicFrame.id,
      revision: publicFrame.revision,
      bytes: bytes.length,
      sha256: hash(bytes),
      captureMs,
    });

    if (resourceId === "rover-01") {
      // Exercise the actual inline bundle through the MCP Apps handshake.
      const host = await browser.newPage({
        viewport: { width: 740, height: 650 },
      });
      host.on("pageerror", (error) => errors.push(error.message));
      host.on("console", (message) => {
        if (message.type() === "error")
          console.error("MCP App:", message.text().slice(0, 300));
      });
      await host.setContent(
        '<html><body style="margin:0;background:#0c1414"><iframe title="MCP App" style="border:0;width:100%;height:640px"></iframe></body></html>',
      );
      await host.evaluate(
        ({ html, result }) => {
          const iframe = document.querySelector("iframe");
          window.addEventListener("message", (event) => {
            if (event.source !== iframe.contentWindow) return;
            const msg = event.data;
            if (msg.method === "ui/initialize")
              iframe.contentWindow.postMessage(
                {
                  jsonrpc: "2.0",
                  id: msg.id,
                  result: {
                    protocolVersion: msg.params.protocolVersion,
                    hostInfo: { name: "GHOST local test host", version: "1.0" },
                    hostCapabilities: {},
                    hostContext: { theme: "dark", displayMode: "inline" },
                  },
                },
                "*",
              );
            if (msg.method === "ui/notifications/initialized") {
              iframe.contentWindow.postMessage(
                {
                  jsonrpc: "2.0",
                  method: "ui/notifications/tool-input",
                  params: { arguments: {} },
                },
                "*",
              );
              iframe.contentWindow.postMessage(
                {
                  jsonrpc: "2.0",
                  method: "ui/notifications/tool-result",
                  params: result,
                },
                "*",
              );
            }
          });
          iframe.srcdoc = html;
        },
        { html, result },
      );
      try {
        await host
          .frameLocator("iframe")
          .getByAltText(/sensor frame received by the agent/)
          .waitFor({ timeout: 15000 });
      } catch (error) {
        console.error(
          "App frame text:",
          await host.frameLocator("iframe").locator("body").innerText(),
        );
        await host.screenshot({
          path: join(output, "ghost-mcp-app-failure.jpg"),
        });
        throw error;
      }
      assert.equal(
        await host.frameLocator("iframe").locator("img").getAttribute("src"),
        "data:image/jpeg;base64," + image.data,
      );
      await host.screenshot({
        path: join(output, "ghost-mcp-app.jpg"),
        quality: 85,
      });
      await host.close();
    }
  }
  assert.equal(
    new Set(results.map((result) => result.sha256)).size,
    4,
    "four distinct optical views",
  );
  await recorder.send("Page.stopScreencast");
  await Promise.all(writes);
  assert.ok(frames.length > 5, "actual browser demo frames recorded");
  const frameList = join(videoDir, "frames.txt");
  await writeFile(
    frameList,
    frames
      .map(
        (frame, i) =>
          `file '${frame.path}'\nduration ${i + 1 < frames.length ? Math.max(0.04, frames[i + 1].at - frame.at) : 1}`,
      )
      .join("\n") + `\nfile '${frames.at(-1).path}'\n`,
  );
  await page.close();
  await promisify(execFile)("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    frameList,
    "-vf",
    "scale=960:-2",
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
    join(output, "ghost-sensor-demo.mp4"),
  ]);
  // The stdio proxy also delivers real image content, not base64 text.
  const stdio = new Client({ name: "stdio sensor agent", version: "1.0" });
  try {
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("apps/server/dist/index.js")],
        env: { ...process.env, GHOST_PORT: String(port) },
        stderr: "pipe",
      }),
    );
    const lease = (
      await stdio.callTool({
        name: "possess",
        arguments: { resourceId: "rover-01" },
      })
    ).structuredContent;
    const imageResult = await stdio.callTool({
      name: "observe",
      arguments: { leaseId: lease.leaseId, image: true },
    });
    assert.ok(imageResult.content.some((item) => item.type === "image"));
    await stdio.callTool({
      name: "release",
      arguments: { leaseId: lease.leaseId },
    });
  } finally {
    await stdio.close();
  }
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(url);
  await mobile.getByText("Systems live", { exact: true }).waitFor();
  await mobile
    .getByRole("button", { name: "Body camera", exact: true })
    .click();
  await mobile
    .locator(".sensor-floating")
    .getByRole("button", { name: /AGENT VISION/ })
    .click();
  await mobile.locator(".sensor-floating img").waitFor();
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "mobile layout fits",
  );
  await mobile.locator(".viewport").scrollIntoViewIfNeeded();
  await mobile.screenshot({
    path: join(output, "ghost-sensor-mobile.jpg"),
    quality: 80,
  });
  assert.deepEqual(errors, []);
  const report = {
    at: new Date().toISOString(),
    mode: "actual MCP images; local MCP Apps host, not ChatGPT",
    results,
    stdioImage: true,
    embeddedImageMatchesAgent: true,
    mobileFits: true,
    errors,
  };
  await writeFile(
    join(output, "sensor-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
  await browser?.close();
  await warehouse.close();
}
