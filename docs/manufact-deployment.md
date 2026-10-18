# Manufact deployment

GHOST targets **Manufact Cloud**, matching the [official YC starter](https://github.com/mcp-use/hack-yc). HTTP MCP uses `mcp-use`; 17 tools dispatch to the live authority and isolated experiment worlds. Stdio remains an official MCP SDK adapter to that same authority.

**Live service:** https://bold-zero-suoax.run.mcp-use.com — MCP endpoint `/mcp`. The private repository is connected through the Manufact GitHub App. Production follows `main` with Wait for CI enabled. Deployment logs confirm one instance in US East; browser login, synchronized controls, images and authenticated MCP have been verified against the live endpoint.

## Service configuration

Import the existing private `krisdiallo/ghost` repository through the Manufact GitHub App. Use `main`, repository root `.`, Dockerfile `Dockerfile`, port `3000`, and enable **Wait for CI**. The image builds all three workspaces with Node 24 and serves the web console, API/SSE, and `/mcp` in one process as an unprivileged user. It includes Chromium for on-demand body-camera image observations; one renderer sleeps between captures. HTTP observations also support an inline mcp-use MCP Apps card. Pushes to the production branch can then deploy automatically.

Set runtime variables through Manufact's environment/secret settings:

| Variable             | Value                                                                             |
| -------------------- | --------------------------------------------------------------------------------- |
| `GHOST_ORIGIN`       | Exact assigned HTTPS browser origin, without `/mcp` or another path               |
| `GHOST_ACCESS_TOKEN` | Random private access key, at least 32 characters; generate and store as a secret |
| `GHOST_HOST`         | `0.0.0.0` (already set by the image)                                              |
| `PORT`               | `3000` (already set by the image; `GHOST_PORT` takes precedence)                  |

The process refuses remote binding without both authentication and an exact HTTPS origin. Health checks use `GET /api/health`, which returns service status only and does not require a key. Application endpoints require the key or a valid browser session. OAuth discovery, registration and authorization routes are public; granting access requires explicit consent and the warehouse key. OAuth bearer tokens authorize only `/mcp`.

**Run one replica in one region.** State and leases are in memory. Multiple containers would create separate warehouses. Verify Manufact's actual scaling configuration; do not assume HTTP statelessness makes the simulation horizontally scalable. A deploy, cold start, or restart resets the world and browser sessions. Prevent Scale to Zero is a paid Manufact setting; a plan purchase is not part of this setup.

## Deployment authorization

Manufact CLI login is separate from GitHub's existing connection. After network access to `manufact.com`, `*.manufact.com`, and `*.mcp-use.com` is available, use the official device login (`npx mcp-use login --no-open`) so the owner can authorize from their phone. The CLI normally stores its credential in `~/.mcp-use/config.json`; never print, commit, or copy that credential into chat. Configure filesystem permission for that credential directory before completing login. Alternatively inject `MCP_USE_API_KEY` through the cloud secret mechanism.

The Manufact GitHub App must separately have access to `krisdiallo/ghost`. Existing Codex GitHub access does not imply that permission. Do not create a replacement repository or use another host to work around a blocked connection.

Once signed in and secrets are configured, run `npm run deploy` from a clean checkout of `main`. This targets the root Dockerfile and waits for GitHub checks. Keep `.mcp-use/` private and ignored; its project link identifies the existing server on subsequent deployments.

## Connect and verify

Open the assigned HTTPS root URL on a phone. The private entry screen accepts the warehouse key and creates an eight-hour HttpOnly, Secure, SameSite browser cookie. The key is not stored in JavaScript storage, URLs, or public state. Sign out revokes that session and disconnects its streams. This is one shared private demo key, not individual user accounts.

For Claude Code, Cursor, or another client supporting custom authorization headers, configure the assigned HTTPS URL ending in `/mcp` with `Authorization: Bearer <private access key>`. Enter the real key through the client's private configuration. The in-app **Connect an agent** dialog shows the correct current-origin URL without revealing the key. The Manufact dashboard's own MCP client also needs this header in its server connection settings.

For ChatGPT, add `https://bold-zero-suoax.run.mcp-use.com/mcp` with **OAuth** authentication. Leave client ID and secret blank to use dynamic client registration. Enter the warehouse key only on GHOST’s consent page, check the return address, and approve the connection you started.

The official MCP SDK handles authorization-code/S256 PKCE, registration, token and revocation endpoints. Discovery advertises `ghost:control`, the exact MCP resource audience and authorization-response issuer identification. The scope permits observing and controlling the four simulated bodies; OAuth tokens do not unlock browser/admin APIs. Consent checks the request cookie, CSRF value and exact Origin; client names are escaped. Codes are one-use and expire after one minute. Access tokens last 15 minutes; refresh tokens rotate and expire after eight hours total. Refresh replay or `/revoke` invalidates the entire grant. Token hashes and consent state are memory-only, so a restart requires reauthorization. Client registrations are encrypted, authenticated IDs derived from the warehouse key and origin, allowing clients to reconnect across restarts without a database. Rotating the warehouse key invalidates client registrations too.

This remains one shared owner key, not individual accounts. The OAuth protocol and browser flow are automatically tested; actual signed-in ChatGPT setup must be verified in the owner’s account. Manufact deployment login is not authentication for GHOST's users. No LLM provider is added; the guided tour remains scripted, while an external agent supplies reasoning.

Before publishing a success report, verify the assigned endpoint: anonymous requests rejected; phone login and WebGL; SSE reconnection; authenticated MCP initialization and all 17 tools; one client possesses a rover and another sees contention; motion and inspection visible in the browser; release restores availability; logout invalidates the cookie. Confirm only one warehouse authority is active.

## Repeatable checks

`npm run check` and `npm test` cover the server and console. Authentication tests exercise real HTTP and stdio MCP clients, protected API/SSE paths, cookie revocation, CSRF/Origin rejection, secure-cookie attributes, login throttling and fail-closed remote configuration. `node scripts/capture-access.mjs` runs a real mobile-emulated browser login, MCP rover movement and inspection, immersive console, connection dialog and logout, saving small screenshots and `access-report.json` in `work/captures`. `node scripts/capture-oauth.mjs` tests SDK discovery/registration, real mobile browser consent and return navigation, authenticated MCP, refresh and revocation. Set `GHOST_OAUTH_URL` and `GHOST_ACCESS_KEY_FILE` to verify an existing deployment; secrets stay in memory and reports exclude tokens.

References: [Manufact deployment](https://docs.manufact.com/cli/deploy), [device login](https://docs.manufact.com/cli/login), [server settings](https://docs.manufact.com/dashboard/settings), [build runtimes](https://docs.manufact.com/dashboard/build-runtimes).

The full tour recorder observes warehouse travel independently of screenshot speed. If a brief camera/body moment falls between software-rendered frames, it captures the missing still in a separate replay through real HTTP tools, holding the actual pose until rendering finishes. `capture-report.json` identifies those replayed stills; the video remains the original uninterrupted tour. Set `GHOST_CAPTURE_REPLAY_STILLS=1` to exercise every replay checkpoint during validation.

### Demo deployment cadence

Pushes and merges run the `Check` workflow with strict typechecking and production builds. The long browser recordings, test suites and container rehearsal are retained as the manually invoked `Full QA (manual)` workflow so they do not delay demo deployments.
