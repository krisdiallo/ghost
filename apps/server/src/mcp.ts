import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolName } from "@ghost/shared";
import { CAMERA_SENSOR } from "@ghost/shared";
import { schemas } from "./contracts.js";
import { SimError } from "./simulation.js";

const descriptions: Record<ToolName, string> = {
  discover:
    "Discover live warehouse bodies, availability, capabilities, lease limits and bounds. Start here. Coordinates are in meters; y is up.",
  possess:
    "Acquire an exclusive expiring lease on a body. Keep the returned opaque leaseId private. Default 60s, range 5–300s. Set owner to an agent display name.",
  observe:
    "Observe through the possessed body's sensors. Returns pose, visible cargo and distance, last inspection and action completion. Structured simulation data, not an image.",
  act: `Control a possessed body with a typed command. move: rover x/z or airborne drone x/y/z. look: camera pan/tilt in degrees. inspect: visible nearby cargo. arm: preset home/reach/drop, grasp objectId, place. Drone: takeoff/land. stop cancels motion. Poll observe for completion. Mission: the camera is fixed 10 m high in the southwest corner, with ${CAMERA_SENSOR.range} m range; look ${CAMERA_SENSOR.homePan}/${CAMERA_SENSOR.homeTilt} and inspect crate-07; rover move 1/1.4 and inspect; drone takeoff, move 1/3.4/-1.5 and inspect, land; arm reach, grasp crate-07, drop, place.`,
  release:
    "Release a lease and cancel its pending motion. Repeated release is harmless. A drone holds its last altitude, and a held crate stays attached.",
};
export function createMcp(
  dispatch: (name: ToolName, input: unknown) => unknown | Promise<unknown>,
) {
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
      async (input: unknown) => {
        try {
          const result = await dispatch(name, input);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          const failure = {
            code: error instanceof SimError ? error.code : "SERVER_ERROR",
            message:
              error instanceof SimError
                ? error.message
                : "Could not execute warehouse command.",
          };
          return {
            isError: true,
            content: [{ type: "text" as const, text: JSON.stringify(failure) }],
          };
        }
      },
    );
  }
  return server;
}
