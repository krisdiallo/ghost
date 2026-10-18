# GHOST demo playbook

## Before the demo

1. Use Node 24; `npm ci`, `npm run check`, `npm test`.
2. `npm start` serves the built demo at `http://127.0.0.1:3001` in the execution environment. `npm run dev` runs the editable UI at port 5173.
3. Check **Systems live**. Select each machine, orbit the view, and verify the scene on the actual device. The capture run checks software WebGL; physical GPU behavior still needs this device check.
4. Use a private port forward when viewing from another device. Loopback on a phone points to the phone itself. Configure `GHOST_ORIGIN` and (only if needed) `GHOST_HOST` for the forwarding setup. The API has no public-user authentication.

## The 30-second pitch

> GHOST gives any agent a temporary body. The intelligence stays with the agent; the machine becomes its host. Watch one ghost locate a crate with a camera, inspect it with a rover, verify it from the air, and stage it with a robotic arm. Every possession is exclusive, expires, and can be released. Every movement you see is the same state the MCP agent sees.

The **guided demo is scripted**. For a real agent demo, connect your MCP client to `/mcp` and give it the mission below. No model integration is embedded in GHOST; the connected client brings its own agent.

## Agent mission

> Use GHOST to discover the available bodies. Inspect crate-07 using the camera, rover and drone, then place it in dispatch using the arm. Possess one body at a time and release it after use. Poll observe until each motion completes. Stay within warehouse bounds.

For a deterministic manual MCP walkthrough, call `discover({})`, then perform these commands using each body's returned `leaseId`. Acquire with `possess({resourceId, ttlSeconds:120, owner:"Demo ghost"})` and release after each body.

| Body        | `act` commands in order                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `camera-01` | `{type:"look",pan:104,tilt:-16}`, `{type:"inspect",objectId:"crate-07"}`                                                                                    |
| `rover-01`  | `{type:"move",x:1,z:1.4}`, wait for completion, `{type:"inspect",objectId:"crate-07"}`                                                                     |
| `drone-01`  | `{type:"takeoff"}`, wait; `{type:"move",x:1,y:3.4,z:-1.5}`, wait; `{type:"inspect",objectId:"crate-07"}`, `{type:"land"}`, wait                            |
| `arm-01`    | `{type:"preset",preset:"reach"}`, `{type:"grasp",objectId:"crate-07"}`, `{type:"preset",preset:"drop"}`, `{type:"place"}`, `{type:"preset",preset:"home"}` |

Calls to `act` wrap the command: `{leaseId, command}`. `observe({leaseId})` reports `body.action.status`, visible object IDs/distances, and inspection findings. Scene units are meters; y is vertical.

## Whole-warehouse tour and camera

**Run guided demo** takes about 90 seconds. Scout travels through X −10 to Z −18 and inspects Cargo 12 before returning to the bay. Wisp climbs to Y 9, flies to X 10 / Z −30, descends to scan Cargo 18, climbs above the racks and returns. These are actual server actions using leases, not decorative animation. The tour uses clear aisle waypoints; free movement remains kinematic without collision avoidance.

Choose **Pan** and drag to translate the camera; choose **Orbit** to rotate. Scroll/pinch or use **+ / −** to zoom. Two fingers pan and zoom. **Follow** tracks the selected body's current position. **Facility overview** restores the whole hall, and **Top view** gives a floor plan.

Use **Immerse** for a full-window warehouse with a live map, fleet switcher and compact control dock. Select Scout, possess it and tap a destination on the map. Wisp must take off before accepting a destination. Set its desired flight altitude in the full control panel. **Stop** cancels the current movement. **Exit** or Escape returns to the full operations console.

## Manual browser walkthrough

- **Sentinel:** high on the southwest corner column (X −30.2 / Y 10 / Z 8). Possess → Aim camera → Scan priority cargo. Defaults 104° pan / −16° tilt point inward toward Cargo 07. Sensor range is 45 m.
- **Scout:** possess → Move to point (defaults 1 / 1.4) → wait for completion → Scan priority cargo.
- **Wisp:** possess → Take off → wait → set X 1 / Y 3.4 / Z −1.5 → Move → wait → Scan → Land.
- **Atlas:** possess → Reach → Grasp cargo → Dispatch → Place cargo → Home.
- The Observation tab shows sensor outputs; the checklist advances from server-confirmed results.

## Recovery

- **Busy body:** another lease owns it. Release in that client or wait for its countdown. Display names do not grant control.
- **Expired lease:** possess again. Pending movement was cancelled and the previous capability is invalid.
- **Action busy:** wait or Stop motion. No queue runs past the lease.
- **Out of reach:** move closer, aim the camera, or set the arm to Reach. Cargo may have moved after the arm step; reset for the standard mission.
- **Disconnected:** the UI keeps its last frame, labels it stale, and disables controls. SSE automatically reconnects with a new snapshot. Server restart resets the world.
- **Interrupted guided demo:** Stop demo releases its own bodies. It does not release unrelated agents' bodies. Reset warehouse explicitly releases every lease, cancels the script and restores the scene.
- **WebGL unavailable:** use the controls and telemetry panels; enable WebGL/use a supported browser for the 3D presentation.

## Shutdown

Ctrl+C on the standalone process. All state is in memory. A fresh start resets the warehouse. Use a standalone process for multi-client demos; an authority auto-started by a stdio client lives only as long as that owning client.

## Visual progress

`npm run progress` captures the actual warehouse, records the four-body mission, runs a touch-emulated rover inspection, and refreshes `docs/progress/latest`. CI independently captures each integrated change and retains the results for 14 days. Only publish reports from passing runs; never use concept images as evidence of working behavior.
