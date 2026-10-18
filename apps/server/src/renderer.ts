import { access, readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import type { SensorFrame, Snapshot } from "@ghost/shared";
import { SimError } from "./simulation.js";

const root = resolve(
  fileURLToPath(new URL("../../web/dist/", import.meta.url)),
);
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

// One lazy software-WebGL renderer per authority. It only reads bundled local
// assets through intercepted requests: no credentials, live APIs or Internet.
export class SensorRenderer {
  private browser: Browser | undefined;
  private page: Page | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;

  private async ready() {
    if (this.page && !this.page.isClosed()) return this.page;
    let executablePath = process.env.GHOST_BROWSER_PATH;
    if (!executablePath) {
      try {
        await access("/usr/bin/chromium");
        executablePath = "/usr/bin/chromium";
      } catch {
        /* Playwright installation. */
      }
    }
    this.browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      timeout: 15000,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const page = await this.browser.newPage({
      viewport: { width: 640, height: 360 },
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const path = resolve(root, "." + decodeURIComponent(url.pathname));
      if (
        url.origin !== "http://ghost-render.local" ||
        !path.startsWith(root + sep)
      )
        return route.abort();
      try {
        await route.fulfill({
          body: await readFile(path),
          contentType: mime[extname(path)] ?? "application/octet-stream",
        });
      } catch {
        await route.abort();
      }
    });
    await page.goto("http://ghost-render.local/sensor.html", {
      timeout: 15000,
    });
    await page.waitForFunction(
      () =>
        typeof (globalThis as unknown as { ghostSensor?: unknown })
          .ghostSensor === "function",
      undefined,
      { timeout: 10000 },
    );
    this.page = page;
    return page;
  }

  async capture(snapshot: Snapshot, resourceId: string): Promise<SensorFrame> {
    if (this.closed || this.pending >= 4)
      throw new SimError(
        "SENSOR_BUSY",
        "Image renderer is busy. Retry shortly.",
      );
    this.pending++;
    const task = this.queue.then(async () => {
      if (this.closed) throw new Error("Renderer closed");
      try {
        const page = await this.ready();
        const data = await page.evaluate(
          async ({ snapshot, resourceId }) => {
            return Promise.race([
              (
                globalThis as unknown as {
                  ghostSensor: (
                    snapshot: Snapshot,
                    id: string,
                  ) => Promise<string>;
                }
              ).ghostSensor(snapshot, resourceId),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Render timed out")), 10000),
              ),
            ]);
          },
          { snapshot, resourceId },
        );
        return {
          id: randomUUID(),
          instanceId: snapshot.instanceId,
          resourceId,
          revision: snapshot.revision,
          at: snapshot.at,
          width: 640,
          height: 360,
          mimeType: "image/jpeg" as const,
          data,
        };
      } catch {
        await this.disposeBrowser();
        throw new SimError(
          "SENSOR_UNAVAILABLE",
          "Cannot render a sensor frame. Install Chromium (npx playwright install chromium) and build the web app, then retry.",
        );
      }
    });
    this.queue = task.catch(() => {});
    try {
      return await task;
    } finally {
      this.pending--;
    }
  }
  private async disposeBrowser() {
    this.page = undefined;
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close();
  }
  async close() {
    this.closed = true;
    await this.disposeBrowser();
    await this.queue;
    await this.disposeBrowser(); // Covers a launch that was still in flight.
  }
}
