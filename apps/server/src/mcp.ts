import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCPServer, registerViews } from "mcp-use";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ToolName, Observation } from "@ghost/shared";
import { schemas } from "./contracts.js";
import { SimError } from "./simulation.js";

const descriptions: Record<ToolName, string> = {
  operations:
    "Manage live local-autonomy jobs and operator incidents. status lists tasks, open incidents and placed boxes. start/pause control background device jobs. watch waits up to 25 seconds for an incident afterSequence (default 0); it returns immediately for an existing newer incident. ChatGPT must actively call watch: this is not unsolicited wake-up. place_box adds a simulated floor obstruction at x/z or ahead of Scout. For recovery, possess the affected body (local autonomy yields), observe with image:true, approach within 4m, then clear_box with incidentId and that body's leaseId. Clearance simulates operator removal; the rover has no gripper. Reposition/verify using act and observe, then resume with incidentId/leaseId. Resume checks the remaining route, releases the lease and returns work to local autonomy. Permanent structures cannot be removed. Experiments remain isolated; use sandbox/experiment tools separately.",
  discover:
    "Pass sandboxId to explore a sandbox; omit it for the live warehouse. Discover live warehouse bodies, availability, sensor/inspection and handling limits, lease limits and bounds. Start here. Coordinates are in meters; y is up. Includes shared survey grid history and known cargo from actual observations; use unknown checkpoints and static navigation geometry to plan your own search. Read surveyGuide before interpreting coverage.",
  possess:
    "Pass sandboxId to possess a draft sandbox device; its lease routes observe/act/release automatically. Acquire an exclusive expiring lease on a body. Keep the returned opaque leaseId private. Default 60s, range 5–300s. Set owner to an agent display name.",
  observe:
    "Observe through the possessed body's sensors. Returns pose, limits, analytic cargo telemetry, last inspection, action completion and shared survey history. Stationary observations credit visible floor checkpoints; motion polls do not credit a swept path. Set image:true for a server-rendered 640x360 body camera JPEG as MCP image content, plus an embedded viewer in MCP Apps hosts. Frames are frozen at their reported revision; image visibility includes scenery occlusion while cargo telemetry uses range and static-obstacle line-of-sight checks.",
  act: "Control a possessed body with a typed command. move: rover x/z or airborne drone x/y/z. look: fixed camera or drone gimbal pan/tilt in degrees. inspect: visible nearby cargo. arm: preset home/reach/drop, grasp objectId, place; choose drop before placing in dispatch. Drone: takeoff/land. stop cancels motion. Poll observe for completion. Use observations to find cargo and decide where to move; direct paths are checked against static obstacles and body clearance; PATH_BLOCKED rejects the entire motion. Use discover navigation geometry to choose aisle waypoints. Drone look pan/tilt aims its gimbal in world degrees without changing flight or replacing a running motion.",
  sandbox_list:
    "List isolated warehouse draft sandboxes, recent experiment runs, retention limits and model assumptions. Start experiment design here. Drafts and reports are in memory; export JSON to keep them.",
  sandbox_create:
    "Clone the live warehouse, another sandbox (sourceSandboxId), or a version-1 imported definition into an independent draft. No source leases/actions/inspection history are copied. Operator/design tools expose complete scenario cargo, unlike body sensor discovery.",
  sandbox_inspect:
    "Read a sandbox definition and spectator snapshot. This is operator scenario data, not a sensor observation. Save the versioned definition as JSON for import through sandbox_create.",
  sandbox_update:
    "Atomically replace a sandbox definition, including structures, cargo, device profiles and optional saved workflow. Supply expectedRevision from sandbox_inspect to prevent lost edits. Running/completed experiments keep their frozen definitions.",
  sandbox_add_device:
    "Create a temporary device in a sandbox with ID, kind, label, position and optional bounded profile. Supply expectedRevision. Profile scale uniformly changes mesh and clearance; speed is m/s, ranges are meters. Set airborne:false for a landed drone spawn. Only arms handle payload. Nothing changes in the live warehouse.",
  sandbox_delete:
    "Delete an unleased draft sandbox. Existing experiment forks and retained reports remain independent. Export its definition first if needed.",
  experiment_templates:
    "Get explicit starter workflow/device definitions and candidate parameters, including a standard-vs-compact drone aisle-fit trial. Templates are deterministic scripts, not agent decisions.",
  experiment_run:
    "Fork a sandbox's frozen definition and execute a typed sequential workflow. Actors map role names to device IDs; each step names an actor and command. Use saved workflow or provide one. Supply expectedRevision to reject a stale preview. Returns immediately with run ID; poll experiment_inspect. Simulated time is independent of playbackRate (1–8). Commands face the same leases, bounds, static collisions and sensor/inspection rules as manual control. Defaults stop on error and require safe end state.",
  experiment_inspect:
    "Read a run's exact frozen definition, workflow, step trace, metrics, fingerprints and assumptions. Set includeSnapshot for spectator state or imageResourceId for an actual JPEG from a trial device. Run state is read-only; use a new trial for changes. Operator access is not a blind agent benchmark.",
  experiment_cancel:
    "Cancel a running experiment, stop pending motion and release its leases. Captured progress remains in the report. This does not auto-land a drone or place held cargo; report safeEndState records recovery needs.",
  experiment_compare:
    "Compare 2–4 retained runs. Controlled comparisons require the same layout/cargo, workflow, actor kinds and launch poses; device profiles may differ. Failed/cancelled or mismatched runs are never advertised as speed improvements.",
  release:
    "Release a lease and cancel its pending motion. Repeated release is harmless. A drone holds its last altitude, and a held crate stays attached.",
};
type Dispatch = (name: ToolName, input: unknown) => unknown | Promise<unknown>;

