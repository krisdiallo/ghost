// Transport and evidence recorder for an external agent. No route, cargo
// selection, or mission policy is implemented here; every action comes on stdin.
import { createInterface } from "node:readline";
import {
  mkdir,
  writeFile,
  access,
  readFile,
  readdir,
  unlink,
  rename,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../apps/server/dist/http.js";
import { publicResult, privateArguments } from "./lib/agent-evidence.mjs";

const output = resolve(process.env.GHOST_AGENT_DIR ?? "work/agent-session");
await mkdir(join(output, "frames"), { recursive: true });
await mkdir(join(output, "video"), { recursive: true });
await mkdir(join(output, "commands"), { recursive: true });
// A disposable local world keeps this run separate from other agents/viewers.
const warehouse = await startWarehouse(0);
const url = `http://127.0.0.1:${warehouse.server.address().port}`;
const client = new Client({ name: "Fresh Codex mission", version: "1.0" });
const leases = new Map();
const events = [];
const frames = [];
const writes = [];
const browserErrors = [];
const startedAt = Date.now();
let browser, page, recorder;
let closed = false;
let objective = "";
let lastOutput;
const emit = (value) => {
  lastOutput = value;
  process.stdout.write(JSON.stringify(value) + "\n");
};
const save = async () =>
  writeFile(
    join(output, "trace.json"),
    JSON.stringify(
      {
        driver: process.env.GHOST_AGENT_ACTOR ?? "External caller through MCP",
        objective,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        guidedDemoInvoked: false,
        events,
        browserErrors,
      },
      null,
      2,
    ),
  );

async function select(resourceId) {
  const label = {
    "camera-01": "Sentinel",
    "rover-01": "Scout",
    "arm-01": "Atlas",
    "drone-01": "Wisp",
  }[resourceId];
  const button = page.locator(".fleet-list button").filter({ hasText: label });
  if (await button.count()) await button.first().click();
  else
    await page
      .getByRole("button", { name: new RegExp(label) })
      .first()
      .click();
}
async function execute(tool, args, note) {
  const input = privateArguments(tool, args, leases);
  const result = await client.callTool({ name: tool, arguments: input });
  if (tool === "possess" && !result.isError)
    leases.set(args.resourceId, result.structuredContent.leaseId);
  const record = publicResult(result);
  let image;
  const content = result.content.find((item) => item.type === "image");
  if (content) {
    const data = Buffer.from(content.data, "base64");
    const filename = `sensor-${String(events.length + 1).padStart(3, "0")}-${record.result.body.id}.jpg`;
    await writeFile(join(output, "frames", filename), data);
    image = {
      path: `frames/${filename}`,
      sha256: createHash("sha256").update(data).digest("hex"),
      bytes: data.length,
    };
  }
  const event = {
    index: events.length + 1,
    at: new Date().toISOString(),
    tool,
    input: args,
    note,
    ...record,
    ...(image ? { image } : {}),
  };
  events.push(event);
  if (tool === "release" && !result.isError) leases.delete(args.leaseRef);
  // Presentation follows the body the external agent actually selects.
  try {
    if (tool === "possess" && !result.isError) await select(args.resourceId);
    if (image) {
      await select(record.result.body.id);
      const toggle = page
        .locator(".sensor-floating")
        .getByRole("button", { name: /AGENT VISION/ });
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
      await page.waitForFunction(
        (data) =>
          document
            .querySelector(".sensor-floating img")
            ?.getAttribute("src") === `data:image/jpeg;base64,${data}`,
        content.data,
      );
      await page.screenshot({
        path: join(output, `step-${String(event.index).padStart(3, "0")}.jpg`),
        quality: 78,
      });
    }
  } catch (error) {
    // A spectator recording failure must never replace a valid MCP result.
    event.presentationError =
      error instanceof Error ? error.message : "Preview unavailable";
  }
  await save();
  emit({
    ...event,
    ...(image
      ? { image: { ...image, absolutePath: join(output, image.path) } }
      : {}),
  });
  return result;
}
async function finish(note = "Session closed") {
  if (closed) return;
  closed = true;
  let exportError;
  try {
    // Cleanup only: no successful mission state is inferred from these releases.
    for (const [resourceId] of leases) {
      try {
        await execute("release", { leaseRef: resourceId }, "Session cleanup");
      } catch {
        /* TTL remains a final safeguard. */
      }
    }
    if (recorder) await recorder.send("Page.stopScreencast");
    await Promise.all(writes);
    const snapshot = warehouse.sim.snapshot();
    await writeFile(
      join(output, "final-snapshot.json"),
      JSON.stringify(snapshot, null, 2),
    );
    await page?.screenshot({
      path: join(output, "final-console.jpg"),
      quality: 80,
    });
    if (frames.length > 1) {
      const list = join(output, "video", "frames.txt");
      await writeFile(
        list,
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
        list,
        "-vf",
        "scale=960:-2,setpts=PTS/4",
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
        join(output, "agent-mission-4x.mp4"),
      ]);
    }
    if (process.env.GHOST_AGENT_CAPTURE_MOBILE === "1") {
      await page.locator(".survey-panel").screenshot({
        path: join(output, "survey-ledger.jpg"),
        quality: 80,
      });
      await page.locator(".warehouse-map").screenshot({
        path: join(output, "survey-map.jpg"),
        quality: 85,
      });
      // Only one live UI page: background pages can stall screenshot stability checks.
      await page.close();
      const mobile = await browser.newPage({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      mobile.on("pageerror", (error) => browserErrors.push(error.message));
      await mobile.bringToFront();
      await mobile.goto(url);
      await mobile.locator(".survey-panel").waitFor();
      await mobile.locator(".survey-panel").screenshot({
        path: join(output, "survey-mobile.jpg"),
        quality: 80,
      });
      const overflow = await mobile.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow)
        browserErrors.push("Mobile survey causes horizontal overflow");
      await mobile.close();
    }
  } catch (error) {
    exportError =
      error instanceof Error ? error.message : "Evidence export failed";
  } finally {
    events.push({
      index: events.length + 1,
      at: new Date().toISOString(),
      tool: "session_end",
      note,
      ...(exportError ? { exportError } : {}),
    });
    try {
      await save();
    } finally {
      await Promise.allSettled([
        client.close(),
        browser?.close(),
        warehouse.close(),
      ]);
    }
    emit({
      status: exportError ? "finished_with_export_error" : "finished",
      output,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      browserErrors,
      ...(exportError ? { exportError } : {}),
    });
  }
}

try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp")),
  );
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
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(url);
  await page.getByText("Systems live", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Body camera", exact: true }).click();
  recorder = await page.context().newCDPSession(page);
  recorder.on("Page.screencastFrame", (event) => {
    const path = join(
      output,
      "video",
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
    quality: 60,
    maxWidth: 960,
    maxHeight: 734,
    everyNthFrame: 8,
  });
  emit({
    status: "ready",
    url,
    output,
    tools: (await client.listTools()).tools.map(
      ({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      }),
    ),
    control:
      "JSON lines: {tool, arguments, note}; leaseRef substitutes a private capability. {waitFor:resourceId} only polls. {finish:summary} releases and exports.",
  });
  async function handle(command) {
    try {
      if (command.tools) {
        emit({
          tools: (await client.listTools()).tools.map(
            ({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema,
            }),
          ),
        });
      } else if (command.objective) {
        objective = String(command.objective);
        await save();
        emit({ status: "objective_set", objective });
      } else if (command.finish) {
        await finish(String(command.finish));
      } else if (command.waitFor) {
        const leaseId = leases.get(command.waitFor);
        if (!leaseId) throw new Error("Possess this body first.");
        const deadline = Date.now() + 30000;
        let observation,
          polls = 0;
        do {
          const response = await client.callTool({
            name: "observe",
            arguments: { leaseId },
          });
          observation = publicResult(response);
          polls++;
          if (
            response.isError ||
            response.structuredContent.body.action?.status !== "running"
          )
            break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        } while (Date.now() < deadline);
        const event = {
          index: events.length + 1,
          at: new Date().toISOString(),
          tool: "wait",
          input: { leaseRef: command.waitFor },
          polls,
          ...observation,
        };
        events.push(event);
        await save();
        emit(event);
      } else {
        if (!objective)
          throw new Error("Set {objective:...} before starting a mission.");
        await execute(
          command.tool,
          command.arguments ?? {},
          String(command.note ?? ""),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Command failed";
      events.push({
        index: events.length + 1,
        at: new Date().toISOString(),
        tool: "recorder_error",
        message,
      });
      await save();
      emit({ error: message });
    }
    return lastOutput;
  }
  if (process.argv.includes("--stdio")) {
    const input = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of input) {
      if (line.trim()) await handle(JSON.parse(line));
      if (closed) break;
    }
  } else {
    // A filesystem mailbox works across separately scoped agent exec sessions.
    // Only the recorder holds private capabilities; replies are sanitized.
    while (!closed) {
      const requests = (await readdir(join(output, "commands")))
        .filter((name) => /^[\da-f-]+\.request\.json$/.test(name))
        .sort();
      for (const name of requests) {
        const requestPath = join(output, "commands", name);
        let response;
        try {
          response = await handle(
            JSON.parse(await readFile(requestPath, "utf8")),
          );
        } catch {
          response = { error: "Invalid recorder command." };
        }
        const responsePath = requestPath.replace(
          ".request.json",
          ".response.json",
        );
        await writeFile(responsePath + ".tmp", JSON.stringify(response), {
          mode: 0o600,
        });
        await rename(responsePath + ".tmp", responsePath);
        await unlink(requestPath);
      }
      if (!closed) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await finish("Input closed");
} catch (error) {
  emit({ error: error instanceof Error ? error.message : "Session failed" });
  await finish("Session failed");
  process.exitCode = 1;
}
