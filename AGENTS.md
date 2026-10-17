# GHOST

GHOST — Any agent. Any body. A YC hackathon project for agents inhabiting simulated camera, rover, robotic arm, and drone resources through MCP.

Read `README.md` for current functionality and `docs/design-plan.md` for the proposed design. The plan is a draft, not permission to implement every milestone automatically. Keep changes small and practical.

## Setup and verification

- Use Node 24 and npm workspaces.
- Install from the repository root: `npm ci`.
- Validate: `npm run check` (strict TypeScript checks and production builds).
- Frontend: `npm run dev`.
- MCP server: `npm run dev:server`, or build and launch `node apps/server/dist/index.js` from an MCP client.
- No secrets or external services are needed for the scaffold.

## Boundaries

- `apps/server`: MCP tools and future authoritative simulation state.
- `apps/web`: React/Three.js presentation and interaction.
- `packages/shared`: contracts and shared resource definitions.
- Do not write logs to stdout in the stdio MCP server.
- Do not claim static preview data is live simulation state.
- Add focused behavioral tests when implementing leases, command validation, or state synchronization.
- Avoid extra frameworks, databases, real hardware integrations, and deployment infrastructure unless requested.
