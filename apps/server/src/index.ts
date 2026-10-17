import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startWarehouse } from "./http.js";
import { createMcp } from "./mcp.js";
import { SimError } from "./simulation.js";

const port = Number(process.env.GHOST_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("GHOST_PORT must be a valid port.");
const url = `http://127.0.0.1:${port}`;
let owned: Awaited<ReturnType<typeof startWarehouse>> | undefined;
async function ensureWarehouse() {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (
      response.ok &&
      ((await response.json()) as { service?: string }).service === "ghost"
    )
      return;
    throw new Error("The configured port belongs to a different service.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("different service"))
      throw error;
  }
  try {
    owned = await startWarehouse(port, process.env.GHOST_HOST ?? "127.0.0.1");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    // A concurrent client may have started the single authority first.
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (
      !response.ok ||
      ((await response.json()) as { service?: string }).service !== "ghost"
    )
      throw error;
  }
}
await ensureWarehouse();
console.error(`GHOST warehouse · ${url}`);
async function shutdown() {
  if (owned) await owned.close();
  process.exit(0);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
if (!process.argv.includes("--serve")) {
  const mcp = createMcp(async (name, input) => {
    const response = await fetch(`${url}/api/tools/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new SimError(
        String(result.code ?? "SERVER_ERROR"),
        String(result.message ?? "Warehouse unavailable"),
      );
    return result;
  });
  await mcp.connect(new StdioServerTransport());
  mcp.server.onclose = () => {
    void shutdown();
  };
}
