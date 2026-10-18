import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCPServer, registerViews } from "mcp-use";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ToolName, Observation } from "@ghost/shared";
import { schemas } from "./contracts.js";
import { SimError } from "./simulation.js";

const descriptions: Record<ToolName, string> = {
  discover:
    "Discover live warehouse bodies, availability, sensor/inspection and handling limits, lease limits and bounds. Start here. Coordinates are in meters; y is up. Includes shared survey grid history and known cargo from actual observations; use unknown checkpoints and static navigation geometry to plan your own search. Read surveyGuide before interpreting coverage.",
  possess:
    "Acquire an exclusive expiring lease on a body. Keep the returned opaque leaseId private. Default 60s, range 5–300s. Set owner to an agent display name.",
  observe:
    "Observe through the possessed body's sensors. Returns pose, limits, analytic cargo telemetry, last inspection, action completion and shared survey history. Stationary observations credit visible floor checkpoints; motion polls do not credit a swept path. Set image:true for a server-rendered 640x360 body camera JPEG as MCP image content, plus an embedded viewer in MCP Apps hosts. Frames are frozen at their reported revision; image visibility includes scenery occlusion while cargo telemetry uses range and static-obstacle line-of-sight checks.",
  act: "Control a possessed body with a typed command. move: rover x/z or airborne drone x/y/z. look: fixed camera or drone gimbal pan/tilt in degrees. inspect: visible nearby cargo. arm: preset home/reach/drop, grasp objectId, place; choose drop before placing in dispatch. Drone: takeoff/land. stop cancels motion. Poll observe for completion. Use observations to find cargo and decide where to move; direct paths are checked against static obstacles and body clearance; PATH_BLOCKED rejects the entire motion. Use discover navigation geometry to choose aisle waypoints. Drone look pan/tilt aims its gimbal in world degrees without changing flight or replacing a running motion.",
  release:
    "Release a lease and cancel its pending motion. Repeated release is harmless. A drone holds its last altitude, and a held crate stays attached.",
};
type Dispatch = (name: ToolName, input: unknown) => unknown | Promise<unknown>;

async function execute(dispatch: Dispatch, name: ToolName, input: unknown) {
  try {
    const result = await dispatch(name, input);
    const frame =
      name === "observe" ? (result as Observation).frame : undefined;
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
          readOnlyHint: name === "discover" || name === "observe",
          openWorldHint: false,
          destructiveHint: false,
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
          readOnlyHint: name === "discover" || name === "observe",
          openWorldHint: false,
          destructiveHint: false,
        },
      },
      async (input: unknown) => execute(dispatch, name, input),
    );
  }
  return server;
}
