# Real agent missions

GHOST accepts a real MCP agent through its local HTTP or stdio endpoint. Hosting and ChatGPT OAuth are not needed when the agent and warehouse run in the same environment. [The navigation run](progress/navigation/README.md) inspected all 3 tagged crates, observed 85/85 eligible checkpoints with static occlusion, recovered from a blocked path and verified priority dispatch. [The initial run](progress/agent/README.md) inspected 2 of 3. [The earlier survey run](progress/survey/README.md) used the previous non-occluding 96-cell model. Reports include actual sensor frames, redacted MCP traces, recordings and limitations; different objectives/budgets/models prevent a controlled performance comparison.

Each agent was a new Codex subagent started without inherited conversation. It was given a general objective, actual MCP schemas, and transport instructions. No repository context, crate locations, route or expected inspection conditions were provided. It used both structured telemetry and camera images. The MCP tool description now describes command mechanics without a canned mission recipe.

## Connect an agent

Build and run the warehouse, then configure the agent with `http://127.0.0.1:3001/mcp`, or use the stdio configuration in the README. A general objective is enough:

> Find and inspect tagged cargo. Report condition exceptions. Stage cleared priority cargo in dispatch using suitable bodies, and verify the result. Choose your own bodies, order, route and actions. Use camera images and structured observations. Stop safely if you cannot verify the work, and report any coverage uncertainty.

The agent should discover bodies, possess before acting, request `observe` with `image:true` when it needs an image, and use inexpensive structured observations to poll motion. Leases expire; an agent can release and possess again when necessary. Typed errors describe failures. Returning an arm home and landing a drone are separate actions from release: release stops motion but does not automatically restore a pose.

Use the five MCP tools as the agent's world interface. Keep spectator snapshots and repository fixtures out of its decision context when evaluating independent discovery. Structured observations disclose sensor-visible positions and inspection conditions, so this is a multimodal tool-use task, not a vision-only navigation test. The simulated abrasion condition currently comes from an inspection result, not a visible damage texture.

## Plan a search from the MCP interface

`discover` returns each body's `limits`: analytic telemetry range/model, inspection range, camera view and aim bounds, arm gripper presets/grasp radius, and drone flight bounds. Read these before selecting an inspection height or grasping cargo. Telemetry is radial for mobile bodies and range/pan/tilt limited for Sentinel; both telemetry and inspection require a clear static sightline. Rendered images use the body optics and finer scene geometry.

`survey` is shared checkpoint history since reset. `grid` defines 12 west-to-east columns and 8 north-to-south rows. Each row string uses `1` for a visible floor checkpoint, `0` for an unknown point, and `x` for a point inside a structure (excluded from totalCells). Compute point positions using surveyGuide. Only stationary observations with a static line of sight receive credit. These sampled points do not certify whole floor-cell areas.

Read `navigation.obstacles` and each body's clearance before choosing waypoints. Every direct motion, including descent and landing, is checked against static solid envelopes. PATH_BLOCKED rejects it without applying a partial motion and supplies the obstacle and blocking point. There is no automatic route planner. Drone look uses world pan/tilt, can aim while a motion runs, and preserves its aim when heading changes. Mobile proximity telemetry is radial with occlusion, separately from the aimed optical frustum.

`knownCargo` includes only previously observed objects, with historical positions, timestamps and any successful inspection findings. Seeing cargo does not inspect it; move within `inspectRange` and inspect discovered IDs. Shared findings survive body switches and lease expiry, but restart/reset clears them. No expected cargo count is disclosed. Even a full floor grid cannot establish complete visual, elevated-rack, or changing-world inventory coverage.

## Record a fresh Codex session

The optional recorder starts a disposable local warehouse using the same authority, MCP implementation and renderer as the main app. It does not reset or modify a separately running warehouse.

```sh
npm run agent:record
```

It requires Chromium and FFmpeg, as described in the README. The recorder remains running while a separate process sends commands through a filesystem mailbox. Set the same `GHOST_AGENT_DIR` on both processes to choose an output directory; the default is `work/agent-session`. `GHOST_AGENT_ACTOR` optionally labels the external caller. Set `GHOST_AGENT_CAPTURE_MOBILE=1` to export desktop/mobile survey ledger and map stills after the mission, without sending them to the agent. The recorder itself does not run a model.

Ask the parent Codex agent to start a subagent with **no inherited conversation**. Give the subagent the general objective and transport syntax below. Instruct it to avoid repository/source files, spectator DOM and snapshot APIs; it may view only the actual sensor JPEG paths returned by its tool calls. The recorded run was instruction-bound, rather than an operating-system sandbox with a restricted filesystem.

Get the actual MCP schemas:

```sh
node scripts/agent-command.mjs <<'JSON'
{"tools":true}
JSON
```

Then send the objective and agent-selected commands, one JSON object per call:

```json
{"objective":"Find and inspect tagged cargo, report exceptions, and stage cleared priority cargo."}
{"tool":"discover","arguments":{},"note":"Find available bodies and their capabilities."}
```

Possess uses the real resource ID returned by discovery. For `observe`, `act`, and `release`, the recorder accepts `leaseRef` equal to that resource ID and substitutes its private capability in memory. Raw `leaseId` inputs are rejected. The public result removes capability fields, view metadata and base64 image bytes; images are saved separately with hashes.

`{"waitFor":"possessed-resource-id"}` only polls an existing action. It never chooses or starts an action. When an image result returns `image.absolutePath`, the agent must inspect that image before claiming visual evidence. `{"finish":"outcome and limitations"}` releases remaining leases, exports authority state for later evaluation, saves a public trace, and encodes a continuous browser recording at **4× speed**. There is no predetermined body sequence or movement policy in the recorder.

The recorder's browser follows the observed body, and presentation failures are reported separately from actual MCP outcomes. Mailbox replies are atomically renamed into place; clients also tolerate incomplete writes from older running recorders without resubmitting commands. The video is encoded before optional post-run stills, and the desktop page closes before opening the mobile page to keep screenshot stability checks active. The live run exposed an interleaved-body preview timeout; `node scripts/smoke-agent-recorder.mjs` checks the corrected behavior. That is a scripted transport regression test, separate from the real agent run.

## Evaluate after completion

Keep the original trace unchanged. Compare final authority state against the agent's claims after it finishes. Count inspected and unseen tagged objects, check dispatch placement, confirm the drone landed, and verify cleanup. Retain errors and unobserved frames in the report. A successful priority transfer does not establish exhaustive inventory coverage.

`scripts/save-agent-progress.mjs` validates image hashes and cleanup, reads an explicit image-viewing attestation, and publishes a mobile report. The initial run's full-world comparison is in `docs/progress/agent/verification.json`; it was not supplied to the agent during its mission.

This work provides a real agent-controlled example and reusable recording transport. A standalone model runner, one-click autonomous UI mode, a guaranteed exhaustive inventory planner, hosted Manufact endpoint, and ChatGPT OAuth are not implemented.
