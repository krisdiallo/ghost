# GHOST v0 design plan

Status: draft for discussion. This document describes future behavior; only the scaffold described in the README exists today.

## Demo outcome

An agent discovers a warehouse's available bodies, possesses one for a bounded period, observes the world, issues a supported command, and releases it. The browser shows the same authoritative state and highlights the currently possessed body. A second agent cannot control a body with an active lease.

The first end-to-end milestone is a rover moving to an inspection point. The final demo switches between camera, rover, arm, and drone, making the difference between intelligence and interchangeable bodies visible.

## Scope

One local warehouse, one server process, four resource instances, and in-memory state. Use simple geometry and deterministic movement. A restart resets the scene and invalidates all leases.

Defer real hardware, payments, accounts, persistence, distributed locks, realistic physics, collision avoidance, path planning, and multi-warehouse scheduling. Do not imply hardware interoperability from this simulation.

## Architecture

```text
Agent / MCP client ── stdio ──> apps/server
                               ├─ MCP tools
                               ├─ resource registry + lease manager
                               ├─ authoritative simulation state
                               └─ local state stream ──> apps/web
                                                         React + Three.js
packages/shared: typed contracts used by both applications
```

Keep stdio for the first local agent demo. The same server process will expose a loopback-only HTTP snapshot endpoint and a server-sent event stream for browser updates. Sending the complete small world snapshot avoids complex patch ordering. Add Streamable HTTP MCP only if the demo needs multiple independent client connections; do not run multiple stdio processes and pretend they share a warehouse.

The server validates commands and owns positions, lease expiry, and scene revisions. React renders snapshots and interpolates positions for smooth movement. Browser animation must never decide whether an action succeeded. Reconnection fetches a new snapshot; sequence numbers allow stale updates to be ignored. Manual controls, if added, must use the same command validation path.

## Proposed tool contract

| Tool | Input | Result |
| --- | --- | --- |
| `discover` | Optional resource kind | IDs, capabilities, live availability, and lease limits |
| `possess` | `resourceId`, `ttlSeconds` | Opaque `leaseId`, resource snapshot, expiry |
| `observe` | `leaseId` | Timestamped pose, resource state, visible scene objects |
| `act` | `leaseId`, typed command | Accepted/completed status, action ID, resulting revision |
| `release` | `leaseId` | Released status; repeated release is harmless |

Possession means an exclusive, expiring lease. Suggested default TTL: 60 seconds, bounded to 5–300 seconds. Require an unexpired matching lease for observation and control. `discover` remains read-only. A lease token is a capability for this trusted local demo; an agent name alone is not authentication. Exclude tokens from public scene snapshots and the activity feed.

Use explicit errors such as `RESOURCE_NOT_FOUND`, `RESOURCE_BUSY`, `LEASE_EXPIRED`, `INVALID_COMMAND`, and `OUT_OF_BOUNDS`. Check and grant leases atomically within the process. Use a monotonic deadline internally and a wall-clock expiry for display. Expiry or release cancels pending motion, clears possession, and returns the resource to availability. Retain released lease IDs briefly to support idempotent release. Never queue a command past its lease.

For movement, return an action ID when accepted; `observe` reports completion or cancellation. Serialize actions per resource. Define command schemas as a discriminated union rather than accepting arbitrary action names and payloads.

## Bodies and initial capabilities

| Body | First command | Initial observation |
| --- | --- | --- |
| Camera | Set pan/tilt within limits | Pose, viewing direction, visible object IDs |
| Rover | Move to an in-bounds floor coordinate | Pose, motion status, nearby object IDs |
| Robotic arm | Move to a preset; grasp/release a nearby demo crate | Joint/preset state, held object ID |
| Drone | Take off, move to a bounded 3D point, land | Pose, flight state, visible object IDs |

Observation starts as structured simulation data, not an image or a claimed camera feed. Rendered image observations are a separate stretch goal. Motion remains kinematic; reject targets outside warehouse bounds. Arm grasping uses a simple reach threshold, and drone movement uses an altitude limit. This is enough to demonstrate the API without a physics engine.

## Interface

Warehouse scene, resource list, selected-body panel, lease countdown, and compact activity feed. Distinguish selected from possessed. Show agent activity through a glow or small ghost indicator; animate transitions only after state updates confirm possession. Keep keyboard-accessible sidebar controls alongside scene picking.

The browser should clearly show connecting, live, disconnected, and expired states. On disconnect, keep the last frame visible but mark it stale. Do not simulate successful actions locally.

## Implementation milestones

1. **Rover vertical slice:** in-memory registry, exclusive expiring leases, five MCP tools for the rover, and bounded movement. Verify acquire → observe → act → observe → release with an actual MCP client.
2. **Live warehouse:** snapshot endpoint and state stream, frontend reconciliation, lease display, and activity feed. Confirm browser and agent see the same pose and possession state.
3. **Four bodies:** camera orientation, arm preset/grasp, drone takeoff/move/land, per-kind schemas, and a body-switching demo.
4. **Demo polish:** distinctive meshes, possession animation, one repeatable task, and a documented reset procedure.

## Checks to add with behavior

Test lease contention, expiry during motion, use of wrong/released tokens, duplicate release, malformed commands, bounds, action cancellation, and state ordering. Add an MCP integration test for the complete rover cycle and a browser check for selection, reconnect, and live state updates. Use an injectable clock for expiry tests.

## Decisions for our next discussion

- Demo mission: inspect a crate across the warehouse, or retrieve and relocate it?
- Is structured observation enough for judging, or are rendered camera images essential?
- Will one agent switch bodies, or must independent agents compete for resources in the demo?

Recommended starting point: one agent, structured observations, and a rover inspection task. Expand only after the full cycle is visible and reliable.
