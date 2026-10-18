import { randomUUID } from "node:crypto";
import {
  blockingObstacle,
  bodyClearance,
  type OperationsState,
  type OperationsInput,
  type FleetStep,
  type FleetIncident,
  type Vec3,
} from "@ghost/shared";
import { Simulation, SimError } from "./simulation.js";
import { BoxRecovery } from "./recovery.js";
import { schemas } from "./contracts.js";
type Task = {
  resourceId: string;
  label: string;
  steps: FleetStep[];
  index: number;
  cycles: number;
  token: string | null;
  waiting: boolean;
  due: number;
  status: OperationsState["jobs"][number]["status"];
  loop: boolean;
  instantApplied: boolean;
};
const step = (
  label: string,
  command: FleetStep["command"],
  dwell = 1000,
): FleetStep => ({ label, command, dwell });
function tasks(): Task[] {
  return [
    {
      resourceId: "rover-01",
      label: "Aisle B inspection",
      loop: true,
      steps: [
        step("Outbound to west aisle", { type: "move", x: -10, z: 3 }),
        step("Inspect storage aisle B", { type: "move", x: -10, z: -18 }),
        step(
          "Read cargo 12 seal",
          { type: "inspect", objectId: "crate-12" },
          2500,
        ),
        step("Return through west aisle", { type: "move", x: -10, z: 3 }),
        step("Return to inspection bay", { type: "move", x: 1, z: 1.4 }),
        step("Dock checkpoint", { type: "stop" }, 2500),
      ],
    },
    {
      resourceId: "drone-01",
      label: "North dock inventory",
      loop: true,
      steps: [
        step("Take off", { type: "takeoff" }),
        step("Climb above storage", { type: "move", x: -4, y: 9, z: -3 }),
        step("Survey north docks", { type: "move", x: 10, y: 9, z: -30 }),
        step("Descend to cargo", { type: "move", x: 10, y: 4.5, z: -30 }),
        step("Aim at dock cargo", { type: "look", pan: -90, tilt: -68 }),
        step(
          "Verify cargo 18",
          { type: "inspect", objectId: "crate-18" },
          2500,
        ),
        step("Climb for return", { type: "move", x: 10, y: 9, z: -30 }),
        step("Return to charging pad", { type: "move", x: -4, y: 9, z: -3 }),
        step("Descend at charging pad", { type: "move", x: -4, y: 2.8, z: -3 }),
        step("Land", { type: "land" }, 3000),
      ],
    },
    {
      resourceId: "camera-01",
      label: "Dock surveillance",
      loop: true,
      steps: [
        step("Scan dispatch", { type: "look", pan: 104, tilt: -16 }, 3500),
        step(
          "Scan storage aisles",
          { type: "look", pan: 134, tilt: -12 },
          3500,
        ),
        step(
          "Scan west cross-aisle",
          { type: "look", pan: 80, tilt: -18 },
          3500,
        ),
      ],
    },
    {
      resourceId: "arm-01",
      label: "Dispatch cargo 07",
      loop: false,
      steps: [
        step("Reach priority cargo", { type: "preset", preset: "reach" }, 2000),
        step(
          "Secure priority cargo",
          { type: "grasp", objectId: "crate-07" },
          2000,
        ),
        step("Transfer to dispatch", { type: "preset", preset: "drop" }, 2000),
        step("Place cargo in dispatch", { type: "place" }, 2000),
        step("Return home", { type: "preset", preset: "home" }, 2000),
      ],
    },
  ].map(
    (t) =>
      ({
        ...t,
        index: 0,
        cycles: 0,
        token: null,
        waiting: false,
        due: 0,
        status: "paused",
        instantApplied: false,
      }) as Task,
  );
}
export class Operations {
  private jobs = tasks();
  private recovery: BoxRecovery;
  private running = false;
  private sequence = 0;
  private watchers = 0;
  private incidents: FleetIncident[] = [];
  private closed = false;
  private wake = new Set<() => void>();
  constructor(
    private sim: Simulation,
    private clock = () => performance.now(),
    private wall = () => Date.now(),
  ) {
    this.recovery = new BoxRecovery(sim, () => this.publish(), clock);
    this.publish();
  }
  state(): OperationsState {
    return {
      running: this.running,
      sequence: this.sequence,
      watchers: this.watchers,
      mode: "local-autonomy",
      recovery: this.recovery.state(),
      jobs: this.jobs.map((j) => ({
        resourceId: j.resourceId,
        label: j.label,
        status:
          j.status === "blocked" &&
          this.sim.snapshot().bodies.find((b) => b.id === j.resourceId)?.lease
            ? "operator"
            : j.status,
        step: j.steps[j.index]?.label ?? "Waiting for next assignment",
        cycles: j.cycles,
        command: j.steps[j.index]?.command ?? { type: "stop" },
      })),
      incidents: structuredClone(this.incidents),
      obstructions: this.sim.obstacles.filter((o) =>
        o.id.startsWith("ops-box-"),
      ),
    };
  }
  private publish() {
    const recovery = this.recovery.state();
    if (recovery?.phase === "parked") {
      const incident = this.incidents.find(
        (i) => i.id === recovery.incidentId && !i.resolvedAt,
      );
      if (incident)
        incident.resolution =
          "Mule physically relocated the box to staging. Awaiting route verification and handback.";
    }
    this.sim.publishOperations(this.state());
  }
  private event() {
    this.sequence++;
    this.publish();
    for (const w of this.wake) w();
  }
  start() {
    if (this.sim.snapshot().demo.running)
      throw new SimError("DEMO_RUNNING", "Stop the guided tour first.");
    this.running = true;
    this.closed = false;
    for (const j of this.jobs) if (j.status === "paused") j.status = "working";
    this.publish();
    return this.state();
  }
  pause() {
    this.running = false;
    for (const j of this.jobs) {
      this.advanceApplied(j);
      this.free(j);
      if (j.status !== "blocked" && j.status !== "complete")
        j.status = "paused";
    }
    this.publish();
    return this.state();
  }
  reset() {
    this.pause();
    this.recovery.reset();
    for (const o of this.state().obstructions) this.sim.removeObstruction(o.id);
    this.jobs = tasks();
    this.incidents = [];
    this.event();
  }
  private advanceApplied(j: Task) {
    if (j.waiting && j.instantApplied) {
      j.index++;
      if (j.index >= j.steps.length) {
        j.cycles++;
        j.index = 0;
        if (!j.loop) j.status = "complete";
      }
    }
  }
  private free(j: Task) {
    if (j.token) {
      try {
        this.sim.release(j.token);
      } catch {}
      j.token = null;
    }
    j.waiting = false;
  }
  private incident(j: Task, error: unknown) {
    const b = this.sim.snapshot().bodies.find((b) => b.id === j.resourceId)!;
    this.free(j);
    j.status = "blocked";
    if (
      !this.incidents.some(
        (i) => !i.resolvedAt && i.resourceId === j.resourceId,
      )
    ) {
      this.incidents.unshift({
        id: "incident-" + randomUUID().slice(0, 8),
        sequence: this.sequence + 1,
        resourceId: j.resourceId,
        job: j.label,
        code: b.lastBlocked
          ? "PATH_BLOCKED"
          : error instanceof SimError
            ? error.code
            : "JOB_ERROR",
        message: b.lastBlocked
          ? b.label +
            " stopped before " +
            b.lastBlocked.label +
            ". Operator assistance required."
          : error instanceof Error
            ? error.message
            : "Work interrupted.",
        obstacleId: b.lastBlocked?.obstacleId ?? null,
        position: [...b.position],
        createdAt: this.wall(),
        resolvedAt: null,
        resolution: null,
      });
      this.incidents = this.incidents.slice(0, 24);
      this.event();
    }
  }
  tick() {
    this.recovery.tick();
    if (!this.running || this.closed || this.sim.snapshot().demo.running)
      return;
    let changed = false;
    for (const j of this.jobs) {
      if (j.status === "blocked" || j.status === "complete") continue;
      const b = this.sim.snapshot().bodies.find((b) => b.id === j.resourceId)!;
      if (j.token && !this.sim.recognizesLease(j.token)) {
        j.token = null;
        j.waiting = false;
      }
      if (j.token) {
        try {
          this.sim.validateLease(j.token);
        } catch {
          this.advanceApplied(j);
          j.token = null;
          j.waiting = false;
        }
      }
      if (!j.token && b.lease) {
        if (j.status !== "operator") {
          j.status = "operator";
          changed = true;
        }
        continue;
      }
      if (j.status === "operator") {
        j.status = "working";
        changed = true;
      }
      if (j.waiting) {
        if (b.action?.status === "cancelled" && b.lastBlocked) {
          this.incident(j, new SimError("PATH_BLOCKED", b.lastBlocked.label));
          continue;
        }
        if (b.action?.status === "running" || this.clock() < j.due) continue;
        j.waiting = false;
        j.index++;
        changed = true;
        if (j.index === j.steps.length) {
          j.cycles++;
          this.free(j);
          if (!j.loop) {
            j.status = "complete";
            continue;
          }
          j.index = 0;
        }
      }
      try {
        if (!j.token)
          j.token = this.sim.possess(
            j.resourceId,
            300,
            "Local autonomy · " + j.label,
            true,
          ).leaseId;
        const s = j.steps[j.index]!;
        // A new start after an operator landing is allowed to skip redundant takeoff/land.
        if (
          (s.command.type === "takeoff" && b.airborne) ||
          (s.command.type === "land" && !b.airborne)
        ) {
          j.index++;
          continue;
        }
        const action = this.sim.act(j.token, s.command).action;
        j.instantApplied = action.status === "completed";
        j.status = "working";
        j.waiting = true;
        j.due = this.clock() + s.dwell;
        changed = true;
      } catch (e) {
        this.incident(j, e);
      }
    }
    if (changed) this.publish();
  }
  async tool(raw: unknown) {
    const parsed = schemas.operations.safeParse(raw);
    if (!parsed.success)
      throw new SimError(
        "INVALID_COMMAND",
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    const a = parsed.data as OperationsInput;
    switch (a.action) {
      case "status":
        return this.state();
      case "start":
        return this.start();
      case "pause":
        return this.pause();
      case "place_box": {
        const b = this.sim.snapshot().bodies.find((b) => b.id === "rover-01")!;
        let x = a.x,
          z = a.z;
        if ((x === undefined) !== (z === undefined))
          throw new SimError(
            "INVALID_COMMAND",
            "Supply both x and z, or omit both for placement ahead of Scout.",
          );
        if (x === undefined || z === undefined) {
          const target =
            b.action?.status === "running" ? b.action.target : null;
          if (!target)
            throw new SimError(
              "NO_ROVER_PATH",
              "Wait for Scout to move, or choose a floor position.",
            );
          let origin = b.position,
            dx = target[0] - origin[0],
            dz = target[2] - origin[2],
            d = Math.hypot(dx, dz);
          if (d < 4) {
            const job = this.jobs.find((j) => j.resourceId === b.id)!;
            const next = job.steps
              .slice(job.index + 1)
              .find((s) => s.command.type === "move")?.command;
            if (!next || next.type !== "move")
              throw new SimError(
                "ROUTE_TOO_SHORT",
                "Wait for the next travel leg.",
              );
            origin = target;
            dx = next.x - origin[0];
            dz = next.z - origin[2];
            d = Math.hypot(dx, dz);
          }
          const ahead = Math.min(6, d - 1.5);
          x = origin[0] + (dx / d) * ahead;
          z = origin[2] + (dz / d) * ahead;
        }
        const obstacle = {
          id: "ops-box-" + randomUUID().slice(0, 8),
          label: "Unexpected floor box",
          kind: "freight" as const,
          min: [x - 0.65, 0, z - 0.65] as Vec3,
          max: [x + 0.65, 1.3, z + 0.65] as Vec3,
        };
        this.sim.addObstruction(obstacle);
        this.publish();
        return { placed: obstacle, ...this.state() };
      }
      case "recover_box":
      case "clear_box": {
        if (!a.incidentId || !a.leaseId)
          throw new SimError(
            "INVALID_COMMAND",
            "Supply incidentId and the possessed body leaseId.",
          );
        const i = this.incidents.find(
          (i) => i.id === a.incidentId && !i.resolvedAt,
        );
        if (!i?.obstacleId)
          throw new SimError(
            "INCIDENT_NOT_FOUND",
            "No open obstruction incident matches.",
          );
        const observation = this.sim.observe(a.leaseId);
        if (observation.body.id !== i.resourceId)
          throw new SimError(
            "WRONG_BODY",
            "Possess the affected body before clearing its incident.",
          );
        const o = this.state().obstructions.find((o) => o.id === i.obstacleId);
        if (!o)
          throw new SimError(
            "NOT_REMOVABLE",
            "This is a permanent structure. Choose a different route.",
          );
        if (observation.body.action?.status === "running")
          throw new SimError(
            "ACTION_BUSY",
            "Stop the affected body before operator clearance.",
          );
        this.recovery.dispatch(i);
        i.resolution =
          "Mule dispatched to physically relocate the box. Await recovery before resuming.";
        this.event();
        return this.state();
      }
      case "resume": {
        if (this.recovery.active())
          throw new SimError(
            "RECOVERY_IN_PROGRESS",
            "Wait for Mule to set the box down, then verify the route before resuming.",
          );
        if (!a.incidentId || !a.leaseId)
          throw new SimError(
            "INVALID_COMMAND",
            "Supply incidentId and affected body leaseId.",
          );
        const i = this.incidents.find(
          (i) => i.id === a.incidentId && !i.resolvedAt,
        );
        if (!i)
          throw new SimError(
            "INCIDENT_NOT_FOUND",
            "That incident is not open.",
          );
        const b = this.sim.observe(a.leaseId).body;
        if (b.id !== i.resourceId)
          throw new SimError("WRONG_BODY", "Possess the affected device.");
        if (b.action?.status === "running")
          throw new SimError(
            "ACTION_BUSY",
            "Finish operator motion before returning the device.",
          );
        const j = this.jobs.find((j) => j.resourceId === b.id)!;
        const command = j.steps[j.index]!.command;
        if (command.type === "move") {
          const target = [
            command.x,
            command.y ?? b.position[1],
            command.z,
          ] as Vec3;
          if (
            blockingObstacle(
              b.position,
              target,
              bodyClearance(b),
              this.sim.obstacles,
            )
          )
            throw new SimError(
              "PATH_BLOCKED",
              "The remaining job route is still blocked. Clear the obstruction or reposition first.",
            );
        }
        i.resolvedAt = this.wall();
        i.resolution = "Route verified; returned to local autonomy.";
        j.status = this.running ? "working" : "paused";
        j.waiting = false;
        this.sim.release(a.leaseId);
        this.event();
        return this.state();
      }
      case "watch": {
        const after = a.afterSequence ?? 0;
        if (
          this.sequence > after &&
          this.incidents.some((i) => i.sequence > after)
        )
          return this.state();
        this.watchers++;
        this.publish();
        try {
          await new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout>;
            const done = () => {
              clearTimeout(timer);
              this.wake.delete(done);
              resolve();
            };
            this.wake.add(done);
            timer = setTimeout(done, (a.waitSeconds ?? 20) * 1000);
          });
        } finally {
          this.watchers--;
          this.publish();
        }
        return this.state();
      }
    }
  }
  close() {
    this.closed = true;
    this.recovery.close();
    this.pause();
    for (const w of this.wake) w();
  }
}
