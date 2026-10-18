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
- `observe({leaseId,image:true})` adds a server-rendered JPEG and an HTTP MCP Apps view using mcp-use. Both optics and scene are shared with the live viewer. Never substitute an orbit-camera screenshot for an agent sensor frame. Captured frames are historical and revision-tagged. Renderer assets are intercepted locally; never give the renderer credentials or Internet access. See the README for Chromium setup and `scripts/capture-sensors.mjs` for real image and embedded-view checks.
- The fresh-agent experiment is in `docs/agent-missions.md` and `docs/progress/agent`. Keep MCP tool descriptions generic; do not insert a canned route. The recorder forwards external decisions and does not run a model. Distinguish real agent runs from scripted CI smoke tests. Preserve failed observations and incomplete coverage in reports; do not infer that a model viewed every image file the server saved.
- This is kinematic simulation, without collision avoidance, realistic physics, or real hardware.
- Keep the API loopback-only by default. Remote binding requires a private `GHOST_ACCESS_TOKEN` and exact HTTPS `GHOST_ORIGIN`; browser sessions and MCP bearer headers protect every endpoint except the health probe. This is a shared-key demo, not per-user OAuth. See `docs/manufact-deployment.md` for the Manufact deployment and current access blockers. Use one replica for the in-memory authority.
- Avoid extra frameworks, databases, hardware integrations, model providers, or deployment infrastructure unless requested.
