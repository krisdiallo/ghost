# A working warehouse, with a ghost on call

Production starts local device jobs automatically. Scout inspects aisle B, Wisp surveys the north docks, Sentinel sweeps its camera, and Atlas stages priority cargo once and waits for its next assignment. These are deterministic local task controllers issuing actual server commands, not an embedded LLM or decorative movement. External ChatGPT provides operator reasoning when a job needs help.

## The continuous demo

1. Open the warehouse and choose **Enter live warehouse**. Devices are already working. Select Scout or Wisp to follow its actual motion. The compact operations panel remains available in immersive view.
2. Choose **Drop box ahead of Scout**, or **Place a box on the floor** and click clear space on the floor/map. Placement rejects device and structure intersections. A box in Scout's route stops it before contact, cancels its motion, and raises an amber incident. Other jobs continue.
3. In ChatGPT, say:

> There seems to be an incident in the warehouse. Investigate it and get operations moving again. Read the incident, possess the affected device, inspect its actual camera image, clear the simulated obstruction, verify a short forward move, then explicitly return it to local autonomy. Confirm that its assigned work has resumed.

4. Watch the device change from **Needs assistance** to **Operator control**. The box disappears only after an authorized simulated clearance. The operator can move the device, then hand it back. **Return to autonomy** verifies the remaining route and releases the capability. The job continues and the incident remains in history.
5. Continue the same ChatGPT conversation:

> Before we change the routine inspection workflow, test alternatives in a sandbox. Clone the current warehouse, use the aisle-fit inspection starter, compare standard and compact drone candidates under matching conditions, preserve the blocked attempt and show actual trial sensor images. Run sequentially at 1× so we can watch. Explain the result and assumptions; leave live operations alone.

6. Open **Experiment lab**, select each new run, and use **Focus device**. Finish on the failed/completed comparison. Live jobs continue independently.

Do not start the old guided tour for this story. That separate scripted walkthrough pauses local jobs and resets the warehouse. Reset restores the scene and leaves operations paused; choose Start operations to begin again. No reset is needed between incident recovery and experiments.

## MCP operator tools

The connection now exposes **17 tools**: five body tools, eleven sandbox/experiment tools and one operations tool. Refresh the ChatGPT connector's tool list if operations or the experiment tools are missing.

Operations actions:

- `status`: jobs, commands, detected incidents and operator-placed boxes.
- `start` / `pause`: start local task controllers or stop their own pending actions. An external operator's lease is preserved.
- `place_box`: add a bounded simulated box at x/z, or omit both coordinates for a position ahead of Scout.
- `clear_box`: supply incidentId and a valid leaseId for the affected body. The body must be stopped within 4 m. This simulates operator removal; Scout has no gripper. Permanent structures cannot be cleared.
- `resume`: supply incidentId and the affected body leaseId. The body must be stationary and the remaining route clear. The action resolves the incident, releases the operator lease and returns work to the local controller.
- Optional `watch`: bounded wait up to 25 seconds after a sequence cursor. The primary demo uses a human noticing the incident and messaging ChatGPT. There is no unsolicited ChatGPT wake-up.

Possessing a working device yields its internal local-autonomy lease. Possessing a device owned by another external operator still rejects contention. A blocked job releases its own capability and stays stopped until explicit recovery. If an operator takes over a routine job without an incident, releasing it allows that job to continue.

The operator interface intentionally exposes assigned job commands. Ordinary body discovery includes detected incident summaries but does not expose future job cargo targets as sensor discoveries. Actual observation and inspection privacy remains unchanged.

## Simulation and retention

Runtime boxes are visible in the 3D view, actual sensor JPEGs and map. Swept checks apply during motion as well as when a new command is accepted; a box added after movement began cannot be tunneled through. Boxes also participate in telemetry line of sight. Historical checkpoint credit is retained.

Cloning includes current physical obstacles/devices/cargo and clears live capabilities, work controllers and incident history in the sandbox. A held crate must be placed before cloning. Trial forks remain independent of ongoing live work.

All jobs, boxes and incident history are in memory. The standalone server starts operations unless GHOST_AUTONOMY=0; test authorities start paused. API/MCP controls inherit hosted authentication and exact-origin checks. No database, provider key, scheduler service or hardware integration is added.

## Evidence

Run node scripts/capture-operations.mjs after building. It runs a continuous real browser/official MCP SDK rehearsal, verifies the stop, capability handoff, actual image, simulated clearance, manual motion, resumed cargo inspection and sandbox comparison, and checks the phone layout. Its recording is scripted QA, not a recorded autonomous ChatGPT session.
