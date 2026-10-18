import { createHash, hkdfSync, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import express, { type Response } from "express";
import { EncryptJWT, jwtDecrypt } from "jose";
import {
  mcpAuthRouter,
  createOAuthMetadata,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  TooManyRequestsError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { WarehouseAccess } from "./access.js";

export const OAUTH_SCOPE = "ghost:control";
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const cookie = (req: IncomingMessage) =>
  req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("ghost_oauth="))
    ?.slice(12);
const lifetime = 8 * 60 * 60 * 1000;
type Grant = {
  clientId: string;
  scopes: string[];
  resource: string;
  family: string;
  expires: number;
};
type Pending = AuthorizationParams & {
  client: OAuthClientInformationFull;
  csrf: string;
  expires: number;
};
type Code = Pending & { family: string };

/** Single-owner demo OAuth: SDK protocol handlers, explicit consent and rotating tokens.
 * Tokens/consents are deliberately process-local. Encrypted client registrations survive
 * restarts without putting client secrets in their public IDs or requiring a database. */
export class GhostOAuth implements OAuthServerProvider {
  readonly resource: string;
  private readonly key: Uint8Array;
  private pending = new Map<string, Pending>();
  private codes = new Map<string, Code>();
  private accessTokens = new Map<string, Grant>();
  private refreshTokens = new Map<string, Grant & { used: boolean }>();
  private revokedFamilies = new Map<string, number>();
  readonly clientsStore;
  readonly app = express();
  readonly paths = new Set([
    "/authorize",
    "/token",
    "/register",
    "/revoke",
    "/oauth/consent",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp",
  ]);

  constructor(
    readonly origin: string,
    secret: string,
    private warehouseAccess: WarehouseAccess,
  ) {
    this.resource = origin + "/mcp";
    this.key = new Uint8Array(
      hkdfSync(
        "sha256",
        secret,
        origin,
        "ghost-oauth-client-registration-v1",
        32,
      ),
    );
    this.clientsStore = {
      getClient: async (
        id: string,
      ): Promise<OAuthClientInformationFull | undefined> => {
        if (id.length > 12000) return undefined;
        try {
          const { payload } = await jwtDecrypt(id, this.key, {
            issuer: origin,
            audience: "ghost-oauth-client",
            keyManagementAlgorithms: ["dir"],
            contentEncryptionAlgorithms: ["A256GCM"],
          });
          return {
            ...(payload.client as OAuthClientInformationFull),
            client_id: id,
          };
        } catch {
          return undefined;
        }
      },
      registerClient: async (
        client: Omit<
          OAuthClientInformationFull,
          "client_id" | "client_id_issued_at"
        >,
      ) => {
        if (
          JSON.stringify(client).length > 6000 ||
          !client.redirect_uris.length ||
          client.redirect_uris.length > 8
        )
          throw new InvalidClientMetadataError("Invalid registration size");
        for (const redirect of client.redirect_uris) {
          const u = new URL(redirect);
          if (
            u.hash ||
            u.username ||
            u.password ||
            !(
              u.protocol === "https:" ||
              (u.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
            )
          )
            throw new InvalidClientMetadataError(
              "Use an HTTPS or loopback redirect URI",
            );
        }
        if (
          client.token_endpoint_auth_method &&
          !["none", "client_secret_post"].includes(
            client.token_endpoint_auth_method,
          )
        )
          throw new InvalidClientMetadataError(
            "Unsupported client authentication",
          );
        if (
          client.grant_types?.some(
            (x) => !["authorization_code", "refresh_token"].includes(x),
          ) ||
          client.response_types?.some((x) => x !== "code")
        )
          throw new InvalidClientMetadataError(
            "Only authorization code with PKCE is supported",
          );
        const value = {
          ...client,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          scope: OAUTH_SCOPE,
        };
        const id = await new EncryptJWT({ client: value })
          .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
          .setIssuer(origin)
          .setAudience("ghost-oauth-client")
          .encrypt(this.key);
        return { ...value, client_id: id };
      },
    };
    this.app.disable("x-powered-by");
    this.app.use((_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      // Preserve Origin on same-origin consent POSTs; never send a referrer to the client callback.
      res.setHeader("Referrer-Policy", "same-origin");
      next();
    });
    const options = {
      provider: this,
      issuerUrl: new URL(origin),
      resourceServerUrl: new URL(this.resource),
      scopesSupported: [OAUTH_SCOPE],
      resourceName: "GHOST warehouse",
    };
    const metadata = {
      ...createOAuthMetadata(options),
      issuer: origin,
      authorization_response_iss_parameter_supported: true,
      revocation_endpoint_auth_methods_supported: [
        "client_secret_post",
        "none",
      ],
    };
    this.app.get("/.well-known/oauth-authorization-server", (_req, res) =>
      res.set("Access-Control-Allow-Origin", "*").json(metadata),
    );
    const resourceMetadata = {
      resource: this.resource,
      authorization_servers: [origin],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "GHOST warehouse",
    };
    this.app.get(
      [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ],
      (_req, res) =>
        res.set("Access-Control-Allow-Origin", "*").json(resourceMetadata),
    );
    const rateLimit = { keyGenerator: () => "warehouse" };
    this.app.use(
      mcpAuthRouter({
        ...options,
        clientRegistrationOptions: { clientSecretExpirySeconds: 0, rateLimit },
        authorizationOptions: { rateLimit },
        tokenOptions: { rateLimit },
        revocationOptions: { rateLimit },
      }),
    );
    this.app.use(
      "/oauth/consent",
      express.urlencoded({ extended: false, limit: "16kb" }),
    );
    this.app.get("/oauth/consent", (req, res) => {
      this.cleanup();
      const id = String(req.query.request ?? "");
      const pending = this.pending.get(id);
      if (!pending || cookie(req) !== id) {
        res
          .status(400)
          .send("This authorization request expired. Start connecting again.");
        return;
      }
      this.consentPage(res, id, pending);
    });
    this.app.post("/oauth/consent", (req, res) => {
      this.cleanup();
      const id = String(req.body.request ?? "");
      const pending = this.pending.get(id);
      if (
        req.headers.origin !== origin ||
        !pending ||
        cookie(req) !== id ||
        req.body.csrf !== pending.csrf
      ) {
        res
          .status(403)
          .send("Invalid authorization request. Start connecting again.");
        return;
      }
      if (req.body.decision !== "deny") {
        const result = this.warehouseAccess.checkKey(req.body.token);
        if (result !== "ok") {
          if (result === "limited") res.setHeader("Retry-After", "60");
          this.consentPage(res, id, pending, result === "limited" ? 429 : 401);
          return;
        }
      }
      this.pending.delete(id);
      res.setHeader(
        "Set-Cookie",
        `ghost_oauth=; HttpOnly; SameSite=Lax; Path=/oauth/consent; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      const redirect = new URL(pending.redirectUri);
      if (pending.state !== undefined)
        redirect.searchParams.set("state", pending.state);
      redirect.searchParams.set("iss", origin);
      if (req.body.decision === "deny")
        redirect.searchParams.set("error", "access_denied");
      else {
        const code = random();
        this.codes.set(hash(code), {
          ...pending,
          expires: Date.now() + 60_000,
          family: random(),
        });
        redirect.searchParams.set("code", code);
      }
      res.redirect(303, redirect.href);
    });
    this.app.use((_req, res) => res.status(404).json({ error: "not_found" }));
    this.app.use(
      (
        _error: unknown,
        _req: express.Request,
        res: Response,
        _next: express.NextFunction,
      ) => res.status(400).json({ error: "invalid_request" }),
    );
  }
  private cleanup() {
    const now = Date.now();
    for (const map of [
      this.pending,
      this.codes,
      this.accessTokens,
      this.refreshTokens,
    ])
      for (const [id, value] of map) if (value.expires <= now) map.delete(id);
    for (const [id, expiry] of this.revokedFamilies)
      if (expiry <= now) this.revokedFamilies.delete(id);
  }
  private audience(resource?: URL) {
    if (resource && resource.href !== this.resource)
      throw new InvalidTargetError(
        "Token resource must be this GHOST MCP endpoint",
      );
  }
  private scopes(scopes?: string[]) {
    if (scopes?.some((x) => x !== OAUTH_SCOPE && x !== "offline_access"))
      throw new InvalidScopeError("Unsupported scope");
    return [OAUTH_SCOPE];
  }
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    this.cleanup();
    this.audience(params.resource);
    this.scopes(params.scopes);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
      throw new InvalidGrantError("A valid S256 PKCE challenge is required");
    if (
      this.pending.size >= 100 ||
      this.accessTokens.size + this.refreshTokens.size >= 4000
    )
      throw new TooManyRequestsError("Too many authorization sessions");
    const id = random();
    this.pending.set(id, {
      ...params,
      scopes: [OAUTH_SCOPE],
      client,
      csrf: random(),
      expires: Date.now() + 10 * 60_000,
    });
    res.setHeader(
      "Set-Cookie",
      `ghost_oauth=${id}; HttpOnly; SameSite=Lax; Path=/oauth/consent; Max-Age=600${this.origin.startsWith("https:") ? "; Secure" : ""}`,
    );
    res.redirect(303, `${this.origin}/oauth/consent?request=${id}`);
  }
  private code(client: OAuthClientInformationFull, value: string) {
    this.cleanup();
    const code = this.codes.get(hash(value));
    if (!code || code.client.client_id !== client.client_id)
      throw new InvalidGrantError("Invalid or expired authorization code");
    return code;
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    return this.code(client, code).codeChallenge;
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    value: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    const code = this.code(client, value);
    this.audience(resource);
    if (redirectUri !== code.redirectUri)
      throw new InvalidGrantError(
        "Redirect URI must match the authorization request",
      );
    this.codes.delete(hash(value));
    return this.issue({
      clientId: client.client_id,
      scopes: [OAUTH_SCOPE],
      resource: this.resource,
      family: code.family,
      expires: Date.now() + lifetime,
    });
  }
  private issue(grant: Grant) {
    const access = random(),
      refresh = random();
    this.accessTokens.set(hash(access), {
      ...grant,
      expires: Math.min(Date.now() + 15 * 60_000, grant.expires),
    });
    this.refreshTokens.set(hash(refresh), { ...grant, used: false });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.min(
        900,
        Math.floor((grant.expires - Date.now()) / 1000),
      ),
      refresh_token: refresh,
      scope: OAUTH_SCOPE,
    };
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    token: string,
    scopes?: string[],
    resource?: URL,
  ) {
    this.cleanup();
    this.audience(resource);
    this.scopes(scopes);
    const grant = this.refreshTokens.get(hash(token));
    if (!grant || grant.clientId !== client.client_id)
      throw new InvalidGrantError("Invalid or expired refresh token");
    if (grant.used) {
      this.revokedFamilies.set(grant.family, grant.expires);
      throw new InvalidGrantError("Refresh token was already used; reconnect");
    }
    if (this.revokedFamilies.has(grant.family))
      throw new InvalidGrantError("Authorization was revoked");
    if (this.accessTokens.size + this.refreshTokens.size >= 4000)
      throw new TooManyRequestsError("Too many tokens");
    grant.used = true;
    return this.issue(grant);
  }
  async verifyAccessToken(token: string) {
    this.cleanup();
    const grant = this.accessTokens.get(hash(token));
    if (!grant || this.revokedFamilies.has(grant.family))
      throw new InvalidTokenError("Invalid or expired access token");
    return {
      token,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: Math.floor(grant.expires / 1000),
      resource: new URL(grant.resource),
    };
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ) {
    this.cleanup();
    const grant =
      this.accessTokens.get(hash(request.token)) ??
      this.refreshTokens.get(hash(request.token));
    if (grant?.clientId === client.client_id)
      this.revokedFamilies.set(grant.family, Date.now() + lifetime);
  }
  async authorized(req: IncomingMessage) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return false;
    try {
      await this.verifyAccessToken(header.slice(7));
      return true;
    } catch {
      return false;
    }
  }
  challenge() {
    return `Bearer resource_metadata="${this.origin}/.well-known/oauth-protected-resource/mcp", scope="${OAUTH_SCOPE}"`;
  }
  handle(req: IncomingMessage, res: ServerResponse) {
    this.app(req, res);
  }
  private consentPage(
    res: Response,
    id: string,
    pending: Pending,
    status = 200,
  ) {
    res
      .status(status)
      .setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:* http://[::1]:*; frame-ancestors 'none'; base-uri 'none'",
      );
    res
      .type("html")
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to GHOST</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#080d13;color:#eef3f6;font:16px system-ui}main{width:min(100%,440px)}small{color:#b7f66a;letter-spacing:3px}h1{font-size:44px;letter-spacing:-2px}p{color:#adbac6;line-height:1.6}form{padding:24px;border:1px solid #29343f;border-radius:16px;background:#111923}label{display:block;margin:16px 0 10px}input,button{width:100%;padding:14px;border-radius:8px;font:inherit}input{background:#080d13;color:white;border:1px solid #455361}button{margin-top:14px;background:#b7f66a;border:0;font-weight:600;color:#0d1609}.deny{background:transparent;color:#adbac6;border:1px solid #455361}.error{color:#ffb4a8}.destination{overflow-wrap:anywhere;font-size:13px}</style><main><small>GHOST / PRIVATE CONNECTION</small><h1>Connect your agent</h1><p><strong>${escape((pending.client.client_name ?? "This MCP client").slice(0, 120))}</strong> is asking to observe and control the four simulated machines in your warehouse.</p><p class="destination">Return address: ${escape(new URL(pending.redirectUri).origin)}. Only approve a connection you started.</p><form method="post" action="/oauth/consent"><input type="hidden" name="request" value="${id}"><input type="hidden" name="csrf" value="${pending.csrf}"><label for="token">Warehouse access key</label><input id="token" name="token" type="password" autocomplete="current-password" maxlength="512" required>${status !== 200 ? '<p class="error" role="alert">Access was not granted. Check the key or try again shortly.</p>' : ""}<button name="decision" value="allow">Allow connection</button><button class="deny" name="decision" value="deny" formnovalidate>Cancel</button></form><p>Your warehouse key stays with GHOST. The client receives a separate token. Reconnect after a server restart or after eight hours.</p></main></html>`,
      );
  }
}
