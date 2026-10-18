# GHOST · visual progress

Oct 17, 2026, 4:52 PM PT · actual app captures

## Bodies navigating the warehouse

**64 × 44 m · 2,816 m² · 12 m clear height.** Scout now travels down the west storage aisle to Z −18. Wisp flies above the racks at 9 m and surveys the loading docks at Z −30. The camera follows the moving body through the hall.

![Actual Scout traversal in the storage aisle — 50 KB](ghost-navigation-small.jpg)

This page loads only the lightweight 50 KB preview. Larger images and video below are optional downloads.

- [Immersive warehouse controls](ghost-immersive.png?raw=true)
- [Scout in the storage aisle](ghost-rover-aisle.png?raw=true)
- [Wisp at the loading docks](ghost-drone-docks.png?raw=true)
- [Phone immersive controls](ghost-mobile-immersive.png?raw=true)
- [Full warehouse screenshot](ghost-warehouse.png?raw=true)
- [Close-up mission bay](ghost-mission-bay.png?raw=true)
- [Watch/download the complete demo](ghost-demo.mp4?raw=true)
- [Animated scene preview](ghost-demo.gif?raw=true)
- [Mission completed — four passed steps](ghost-mission-complete.png?raw=true)
- [Phone possession controls](ghost-mobile-controls.png?raw=true)
- [Phone inspection result](ghost-mobile-observation.png?raw=true)

## What actually ran

The guided camera → rover → drone → arm mission passed **4 / 4 steps**, releasing every lease. It is a scripted tour through the live command interface. The rover also inspects Cargo 12 in storage; the drone scans Cargo 18 at the north loading docks. These are actual server-owned movements and sensor results.

A separate touch-emulated phone run possessed Scout, moved to the inspection point, scanned Cargo 07, and returned: **“Seal intact. Label verified. Cleared for dispatch.”** It then released the body. No browser runtime/console errors and no mobile horizontal overflow. Rendered-image checks verify orbit, pan, zoom, a two-finger touch gesture, and camera reset. Immersive view fills the window. The phone run sends a destination beyond the old demo bay through the live map, checks it in the authority, stops the body, and completes the inspection.

The simulation now admits travel throughout the larger floor and flight up to 12 m. The boundary tests cover floor and elevated flight routes beyond the original demo area. Storage racks and architectural freight remain scenery; the three tagged crates are sensor objects.

These are real Chromium/software-WebGL captures, with a 390 × 844 touch-emulated browser. Physical-device GPU and gesture behavior remain a device check. [Machine-readable run evidence](capture-report.json).
