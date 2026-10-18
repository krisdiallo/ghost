import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const source=resolve(process.env.GHOST_OPERATIONS_CAPTURE_DIR??'work/captures/operations'),out=resolve('docs/progress/operations');
const proof=JSON.parse(await readFile(join(source,'verification.json'),'utf8'));
for(const key of ['ongoingJobs','sweptStopBeforeBox','incidentRaised','operatorPossession','actualSensorImage','operatorClearance','manualMotionVerification','autonomyResumed','subsequentCargoInspection','isolatedExperimentComparison','phoneNoOverflow'])assert.equal(proof[key],true,key);
assert.deepEqual(proof.browserErrors,[]);assert.ok(!JSON.stringify(proof).includes('"leaseId"'));
await mkdir(out,{recursive:true});for(const name of ['working-warehouse.jpg','incident-raised.jpg','operator-possessed.jpg','operator-sensor.jpg','operations-restored.jpg','sandbox-comparison.jpg','working-mobile.jpg','incident-to-experiment-2x.mp4','verification.json'])await copyFile(join(source,name),join(out,name));
await writeFile(join(out,'README.md'),[
'# GHOST · an operating warehouse, a ghost on call','',
'October 18, 2026 · Real browser and official MCP SDK rehearsal. The operator calls in this recording are scripted QA, not a recorded ChatGPT conversation.','',
'![Actual incident: Scout stopped before an inserted box](incident-raised.jpg)','',
'[Continuous incident → recovery → sandbox recording, 2×](incident-to-experiment-2x.mp4?raw=true) · [Working fleet](working-warehouse.jpg) · [Phone](working-mobile.jpg)','',
'The warehouse runs local jobs continuously: rover aisle inspections, drone inventory sweeps, camera surveillance, and a one-shot arm dispatch assignment. Runtime box placement is authoritative. Swept collision checks stop a moving rover before contact and raise a detected incident while the other jobs continue.','',
'The rehearsal then uses real MCP possession and a body-mounted JPEG, removes the simulated obstruction with a capability-authorized operator action, drives the rover forward, verifies the route and returns control to the local controller. Scout subsequently inspects Cargo 12. The incident remains in history.','',
'[Operator possession](operator-possessed.jpg) · [Actual operator sensor JPEG](operator-sensor.jpg) · [Work resumed](operations-restored.jpg) · [Assertions and redacted MCP results](verification.json)','',
'![Actual rover camera facing the box](operator-sensor.jpg)','',
'The same recording continues into an isolated warehouse comparison: the standard drone is blocked at the gap, and the compact candidate completes the workflow. Live operations keep running independently.','',
'[Sandbox comparison](sandbox-comparison.jpg) · [Full continuous demo/operator recipe](../../live-operations.md)','',
'For the presentation, place the box in the UI and manually tell ChatGPT: “There seems to be an incident in the warehouse. Investigate it and get operations moving again.” Refresh the connector to expose all 17 tools. No unsolicited ChatGPT wake-up is required.','',
'Local autonomy is a deterministic task controller issuing real simulation commands. External ChatGPT supplies reasoning. Box removal is a simulated operator action; the rover has no gripper. Motion remains kinematic, with no real hardware or dynamic device collisions. State is in memory.','',
'[Earlier experiment evidence](../experiments/README.md) · [Rack geometry](../racks/README.md) · [Navigation and independent agent evidence](../navigation/README.md)',''
].join('\n'));
await writeFile('docs/progress/latest/README.md',[
'# GHOST · latest visual progress','',
'[Working warehouse → placed box → incident → MCP operator recovery → sandbox validation](../operations/README.md)','',
'![Actual incident and operator handoff](../operations/incident-raised.jpg)','',
'[Continuous rehearsal recording, 2×](../operations/incident-to-experiment-2x.mp4?raw=true) · [Phone](../operations/working-mobile.jpg) · [Operator guide](../../live-operations.md)','',
'Earlier: [Experiment lab and independent trials](../experiments/README.md) · [Rack tops](../racks/README.md) · [Navigation](../navigation/README.md) · [Survey](../survey/README.md).',''
].join('\n'));
console.log('Published validated continuous operating-warehouse rehearsal and evidence.');
