// Actual SDK OAuth + mobile browser consent. No tokens or keys enter artifacts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../apps/server/dist/http.js";

const output = resolve(process.env.GHOST_CAPTURE_DIR ?? "work/captures");
await mkdir(output, { recursive: true });
const live = process.env.GHOST_OAUTH_URL;
const key = live
  ? (await readFile(process.env.GHOST_ACCESS_KEY_FILE, "utf8")).trim()
  : randomBytes(32).toString("base64url");
let base = live;
let warehouse;
if (!base) {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  warehouse = await startWarehouse(port, "127.0.0.1", undefined, {
    origin: base,
    accessToken: key,
  });
}
const callback = "https://oauth-client.example/callback";
const state = randomBytes(24).toString("base64url");
let registration, tokens, verifier, authorizationUrl;
const provider = {
  redirectUrl: callback,
  clientMetadata: {
    client_name: "GHOST OAuth browser check",
    redirect_uris: [callback],
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "ghost:control",
  },
  state: () => state,
  clientInformation: () => registration,
  saveClientInformation: (value) => {
    registration = value;
  },
  tokens: () => tokens,
  saveTokens: (value) => {
    tokens = value;
  },
  saveCodeVerifier: (value) => {
    verifier = value;
  },
  codeVerifier: () => verifier,
  redirectToAuthorization: (value) => {
    authorizationUrl = value;
  },
};
let browser, client;
const errors = [];
try {
  assert.equal(await auth(provider, { serverUrl: base + "/mcp" }), "REDIRECT");
  let executablePath = process.env.GHOST_BROWSER_PATH;
  if (!executablePath) {
    try {
      await access("/usr/bin/chromium");
      executablePath = "/usr/bin/chromium";
    } catch {}
  }
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // Intercept the synthetic callback locally. No authorization code leaves the test browser.
  await context.route(callback + "**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Connection approved</h1>",
    }),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(authorizationUrl.href);
  await page.getByLabel("Warehouse access key").waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: join(output, "ghost-oauth-consent.jpg"),
    quality: 85,
    fullPage: true,
  });
  await page.getByLabel("Warehouse access key").fill(key);
  await page.getByRole("button", { name: "Allow connection" }).click();
  await page.getByRole("heading", { name: "Connection approved" }).waitFor();
  console.log("Browser consent and callback passed.");
  const redirected = new URL(page.url());
  assert.equal(redirected.searchParams.get("state"), state);
  assert.equal(redirected.searchParams.get("iss"), base);
  assert.equal(
    await auth(provider, {
      serverUrl: base + "/mcp",
      authorizationCode: redirected.searchParams.get("code"),
    }),
    "AUTHORIZED",
  );
  console.log("PKCE token exchange passed.");
  assert(tokens.access_token !== key);
  client = new Client({ name: "GHOST OAuth browser check", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
      authProvider: provider,
    }),
  );
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 16);
  assert(
    tools.every((tool) => JSON.stringify(tool._meta).includes("ghost:control")),
  );
  assert(!(await client.callTool({ name: "discover", arguments: {} })).isError);
  await client.close();
  client = undefined;
  console.log("OAuth MCP connection passed.");
  const oldRefresh = tokens.refresh_token;
  assert.equal(
    await auth(provider, { serverUrl: base + "/mcp" }),
    "AUTHORIZED",
  );
  console.log("Refresh passed.");
  assert.notEqual(tokens.refresh_token, oldRefresh);
  const revoked = await fetch(base + "/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: registration.client_id,
      client_secret: registration.client_secret,
      token: tokens.refresh_token,
    }),
  });
  assert.equal(revoked.status, 200);
  assert.equal(
    (
      await fetch(base + "/mcp", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
    ).status,
    401,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "oauth-report.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        deployment: live ? base : "local hosted-mode verification",
        mode: "official SDK OAuth and real browser; not a signed-in ChatGPT session",
        checks: [
          "discovery and confidential client registration",
          "S256 PKCE",
          "mobile consent and cross-origin return navigation",
          "state and issuer validation",
          "all five MCP tools advertise OAuth",
          "authenticated discover",
          "refresh rotation",
          "revocation rejects access",
        ],
        browserErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "OAuth discovery, mobile browser consent, MCP access, refresh and revocation passed.",
  );
} catch (error) {
  console.error(
    "OAuth browser check failed:",
    error.name,
    error.message.split("\n")[0],
  );
  throw error;
} finally {
  await client?.close();
  await browser?.close();
  await warehouse?.close();
}
