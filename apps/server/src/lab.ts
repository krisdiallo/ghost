import { createHash, randomUUID } from "node:crypto";
import {
  BOUNDS,
  bodyClearance,
  bodyLimits,
  containsPoint,
  blockingObstacle,
  defaultProfile,
  type Body,
  type BodyToolName,
  type DeviceProfile,
  type DeviceDefinition,
  type WarehouseDefinition,
  type WorkflowDefinition,
  type SandboxSummary,
  type SandboxDetail,
  type RunSummary,
  type ExperimentReport,
  type TrialStepResult,
  type TrialMetrics,
  type ExperimentComparison,
  type ExperimentTemplate,
  type Vec3,
  type LabState,
  type ToolName,
} from "@ghost/shared";
import {
  schemas,
  definitionSchema,
  workflowSchema,
  deviceSchema,
} from "./contracts.js";
import { Simulation, SimError } from "./simulation.js";

const LIMITS = { sandboxes: 8, devices: 12, activeRuns: 4, retainedRuns: 32 };
export const ASSUMPTIONS = [
  "Kinematic motion with static solid obstacles and conservative swept body envelopes; no automatic path planner.",
  "Uniform device scale changes the rendered body, clearance, mounting offsets and takeoff/landing heights.",
  "Configured speed and sensor ranges are assumptions, not measurements from a hardware vendor.",
  "No battery, acceleration, radio, moving-device collision, dynamic cargo collision or hardware calibration.",
  "Workflows execute typed commands in sequence; they are scripts, not an embedded autonomous model.",
  "Only kinematic travel and configured per-step dwell consume simulated time. Inspection and arm preset commands have no calibrated hardware duration.",
  "Coverage counts sampled floor checkpoints, not full areas or exhaustive inventory.",
  "Drafts and the last 32 runs live in memory. Export JSON to keep them across restarts.",
];
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (message: string): never => {
  throw new SimError("INVALID_DEFINITION", message);
};
type Draft = {
  summary: SandboxSummary;
  definition: WarehouseDefinition;
  sim: Simulation;
};
type Trial = {
  report: ExperimentReport;
  sim: Simulation;
  elapsed: number;
  lastTick: number;
  leases: Map<string, string>;
  motionEnd: number | null;
  distance: number;
};
const unique = (items: { id: string }[], label: string) => {
  if (new Set(items.map((i) => i.id)).size !== items.length)
    fail("Duplicate " + label + " IDs.");
};
function validateWorkflow(
  raw: unknown,
  definition: WarehouseDefinition,
): WorkflowDefinition {
  const parsed = workflowSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      parsed.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; "),
    );
  const w = parsed.data!;
  const entries = Object.entries(w.actors);
  if (!entries.length || entries.length > 6)
    fail("Bind between one and six workflow actors.");
  if (new Set(entries.map((e) => e[1])).size !== entries.length)
    fail("Each workflow actor must bind to a different device.");
  for (const [, id] of entries)
    if (!definition.devices.some((d) => d.id === id))
      fail("Actor device not found: " + id);
  for (const step of w.steps)
    if (!Object.hasOwn(w.actors, step.actor))
      fail("Unbound workflow actor: " + step.actor);
  return structuredClone(w) as WorkflowDefinition;
}
export function normalizeDefinition(raw: unknown): WarehouseDefinition {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success)
    fail(
      parsed.error.issues
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; "),
    );
  const value = parsed.data!;
  unique(value.devices, "device");
  unique(value.obstacles, "obstacle");
  unique(value.cargo, "cargo");
  for (const o of value.obstacles) {
    if (o.min.some((v, i) => v >= o.max[i]!))
      fail("Obstacle min must be below max: " + o.id);
    if (
      o.min[0] < -33 ||
      o.max[0] > 33 ||
      o.min[2] < -35 ||
      o.max[2] > 11 ||
      o.min[1] < 0 ||
      o.max[1] > 16
    )
      fail("Keep structures within the 64 x 44 m hall envelope.");
  }
  const devices: DeviceDefinition[] = value.devices.map((input) => {
    const profile: DeviceProfile = Object.assign(
      defaultProfile(input.kind),
      Object.fromEntries(
        Object.entries(input.profile ?? {}).filter(([, v]) => v !== undefined),
      ),
    );
    const mobile = input.kind === "rover" || input.kind === "drone";
    if (mobile ? profile.speed < 0.2 : profile.speed !== 0)
      fail("Only mobile devices have a speed, bounded to 0.2–6 m/s.");
    if (input.kind === "arm") {
      if (profile.inspectRange !== null || profile.payloadKg === null)
        fail("Arms use payload and grasp limits; inspectRange must be null.");
    } else {
      if (
        profile.inspectRange === null ||
        profile.inspectRange > profile.telemetryRange
      )
        fail("Inspection range must not exceed telemetry range.");
      if (profile.payloadKg !== null)
        fail(
          "Only the arm supports cargo handling in this model; payload must be null for other bodies.",
        );
    }
    if (input.kind === "camera" && (input.tilt ?? -16) < -80)
      fail("Fixed camera tilt must be at least -80 degrees.");
    const position: Vec3 = [...input.position];
    const airborne =
      input.kind === "drone" &&
      (input.airborne ?? position[1] > 0.4 * profile.scale + 0.001);
    if (input.kind === "rover") position[1] = 0.45 * profile.scale;
    if (input.kind === "drone" && !airborne) position[1] = 0.4 * profile.scale;
    if (
      position[0] < BOUNDS.minX ||
      position[0] > BOUNDS.maxX ||
      position[2] < BOUNDS.minZ ||
      position[2] > BOUNDS.maxZ ||
      position[1] < 0 ||
      position[1] > BOUNDS.maxAltitude
    )
      fail("Device spawn is outside warehouse bounds: " + input.id);
    if (airborne && position[1] < 0.8 * profile.scale)
      fail("Airborne spawn is below minimum flight altitude.");
    const device = {
      ...input,
      position,
      profile,
      airborne,
      heading: input.heading ?? (mobile ? Math.PI : 0),
      pan:
        input.pan ??
        (input.kind === "camera" ? 104 : input.kind === "drone" ? 180 : 0),
      tilt:
        input.tilt ??
        (input.kind === "camera" ? -16 : input.kind === "drone" ? -35 : 0),
    };
    const clearance = mobile
      ? bodyClearance(device as Body)
      : ([0, 0, 0] as Vec3);
    if (blockingObstacle(position, position, clearance, value.obstacles))
      fail("Device spawn intersects a static structure: " + input.id);
    return device;
  });
  for (const c of value.cargo) {
    if (
      c.position[0] < BOUNDS.minX ||
      c.position[0] > BOUNDS.maxX ||
      c.position[2] < BOUNDS.minZ ||
      c.position[2] > BOUNDS.maxZ ||
      c.position[1] < 0.5 ||
      c.position[1] > 12
    )
      fail("Cargo position is outside the warehouse: " + c.id);
    if (value.obstacles.some((o) => containsPoint(o, c.position)))
      fail("Tagged cargo must have a free placement point: " + c.id);
  }
  const definition: WarehouseDefinition = {
    version: 1,
    name: value.name,
    obstacles: structuredClone(value.obstacles),
    devices,
    cargo: value.cargo.map((o) => ({ ...o, massKg: o.massKg ?? 1 })),
  };
  if (value.workflow)
    definition.workflow = validateWorkflow(value.workflow, definition);
  return definition;
}
export function experimentTemplates(): ExperimentTemplate[] {
  return [
    {
      id: "aisle-fit",
      name: "Aisle fit · standard vs compact drone",
      description:
        "Same launch site and inspection workflow. A 2.4 m rack gap rejects the standard 2.9 m envelope; a 70% scale candidate can pass. This tests the stated geometry assumptions.",
      device: {
        id: "trial-drone",
        label: "Trial drone",
        kind: "drone",
        position: [-20, 0.4, -10],
        airborne: false,
        profile: defaultProfile("drone"),
      },
      variants: [
        { name: "Standard drone", scale: 1 },
        { name: "Compact drone", scale: 0.7 },
      ],
      workflow: {
        name: "North aisle inspection",
        actors: { vehicle: "trial-drone" },
        stopOnError: true,
        maxSimulatedSeconds: 90,
        requireSafeEnd: true,
        steps: [
          {
            actor: "vehicle",
            label: "Take off in the cross-aisle",
            command: { type: "takeoff" },
          },
          {
            actor: "vehicle",
            label: "Pass between the storage bays",
            command: { type: "move", x: -20, y: 2.8, z: -21 },
          },
          {
            actor: "vehicle",
            label: "Approach storage cargo",
            command: { type: "move", x: -10, y: 2.8, z: -21 },
          },
          {
            actor: "vehicle",
            label: "Aim toward the inspection",
            command: { type: "look", pan: 28, tilt: -34 },
          },
          {
            actor: "vehicle",
            label: "Inspect the tagged crate",
            dwellSeconds: 2,
            command: { type: "inspect", objectId: "crate-12" },
          },
          {
            actor: "vehicle",
            label: "Land in the clear aisle",
            command: { type: "land" },
          },
        ],
      },
    },
  ];
}
export class ExperimentLab {
  private drafts = new Map<string, Draft>();
  private trials = new Map<string, Trial>();
  constructor(
    private live: Simulation,
    private clock = () => performance.now(),
    private wallClock = () => Date.now(),
  ) {}
  private draft(id: string) {
    const d = this.drafts.get(id);
    if (!d)
      throw new SimError(
        "SANDBOX_NOT_FOUND",
        "Sandbox no longer exists. Refresh the lab.",
      );
    return d;
  }
  private trial(id: string) {
    const t = this.trials.get(id);
    if (!t)
      throw new SimError(
        "RUN_NOT_FOUND",
        "Run is unavailable. Only the last 32 runs are retained.",
      );
    return t;
  }
  list(): LabState {
    return structuredClone({
      sandboxes: [...this.drafts.values()].map((d) => d.summary),
      runs: [...this.trials.values()].reverse().map((t) => this.summary(t)),
      limits: LIMITS,
      assumptions: ASSUMPTIONS,
    });
  }
  inspectDraft(id: string): SandboxDetail {
    const d = this.draft(id);
    d.sim.tick();
    return structuredClone({
      sandbox: d.summary,
      definition: d.definition,
      snapshot: d.sim.snapshot(),
    });
  }
  private create(name: string, sourceId?: string, raw?: unknown) {
    if (sourceId && raw)
      throw new SimError(
        "INVALID_COMMAND",
        "Choose a source sandbox or imported definition, not both.",
      );
    if (this.drafts.size >= LIMITS.sandboxes)
      throw new SimError(
        "LAB_LIMIT",
        "Eight sandboxes are already open. Export and delete a draft first.",
      );
    if (!raw && !sourceId && this.live.snapshot().objects.some((o) => o.heldBy))
      throw new SimError(
        "SOURCE_NOT_SETTLED",
        "Place held cargo before cloning the live warehouse.",
      );
    const source =
      raw ??
      (sourceId ? this.draft(sourceId).definition : this.live.definition(name));
    const definition = normalizeDefinition({
      ...structuredClone(source as WarehouseDefinition),
      name,
    });
    const id = "sandbox-" + randomUUID().slice(0, 8);
    const d: Draft = {
      summary: {
        id,
        name,
        revision: 0,
        createdAt: this.wallClock(),
        deviceCount: definition.devices.length,
        obstacleCount: definition.obstacles.length,
        source: sourceId ?? (raw ? "JSON import" : "Live warehouse"),
      },
      definition,
      sim: new Simulation(undefined, undefined, definition),
    };
    this.drafts.set(id, d);
    return this.inspectDraft(id);
  }
  private update(id: string, revision: number, raw: unknown) {
    const d = this.draft(id);
    if (d.summary.revision !== revision)
      throw new SimError(
        "REVISION_CONFLICT",
        "This draft changed in another client. Reload before saving.",
      );
    if (d.sim.snapshot().bodies.some((b) => b.lease))
      throw new SimError(
        "RESOURCE_BUSY",
        "Release the sandbox devices before editing their definition.",
      );
    const definition = normalizeDefinition(raw);
    d.definition = definition;
    d.sim = new Simulation(undefined, undefined, definition);
    d.summary = {
      ...d.summary,
      name: definition.name,
      revision: revision + 1,
      deviceCount: definition.devices.length,
      obstacleCount: definition.obstacles.length,
    };
    return this.inspectDraft(id);
  }
  worldFor(name: BodyToolName, input: Record<string, unknown>) {
    if ((name === "discover" || name === "possess") && input.sandboxId)
      return this.draft(String(input.sandboxId)).sim;
    if (typeof input.leaseId === "string") {
      for (const d of this.drafts.values())
        if (d.sim.recognizesLease(input.leaseId)) return d.sim;
    }
    return this.live;
  }
  runWorld(id: string) {
    return this.trial(id).sim;
  }
  private summary(t: Trial): RunSummary {
    const {
      definition,
      workflow,
      steps,
      scenarioHash,
      workflowHash,
      assumptions,
      ...summary
    } = t.report;
    return structuredClone({ ...summary, metrics: this.metrics(t) });
  }
  private actorBodies(t: Trial) {
    const ids = new Set(Object.values(t.report.workflow.actors));
    return t.sim.snapshot().bodies.filter((b) => ids.has(b.id));
  }
  private metrics(t: Trial): TrialMetrics {
    const snapshot = t.sim.snapshot();
    const pending = t.report.steps.find(
      (s) => s.status === "running" || s.status === "cancelled",
    );
    const current = pending
      ? snapshot.bodies.find((b) => b.id === pending.resourceId)
      : null;
    const safe = this.actorBodies(t).every(
      (b) =>
        !b.airborne &&
        !b.heldObjectId &&
        (b.kind !== "arm" || b.preset === "home"),
    );
    return {
      simulatedSeconds: Math.round(t.elapsed) / 1000,
      distanceMeters:
        Math.round(
          (t.distance +
            (current && pending
              ? distance(pending.before, current.position)
              : 0)) *
            1000,
        ) / 1000,
      completedSteps: t.report.steps.filter((s) => s.status === "completed")
        .length,
      totalSteps: t.report.workflow.steps.length,
      failedSteps: t.report.steps.filter((s) => s.status === "failed").length,
      blockedMoves: t.report.steps.filter(
        (s) => s.error?.code === "PATH_BLOCKED",
      ).length,
      inspectedCargo: snapshot.objects
        .filter((o) => o.inspectedBy.length)
        .map((o) => o.id),
      observedCheckpoints: snapshot.survey.coveredCells,
      eligibleCheckpoints: snapshot.survey.totalCells,
      allLeasesReleased: snapshot.bodies.every((b) => !b.lease),
      safeEndState: safe,
    };
  }
  private start(id: string, raw: unknown, rate: number, revision?: number) {
    if (
      [...this.trials.values()].filter((t) => t.report.status === "running")
        .length >= LIMITS.activeRuns
    )
      throw new SimError(
        "LAB_LIMIT",
        "Four trials are already running. Cancel one or wait for completion.",
      );
    const source = this.draft(id);
    if (revision !== undefined && revision !== source.summary.revision)
      throw new SimError(
        "REVISION_CONFLICT",
        "This draft changed in another client. Reload before running.",
      );
    const definition = structuredClone(source.definition);
    const workflow = validateWorkflow(raw ?? definition.workflow, definition);
    while (this.trials.size >= LIMITS.retainedRuns) {
      const old = [...this.trials].find(
        ([, t]) => t.report.status !== "running",
      );
      if (!old)
        throw new SimError("LAB_LIMIT", "No completed report can be evicted.");
      this.trials.delete(old[0]);
    }
    const used = [...new Set(workflow.steps.map((s) => s.actor))].sort();
    const starts = used.map((actor) => {
      const d = definition.devices.find(
        (d) => d.id === workflow.actors[actor],
      )!;
      return {
        actor,
        kind: d.kind,
        position: [
          d.position[0],
          d.airborne ? d.position[1] : 0,
          d.position[2],
        ],
        heading: d.heading ?? Math.PI,
        pan: d.pan ?? 180,
        tilt: d.tilt ?? -35,
      };
    });
    const actorIds = new Set(Object.values(workflow.actors));
    const scenario = {
      fixtures: definition.devices
        .filter((d) => !actorIds.has(d.id))
        .sort((a, b) => a.id.localeCompare(b.id)),
      obstacles: [...definition.obstacles].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      cargo: [...definition.cargo].sort((a, b) => a.id.localeCompare(b.id)),
    };
    const startedAt = this.wallClock();
    let t: Trial;
    const sim = new Simulation(
      () => t.elapsed,
      () => startedAt + t.elapsed,
      definition,
    );
    t = {
      sim,
      elapsed: 0,
      lastTick: this.clock(),
      leases: new Map(),
      motionEnd: null,
      distance: 0,
      report: {
        id: "run-" + randomUUID().slice(0, 8),
        sandboxId: id,
        sourceRevision: source.summary.revision,
        name: workflow.name,
        sandboxName: definition.name,
        status: "running",
        startedAt,
        playbackRate: rate,
        currentStep: 0,
        definition,
        workflow,
        steps: [],
        scenarioHash: hash(scenario),
        workflowHash: hash({
          starts,
          steps: workflow.steps.map((s) => ({
            actor: s.actor,
            command: s.command,
            dwellSeconds: s.dwellSeconds ?? 0,
          })),
          maxSimulatedSeconds: workflow.maxSimulatedSeconds,
          stopOnError: workflow.stopOnError,
          requireSafeEnd: workflow.requireSafeEnd,
        }),
        metrics: {} as TrialMetrics,
        assumptions: [...ASSUMPTIONS],
      },
    };
    this.trials.set(t.report.id, t);
    this.advance(t, 0);
    return this.inspect(t.report.id, false);
  }
  private finish(
    t: Trial,
    status: "completed" | "failed" | "cancelled",
    error?: { code: string; message: string },
  ) {
    for (const lease of t.leases.values()) {
      try {
        t.sim.release(lease);
      } catch {}
    }
    t.leases.clear();
    t.motionEnd = null;
    t.report.status = status;
    if (error) t.report.error = error;
    t.report.metrics = this.metrics(t);
  }
  private failedStep(t: Trial, result: TrialStepResult, error: unknown) {
    const e = {
      code: error instanceof SimError ? error.code : "RUN_ERROR",
      message:
        error instanceof SimError
          ? error.message
          : "Workflow execution failed.",
    };
    result.status = "failed";
    result.error = e;
    result.finishedAtSeconds = t.elapsed / 1000;
    result.after = [
      ...t.sim.snapshot().bodies.find((b) => b.id === result.resourceId)!
        .position,
    ];
    t.distance += distance(result.before, result.after);
    t.motionEnd = null;
    t.report.currentStep++;
    if (t.report.workflow.stopOnError) this.finish(t, "failed", e);
  }
  private completeStep(t: Trial, result: TrialStepResult) {
    const observation = t.sim.observe(t.leases.get(result.actor)!);
    result.after = [...observation.body.position];
    result.status = "completed";
    result.finishedAtSeconds = t.elapsed / 1000;
    if (result.command.type === "inspect" && observation.inspection)
      result.inspection = observation.inspection;
    t.distance += distance(result.before, result.after);
    t.report.currentStep++;
    t.motionEnd = null;
  }
  private advance(t: Trial, target: number) {
    for (let guard = 0; guard < 132 && t.report.status === "running"; guard++) {
      const w = t.report.workflow;
      const current = t.report.steps.at(-1);
      if (t.motionEnd !== null && current?.status === "running") {
        t.elapsed = Math.min(target, t.motionEnd, w.maxSimulatedSeconds * 1000);
        t.sim.tick();
        if (t.elapsed < t.motionEnd) {
          if (t.elapsed >= w.maxSimulatedSeconds * 1000)
            this.failedStep(
              t,
              current,
              new SimError("RUN_TIMEOUT", "Simulation time budget exhausted."),
            );
          if (
            t.report.status === "running" &&
            t.elapsed >= w.maxSimulatedSeconds * 1000
          )
            this.finish(t, "failed", {
              code: "RUN_TIMEOUT",
              message: "Simulation time budget exhausted.",
            });
          break;
        }
        try {
          this.completeStep(t, current);
        } catch (e) {
          this.failedStep(t, current, e);
        }
        continue;
      }
      if (t.report.currentStep >= w.steps.length) {
        const failed = t.report.steps.find((s) => s.error);
        if (failed?.error) this.finish(t, "failed", failed.error);
        else if (w.requireSafeEnd && !this.metrics(t).safeEndState)
          this.finish(t, "failed", {
            code: "UNSAFE_END_STATE",
            message:
              "Workflow ended with an airborne drone, held cargo or arm away from home.",
          });
        else this.finish(t, "completed");
        break;
      }
      if (t.elapsed >= w.maxSimulatedSeconds * 1000) {
        this.finish(t, "failed", {
          code: "RUN_TIMEOUT",
          message: "Simulation time budget exhausted.",
        });
        break;
      }
      const step = w.steps[t.report.currentStep]!;
      const resourceId = w.actors[step.actor]!;
      const body = t.sim.snapshot().bodies.find((b) => b.id === resourceId)!;
      const result: TrialStepResult = {
        index: t.report.currentStep,
        actor: step.actor,
        resourceId,
        label: step.label ?? step.command.type,
        command: structuredClone(step.command),
        status: "running",
        startedAtSeconds: t.elapsed / 1000,
        before: [...body.position],
        after: [...body.position],
      };
      t.report.steps.push(result);
      try {
        if (!t.leases.has(step.actor))
          t.leases.set(
            step.actor,
            t.sim.possess(resourceId, 300, "Workflow · " + w.name.slice(0, 30))
              .leaseId,
          );
        const action = t.sim.act(
          t.leases.get(step.actor)!,
          step.command,
        ).action;
        if (action.status === "running" && action.target) {
          t.motionEnd =
            t.elapsed +
            Math.max(
              450,
              (distance(body.position, action.target) /
                bodyLimits(body).speed!) *
                1000,
            ) +
            (step.dwellSeconds ?? 0) * 1000;
          if (t.elapsed >= target) break;
        } else if (step.dwellSeconds) {
          t.motionEnd = t.elapsed + step.dwellSeconds * 1000;
          if (t.elapsed >= target) break;
        } else this.completeStep(t, result);
      } catch (e) {
        this.failedStep(t, result, e);
      }
    }
    t.report.metrics = this.metrics(t);
  }
  tick() {
    for (const d of this.drafts.values()) d.sim.tick();
    for (const t of this.trials.values())
      if (t.report.status === "running") {
        const now = this.clock();
        const delta = Math.max(0, Math.min(1000, now - t.lastTick));
        t.lastTick = now;
        this.advance(t, t.elapsed + delta * t.report.playbackRate);
      }
  }
  inspect(id: string, snapshot: boolean) {
    const t = this.trial(id);
    return structuredClone({
      run: { ...t.report, metrics: this.metrics(t) },
      ...(snapshot ? { snapshot: t.sim.snapshot() } : {}),
    });
  }
  private cancel(id: string) {
    const t = this.trial(id);
    if (t.report.status === "running") {
      const current = t.report.steps.at(-1);
      if (current?.status === "running") {
        current.status = "cancelled";
        current.finishedAtSeconds = t.elapsed / 1000;
        current.after = [
          ...t.sim.snapshot().bodies.find((b) => b.id === current.resourceId)!
            .position,
        ];
      }
      this.finish(t, "cancelled", {
        code: "RUN_CANCELLED",
        message:
          "Cancelled by an operator. Pending motion was stopped; leases released.",
      });
    }
    return this.inspect(id, false);
  }
  compare(ids: string[]): ExperimentComparison {
    if (new Set(ids).size !== ids.length)
      throw new SimError(
        "INVALID_COMMAND",
        "Choose different runs to compare.",
      );
    const trials = ids.map((id) => this.trial(id));
    const first = trials[0]!;
    const reasons = [];
    if (trials.some((t) => t.report.status === "running"))
      reasons.push("Wait for every selected run to finish.");
    if (trials.some((t) => t.report.status === "cancelled"))
      reasons.push("Cancelled runs are partial observations.");
    if (trials.some((t) => t.report.scenarioHash !== first.report.scenarioHash))
      reasons.push("Layout, fixture devices or starting cargo differs.");
    if (trials.some((t) => t.report.workflowHash !== first.report.workflowHash))
      reasons.push(
        "Workflow, actor kinds, launch poses or execution requirements differ.",
      );
    const runs = trials.map((t) => this.summary(t));
    const completedRuns = runs.filter((r) => r.status === "completed").length;
    const a = runs[0]!,
      b = runs[1]!;
    const delta =
      !reasons.length && a.status === "completed" && b.status === "completed"
        ? {
            simulatedSeconds:
              b.metrics.simulatedSeconds - a.metrics.simulatedSeconds,
            distanceMeters: b.metrics.distanceMeters - a.metrics.distanceMeters,
          }
        : null;
    return {
      comparable: !reasons.length,
      reasons,
      runs,
      completedRuns,
      delta,
      interpretation: reasons.length
        ? "These runs do not establish a controlled device comparison."
        : completedRuns === runs.length
          ? "Same scenario and workflow. Compare completion, simulated time, route distance and configured device assumptions."
          : "Same scenario and workflow. Compare feasibility first; a failed or shorter aborted run is not a speed improvement.",
    };
  }
  tool(name: ToolName, input: unknown): unknown {
    const parsed = schemas[name].safeParse(input);
    if (!parsed.success)
      throw new SimError(
        "INVALID_COMMAND",
        parsed.error.issues
          .map((i) => i.path.join(".") + ": " + i.message)
          .join("; "),
      );
    const a = parsed.data as Record<string, unknown>;
    switch (name) {
      case "operations":
        throw new SimError(
          "LIVE_ONLY",
          "Operations controls apply to the live warehouse only.",
        );
      case "sandbox_list":
        return this.list();
      case "sandbox_create":
        return this.create(
          a.name as string,
          a.sourceSandboxId as string | undefined,
          a.definition,
        );
      case "sandbox_inspect":
        return this.inspectDraft(a.sandboxId as string);
      case "sandbox_update":
        return this.update(
          a.sandboxId as string,
          a.expectedRevision as number,
          a.definition,
        );
      case "sandbox_add_device": {
        const d = this.draft(a.sandboxId as string);
        const device = deviceSchema.parse(a.device);
        return this.update(d.summary.id, a.expectedRevision as number, {
          ...d.definition,
          devices: [...d.definition.devices, device],
        });
      }
      case "sandbox_delete": {
        const d = this.draft(a.sandboxId as string);
        if (d.sim.snapshot().bodies.some((b) => b.lease))
          throw new SimError(
            "RESOURCE_BUSY",
            "Release draft leases before deleting.",
          );
        this.drafts.delete(d.summary.id);
        return { deleted: true, retainedRuns: true };
      }
      case "experiment_templates":
        return { templates: experimentTemplates(), assumptions: ASSUMPTIONS };
      case "experiment_run":
        return this.start(
          a.sandboxId as string,
          a.workflow,
          a.playbackRate as number,
          a.expectedRevision as number | undefined,
        );
      case "experiment_inspect":
        return this.inspect(a.runId as string, Boolean(a.includeSnapshot));
      case "experiment_cancel":
        return this.cancel(a.runId as string);
      case "experiment_compare":
        return this.compare(a.runIds as string[]);
      default: {
        const world = this.worldFor(name, a);
        const result = world.tool(name, a);
        const draft = [...this.drafts.values()].find((d) => d.sim === world);
        return draft
          ? {
              ...(result as object),
              context: {
                sandboxId: draft.summary.id,
                name: draft.summary.name,
                definitionRevision: draft.summary.revision,
              },
            }
          : result;
      }
    }
  }
  close() {
    for (const t of this.trials.values())
      if (t.report.status === "running") this.cancel(t.report.id);
  }
}
