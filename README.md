# GHOST

**Any agent. Any body.**

An MCP interface for agents to discover, possess, observe, control, and release simulated camera, rover, arm, and drone bodies in a live Three.js warehouse. Built for the YC hackathon.

The agent is the ghost. The machine is its host.

## Run the warehouse

Use **Node 24** (`.nvmrc`; 24.15+ required by the test tooling).

```sh
npm ci
npm run dev
```

This starts **both** the authoritative server on `http://127.0.0.1:3001` and the Vite UI on `http://127.0.0.1:5173`. The UI proxies API/MCP traffic to the server. No API keys, LLM provider, database, or external services are needed. Fonts and scene geometry are served locally.

For a production build and a single process serving everything:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:3001`. Build output is ignored by Git. These are executor-local addresses, not a published phone-accessible URL.

## Demo

Click **Run guided demo** for a repeatable, approximately 90-second scripted warehouse mission:

1. Sentinel scans Cargo 07 from its 10 m-high southwest corner mount.
2. Scout drives down the west aisle to inspect Cargo 12, then returns to check Cargo 07.
3. Wisp climbs to 9 m, flies to the north loading docks to scan Cargo 18, then returns to verify Cargo 07 and land.
4. Atlas grasps the crate and places it in dispatch.

The ghost acquires and releases each body in turn. The script uses the same simulation command path as MCP and manual controls; it is not an LLM making decisions. Run it again to reset and replay. The demo refuses to start if any body is leased. If an external agent acquires a future mission body, the script reports contention and releases its own leases.

To explore manually, choose a body and **Possess body**. Browser possession switches release your previous body. Use the control panel or pick a destination on the floor. **Observation** shows the sensor's visible objects, distances and inspection results. The browser remembers its tokens in session storage across reloads; they are never included in public snapshots or the activity stream. **Reset warehouse** asks before releasing every lease and restoring the scene.

The warehouse is a 64 × 44 m industrial hall with 16 four-tier storage bays, six loading docks, roof trusses, high-bay lights, and a mezzanine control room. Use the facility overview to explore it, or mission view to see the working bay. The guided demo follows each moving body through the warehouse automatically. Choose **Orbit** or **Pan**, then drag with one finger or the left mouse button. Scroll, pinch, or use the **+ / −** buttons to zoom; two fingers pan and zoom together. **Follow** tracks the selected body while preserving your camera angle. **Immerse** fills the window and keeps fleet selection, possession, movement, scanning, stopping, and release controls available. Exit with its toolbar button or Escape. The live map always covers the whole hall: select a body marker, or tap empty map space to send your possessed rover or airborne drone there. The control panel also offers named warehouse destinations. Fleet buttons provide accessible selection. Controls stack on mobile. If WebGL fails, the control and telemetry panels remain usable.

See [the demo playbook](docs/demo-playbook.md) for individual commands and recovery steps.

## Connect any MCP agent

Keep `npm run dev` or `npm start` running as the shared authority when using multiple clients.

### Streamable HTTP

Point an MCP client running in the same environment at:

```text
http://127.0.0.1:3001/mcp
```

Independent clients share one warehouse. The endpoint uses mcp-use and is stateless at the transport layer; leases are opaque capabilities and are held by the simulation, not by HTTP sessions.

### Stdio

After building, launch the entry point **directly**, not through npm:

```json
{
  "mcpServers": {
    "ghost": {
      "command": "node",
      "args": ["/workspace/ghost/apps/server/dist/index.js"]
    }
  }
}
```

The stdio adapter connects to the existing authority at port 3001. If none exists, it starts an embedded authority on that port. An embedded authority ends when that owning stdio client disconnects; use the standalone server for a stable shared demo. All diagnostics go to stderr; stdout contains MCP messages only.

| Tool       | Input                                 | Result                                                                            |
| ---------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `discover` | `{ kind? }`                           | Live bodies, availability, sensor/handling limits, bounds and survey history      |
| `possess`  | `{ resourceId, ttlSeconds?, owner? }` | Private `leaseId`, body and expiry                                                |
| `observe`  | `{ leaseId, image? }`                 | Pose, sensor limits, cargo telemetry and shared survey; optional JPEG and MCP App |
| `act`      | `{ leaseId, command }`                | Action ID/status/revision, inspection result when applicable                      |
| `release`  | `{ leaseId }`                         | Idempotent release; pending movement cancelled                                    |

Default TTL is 60 seconds, bounded to 5–300. Competing possession returns `RESOURCE_BUSY`. Expiry uses a monotonic clock and cancels movement. Observe and act require a valid lease. Commands are validated through strict per-command schemas on both HTTP and MCP paths. Motion returns `running`; poll `observe` for completion. Commands serialize per body. Work that would outlast its lease is rejected.

## Search the warehouse

The warehouse map overlays a shared 12 × 8 floor survey grid. Green cells were fully inside a stationary body's analytic telemetry footprint at cargo height (0.55 m); dark cells remain unknown. Movement polls never credit an entire swept path. Toggle **Survey on/off** to compare the grid with the facility map.

The **Observed cargo** ledger records only cargo actually returned through a leased observation or successful inspection. It retains last-seen positions and inspection findings across body switches and lease expiry, and clears on warehouse reset/restart. It does not reveal unseen cargo or a ground-truth inventory count. This is shared warehouse knowledge, not private per-agent memory.

MCP `discover` includes sensor/inspection ranges, camera angle limits, arm gripper preset positions and grasp reach, drone altitude limits, and the same survey state. `surveyGuide` explains grid row/column coordinates so an agent can choose its own search strategy. `observe` updates that history and returns it alongside the body's live telemetry. Grid coverage concerns the floor telemetry plane; it does not prove visual coverage, elevated-rack coverage, or complete inventory. Images can be occluded while analytic telemetry sees through scenery.

## Model and boundaries

- One server owns all positions, actions, objects, leases and mission progress in memory. Restart resets the world and invalidates tokens.
- Browser snapshots and SSE use instance IDs and revisions. Reconnect receives a full snapshot; older revisions are ignored. Offline frames are marked stale and controls disabled.
- Observations include structured cargo telemetry. Set `image: true` for a server-rendered 640 × 360 JPEG through the body's camera. HTTP MCP also returns an embedded viewer through mcp-use's MCP Apps support. Stdio delivers the same image content without the embedded card.
- Motion is deterministic and kinematic. There is no collision avoidance, path planning, rigid-body physics, or hardware integration. Shelves are scenery.
- Arm presets are `home`, `reach`, and `drop`; grasping checks reach. Release/expiry cancels motion; suspended drones hold position and held cargo remains attached for the next valid lease.
- The default server is a **trusted local demo**. Hosted mode adds a shared private access key, not multi-tenant accounts. Lease IDs authorize control; display names are not authentication. Public spectator snapshots contain the whole scene. The loopback API has Origin/Host checks, payload limits and no wildcard CORS.

## Manufact Cloud

The deployment target is **Manufact Cloud**, following the [official YC starter](https://github.com/mcp-use/hack-yc). HTTP MCP uses mcp-use. A Node 24 Dockerfile builds and serves the console, API/SSE and MCP from one authority. **The public deployment is not live yet:** this executor blocks Manufact's API and a Manufact account still needs to be connected. See [deployment status and configuration](docs/manufact-deployment.md).

The default listener stays loopback-only with no key required. Remote binding requires `GHOST_HOST=0.0.0.0`, an exact HTTPS `GHOST_ORIGIN`, and a random `GHOST_ACCESS_TOKEN` of at least 32 characters in the hosting platform's secret settings. The process refuses an incomplete remote configuration. `PORT` is supported; `GHOST_PORT` overrides it.

Hosted browsers enter through a private login page with an eight-hour HttpOnly, Secure cookie. MCP clients use the HTTPS `/mcp` URL with an Authorization bearer header. All control and spectator endpoints are protected; only the health probe is anonymous. The access key never enters URLs, public snapshots, or JavaScript storage. Sign out revokes the browser session. This supports header-capable MCP clients; **ChatGPT connectors need OAuth, which is not implemented**.

Keep exactly one running replica. Restarts and scale-to-zero reset the in-memory warehouse, leases and sessions. Publishing the cloud workspace alone does not publish the app. No Manufact service or public URL has been provisioned yet.

## Development and validation

| Command               | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `npm run dev`         | Shared authority + Vite UI                               |
| `npm run dev:web`     | UI only, expects the authority running                   |
| `npm run dev:server`  | Manual stdio development (can start authority)           |
| `npm run build`       | Build shared, server, frontend                           |
| `npm start`           | Serve built UI, API, SSE, and HTTP MCP on port 3001      |
| `npm run check`       | Strict TypeScript checks and all builds                  |
| `npm test`            | Build, simulation/integration tests, UI interaction test |
| `npm run test:server` | Server tests; stdio integration expects built output     |
| `npm run test:web`    | React interaction checks in JSDOM                        |

Tests cover lease contention and expiry, invalid tokens, repeated release, bounds, malformed commands, action cancellation, completion, camera field of view, drone flight, arm transfer, reset/demo cancellation, revision ordering, HTTP/SSE, actual MCP clients over HTTP and stdio, and the full four-body guided mission. The UI test covers possession, movement, observations, body switching, stale snapshots and reconnection. GitHub Actions runs typechecks, builds and tests.

**Visual progress:** `npm run capture` runs the actual app in headless Chromium with software WebGL, records the full four-body mission, captures desktop and mobile layouts, and performs a rover inspection through touch-emulated controls. It also captures a small JPEG for limited-service mobile viewing. Outputs go to `work/captures`; CI archives them as `ghost-visual-progress`. The [latest visual report](docs/progress/latest/README.md) includes selected screenshots and the demo video. Run `npx playwright install --with-deps chromium` and install FFmpeg if they are not available; `GHOST_BROWSER_PATH` can select a system Chromium executable.

**Verification limit:** Desktop and mobile-emulated browser runs are verified; physical phone/GPU behavior and pinch gestures remain a target-device check. Vite's large Three.js bundle warning is non-fatal.

## See what the agent sees

**Real agent progress:** [A new fresh-context agent inspected all 3 tagged crates, surveyed all 96 floor cells and verified priority dispatch](docs/progress/survey/README.md). The report includes a 30 KB phone preview, short edited highlights, original MCP trace and remaining limits. [Initial run: 2 of 3 crates inspected](docs/progress/agent/README.md). [Run and record agent missions](docs/agent-missions.md).

**Body camera** switches the main warehouse viewer to the selected body's live optics: Sentinel's mounted lens, Scout's mast, Wisp's downward-facing camera, or Atlas's wrist camera. Switch back to **Warehouse view** to orbit, pan and zoom. Mobile bodies initially face into the hall, and cargo has physical labels on its faces.

**Agent vision** displays the last captured image for that body, with its revision and UTC timestamp. This is a frozen image, not a video stream. It is the exact JPEG returned by `observe({ leaseId, image: true })`; the live world can advance after capture. Browser owners can also choose **Capture sensor frame**. Capturing in the console prepares a frame but does not send it to a model on its own.

The server runs one lazy, serial Chromium/software-WebGL renderer using the same warehouse scene and optical rigs as the UI. It renders a frozen authority snapshot without a spectator browser, API credentials, external assets, or network access. It sleeps between captures; up to four requests can be queued. No frame is returned if the lease expires or is released while rendering. A restart clears frames. The Manufact Docker image includes Chromium. For a non-container install, run `npx playwright install --with-deps chromium` or set `GHOST_BROWSER_PATH` to a system Chromium executable. Missing browser/WebGL support produces an explicit tool error; structured observations still work.

The MCP image content is available to a multimodal agent. In compatible MCP Apps hosts, mcp-use also renders the same image in a compact in-chat card. The standalone console is custom React/Three.js; mcp-use supplies the embedded app runtime, hooks and host bridge. A local MCP Apps host is tested; **a signed-in ChatGPT connection remains unverified and requires the hosted OAuth integration**. This does not add a model or make the scripted tour autonomous.

Images include normal scene occlusion. Structured telemetry and inspection eligibility still use analytic range/FOV checks and can report cargo hidden behind a rack; they are explicitly separate signals. `node scripts/capture-sensors.mjs` verifies all four actual JPEGs, HTTP/stdio delivery, pixel identity in the embedded card, and the phone layout.

```text
apps/server/       Simulation, MCP tools, stdio adapter, HTTP/SSE bridge
apps/web/          React console and procedural Three.js warehouse
packages/shared/   Typed contracts and body definitions
docs/              Design and demo playbook
```
