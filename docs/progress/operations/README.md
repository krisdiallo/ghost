# GHOST · an operating warehouse, a ghost on call

October 18, 2026 · Real browser and official MCP SDK rehearsal. The operator calls in this recording are scripted operator calls, not a recorded ChatGPT conversation.

![Actual incident: Scout stopped before an inserted box](incident-raised.jpg)

[Continuous incident → recovery → sandbox recording, 2×](incident-to-experiment-2x.mp4?raw=true) · [Working fleet](working-warehouse.jpg) · [Phone](working-mobile.jpg)

The warehouse runs local jobs continuously: rover aisle inspections, drone inventory sweeps, camera surveillance, and a one-shot arm dispatch assignment. Runtime box placement is authoritative. Swept collision checks stop a moving rover before contact and raise a detected incident while the other jobs continue.

The rehearsal then uses real MCP possession and a body-mounted JPEG, then dispatches Mule with a capability-authorized operator action. Mule approaches, lifts, carries and sets the same box down in staging. The rehearsal then drives the rover forward, verifies the route and returns control to the local controller. Scout subsequently inspects Cargo 12. The incident remains in history.

[Mule loading](mule-loading.jpg) · [Carrying the box](mule-carrying.jpg) · [Box staged](box-staged.jpg)

[Operator possession](operator-possessed.jpg) · [Actual operator sensor JPEG](operator-sensor.jpg) · [Work resumed](operations-restored.jpg) · [Assertions and redacted MCP results](verification.json)

![Actual rover camera facing the box](operator-sensor.jpg)

The same recording continues into an isolated warehouse comparison: the standard drone is blocked at the gap, and the compact candidate completes the workflow. Live operations keep running independently.

[Sandbox comparison](sandbox-comparison.jpg) · [Full continuous demo/operator recipe](../../live-operations.md)

For the presentation, place the box in the UI and manually tell ChatGPT: “There seems to be an incident in the warehouse. Investigate it and get operations moving again.” Refresh the connector to expose all 17 tools. No unsolicited ChatGPT wake-up is required.

Local autonomy is a deterministic task controller issuing real simulation commands. External ChatGPT supplies reasoning. Scout has no gripper. A dedicated Mule material handler physically relocates the same box through bounded aisle routes; the staged box remains visible and collidable. Motion remains kinematic, with no real hardware or dynamic device collisions. State is in memory.

[Earlier experiment evidence](../experiments/README.md) · [Rack geometry](../racks/README.md) · [Navigation and independent agent evidence](../navigation/README.md)
