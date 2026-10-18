import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface AccessOptions {
  origin?: string;
  accessToken?: string;
}
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const cookieName = "ghost_session";
const sessionLifetime = 8 * 60 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest();

export function accessConfig(host: string, options: AccessOptions) {
  const rawOrigin = options.origin ?? process.env.GHOST_ORIGIN;
  const token = options.accessToken ?? process.env.GHOST_ACCESS_TOKEN;
  const origin = rawOrigin ? new URL(rawOrigin) : undefined;
  if (
    origin &&
    (origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      !["http:", "https:"].includes(origin.protocol))
  )
    throw new Error(
      "GHOST_ORIGIN must be an exact HTTP(S) origin, without a path or credentials.",
    );
  const remote =
    !localHosts.has(host) || (origin && !localHosts.has(origin.hostname));
  if (
    token !== undefined &&
    (token.length < 32 || token.length > 512 || /\s/.test(token))
  )
    throw new Error(
      "GHOST_ACCESS_TOKEN must contain 32–512 non-whitespace characters.",
    );
  if (remote && (!token || !origin || origin.protocol !== "https:"))
    throw new Error(
      "Remote binding requires GHOST_ACCESS_TOKEN and an exact HTTPS GHOST_ORIGIN.",
    );
  return {
    origin: origin?.origin ?? null,
    token,
    secure: origin?.protocol === "https:",
  };
}

export class WarehouseAccess {
  private sessions = new Map<string, number>();
  private attempts = 0;
  private windowEnds = 0;
  private key: Buffer | undefined;
  readonly enabled: boolean;
  constructor(
    token: string | undefined,
    private secure: boolean,
  ) {
    this.enabled = token !== undefined;
    this.key = token === undefined ? undefined : digest(token);
  }
  private matches(token: string) {
    return this.key !== undefined && timingSafeEqual(digest(token), this.key);
  }
  private session(req: IncomingMessage) {
    const value = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    return value ? digest(value).toString("hex") : "";
  }
  authorized(req: IncomingMessage) {
    if (!this.enabled) return true;
    if (this.bearer(req)) return true;
    return (this.sessions.get(this.session(req)) ?? 0) > Date.now();
  }
  bearer(req: IncomingMessage) {
    const header = req.headers.authorization;
    return (
      header?.startsWith("Bearer ") === true && this.matches(header.slice(7))
    );
  }
  login(token: unknown, res: ServerResponse) {
    const now = Date.now();
    if (now >= this.windowEnds) {
      this.attempts = 0;
      this.windowEnds = now + 60_000;
    }
    if (++this.attempts > 30) {
      res.setHeader("Retry-After", "60");
      return "limited";
    }
    if (typeof token !== "string" || !this.matches(token)) return "invalid";
    for (const [id, expiry] of this.sessions)
      if (expiry <= now) this.sessions.delete(id);
    if (this.sessions.size >= 100)
      this.sessions.delete(this.sessions.keys().next().value!);
    const session = randomBytes(32).toString("base64url");
    this.sessions.set(digest(session).toString("hex"), now + sessionLifetime);
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetime / 1000}${this.secure ? "; Secure" : ""}`,
    );
    return "ok";
  }
  logout(req: IncomingMessage, res: ServerResponse) {
    this.sessions.delete(this.session(req));
    res.setHeader(
      "Set-Cookie",
      `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${this.secure ? "; Secure" : ""}`,
    );
  }
}

export function loginPage(res: ServerResponse, status = 200, error = false) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "same-origin",
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enter GHOST</title><style>
  *{box-sizing:border-box}body{margin:0;min-height:100svh;background:#080d13;color:#eef3f6;font:16px system-ui,sans-serif;display:grid;place-items:center;padding:24px;background-image:linear-gradient(#ffffff04 1px,transparent 1px),linear-gradient(90deg,#ffffff04 1px,transparent 1px);background-size:48px 48px}main{width:min(100%,440px)}.mark{width:56px;height:56px;display:grid;place-items:center;background:#b7f66a;color:#0d1609;font-size:30px;border-radius:16px;margin-bottom:40px}small{color:#b7f66a;font-size:11px;letter-spacing:3px}h1{font-size:clamp(48px,15vw,72px);letter-spacing:-4px;margin:8px 0 0;line-height:1}h2{font-size:22px;font-weight:500;letter-spacing:-.4px;margin:12px 0 24px}p{color:#9caab6;font-size:14px;line-height:1.6}form{margin-top:32px;padding:24px;border:1px solid #29343f;border-radius:16px;background:#111923}label{display:block;font-size:13px;margin-bottom:12px}input{display:block;width:100%;font:inherit;background:#080d13;color:#eef3f6;border:1px solid #455361;border-radius:8px;padding:14px;min-height:48px}input:focus{outline:2px solid #b7f66a;outline-offset:2px}button{width:100%;padding:14px;margin-top:16px;background:#b7f66a;border:0;border-radius:8px;color:#0d1609;font:600 15px system-ui;min-height:48px;cursor:pointer}.error{color:#ffb4a8}.meta{display:flex;justify-content:space-between;font:11px ui-monospace,monospace;color:#8394a3;margin-top:24px;gap:12px}.note{font-size:12px;margin-bottom:0}
  </style></head><body><main><div class="mark" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 32 32"><path d="M6 26V14a10 10 0 0 1 20 0v12l-5-3-5 3-5-3-5 3Z" fill="currentColor"/><rect x="11" y="12" width="3" height="5" rx="1.5" fill="#b7f66a"/><rect x="18" y="12" width="3" height="5" rx="1.5" fill="#b7f66a"/></svg></div><small>EMBODIMENT LAB / PRIVATE DEMO</small><h1>GHOST</h1><h2>Any agent. Any body.</h2><p>One living warehouse. Four machines to inhabit.<br>Enter the operations console to explore.</p><form method="post" action="/auth/login"><label for="token">Warehouse access key</label><input id="token" name="token" type="password" autocomplete="current-password" required maxlength="512" placeholder="Enter your private access key" aria-describedby="help${error ? " error" : ""}">${error ? '<p class="error" id="error" role="alert">Access was not granted. Check your key or try again shortly.</p>' : ""}<button type="submit">Enter warehouse →</button><p class="note" id="help">Private access to your warehouse. Your session lasts eight hours.</p></form><div class="meta"><span>01 CAMERA · 02 ROVER</span><span>03 ARM · 04 DRONE</span></div></main></body></html>`);
}
