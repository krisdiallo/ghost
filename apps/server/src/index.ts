import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DEMO_RESOURCES } from "@ghost/shared";

const server = new McpServer({ name: "ghost", version: "0.0.0" });

server.registerTool(
  "discover",
  {
    description: "List the four simulated bodies in the GHOST scaffold. This is a static catalog, not live availability.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify({ mode: "scaffold", resources: DEMO_RESOURCES }) }]
  })
);

// Next: authoritative simulation state and possess/observe/act/release tools.
// stdout is reserved for MCP messages; send diagnostics to stderr.
await server.connect(new StdioServerTransport());
