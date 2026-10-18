import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startWarehouse } from "../src/http.js";
import { GhostOAuth, OAUTH_SCOPE } from "../src/oauth.js";
import { WarehouseAccess } from "../src/access.js";

const origin = "https://ghost.example";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const key = randomBytes(36).toString("base64url");
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

test("OAuth discovery, consent, PKCE, scoped MCP access, refresh rotation and revocation", async (t) => {
  const warehouse = await startWarehouse(0, "127.0.0.1", undefined, {
    origin,
    accessToken: key,
  });
  const base = `http://127.0.0.1:${(warehouse.server.address() as { port: number }).port}`;
  const post = (
    path: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams(body),
    });
  let client: Client | undefined;
  try {
    const metadata = await (
      await fetch(base + "/.well-known/oauth-authorization-server")
    ).json();
    assert.equal(metadata.issuer, origin);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.equal(metadata.authorization_response_iss_parameter_supported, true);
    const resource = await (
      await fetch(base + "/.well-known/oauth-protected-resource/mcp")
    ).json();
    assert.equal(resource.resource, origin + "/mcp");
    const denied = await post("/mcp", {});
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate")!, /resource_metadata=/);
    const registration = await fetch(base + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "ChatGPT <test>",
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(registration.status, 201);
    const registered = await registration.json();
    assert(!registered.client_secret);
    assert.equal(registered.scope, OAUTH_SCOPE);
    const authorize = async (extra: Record<string, string> = {}) => {
      const query = new URLSearchParams({
        client_id: registered.client_id,
        redirect_uri: redirect,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        scope: OAUTH_SCOPE,
        resource: origin + "/mcp",
        state: "client-state",
        ...extra,
      });
      const res = await fetch(base + "/authorize?" + query, {
        redirect: "manual",
      });
      return res;
    };
    assert.equal(
      (await authorize({ redirect_uri: "https://evil.example/callback" }))
        .status,
      400,
    );
    const badScope = await authorize({ scope: "admin" });
    assert(
      new URL(badScope.headers.get("location")!).searchParams.has("error"),
    );
    const badAudience = await authorize({
      resource: "https://another.example/mcp",
    });
    assert(
      new URL(badAudience.headers.get("location")!).searchParams.has("error"),
    );
    const auth = await authorize();
    assert.equal(auth.status, 303);
    const authCookie = auth.headers.get("set-cookie")!.split(";")[0]!;
    assert.match(auth.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(auth.headers.get("set-cookie")!, /Secure/);
    const consentUrl = new URL(auth.headers.get("location")!);
    const id = consentUrl.searchParams.get("request")!;
    const consent = await fetch(
      base + consentUrl.pathname + consentUrl.search,
      { headers: { Cookie: authCookie } },
    );
    assert.equal(consent.status, 200);
    const html = await consent.text();
    assert(html.includes("ChatGPT &lt;test&gt;"));
    assert(!html.includes(key));
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1]!;
    const form = { request: id, csrf, decision: "allow", token: key };
    assert.equal(
      (
        await post("/oauth/consent", form, {
          Cookie: authCookie,
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await post("/oauth/consent", form, { Origin: origin })).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/oauth/consent",
          { ...form, token: "wrong" },
          { Cookie: authCookie, Origin: origin },
        )
      ).status,
      401,
    );
    const approved = await post("/oauth/consent", form, {
      Cookie: authCookie,
      Origin: origin,
    });
    assert.equal(approved.status, 303);
    const callback = new URL(approved.headers.get("location")!);
    assert.equal(callback.searchParams.get("state"), "client-state");
    assert.equal(callback.searchParams.get("iss"), origin);
    assert(!callback.href.includes(key));
    const code = callback.searchParams.get("code")!;
    const exchange = {
      grant_type: "authorization_code",
      client_id: registered.client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: origin + "/mcp",
    };
    assert.equal(
      (await post("/token", { ...exchange, code_verifier: "x".repeat(43) }))
        .status,
      400,
    );
    assert.equal(
      (
        await post("/token", {
          ...exchange,
          redirect_uri: "https://evil.example",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/token", {
          ...exchange,
          resource: "https://evil.example/mcp",
        })
      ).status,
      400,
    );
    const exchangeResult = await post("/token", exchange);
    assert.equal(exchangeResult.status, 200);
    const tokens = await exchangeResult.json();
    assert.equal(tokens.scope, OAUTH_SCOPE);
    assert(tokens.access_token !== key);
    assert(tokens.refresh_token !== tokens.access_token);
    assert.equal((await post("/token", exchange)).status, 400);
    client = new Client({ name: "OAuth regression", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(base + "/mcp"), {
        requestInit: {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      }),
    );
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 17);
    assert(
      tools.every((tool) => JSON.stringify(tool._meta).includes(OAUTH_SCOPE)),
    );
    const discovery = await client.callTool({
      name: "discover",
      arguments: {},
    });
    assert(!discovery.isError);
    const draft = await client.callTool({
      name: "sandbox_create",
      arguments: { name: "OAuth experiment" },
    });
    assert(!draft.isError);
    const sandboxId = (draft.structuredContent as { sandbox: { id: string } })
      .sandbox.id;
    const removed = await client.callTool({
      name: "sandbox_delete",
      arguments: { sandboxId },
    });
    assert(!removed.isError);

    assert.equal(
      (
        await fetch(base + "/api/snapshot", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
      401,
      "OAuth tokens cannot authenticate arbitrary browser/admin endpoints",
    );
    assert.equal(
      (
        await fetch(base + "/api/snapshot", {
          headers: { Authorization: `Bearer ${key}` },
        })
      ).status,
      200,
      "legacy access key remains valid",
    );
    const another = await (
      await fetch(base + "/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
        }),
      })
    ).json();
    assert.equal(
      (
        await post("/token", {
          grant_type: "refresh_token",
          client_id: another.client_id,
          refresh_token: tokens.refresh_token,
        })
      ).status,
      400,
      "refresh grants stay bound to their registered client",
    );
    assert.equal(
      (
        await post("/revoke", {
          client_id: another.client_id,
          token: tokens.access_token,
        })
      ).status,
      200,
    );
    assert(
      !(await client.callTool({ name: "discover", arguments: {} })).isError,
      "another client cannot revoke this grant",
    );
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    t.mock.timers.tick(16 * 60_000);
    assert.equal(
      (
        await post(
          "/mcp",
          {},
          { Authorization: `Bearer ${tokens.access_token}` },
        )
      ).status,
      401,
      "access expires after 15 minutes",
    );
    const refreshed = await post("/token", {
      grant_type: "refresh_token",
      client_id: registered.client_id,
      refresh_token: tokens.refresh_token,
      resource: origin + "/mcp",
    });
    assert.equal(refreshed.status, 200);
    const rotated = await refreshed.json();
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    assert.equal(
      (
        await post("/token", {
          grant_type: "refresh_token",
          client_id: registered.client_id,
          refresh_token: tokens.refresh_token,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          "/mcp",
          {},
          { Authorization: `Bearer ${rotated.access_token}` },
        )
      ).status,
      401,
      "refresh replay revokes the whole token family",
    );
    const secondAuth = await authorize();
    const secondCookie = secondAuth.headers.get("set-cookie")!.split(";")[0]!;
    const secondUrl = new URL(secondAuth.headers.get("location")!);
    const secondHtml = await (
      await fetch(base + secondUrl.pathname + secondUrl.search, {
        headers: { Cookie: secondCookie },
      })
    ).text();
    const second = await post(
      "/oauth/consent",
      {
        request: secondUrl.searchParams.get("request")!,
        csrf: secondHtml.match(/name="csrf" value="([^"]+)"/)![1]!,
        decision: "allow",
        token: key,
      },
      { Cookie: secondCookie, Origin: origin },
    );
    const secondCode = new URL(
      second.headers.get("location")!,
    ).searchParams.get("code")!;
    const more = await (
      await post("/token", { ...exchange, code: secondCode })
    ).json();
    assert.equal(
      (
        await post("/revoke", {
          client_id: registered.client_id,
          token: more.access_token,
        })
      ).status,
      200,
    );
    assert.equal(
      (await post("/mcp", {}, { Authorization: `Bearer ${more.access_token}` }))
        .status,
      401,
    );
    const cancelAuth = await authorize();
    const cancelCookie = cancelAuth.headers.get("set-cookie")!.split(";")[0]!;
    const cancelUrl = new URL(cancelAuth.headers.get("location")!);
    const cancelHtml = await (
      await fetch(base + cancelUrl.pathname + cancelUrl.search, {
        headers: { Cookie: cancelCookie },
      })
    ).text();
    const cancelled = await post(
      "/oauth/consent",
      {
        request: cancelUrl.searchParams.get("request")!,
        csrf: cancelHtml.match(/name="csrf" value="([^"]+)"/)![1]!,
        decision: "deny",
      },
      { Cookie: cancelCookie, Origin: origin },
    );
    assert.equal(
      new URL(cancelled.headers.get("location")!).searchParams.get("error"),
      "access_denied",
    );
  } finally {
    await client?.close();
    await warehouse.close();
  }
});

