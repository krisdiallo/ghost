# GHOST

GHOST — Any agent. Any body. A YC hackathon project for agents inhabiting simulated camera, rover, robotic arm, and drone bodies through MCP.

Read `README.md` for current functionality, `docs/design-plan.md` for the implemented architecture, and `docs/demo-playbook.md` for the mission and recovery. All four bodies, leases, observations, control, synchronization, and the scripted guided mission are implemented. Keep future changes small and practical.

## Setup and verification

- Use Node 24 (24.15+; see `.nvmrc`) and npm workspaces.
- Install from the repository root: `npm ci`.
- Validate: `npm run check` (strict TypeScript checks and production builds) and `npm test` (build + server/MCP integration + UI interaction tests).
- `npm run dev` starts both the authoritative server on loopback port 3001 and Vite UI on 5173. It reuses an existing authority. `npm start` serves the production build and API on 3001.
- MCP clients use `http://127.0.0.1:3001/mcp` or launch `node /workspace/ghost/apps/server/dist/index.js` directly after building. Do not launch through npm: stdout must contain only MCP messages.
- The stdio adapter reuses the authority; if it starts an embedded authority, that authority lives only as long as the owning stdio client. Use the standalone server for stable multi-client demos.
- No secrets, LLM provider, or external services are required. The guided demo is scripted, not an LLM agent.
- UI interactions are tested in JSDOM and in real headless Chromium with software WebGL. `npm run capture` records the full mission, captures desktop/mobile screenshots, and runs a touch-emulated rover inspection. Physical phone/GPU behavior is a separate check.
- The user is traveling on mobile: continuously integrate and merge passing changes without asking them to review PRs. Send visual progress reports with actual screenshots, short demo recordings, and concrete examples. Keep `docs/progress/latest` current with selected captures; CI archives every capture run. Do not substitute code-review links for visual reports.

## Boundaries

- `apps/server`: single authoritative simulation, lease manager, typed command validation, HTTP/SSE and MCP transports.
- `apps/web`: presentation, manual controls, sensor output, scene interpolation. Never decide command success in browser animation.
- `packages/shared`: contracts and body/capability definitions used by both applications.
- Preserve token privacy: lease IDs never go in public snapshots or logs. Agent display names are not authentication.
- Preserve focused tests for leases, command validation, cancellation, and state synchronization.
- Public snapshots are spectator views. Agent observations use per-body sensor visibility and range.
- Shared survey history contains only leased observations and successful inspections. Credit sampled floor checkpoints only from stationary observations with range/FOV and static line of sight; mark points inside structures x and exclude them from the denominator. Never infer swept-path or whole-area coverage. Discovery must not disclose unseen cargo IDs/counts. Distinguish analytic floor telemetry coverage from image visibility and inventory completeness. Reset/restart clears history; release/expiry preserves it.
- `observe({leaseId,image:true})` adds a server-rendered JPEG and an HTTP MCP Apps view using mcp-use. Both optics and scene are shared with the live viewer. Never substitute an orbit-camera screenshot for an agent sensor frame. Captured frames are historical and revision-tagged. Renderer assets are intercepted locally; never give the renderer credentials or Internet access. See the README for Chromium setup and `scripts/capture-sensors.mjs` for real image and embedded-view checks.
- Fresh-agent experiments are in `docs/agent-missions.md`, `docs/progress/agent` (initial incomplete run), and `docs/progress/survey` (all tagged cargo and prior analytic floor cells verified). Current navigation/occlusion evidence belongs in `docs/progress/navigation`. Keep MCP tool descriptions generic; do not insert a canned route. The recorder forwards external decisions and does not run a model. Distinguish real agent runs from scripted CI smoke tests. Preserve failed observations and incomplete coverage in reports; do not infer that a model viewed every image file the server saved.
- Motion uses shared static solid envelopes and swept body-clearance checks; blocked moves/landings are rejected. No automatic path planning, moving-body collision, rigid-body physics, or real hardware. Drone look must preserve a running motion and world aim when heading changes. Keep obstacle positions shared with the hall and map. Historical reports predate these rules and must remain unchanged.
- Keep the API loopback-only by default. Remote binding requires a private `GHOST_ACCESS_TOKEN` and exact HTTPS `GHOST_ORIGIN`; browser sessions and MCP bearer headers protect application endpoints. Health and OAuth discovery/authorization routes are public, with explicit key-based consent. Hosted MCP supports OAuth with rotating tokens; this remains a single-owner demo, not individual user accounts. See `docs/manufact-deployment.md` for deployment and OAuth details. Use one replica for the in-memory authority.
- Avoid extra frameworks, databases, hardware integrations, model providers, or deployment infrastructure unless requested.
