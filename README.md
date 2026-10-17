# ghost

**GHOST — Any agent. Any body.**

An MCP interface for agents to discover, temporarily possess, observe, control, and release simulated physical resources in an interactive Three.js warehouse.

Built for the YC hackathon, October 2026. The agent is the ghost; the machine is its host.

## Status

This repository is a runnable scaffold, not a complete simulation.

- React + Three.js preview with four selectable placeholder markers: camera, rover, robotic arm, and drone.
- MCP server over stdio with a working `discover` tool returning a static catalog.
- Shared TypeScript resource definitions, strict type checking, and an npm lockfile.
- Possession, leases, observations, movement, and frontend/server synchronization are planned, not implemented.

## Quick start

Use Node 24 LTS (see `.nvmrc`) and npm. Node 20.19+ or 22.12+ also satisfy the toolchain requirements.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally http://127.0.0.1:5173. Select a resource with the sidebar buttons or its marker in the scene.

Run the MCP server separately:

```sh
npm run dev:server
```

It waits for an MCP client on stdin; it is not an HTTP endpoint. The frontend currently uses the same static catalog and does not connect to this process. No credentials or environment variables are required.

## Connect an MCP client

Build first with `npm run build`, then use the following configuration in a client that supports stdio MCP servers. Replace the path with your checkout's absolute path:

```json
{
  "mcpServers": {
    "ghost": {
      "command": "node",
      "args": ["/absolute/path/to/ghost/apps/server/dist/index.js"]
    }
  }
}
```

Call `discover` with `{}`. It returns the four resource definitions with `mode: "scaffold"`; it does not claim they have live leases or availability. Launch the built entry point directly for client integration so npm's script output cannot interfere with stdio.

## Workspace

```text
apps/server/       MCP entry point; future simulation authority
apps/web/          Vite + React + React Three Fiber warehouse preview
packages/shared/  Resource types and static demo catalog
docs/design-plan.md  Draft architecture, tool contract, and milestones
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend |
| `npm run dev:server` | Start the stdio MCP server |
| `npm run typecheck` | Check all workspaces |
| `npm run build` | Build shared package, server, and frontend in order |
| `npm run check` | Run type checking and all builds |

Root development commands build the shared package first. After changing shared definitions, rerun its build or restart the development command. There is intentionally no task orchestrator or watch pipeline yet.

## Next step

Review the [draft design plan](docs/design-plan.md). Start with one complete rover possession cycle before expanding behavior to all four body types.

Technical references: [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server), [Vite](https://vite.dev/guide/), and [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction).