async function execute(dispatch: Dispatch, name: ToolName, input: unknown) {
  try {
    const result = await dispatch(name, input);
    const frame = (result as { frame?: Observation["frame"] }).frame;
    const structuredContent = frame
      ? { ...(result as Observation), frame: { ...frame, data: undefined } }
      : result;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(structuredContent) },
        ...(frame
          ? [
              {
                type: "image" as const,
                data: frame.data,
                mimeType: frame.mimeType,
              },
            ]
          : []),
      ],
      structuredContent: structuredContent as Record<string, unknown>,
      ...(frame ? { _meta: { frameData: frame.data } } : {}),
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            code: error instanceof SimError ? error.code : "SERVER_ERROR",
            ...(error instanceof SimError && error.details
              ? { details: error.details }
              : {}),
            message:
              error instanceof SimError
                ? error.message
                : "Could not execute warehouse command.",
          }),
        },
      ],
    };
  }
}

// Manufact's SDK serves HTTP; stdio retains the official SDK adapter below.
// Both dispatch into the same long-lived Simulation, never a per-request world.
export function createHttpMcp(dispatch: Dispatch, oauthEnabled = false) {
  const server = new MCPServer({
    name: "ghost",
    version: "0.2.0",
    title: "GHOST — Any agent. Any body.",
    description: "Possess simulated machines in one live warehouse.",
    logging: { enabled: false }, // Tool inputs contain private lease capabilities.
    skills: false,
  });
  server[registerViews]({
    "body-view": {
      kind: "inline",
      // The SDK bundle contains HTML examples. Escape raw closing script tags
      // before placing the module inside an inline resource document.
      js: readFileSync(
        new URL("../../web/dist/mcp-view/body-view.js", import.meta.url),
        "utf8",
      ).replace(/<\/script/gi, "<\\/script"),
      css: readFileSync(
        new URL("../../web/dist/mcp-view/body-view.css", import.meta.url),
        "utf8",
      ),
    },
  });
  for (const name of Object.keys(schemas) as ToolName[]) {
    server.tool(
      {
        name,
        description: descriptions[name],
        inputSchema: schemas[name],
        ...(oauthEnabled
          ? {
              _meta: {
                securitySchemes: [
                  { type: "oauth2", scopes: ["ghost:control"] },
                ],
              },
            }
          : {}),
        ...(name === "observe"
          ? {
              outputSchema: z.object({
                at: z.number(),
                revision: z.number(),
                body: z.object({ id: z.string() }).passthrough(),
                objects: z.array(z.unknown()),
                inspection: z.unknown(),
                limits: z.record(z.string(), z.unknown()),
                survey: z.record(z.string(), z.unknown()),
                frame: z.record(z.string(), z.unknown()).optional(),
                context: z.record(z.string(), z.unknown()).optional(),
              }),
              view: {
                name: "body-view",
                description:
                  "The captured sensor frame returned to the agent, with body pose and inspection result.",
                prefersBorder: false,
              },
            }
          : {}),
        annotations: {
          readOnlyHint: [
            "discover",
            "observe",
            "sandbox_list",
            "sandbox_inspect",
            "experiment_templates",
            "experiment_inspect",
            "experiment_compare",
          ].includes(name),
          openWorldHint: false,
          destructiveHint: name === "sandbox_delete",
        },
      },
      async (input: unknown) => execute(dispatch, name, input),
    );
  }
  return server;
}

export function createMcp(dispatch: Dispatch) {
  const server = new McpServer({ name: "ghost", version: "0.1.0" });
  for (const name of Object.keys(schemas) as ToolName[]) {
    server.registerTool(
      name,
      {
        description: descriptions[name],
        inputSchema: schemas[name].shape,
        annotations: {
          readOnlyHint: [
            "discover",
            "observe",
            "sandbox_list",
            "sandbox_inspect",
            "experiment_templates",
            "experiment_inspect",
            "experiment_compare",
          ].includes(name),
          openWorldHint: false,
          destructiveHint: name === "sandbox_delete",
        },
      },
      async (input: unknown) => execute(dispatch, name, input),
    );
  }
  return server;
}
