# GHOST v0 design

Status: implemented in the cloud checkout. This supersedes the initial scaffold proposal. Runtime details and commands are in the [README](../README.md); the [demo playbook](demo-playbook.md) covers presentation and recovery.

## Outcome

One agent can discover, lease, observe, control and release four simulated body types. The browser renders the same server-owned warehouse state. The guided mission locates Cargo 07 with a camera, sends the rover down the west aisle to inspect Cargo 12, and flies the drone above the racks to scan Cargo 18 at the north loading docks. Both return to verify Cargo 07 before the arm transfers it to dispatch. The guided path is scripted; an external MCP client supplies real agent reasoning.

## Architecture

```text
Agent / stdio MCP adapter ── local HTTP tools ──┐
Independent MCP clients ── /mcp HTTP ──────────┤
Browser controls ── /api/tools/* ──────────────┤
                                             v
                              One Node warehouse authority
                              ├─ registry + monotonic lease deadlines
                              ├─ command validation + deterministic simulation
                              ├─ mission state + bounded activity history
                              └─ snapshots/SSE ── React / Three.js
```

Node serves production static assets and the API on loopback port 3001 by default. HTTP MCP uses mcp-use; stdio retains the official SDK adapter. Hosted mode uses a shared bearer key and HttpOnly browser sessions, and requires one replica and an exact HTTPS origin. See [Manufact deployment status](manufact-deployment.md). Development uses Vite port 5173 with a same-origin proxy. All transports dispatch into the same five-tool implementation. A stdio client attaches to an existing authority or starts an embedded one if absent; stable multi-client demos use the standalone process. Streamable HTTP uses stateless transport with shared in-process state.

## Decisions implemented

- Structured observations, with per-body visibility and inspection range; no rendered image observations.
- Inspect-first mission, followed by the arm's small deterministic cargo-transfer step.
- One ghost switches bodies in the guided tour; independent agents can also compete through the shared HTTP authority.
- Exclusive opaque-capability leases: default 60 seconds, bounds 5–300, contention rejection, monotonic expiry, no token disclosure in public state. Released IDs are retained for ten minutes for idempotent release.
- Bounds and typed commands enforced on every transport. Motion returns an action ID, serializes per body, and rejects work that cannot finish before lease expiry.
- Stop, release and expiry cancel pending motion. Drones hold their last altitude; held cargo remains attached until a valid lease places it. Reset cancels every lease and the guided script.
- Public spectator snapshots include complete scene state; leased sensor observations are restricted by orientation/range. Display names are labels, not identities.
- Full snapshots with process instance IDs and increasing revisions. Reconnect replaces stale state, older revisions are ignored, controls disable offline. Render interpolation never decides command success.

## Body behaviors

| Body              | Commands                                                | Observation                                         |
| ----------------- | ------------------------------------------------------- | --------------------------------------------------- |
| Camera / Sentinel | `look` pan/tilt, `inspect`                              | 70° horizontal / 60° vertical view; cargo under 45m |
| Rover / Scout     | floor `move`, `inspect`, `stop`                         | Cargo within 4m; inspect within 2.3m                |
| Arm / Atlas       | `preset` home/reach/drop, `grasp`, `place`              | Cargo within 2.8m; grasp checks gripper reach       |
| Drone / Wisp      | `takeoff`, bounded 3D `move`, `inspect`, `land`, `stop` | Cargo within 9m; aerial inspect within 5m           |

Warehouse footprint: 64 × 44 m (2,816 m²), with 12 m clear flight height. Authoritative floor bounds: X −31…31, Z −33…9. Airborne targets use Y 0.8…12. Ground heights and arm presets are fixed simulation conventions. Motion is linear at a body-specific speed, without collision avoidance or physics.

## Interface

Responsive operations console with distinct procedural machines, 16 four-tier storage bays, six loading docks, a high-bay steel shell, overhead lights, mezzanine control room and cargo, camera facility/mission/top/focus views, accessible fleet selection, possession countdown, coordinate and floor-pick controls, structured sensor output, mission checklist and live activity stream. A guided run, stop action and confirmed reset make the demo repeatable. Browser tokens survive reload via session storage; restart invalidates them. Fonts are self-hosted and there are no external scene assets.

## Validation and limits

Focused simulation tests cover leases, contention, schema validation, bounds, cancellation, sensor visibility and body behavior. Integration tests initialize real HTTP and stdio MCP clients, assert one shared authority and SSE snapshots, and run the full guided mission. React/JSDOM tests cover possession, movement, observations, body switching, stale snapshots and reconnection. CI runs strict typechecks, builds and tests.

Actual WebGL rendering and desktop/mobile layouts are checked by a repeatable Chromium capture run. It records the complete mission and performs a rover inspection through touch-emulated controls. CI retains the screenshots, video, and machine-readable report. Physical device/GPU behavior and pinch gestures remain target-device QA. No real hardware, persistence, individual accounts, OAuth, rendered observations, model provider, or collision/path planning has been added. A Manufact container and authenticated shared-key demo mode are prepared, but no public deployment is live. Local and hosted transports share Host/Origin checks, tool validation and one simulation authority.

The facility overview frames the full industrial hall. Starting the guided mission or selecting a body frames that body at its actual location. Follow mode tracks translation while preserving the viewing angle. Visible Orbit/Pan and zoom buttons support mouse and touch controls; two fingers pan and zoom. A whole-warehouse map supplies destinations and fleet positions. Immersive mode fills the viewport while retaining a compact possession/action dock, fleet switcher, map, and tour controls. Preset transitions stop when the user takes over the camera. Repeated storage and structural parts use instanced geometry so scene detail does not add hundreds of individual draw calls. Report pages load one small JPEG by default, with larger captures and video available on demand for mobile users.

Sentinel is fixed to the southwest structural column at X −30.2 / Y 10 / Z 8, with a visible bracket rather than a floor stand. Its 104° pan / −16° tilt home pose watches the open inspection and dispatch forecourt. The camera has a 45 m analytic sensor range and 70° × 60° field of view; rack occlusion is not simulated. The viewer frames the wall mount from inside the building when Sentinel is selected.