test("client registrations survive restarts, reject tampering and rotate with the warehouse key", async () => {
  const first = new GhostOAuth(origin, key, new WarehouseAccess(key, true));
  const client = await first.clientsStore.registerClient({
    redirect_uris: [redirect],
    client_secret: "private-client-secret",
    token_endpoint_auth_method: "client_secret_post",
  });
  assert(!client.client_id.includes("private-client-secret"));
  const restarted = new GhostOAuth(origin, key, new WarehouseAccess(key, true));
  assert.equal(
    (await restarted.clientsStore.getClient(client.client_id))?.client_secret,
    "private-client-secret",
  );
  assert.equal(
    await restarted.clientsStore.getClient(
      client.client_id.slice(0, -4) + "xxxx",
    ),
    undefined,
  );
  const changed = new GhostOAuth(
    origin,
    "another-key-".repeat(4),
    new WarehouseAccess(key, true),
  );
  assert.equal(
    await changed.clientsStore.getClient(client.client_id),
    undefined,
  );
  await assert.rejects(
    first.clientsStore.registerClient({
      redirect_uris: ["javascript:alert(1)"],
    }),
  );
  await assert.rejects(
    first.clientsStore.registerClient({
      redirect_uris: [redirect],
      grant_types: ["client_credentials"],
    }),
  );
});
