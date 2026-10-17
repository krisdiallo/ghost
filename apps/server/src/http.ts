import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ToolName } from "@ghost/shared";
import { Simulation, SimError } from "./simulation.js";
import { createMcp } from "./mcp.js";

async function readJson(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384)
      throw new SimError("PAYLOAD_TOO_LARGE", "Request exceeds 16 KB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    throw new SimError("INVALID_JSON", "Expected a JSON request body.");
  }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
const webRoot = resolve(
  fileURLToPath(new URL("../../web/dist/", import.meta.url)),
);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function startWarehouse(
  port = 3001,
  host = "127.0.0.1",
  sim = new Simulation(),
) {
  const configuredOrigin = process.env.GHOST_ORIGIN
    ? new URL(process.env.GHOST_ORIGIN).origin
    : null;
  const allowedHosts = new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    ...(configuredOrigin ? [new URL(configuredOrigin).host] : []),
  ]);
  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(configuredOrigin ? [configuredOrigin] : []),
  ]);
  const streams = new Set<ServerResponse>();
  const unsubscribe = sim.subscribe(() => {
    const event = `data: ${JSON.stringify(sim.snapshot())}\n\n`;
    for (const res of streams)
      if (!res.write(event)) {
        streams.delete(res);
        res.end();
      }
  });
  const timer = setInterval(() => sim.tick(), 50);
  const heartbeat = setInterval(() => {
    for (const res of streams) res.write(": heartbeat\n\n");
  }, 10_000);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      // Loopback service: reject cross-origin browser requests, including DNS-rebinding hosts.
      if (!allowedHosts.has(req.headers.host ?? ""))
        return json(res, 403, {
          code: "INVALID_HOST",
          message: "Use the loopback warehouse URL.",
        });
      if (req.headers.origin) {
        if (!allowedOrigins.has(req.headers.origin))
          return json(res, 403, {
            code: "INVALID_ORIGIN",
            message: "Cross-origin requests are disabled.",
          });
      }
      if (url.pathname === "/api/health")
        return json(res, 200, { service: "ghost", mode: "live" });
      if (url.pathname === "/api/snapshot" && req.method === "GET") {
        sim.tick();
        return json(res, 200, sim.snapshot());
      }
      if (url.pathname === "/api/events" && req.method === "GET") {
        if (streams.size >= 40)
          return json(res, 503, {
            code: "TOO_MANY_STREAMS",
            message: "Too many viewers.",
          });
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify(sim.snapshot())}\n\n`);
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      if (url.pathname.startsWith("/api/tools/") && req.method === "POST") {
        const name = url.pathname.slice("/api/tools/".length);
        if (
          !["discover", "possess", "observe", "act", "release"].includes(name)
        )
          return json(res, 404, {
            code: "UNKNOWN_TOOL",
            message: "Unknown tool.",
          });
        return json(res, 200, sim.tool(name as ToolName, await readJson(req)));
      }
      if (
        req.method === "POST" &&
        ["/api/demo/start", "/api/demo/stop", "/api/reset"].includes(
          url.pathname,
        )
      ) {
        await readJson(req);
        if (url.pathname === "/api/demo/start")
          return json(res, 200, sim.startDemo());
        if (url.pathname === "/api/demo/stop") sim.stopDemo();
        else sim.reset();
        return json(res, 200, { ok: true });
      }
      if (url.pathname === "/mcp") {
        if (req.method !== "POST")
          return json(res, 405, {
            code: "METHOD_NOT_ALLOWED",
            message: "Stateless MCP accepts POST requests.",
          });
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
        });
        const mcp = createMcp((name, input) => sim.tool(name, input));
        res.on("close", () => {
          void transport.close();
          void mcp.close();
        });
        // SDK HTTP transport declares optional callbacks differently under exactOptionalPropertyTypes.
        await mcp.connect(transport as Transport);
        await transport.handleRequest(req, res, await readJson(req));
        return;
      }
      if (url.pathname.startsWith("/api/"))
        return json(res, 404, {
          code: "NOT_FOUND",
          message: "Unknown endpoint.",
        });
      if (req.method !== "GET" && req.method !== "HEAD")
        return json(res, 405, { code: "METHOD_NOT_ALLOWED" });
      const path = resolve(
        webRoot,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!path.startsWith(webRoot + sep))
        return json(res, 403, { code: "FORBIDDEN" });
      try {
        const data = await readFile(path);
        res.writeHead(200, {
          "Content-Type": mime[extname(path)] ?? "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : data);
      } catch {
        json(res, 404, {
          code: "NOT_FOUND",
          message: "Build the web app with npm run build first.",
        });
      }
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, error instanceof SimError ? 400 : 500, {
        code: error instanceof SimError ? error.code : "SERVER_ERROR",
        message:
          error instanceof SimError
            ? error.message
            : "Unexpected warehouse error.",
      });
    }
  });
  server.requestTimeout = 15_000;
  server.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeat);
    unsubscribe();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    clearInterval(timer);
    clearInterval(heartbeat);
    unsubscribe();
    throw error;
  }
  const address = server.address();
  if (address && typeof address === "object") {
    for (const local of ["localhost", "127.0.0.1"]) {
      allowedHosts.add(`${local}:${address.port}`);
      allowedOrigins.add(`http://${local}:${address.port}`);
    }
  }
  return {
    server,
    sim,
    close: async () => {
      sim.stopDemo();
      for (const res of streams) res.end();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
