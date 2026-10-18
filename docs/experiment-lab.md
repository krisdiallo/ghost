# GHOST experiment lab

Open **Experiment lab** in the console at /#lab to test configured devices and workflows in isolated warehouses. Eleven new MCP tools extend the original five embodiment tools. This is simulation evidence under explicit assumptions, not physical hardware certification.

## Complete flow

1. Clone the live warehouse, a saved sandbox, or imported version-1 JSON.
2. Change structures, tagged cargo or temporary device candidates.
3. Bind named workflow actors to device IDs and add typed command steps.
4. Save and run. The server forks the starting definition into a separate Simulation.
5. Watch the trial, inspect actual sensor JPEGs, review errors and compare candidates.
6. Export definitions and complete reports as JSON.

The desktop/phone UI provides orbit/pan/zoom, top view, body camera, device focus, device parameters, a floorplan editor, workflow roles and steps, run history and comparisons. All controls use the same authority as MCP.

**Run aisle fit comparison** creates an explicit scripted example: the standard drone's 2.9 m conservative envelope is rejected by a 2.4 m rack gap, while a 70% scale candidate completes the same inspection. This tests stated geometry assumptions; it is not a vendor recommendation or autonomous planner.

## MCP tools

| Tool                 | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| sandbox_list         | Drafts, recent runs, limits and assumptions              |
| sandbox_create       | Clone live state, a saved sandbox or imported definition |
| sandbox_inspect      | Complete operator definition and spectator snapshot      |
| sandbox_update       | Replace a definition using expectedRevision              |
| sandbox_add_device   | Add a bounded temporary device using expectedRevision    |
| sandbox_delete       | Remove an unleased draft; retained run forks remain      |
| experiment_templates | Explicit starter candidate/workflow definitions          |
| experiment_run       | Fork and execute; return a run ID immediately            |
| experiment_inspect   | Frozen inputs, trace, metrics and optional snapshot/JPEG |
| experiment_cancel    | Stop work, release leases and retain partial evidence    |
| experiment_compare   | Compare two to four reports and explain mismatches       |

Discover and possess also accept sandboxId. Their opaque lease automatically routes observe, act and release to that draft, with sandbox context in replies. Omitting sandboxId preserves the live-warehouse behavior.

Operator tools deliberately expose full scenario cargo and configured conditions. Body discovery retains its sensor privacy. Using an operator definition is not a blind inventory benchmark.

A complete MCP recipe:

```text
sandbox_create({name:"Candidate A"})
sandbox_add_device({sandboxId, expectedRevision:0, device})
sandbox_inspect({sandboxId})
sandbox_update({sandboxId, expectedRevision:1, definition:{...definition,workflow}})
experiment_run({sandboxId, expectedRevision:2, playbackRate:4})
experiment_inspect({runId, includeSnapshot:true})
experiment_inspect({runId, imageResourceId:device.id})
```

Reuse actual returned IDs/revisions. Obtain starter device/workflow definitions through experiment_templates. For a controlled variant, clone the same saved starting definition, change the bound candidate profile and execute the same workflow.

## Definitions and parameters

Version-1 definitions include a name, solid obstacle boxes, device definitions, tagged cargo and an optional saved workflow. This version edits/imports structures inside the existing **64 × 44 m hall**; it does not reconstruct arbitrary buildings from images or CAD.

Device scale is bounded to 50–150%. It changes visible geometry, conservative clearance, camera offsets, arm reach and ground/takeoff/landing heights. It is a hypothetical uniformly scaled candidate, not a calibrated vendor model. Mobile speed ranges from 0.2–6 m/s. Sensor/inspection ranges use meters; inspection cannot exceed sensing. Only arms support payload and grasp/place. Cargo mass in kilograms is checked against configured arm payload.

Saving validates dimensions, bounds, IDs, spawn clearance and profiles. Expected revisions prevent lost edits; release draft leases before changing a definition. Runs can require the preview revision so another client's edit cannot silently change their inputs.

Live state stays independent. A clone clears leases, pending actions and inspection history. Place held cargo before cloning live state. Cloning a sandbox copies its saved definition; manual motion in a draft does not rewrite that starting definition.

## Workflow execution

A workflow contains actors (role → device ID), one to 64 sequential steps, stopOnError, a 5–300 simulated-second budget and requireSafeEnd. Steps contain actor, a normal body command, optional label and optional dwellSeconds (0–60).

Commands use the existing capability, lease, collision, sensing, range and payload checks. The runner executes no user code and finds no routes automatically. Internal actor capabilities never enter reports or public snapshots.

Playback 1–8 changes viewing speed, not simulated results. The clock advances deterministically to action/dwell boundaries. Travel consumes distance/speed time with the existing minimum action duration. Post-action dwell adds configured time. Inspection and arm preset commands otherwise have no calibrated hardware duration.

Defaults stop at the first error and require drones landed, grippers empty and arms home. With stopOnError:false, later steps can recover, but any failed step still fails the overall run. Cancellation/timeout stop motion and release leases. They do not secretly land a drone or place cargo; safeEndState identifies recovery needs.

## Reports and comparisons

Every report freezes the definition, workflow, source revision, step trace, original errors and assumptions. Editing/deleting its source draft cannot rewrite the result.

Metrics include simulated seconds, actual route distance (including partial motion), completed/failed steps, blocked moves, inspected cargo IDs, sampled floor checkpoints, lease cleanup and safe end state.

Controlled comparisons require matching structures, starting cargo, fixture device definitions, workflow commands/dwell, actor kinds, launch poses and execution requirements. Candidate profiles may differ. Fingerprints derive from frozen inputs. Display names and playback rate do not change the test.

A failed or cancelled run is not a speed improvement. Time/distance deltas appear only for comparable completed runs. Untested capabilities are not established by completion. Checkpoint visibility does not certify full areas or exhaustive inventory.

## Assumptions, retention and access

The model uses static solid structures, conservative swept clearance, occluded radial mobile telemetry and rendered optics. It excludes battery, acceleration, airflow, radio, moving-device/cargo collisions, wear, firmware and calibrated hardware performance.

One process holds the live world, at most eight drafts and four concurrent trial forks. A draft supports twelve devices, 128 obstacles and 32 cargo objects. The last 32 run reports are retained; old completed reports are evicted as new ones start. Restart clears memory. Export JSON for retention and import definitions to reproduce work.

All tools use existing host/origin checks and hosted shared-key authentication. Sensor rendering receives frozen state and local assets only. No database, external model provider or new credentials are required.

## Verification

The lab server tests cover isolation, revisions, deterministic clocks, frozen evidence, comparison criteria, continuation after failure, dwell, cancellation, timeout, safe endings, payload and actual HTTP/stdio MCP clients.

Run node scripts/capture-lab.mjs for the real desktop/phone UI and official MCP SDK regression. It records A/B outcomes, a real JPEG, device/layout edits, frozen prior inputs, definition download/import and a phone workflow replay. Actual screenshots, a continuous 2× recording and verification JSON go to work/captures/lab. These scripted checks are separate from independent agent evaluations.
