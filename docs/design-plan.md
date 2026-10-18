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

- Structured observations with per-body visibility and inspection range; optional server-rendered image observations with shared optical rigs. HTTP MCP binds observations to a mcp-use MCP Apps view.
- Inspect-first mission, followed by the arm's small deterministic cargo-transfer step.
- One ghost switches bodies in the guided tour; independent agents can also compete through the shared HTTP authority.
- Exclusive opaque-capability leases: default 60 seconds, bounds 5–300, contention rejection, monotonic expiry, no token disclosure in public state. Released IDs are retained for ten minutes for idempotent release.
- Bounds and typed commands enforced on every transport. Motion returns an action ID, serializes per body, and rejects work that cannot finish before lease expiry.
- Stop, release and expiry cancel pending motion. Drones hold their last altitude; held cargo remains attached until a valid lease places it. Reset cancels every lease and the guided script.
- Public spectator snapshots include complete scene state; leased sensor observations are restricted by orientation/range. Display names are labels, not identities.
- Full snapshots with process instance IDs and increasing revisions. Reconnect replaces stale state, older revisions are ignored, controls disable offline. Render interpolation never decides command success.

## Body behaviors

| Body              | Commands                                                        | Observation                                         |
| ----------------- | --------------------------------------------------------------- | --------------------------------------------------- |
| Camera / Sentinel | `look` pan/tilt, `inspect`                                      | 70° horizontal / 43° vertical view; cargo under 45m |
| Rover / Scout     | floor `move`, `inspect`, `stop`                                 | Cargo within 4m; inspect within 2.3m                |
| Arm / Atlas       | `preset` home/reach/drop, `grasp`, `place`                      | Cargo within 2.8m; grasp checks gripper reach       |
| Drone / Wisp      | `takeoff`, bounded 3D `move`, `look`, `inspect`, `land`, `stop` | Cargo within 9m; aerial inspect within 5m           |

Warehouse footprint: 64 × 44 m (2,816 m²), with 12 m clear flight height. Authoritative floor bounds: X −31…31, Z −33…9. Airborne targets use Y 0.8…12. Ground heights and arm presets are fixed simulation conventions. Motion is linear at a body-specific speed, with swept static-obstacle checks but no automatic route planning or rigid-body physics.

## Interface

Responsive operations console with distinct procedural machines, 16 four-tier storage bays, six loading docks, a high-bay steel shell, overhead lights, mezzanine control room and cargo, camera facility/mission/top/focus views, accessible fleet selection, possession countdown, coordinate and floor-pick controls, structured sensor output, mission checklist and live activity stream. A guided run, stop action and confirmed reset make the demo repeatable. Browser tokens survive reload via session storage; restart invalidates them. Fonts are self-hosted and there are no external scene assets.

## Validation and limits

Focused simulation tests cover leases, contention, schema validation, bounds, cancellation, sensor visibility and body behavior. Integration tests initialize real HTTP and stdio MCP clients, assert one shared authority and SSE snapshots, and run the full guided mission. React/JSDOM tests cover possession, movement, observations, body switching, stale snapshots and reconnection. CI runs strict typechecks, builds and tests.

Actual WebGL rendering and desktop/mobile layouts are checked by a repeatable Chromium capture run. It records the complete mission and performs a rover inspection through touch-emulated controls. CI retains the screenshots, video, and machine-readable report. Physical device/GPU behavior and pinch gestures remain target-device QA. No real hardware, persistence, individual accounts, model provider, or automatic route planning has been added. Static collision rejection is implemented. The private Manufact deployment is live. Hosted MCP adds SDK-based OAuth with key-based consent and rotating tokens; browser access remains a shared-key demo. Local and hosted transports share Host/Origin checks, tool validation and one simulation authority.

The facility overview frames the full industrial hall. Starting the guided mission or selecting a body frames that body at its actual location. Follow mode tracks translation while preserving the viewing angle. Visible Orbit/Pan and zoom buttons support mouse and touch controls; two fingers pan and zoom. A whole-warehouse map supplies destinations and fleet positions. Immersive mode fills the viewport while retaining a compact possession/action dock, fleet switcher, map, and tour controls. Preset transitions stop when the user takes over the camera. Repeated storage and structural parts use instanced geometry so scene detail does not add hundreds of individual draw calls. Report pages load one small JPEG by default, with larger captures and video available on demand for mobile users.

Sentinel is fixed to the southwest structural column at X −30.2 / Y 10 / Z 8, with a visible bracket rather than a floor stand. Its 104° pan / −16° tilt home pose watches the open inspection and dispatch forecourt. The camera has a 45 m analytic sensor range and 70° × 43° field of view; shared solid rack/building envelopes occlude telemetry and inspection. The viewer frames the wall mount from inside the building when Sentinel is selected.

