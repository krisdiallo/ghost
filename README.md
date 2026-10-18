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

1. Sentinel locates and scans Cargo 07.
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

Independent clients share one warehouse. The endpoint is stateless at the transport layer; leases are opaque capabilities and are held by the simulation, not by HTTP sessions.

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

| Tool       | Input                                 | Result                                                           |
| ---------- | ------------------------------------- | ---------------------------------------------------------------- |
| `discover` | `{ kind? }`                           | Live bodies, availability, capabilities, bounds and lease limits |
| `possess`  | `{ resourceId, ttlSeconds?, owner? }` | Private `leaseId`, body and expiry                               |
| `observe`  | `{ leaseId }`                         | Pose, action status, sensor-visible cargo, last inspection       |
| `act`      | `{ leaseId, command }`                | Action ID/status/revision, inspection result when applicable     |
| `release`  | `{ leaseId }`                         | Idempotent release; pending movement cancelled                   |

Default TTL is 60 seconds, bounded to 5–300. Competing possession returns `RESOURCE_BUSY`. Expiry uses a monotonic clock and cancels movement. Observe and act require a valid lease. Commands are validated through strict per-command schemas on both HTTP and MCP paths. Motion returns `running`; poll `observe` for completion. Commands serialize per body. Work that would outlast its lease is rejected.

## Model and boundaries

- One server owns all positions, actions, objects, leases and mission progress in memory. Restart resets the world and invalidates tokens.
- Browser snapshots and SSE use instance IDs and revisions. Reconnect receives a full snapshot; older revisions are ignored. Offline frames are marked stale and controls disabled.
- Camera observations use orientation and field of view; rover and drone inspections enforce range. Observations are **structured simulation data**, not images.
- Motion is deterministic and kinematic. There is no collision avoidance, path planning, rigid-body physics, or hardware integration. Shelves are scenery.
- Arm presets are `home`, `reach`, and `drop`; grasping checks reach. Release/expiry cancels motion; suspended drones hold position and held cargo remains attached for the next valid lease.
- The server is a **trusted local demo**, not a multi-tenant service. Lease IDs authorize control; display names are not authentication. Public spectator snapshots contain the whole scene. The loopback API has Origin/Host checks, payload limits and no wildcard CORS.

## Cloud access

The default listener is loopback-only. To use a platform-provided **private, authenticated** port forward, configure `GHOST_HOST` if needed and `GHOST_ORIGIN` to its exact browser origin. Host/Origin checks accept only the configured origin plus local development URLs. Example variables (substitute the platform's actual private URL):

```text
GHOST_HOST=0.0.0.0
GHOST_ORIGIN=https://your-private-forward.example
GHOST_PORT=3001
```

Do not expose this unauthenticated control API on a public port. Publishing the cloud environment does not itself publish the web app. No public tunnel or new hosting infrastructure is created here.

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

```text
apps/server/       Simulation, MCP tools, stdio adapter, HTTP/SSE bridge
apps/web/          React console and procedural Three.js warehouse
packages/shared/   Typed contracts and body definitions
docs/              Design and demo playbook
```
