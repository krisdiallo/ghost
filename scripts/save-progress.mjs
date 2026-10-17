import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const input = resolve(process.env.GHOST_CAPTURE_DIR ?? "work/captures");
const destination = resolve("docs/progress/latest");
const report = JSON.parse(
  await readFile(join(input, "capture-report.json"), "utf8"),
);
assert.ok(
  report.mission.every((step) => step.complete),
  "Only publish a complete mission capture",
);
assert.equal(
  report.browserErrors.length,
  0,
  "Only publish a passing browser run",
);
await mkdir(destination, { recursive: true });
for (const name of [...report.captures, "capture-report.json"]) {
  assert.equal(name, name.split("/").at(-1));
  await copyFile(join(input, name), join(destination, name));
}
const timestamp = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(report.capturedAt));
await writeFile(
  join(destination, "README.md"),
  `# GHOST · visual progress

${timestamp} PT · actual app captures

**[Watch the complete ${Math.round(report.durationSeconds)}-second mission](ghost-demo.mp4?raw=true)** · [Download MP4](ghost-demo.mp4?raw=true)

![Actual four-body mission](ghost-demo.gif)

One ghost located Cargo 07 with Sentinel, inspected its seal with Scout, surveyed it with Wisp, and staged it for dispatch with Atlas. **4 / 4 steps passed; every lease was released.** This tour is scripted through the live control interface.

A separate phone-sized browser run possessed Scout, drove to the inspection point, scanned Cargo 07, and returned: **“${report.manualRoverInspection}”** It then released the body. No browser runtime or console errors; no mobile horizontal overflow.

## Warehouse

![Live warehouse](ghost-warehouse.png)

## Mission complete

![Four completed steps and activity feed](ghost-mission-complete.png)

## Phone controls and observation

![Phone possession controls](ghost-mobile-controls.png)

![Phone inspection result](ghost-mobile-observation.png)

<details><summary>More actual mission snapshots</summary>

Camera:

![Sentinel scan](ghost-camera.png)

Rover:

![Scout inspection](ghost-rover.png)

Drone:

![Wisp survey](ghost-drone.png)

Arm:

![Atlas cargo transfer](ghost-arm.png)

Full phone layout:

![Complete phone layout](ghost-mobile.png)

</details>

These are real Chromium captures using software WebGL, plus a 390 × 844 touch-emulated browser. Physical phone GPU behavior and pinch gestures still need device testing. [Machine-readable run evidence](capture-report.json).
`,
);
console.log(
  "Updated docs/progress/latest with verified screenshots and the mission recording.",
);
