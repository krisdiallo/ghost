# GHOST · navigation and camera realism

Oct 17, 2026, 11:20 PM PDT · actual app and MCP captures

**Static collision checks, occluded sensing and an independent drone gimbal are implemented.** A fresh-context agent inspected **3/3 tagged crates**, observed **85/85 eligible floor checkpoints**, and verified priority dispatch. Remaining limitations and actual errors are below.

![Actual drone sensor after aiming sideways — 29 KB](validation/drone-side.jpg)

Only this 29 KB preview loads automatically. It is from the scripted validation, not the independent agent. [Watch the scripted navigation/gimbal check at 4× — 8 seconds, 106 KB](validation/navigation-check-4x.mp4?raw=true). [Watch the full fresh-agent mission at 4× — 157 seconds, 1139 KB](agent-mission-4x.mp4?raw=true).

- [Same drone pose, camera aimed down — actual JPEG](validation/drone-down.jpg?raw=true)
- [Actual phone gimbal controls](validation/mobile-gimbal.jpg?raw=true)
- [Rejected rover route on the shared map](validation/blocked-map.jpg?raw=true)
- [Full console during blocked motion](validation/route-blocked.jpg?raw=true)
- [Fresh agent's final checkpoint/cargo ledger](survey-mobile.jpg?raw=true)
- [Original fresh-agent MCP trace](trace.json) · [context and image-viewing attestation](agent-attestation.json)
- [Independent authority verification](verification.json) · [scripted regression results](validation/verification.json)

## What is enforced

Rover/drone motions sweep a conservative body envelope over the entire straight segment. Packed rack bays, freight, walls, columns and mezzanine structures reject intersecting paths, including vertical descent and landing. A rejected move leaves the body in place, returns PATH_BLOCKED with obstacle/position/clearance, and publishes a red map marker plus activity event. Static floorplan geometry is available through MCP; it does not reveal hidden cargo IDs or an inventory count. Agents choose their own waypoints. Discovery and body limits label clearance as X/Y/Z half-extents, so clients can account for the full wheel/rotor footprint. There is no automatic path planner or rigid-body physics.

Telemetry and inspection now require line of sight through the same static solid envelopes. Mobile proximity telemetry is radial; rendered images use the aimed optical frustum and finer geometry. The model can conservatively reject a visible gap inside a packed rack. Other moving bodies and mission cargo are not dynamic collision obstacles, and analytic inspection text is not a visible damage texture.

Wisp's world pan/tilt gimbal aims independently of chassis motion. The scripted test changes aim while a takeoff is running and verifies that the original motion remains active. It also captures the two JPEGs above at the exact same body position and heading, verifies their different hashes, and operates the real controls at 390 px phone width. It rejects a rover crossing and landing over a rack, verifies that Sentinel cannot detect or inspect through a packed bay, then returns to clear floor and releases every lease. This is a scripted correctness regression, distinct from the fresh agent below.

## The fresh-context mission

The agent started with no inherited chat or repository context. It was supplied a general mission, actual MCP schemas and recorder transport instructions, with no cargo IDs/locations, expected conditions, body sequence or route. It was instructed to avoid source/docs and spectator APIs/DOM, and to view only its returned sensor JPEGs. This was instruction-bound, not an OS-isolated benchmark. The parent checked authority state only after control finished.

The agent used Sentinel, Atlas and Wisp by its own choice. It inspected Cargo 07 (seal intact, label verified, cleared for dispatch), used the arm to stage it at [6,0.55,2], viewed the placement image and independently verified the location through Sentinel. It inspected Cargo 12 (surface abrasion on north face, seal intact) and Cargo 18 (seal intact, awaiting inventory scan), leaving both in place and reporting the exceptions. It observed all 85 eligible floor checkpoints while explicitly declining to certify exhaustive inventory or elevated/occluded spaces. Motion 35 returned PATH_BLOCKED at rack-7; the body stayed in place, and the agent recovered by overflying racks at 9 m and descending in clear aisles. The arm ended home and empty, the drone landed at [-29.3,0.4,3], and every lease was released.

The trace contains **92 recorded MCP calls**, excluding aggregated motion polls, and **28 sensor images actually viewed**. Tool error responses: **1**. Recorder errors: **0**. No image deliveries were reported unavailable. Export: completed. Cleanup: leases released, arm home and empty, drone landed.

## What the coverage number means

The new grid samples 96 floor positions. 11 points lie inside structures and are excluded, leaving 85 eligible checkpoints. A point is credited only by a stationary observation with range/FOV and line of sight. Hollow points remain unknown. This does not certify full cell areas, elevated-rack coverage or exhaustive inventory. Earlier [96-cell results](../survey/README.md) used the previous non-occluding whole-cell model; scores are not directly comparable.

These examples demonstrate actual simulated embodiment through MCP. The recorder contains no model or route policy; a fresh Codex agent supplied mission decisions. It is not a standalone autonomous UI mode. Physical phone/GPU testing, Manufact hosting and ChatGPT OAuth remain pending.
