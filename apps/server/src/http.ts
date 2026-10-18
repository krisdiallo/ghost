import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { toNodeHandler } from "mcp-use/node";
import type { ToolName, Observation, SensorFrame } from "@ghost/shared";
import { Simulation, SimError } from "./simulation.js";
import { createHttpMcp } from "./mcp.js";
import { SensorRenderer } from "./renderer.js";
import {
  accessConfig,
  WarehouseAccess,
  loginPage,
  type AccessOptions,
} from "./access.js";

async function readBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384)
      throw new SimError("PAYLOAD_TOO_LARGE", "Request exceeds 16 KB.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}
async function readJson(req: IncomingMessage) {
  try {
    return JSON.parse((await readBody(req)) || "{}");
  } catch (error) {
    if (error instanceof SimError) throw error;
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
  options: AccessOptions = {},
) {
  const config = accessConfig(host, options);
  const configuredOrigin = config.origin;
  const access = new WarehouseAccess(config.token, config.secure);
  const renderer = new SensorRenderer();
  const frames = new Map<string, SensorFrame>();
  const dispatch = async (name: ToolName, input: unknown) => {
    const result = sim.tool(name, input);
    if (name !== "observe" || !(input as { image?: boolean }).image)
      return result;
    const observation = result as Observation;
    const snapshot = sim.snapshot();
    const frame = await renderer.capture(snapshot, observation.body.id);
    // A revoked/expired capability must never receive an in-flight image.
    sim.validateLease((input as { leaseId: string }).leaseId);
    frames.set(observation.body.id, frame);
    return { ...observation, frame };
  };
  const mcp = createHttpMcp(dispatch);
  const handleMcp = toNodeHandler(mcp);
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
  const streams = new Map<ServerResponse, IncomingMessage>();
  const unsubscribe = sim.subscribe(() => {
    const event = `data: ${JSON.stringify(sim.snapshot())}\n\n`;
    for (const [res, req] of streams)
      if (!access.authorized(req)) {
        streams.delete(res);
        res.end();
      } else if (!res.write(event)) {
        streams.delete(res);
        res.end();
      }
  });
  const timer = setInterval(() => sim.tick(), 50);
  const heartbeat = setInterval(() => {
    for (const [res, req] of streams) {
      if (!access.authorized(req)) {
        streams.delete(res);
        res.end();
      } else res.write(": heartbeat\n\n");
    }
  }, 10_000);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      // Apply Host/Origin checks before authentication and every transport.
      if (!allowedHosts.has(req.headers.host ?? ""))
        return json(res, 403, {
          code: "INVALID_HOST",
          message: "Use the configured warehouse URL.",
        });
      if (req.headers.origin) {
        if (!allowedOrigins.has(req.headers.origin))
          return json(res, 403, {
            code: "INVALID_ORIGIN",
            message: "Cross-origin requests are disabled.",
          });
      }
      if (
        url.pathname === "/api/health" &&
        ["GET", "HEAD"].includes(req.method ?? "")
      )
        return json(res, 200, { service: "ghost", mode: "live" });
      if (
        url.pathname === "/auth/login" &&
        req.method === "POST" &&
        access.enabled
      ) {
        // HTML forms and cookie-authorized writes must carry a same-origin Origin.
        if (!req.headers.origin)
          return json(res, 403, { code: "INVALID_ORIGIN" });
        const contentType = req.headers["content-type"]?.split(";")[0];
        const body =
          contentType === "application/x-www-form-urlencoded"
            ? Object.fromEntries(new URLSearchParams(await readBody(req)))
            : ((await readJson(req)) as { token?: unknown });
        const result = access.login(body?.token, res);
        if (result !== "ok")
          return loginPage(res, result === "limited" ? 429 : 401, true);
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (!access.authorized(req)) {
        if (req.method === "GET" && ["/", "/auth/login"].includes(url.pathname))
          return loginPage(res);
        res.setHeader("WWW-Authenticate", 'Bearer realm="ghost"');
        return json(res, 401, {
          code: "AUTH_REQUIRED",
          message: "A warehouse access key is required.",
        });
      }
      if (
        access.enabled &&
        !access.bearer(req) &&
        !["GET", "HEAD"].includes(req.method ?? "") &&
        !req.headers.origin
      )
        return json(res, 403, { code: "INVALID_ORIGIN" });
      if (url.pathname === "/auth/logout" && req.method === "POST") {
        access.logout(req, res);
        res.writeHead(303, { Location: "/", "Cache-Control": "no-store" });
        res.end();
        return;
      }
      if (url.pathname === "/api/access" && req.method === "GET")
        return json(res, 200, { authenticated: access.enabled });
      if (url.pathname === "/api/snapshot" && req.method === "GET") {
        sim.tick();
        return json(res, 200, sim.snapshot());
      }
      if (url.pathname.startsWith("/api/frames/") && req.method === "GET") {
        const id = url.pathname.slice("/api/frames/".length);
        const frame = frames.get(id);
        return json(res, 200, {
          frame: frame?.instanceId === sim.snapshot().instanceId ? frame : null,
        });
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
        streams.set(res, req);
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
        return json(
          res,
          200,
          await dispatch(name as ToolName, await readJson(req)),
        );
      }
      if (
        req.method === "POST" &&
        ["/api/demo/start", "/api/demo/stop", "/api/reset"].includes(
          url.pathname,
        )
      ) {
        await readJson(req);
        if (url.pathname !== "/api/demo/stop") frames.clear();
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
        await handleMcp(req, res, await readJson(req));
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
          "Cache-Control": "no-store",
          "Referrer-Policy": "same-origin",
          "X-Frame-Options": "DENY",
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
        ...(error instanceof SimError && error.details
          ? { details: error.details }
          : {}),
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
      await renderer.close();
      for (const res of streams.keys()) res.end();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
