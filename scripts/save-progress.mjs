import { readFile, mkdir, copyFile, writeFile, stat } from "node:fs/promises";
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
const previewKB = Math.round(
  (await stat(join(input, "ghost-overview-small.jpg"))).size / 1024,
);
await writeFile(
  join(destination, "README.md"),
  `# GHOST · visual progress

${timestamp} PT · actual app captures

## A much larger warehouse

**64 × 44 m · 2,816 m² · 12 m clear height.** About ten times the previous floor area, with 16 four-tier storage bays, six loading docks, high roof trusses, industrial lighting, and a mezzanine control room.

![Actual warehouse overview — ${previewKB} KB](ghost-overview-small.jpg)

This page loads only the lightweight ${previewKB} KB preview. Larger images and video below are optional downloads.

- [Full warehouse screenshot](ghost-warehouse.png?raw=true)
- [Close-up mission bay](ghost-mission-bay.png?raw=true)
- [Watch/download the complete demo](ghost-demo.mp4?raw=true)
- [Animated scene preview](ghost-demo.gif?raw=true)
- [Mission completed — four passed steps](ghost-mission-complete.png?raw=true)
- [Phone possession controls](ghost-mobile-controls.png?raw=true)
- [Phone inspection result](ghost-mobile-observation.png?raw=true)

## What actually ran

The guided camera → rover → drone → arm mission passed **4 / 4 steps**, releasing every lease. It is a scripted tour through the live command interface. The camera moves from the facility overview into the embodiment bay so each body remains visible.

A separate touch-emulated phone run possessed Scout, moved to the inspection point, scanned Cargo 07, and returned: **“${report.manualRoverInspection}”** It then released the body. No browser runtime/console errors and no mobile horizontal overflow. A rendered-image check also verifies that manual orbit changes the view and reset restores the facility overview.

The simulation now admits travel throughout the larger floor and flight up to 12 m. The boundary tests cover floor and elevated flight routes beyond the original demo area. Storage racks and architectural freight remain scenery; the three tagged crates are sensor objects.

These are real Chromium/software-WebGL captures, with a 390 × 844 touch-emulated browser. Physical-device GPU behavior and pinch gestures remain a device check. [Machine-readable run evidence](capture-report.json).
`,
);
console.log("Updated the lightweight visual report in docs/progress/latest.");
