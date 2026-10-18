# GHOST · see what the agent sees

2026-10-18T01:47:23.898Z · real Chromium/software-WebGL and MCP captures

**All four bodies now have camera views.** An MCP agent can request a real JPEG through its possessed body's sensor. The warehouse's **Agent vision** panel and the embedded mcp-use MCP App show the exact returned image, with its revision and capture time.

![Actual mcp-use embedded sensor card in a local MCP Apps host — 62 KB](ghost-mcp-app.jpg)

Only this 62 KB preview loads by default. The card above is captured from our local MCP Apps test host, **not a signed-in ChatGPT session**. The warehouse is simulated; no real camera or hardware is involved.

- [Watch the actual four-body sensor demo — 33 seconds, approximately 295 KB](ghost-sensor-demo.mp4?raw=true)
- [Phone UI with live body camera and captured agent frame](ghost-sensor-mobile.jpg?raw=true)
- [Scout inspecting Cargo 07 — full console](ghost-pov-rover-01.jpg?raw=true)
- [Sentinel's high corner view](ghost-sensor-camera-01.jpg?raw=true)
- [Scout's mast view and readable cargo label](ghost-sensor-rover-01.jpg?raw=true)
- [Wisp's downward view from 9 m](ghost-sensor-drone-01.jpg?raw=true)
- [Atlas's wrist camera over Cargo 07](ghost-sensor-arm-01.jpg?raw=true)
- [Machine-readable results and frame hashes](sensor-report.json)

## What actually ran

A real MCP client possessed Scout, drove along the forecourt to X 2 / Z 2.1, inspected Cargo 07, captured an image, and released the body. The sensor saw the physical **CARGO 07** label. Inspection returned **“Seal intact. Label verified. Cleared for dispatch.”** The capture harness uses explicit commands; it is not an LLM deciding the route or interpreting the image.

The same run captured Sentinel from its 10 m corner mount, Wisp after climbing to 9 m, and Atlas in its Reach preset. Every image is a real 640 × 360 JPEG rendered from a frozen authoritative snapshot. A separate stdio MCP client received image content as well. The embedded app completed the MCP Apps handshake, and its image bytes exactly matched the agent's image. The touch-emulated phone layout fit its screen with no page errors.

The server renders without a human browser open. One lazy Chromium worker uses only bundled local scene assets and sleeps between captures. The production container includes Chromium and also passed an authenticated MCP image request.

**Live body camera** follows the current world. **Agent vision** is the last captured frame and can be older; its timestamp and revision make that explicit. Structured cargo telemetry still uses analytic range/FOV checks, while the image includes scene occlusion.

The standalone warehouse UI is custom React/Three.js. The embedded card uses mcp-use's React runtime, host bridge and MCP Apps resource support. Manufact hosting remains blocked by the environment's domain allowlist, and ChatGPT OAuth is not implemented. [Deployment status](../../manufact-deployment.md). This work does not claim a deployed or signed-in ChatGPT integration.