## Body camera and MCP Apps

`observe({leaseId,image:true})` freezes one authoritative snapshot and renders a 640 × 360 JPEG with shared camera rigs and the existing warehouse scene. One lazy Chromium worker serializes captures and sleeps between requests; its intercepted asset requests read only the local built UI. It never receives an access key or contacts the authority/Internet. Lease validity is checked before and after capture. The same frame ID, revision, timestamp and bytes are available to the authenticated spectator UI. Captures are historical, separate from the live body-camera view.

MCP returns the image as an image content block, frame metadata as structured content, and view-only image bytes in `_meta`. HTTP uses mcp-use’s inline MCP Apps resource and React host hooks to show the same frame in a card; stdio carries image content without the card. The embedded bundle is self-contained and uses no credential-bearing image URLs. Chromium is included in the Manufact image. The local host harness verifies the app handshake and pixel identity; signed-in ChatGPT verification remains separate from the tested hosted OAuth protocol. Proximity telemetry and images share static obstruction checks, while optics and conservative envelope geometry differ.

## Initial fresh-agent experiment

A Codex subagent with no inherited chat or repository context operated all four bodies through MCP, viewed nine images, staged cleared Cargo 07 and reported an abrasion on Cargo 12. It missed Cargo 18, so coverage remains incomplete. Two recorder preview waits timed out; the agent recovered with telemetry. The recorder now focuses the observed body and preserves tool results when presentation fails. The actual trace, image-viewing attestation, post-run authority verification and 4× recording are in [the agent report](progress/agent/README.md). This is a real external-agent run, not a built-in autonomous model runner.

## Shared survey history

Discovery exposes each body's limits, the static obstacle floorplan, and a 12 × 8 lattice of floor checkpoints at Y 0.55 m. Stationary observations credit individual unobstructed points within range/FOV. Checkpoints inside structures are x and excluded; unknown points remain 0. Sampling does not certify whole-cell areas, elevated cargo or exhaustive inventory. Moving polls return live objects without crediting a swept path.

The shared cargo ledger records only actual observations and successful inspections, preserving historical positions and findings across leases. No undiscovered cargo IDs or expected count enter MCP discovery. Reset/restart clears history. UI snapshots and SSE carry the same history.

Before collision/occlusion rules were added, the follow-up [fresh-agent mission](progress/survey/README.md) completed all 96 analytic floor cells, inspected all 3 tagged crates, staged priority cargo and safely released its bodies. It viewed 18 actual images and used camera, arm and drone by its own choice. The run had no MCP or image-delivery errors. This is one real multimodal tool-use example, not a guaranteed inventory planner or a controlled comparison with the earlier run.

## Navigation realism

The shared hall layout supplies packed rack bays, freight positions and structural columns. Static AABBs represent packed racks, freight, walls and mezzanine structures. Full-segment intersection against expanded boxes prevents rover/drone tunnelling, including takeoff and landing. Rejection preserves pose and pending motion, publishes the blocking point, and appears in the shared map/activity stream. These are static envelopes, not a rigid-body physics engine or dynamic robot/cargo collision system.

Telemetry and inspection require line of sight from the body's sensor origin. The survey now counts visible floor checkpoints, with structural points excluded, rather than claiming whole-cell visibility through shadows. Previous 96-cell reports are historical examples from the earlier model. Drone world pan/tilt controls a visible gimbal and the shared optical rig, can be changed during flight, and never replaces a running movement.

The [navigation mission](progress/navigation/README.md) independently verified this model: a fresh-context agent inspected 3/3 tagged crates, observed all 85 eligible checkpoints, staged priority cargo and released every lease. It recovered from a rejected inter-rack move by overflying racks at 9 m. The report preserves that error, all 28 actually viewed images, the original MCP trace and recording. Full checkpoint coverage is not a proof of exhaustive inventory.


## Isolated workflow experiments

The [experiment lab](experiment-lab.md) adds operator tools alongside embodiment. A bounded ExperimentLab manager holds saved draft definitions and independent run Simulation instances, while the live warehouse stays separate. The existing command implementation validates workflow actions. A deterministic simulated clock separates playback from results.

Definitions include edited structures, configurable temporary devices, cargo/mass and a role-bound sequential workflow. Scale drives rendering, clearance and mounting offsets. Actual trial images use the frozen-snapshot renderer. Reports retain source revision, inputs, errors, metrics and assumptions. Comparisons check fingerprints; aborted runs cannot win on elapsed time.

The lab UI provides drafts, a live 3D viewer, device/layout/workflow editing, traces, comparison and JSON export/import on desktop/phone. State is in memory. Operator definitions disclose the whole scenario and are separate from blind sensing. Physics, arbitrary-building reconstruction, hardware calibration and battery modeling remain outside this version.
