// Real browser + MCP smoke test. The temporary key is never saved or printed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, access, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../apps/server/dist/http.js";

const output = resolve(process.env.GHOST_CAPTURE_DIR ?? "work/captures");
await mkdir(output, { recursive: true });
const token = randomBytes(32).toString("base64url");
const warehouse = await startWarehouse(0, "127.0.0.1", undefined, {
  accessToken: token,
});
const url = `http://127.0.0.1:${warehouse.server.address().port}`;
let executablePath = process.env.GHOST_BROWSER_PATH;
if (!executablePath) {
  try {
    await access("/usr/bin/chromium");
    executablePath = "/usr/bin/chromium";
  } catch {
    /* Use Playwright's browser in CI. */
  }
}
let browser;
const client = new Client({ name: "Manufact smoke agent", version: "1.0" });
const errors = [];
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
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByLabel("Warehouse access key").waitFor();
  await page.screenshot({
    path: join(output, "ghost-private-login.jpg"),
    quality: 78,
  });
  await page.getByLabel("Warehouse access key").fill(token);
  await page.getByRole("button", { name: "Enter warehouse" }).click();
  await page.getByText("Systems live", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector("canvas")?.width > 100,
  );
  await page.waitForTimeout(1200);
  assert.equal(await page.locator(".scene-fallback").isVisible(), false);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    "private mobile header fits",
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tools = (await client.listTools()).tools.map((tool) => tool.name);
  const lease = (
    await client.callTool({
      name: "possess",
      arguments: { resourceId: "rover-01", owner: "Manufact smoke agent" },
    })
  ).structuredContent;
  await client.callTool({
    name: "act",
    arguments: {
      leaseId: lease.leaseId,
      command: { type: "move", x: 1, z: 1.4 },
    },
  });
  const deadline = Date.now() + 12000;
  while (true) {
    const observation = (
      await client.callTool({
        name: "observe",
        arguments: { leaseId: lease.leaseId },
      })
    ).structuredContent;
    if (observation.body.action.status !== "running") break;
    assert.ok(Date.now() < deadline, "remote rover movement completes");
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const inspection = (
    await client.callTool({
      name: "act",
      arguments: {
        leaseId: lease.leaseId,
        command: { type: "inspect", objectId: "crate-07" },
      },
    })
  ).structuredContent.inspection.condition;
  assert.match(inspection, /Seal intact/);
  await client.callTool({
    name: "release",
    arguments: { leaseId: lease.leaseId },
  });
  await page
    .getByRole("button", { name: "Enter immersive view", exact: true })
    .click();
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: join(output, "ghost-private-warehouse.jpg"),
    quality: 78,
  });
  await page
    .getByRole("button", { name: "Exit immersive view", exact: true })
    .click();
  await page.getByRole("button", { name: "Connect an agent" }).click();
  await page.getByRole("dialog").waitFor();
  assert.ok(
    (await page.getByRole("dialog").innerText()).includes(url + "/mcp"),
  );
  assert.ok(!(await page.getByRole("dialog").innerText()).includes(token));
  await page.screenshot({
    path: join(output, "ghost-private-connect.jpg"),
    quality: 78,
  });
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Warehouse access key").waitFor();
  assert.equal(
    (await context.request.get(url + "/api/snapshot")).status(),
    401,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "access-report.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        deployment:
          "local hosted-mode validation; not a live Manufact deployment",
        mobileViewport: "390 × 844",
        tools,
        inspection,
        checks: [
          "private phone login",
          "authenticated MCP movement and inspection",
          "shared browser world",
          "immersive controls",
          "current-origin connection URL",
          "logout revokes cookie",
          "no mobile overflow",
        ],
        browserErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Private phone login, MCP rover inspection, immersive view, connection dialog, and logout passed. Captures: work/captures/ghost-private-*.jpg",
  );
} finally {
  await client.close();
  await browser?.close();
  await warehouse.close();
}
