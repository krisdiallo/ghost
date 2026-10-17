import { randomUUID } from "node:crypto";
import { BOUNDS, CAPABILITIES, DEMO_RESOURCES } from "@ghost/shared";
import type {
  Action,
  Activity,
  Body,
  Command,
  Observation,
  Possession,
  ResourceKind,
  SceneObject,
  Snapshot,
  ToolName,
  Vec3,
} from "@ghost/shared";
import { schemas } from "./contracts.js";

export class SimError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
type Lease = {
  id: string;
  resourceId: string;
  deadline: number;
  expiresAt: number;
  owner: string;
};
type Motion = { from: Vec3; target: Vec3; start: number; end: number };
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));

export class Simulation {
  private instanceId = randomUUID();
  private revision = 0;
  private bodies: Body[] = [];
  private objects: SceneObject[] = [];
  private leases = new Map<string, Lease>();
  private retired = new Map<string, { code: string; at: number }>();
  private motions = new Map<string, Motion>();
  private inspections = new Map<
    string,
    { objectId: string; condition: string }
  >();
  private activity: Activity[] = [];
  private serial = 0;
  private listeners = new Set<() => void>();
  private demo = {
    running: false,
    phase: "Ready to begin",
    error: null as string | null,
  };
  constructor(
    private clock = () => performance.now(),
    private wallClock = () => Date.now(),
  ) {
    this.initialize();
  }

  private initialize() {
    this.bodies = DEMO_RESOURCES.map((r) => ({
      ...structuredClone(r),
      heading: 0,
      pan: 30,
      tilt: -12,
      preset: "home",
      heldObjectId: null,
      airborne: false,
      lease: null,
      action: null,
    }));
    this.objects = [
      {
        id: "crate-07",
        label: "Priority cargo · 07",
        position: [2, 0.55, 0],
        condition: "Seal intact. Label verified. Cleared for dispatch.",
        heldBy: null,
        inspectedBy: [],
      },
      {
        id: "crate-12",
        label: "Storage cargo · 12",
        position: [-6, 0.55, -0.5],
        condition: "Surface abrasion on north face. Seal intact.",
        heldBy: null,
        inspectedBy: [],
      },
      {
        id: "crate-18",
        label: "Storage cargo · 18",
        position: [6, 0.55, -4],
        condition: "Seal intact. Awaiting inventory scan.",
        heldBy: null,
        inspectedBy: [],
      },
    ];
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  private log(
    message: string,
    kind: Activity["kind"],
    resourceId: string | null = null,
  ) {
    this.activity.unshift({
      id: ++this.serial,
      at: this.wallClock(),
      resourceId,
      message,
      kind,
    });
    this.activity.length = Math.min(this.activity.length, 80);
  }
  snapshot(): Snapshot {
    return structuredClone({
      instanceId: this.instanceId,
      revision: this.revision,
      at: this.wallClock(),
      bodies: this.bodies,
      objects: this.objects,
      activity: this.activity,
      demo: this.demo,
      mission: [
        {
          id: "camera",
          body: "camera",
          label: "Locate cargo with Sentinel",
          complete: this.target().inspectedBy.includes("camera-01"),
        },
        {
          id: "rover",
          body: "rover",
          label: "Inspect the seal with Scout",
          complete: this.target().inspectedBy.includes("rover-01"),
        },
        {
          id: "drone",
          body: "drone",
          label: "Survey from above with Wisp",
          complete: this.target().inspectedBy.includes("drone-01"),
        },
        {
          id: "arm",
          body: "arm",
          label: "Stage cargo with Atlas",
          complete:
            this.target().heldBy === null &&
            this.target().position[0] > 5 &&
            this.target().position[2] > 1,
        },
      ],
    });
  }
  private target() {
    return this.objects[0]!;
  }
  private body(id: string) {
    const body = this.bodies.find((b) => b.id === id);
    if (!body)
      throw new SimError("RESOURCE_NOT_FOUND", "That body does not exist.");
    return body;
  }
  private object(id: string) {
    const object = this.objects.find((o) => o.id === id);
    if (!object)
      throw new SimError("OBJECT_NOT_FOUND", "That cargo does not exist.");
    return object;
  }
  tick() {
    const now = this.clock();
    let dirty = false;
    for (const [id, lease] of this.leases)
      if (now >= lease.deadline) {
        this.endLease(id, "LEASE_EXPIRED");
        dirty = true;
      }
    for (const body of this.bodies) {
      const motion = this.motions.get(body.id);
      if (!motion) continue;
      const t = Math.min(
        1,
        Math.max(0, (now - motion.start) / (motion.end - motion.start)),
      );
      body.position = motion.from.map(
        (v, i) => v + (motion.target[i]! - v) * t,
      ) as Vec3;
      if (t === 1) {
        this.motions.delete(body.id);
        body.action!.status = "completed";
        if (body.action!.type === "land") body.airborne = false;
        this.log(
          `${body.label} · ${body.action!.type} completed`,
          "action",
          body.id,
        );
      }
      dirty = true;
    }
    for (const [id, value] of this.retired)
      if (now - value.at > 600_000) this.retired.delete(id);
    if (dirty) this.changed();
  }
  private authorize(id: string) {
    this.tick();
    const lease = this.leases.get(id);
    if (!lease)
      throw new SimError(
        this.retired.get(id)?.code ?? "INVALID_LEASE",
        "Possession has ended or this lease is invalid. Possess the body again.",
      );
    return { lease, body: this.body(lease.resourceId) };
  }
  discover(kind?: ResourceKind) {
    this.tick();
    return {
      mode: "live",
      bounds: BOUNDS,
      leaseLimits: { default: 60, min: 5, max: 300 },
      resources: this.bodies
        .filter((b) => !kind || b.kind === kind)
        .map((b) => ({
          ...structuredClone(b),
          available: !b.lease,
          capabilities: CAPABILITIES[b.kind],
        })),
    };
  }
  possess(
    resourceId: string,
    ttlSeconds = 60,
    owner = "MCP agent",
  ): Possession {
    this.tick();
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 300)
      throw new SimError(
        "INVALID_TTL",
        "Lease duration must be 5–300 seconds.",
      );
    const body = this.body(resourceId);
    if (body.lease)
      throw new SimError(
        "RESOURCE_BUSY",
        `${body.label} is already possessed by ${body.lease.owner}.`,
      );
    const id = randomUUID();
    const expiresAt = this.wallClock() + ttlSeconds * 1000;
    this.leases.set(id, {
      id,
      resourceId,
      owner,
      expiresAt,
      deadline: this.clock() + ttlSeconds * 1000,
    });
    body.lease = { owner, expiresAt };
    this.log(`${owner} possessed ${body.label}`, "lease", body.id);
    this.changed();
    return { leaseId: id, resource: structuredClone(body), expiresAt };
  }
  private visible(body: Body, object: SceneObject) {
    if (object.heldBy && object.heldBy !== body.id) return false;
    const d = distance(body.position, object.position);
    if (body.kind === "camera") {
      const dx = object.position[0] - body.position[0],
        dz = object.position[2] - body.position[2];
      const pan = (Math.atan2(dx, dz) * 180) / Math.PI;
      const tilt =
        (Math.atan2(object.position[1] - body.position[1], Math.hypot(dx, dz)) *
          180) /
        Math.PI;
      const delta = Math.abs(((pan - body.pan + 540) % 360) - 180);
      return d < 18 && delta <= 35 && Math.abs(tilt - body.tilt) <= 30;
    }
    return d <= (body.kind === "rover" ? 4 : body.kind === "drone" ? 9 : 2.8);
  }
  observe(id: string): Observation {
    const { body } = this.authorize(id);
    return {
      at: this.wallClock(),
      revision: this.revision,
      body: structuredClone(body),
      objects: this.objects
        .filter((o) => this.visible(body, o))
        .map((o) => ({
          id: o.id,
          label: o.label,
          position: [...o.position] as Vec3,
          distance: Math.round(distance(body.position, o.position) * 100) / 100,
          ...(o.inspectedBy.includes(body.id)
            ? { condition: o.condition }
            : {}),
        })),
      inspection: this.inspections.get(id) ?? null,
    };
  }
  private cancel(body: Body) {
    this.motions.delete(body.id);
    if (body.action?.status === "running") {
      body.action.status = "cancelled";
      this.log(`${body.label} · action cancelled`, "action", body.id);
    }
  }
  private endLease(id: string, code: string) {
    const lease = this.leases.get(id);
    if (!lease) return;
    const body = this.body(lease.resourceId);
    this.cancel(body);
    body.lease = null;
    this.leases.delete(id);
    this.inspections.delete(id);
    this.retired.set(id, { code, at: this.clock() });
    this.log(
      `${body.label} · ${code === "LEASE_EXPIRED" ? "lease expired" : "released"}`,
      "lease",
      body.id,
    );
  }
  release(id: string) {
    this.tick();
    if (!this.leases.has(id)) {
      if (this.retired.has(id)) return { released: true };
      throw new SimError("INVALID_LEASE", "That lease is unknown.");
    }
    this.endLease(id, "LEASE_RELEASED");
    this.changed();
    return { released: true };
  }
  act(id: string, command: Command) {
    const { body, lease } = this.authorize(id);
    if (!CAPABILITIES[body.kind].includes(command.type))
      throw new SimError(
        "INVALID_COMMAND",
        `${body.kind} cannot ${command.type}.`,
      );
    if (command.type !== "stop" && body.action?.status === "running")
      throw new SimError(
        "ACTION_BUSY",
        "Wait for the current action or stop it first.",
      );
    const action: Action = {
      id: randomUUID(),
      type: command.type,
      status: "completed",
      target: null,
    };
    let target: Vec3 | null = null;
    switch (command.type) {
      case "move":
        if (body.kind === "drone" && !body.airborne)
          throw new SimError(
            "NOT_AIRBORNE",
            "Take off before moving the drone.",
          );
        if (body.kind === "rover" && command.y !== undefined)
          throw new SimError(
            "INVALID_COMMAND",
            "The rover only moves on the floor; omit y.",
          );
        target = [
          command.x,
          body.kind === "rover" ? 0.45 : (command.y ?? body.position[1]),
          command.z,
        ];
        if (
          target[0] < BOUNDS.minX ||
          target[0] > BOUNDS.maxX ||
          target[2] < BOUNDS.minZ ||
          target[2] > BOUNDS.maxZ ||
          (body.kind === "drone" &&
            (target[1] < 0.8 || target[1] > BOUNDS.maxAltitude))
        )
          throw new SimError(
            "OUT_OF_BOUNDS",
            "Target is outside the warehouse flight or floor bounds.",
          );
        break;
      case "takeoff":
        if (body.airborne)
          throw new SimError(
            "ALREADY_AIRBORNE",
            "The drone is already airborne.",
          );
        target = [body.position[0], 2.8, body.position[2]];
        break;
      case "land":
        if (!body.airborne)
          throw new SimError("NOT_AIRBORNE", "The drone is already landed.");
        target = [body.position[0], 0.4, body.position[2]];
        break;
      case "look":
        body.pan = command.pan;
        body.tilt = command.tilt;
        break;
      case "inspect": {
        const object = this.object(command.objectId);
        if (
          !this.visible(body, object) ||
          distance(body.position, object.position) >
            (body.kind === "rover" ? 2.3 : body.kind === "drone" ? 5 : 18)
        )
          throw new SimError(
            "OUT_OF_REACH",
            "Cargo is outside the sensor range or field of view. Move closer or aim the camera.",
          );
        if (body.kind === "drone" && !body.airborne)
          throw new SimError("NOT_AIRBORNE", "Take off for an aerial survey.");
        if (!object.inspectedBy.includes(body.id))
          object.inspectedBy.push(body.id);
        this.inspections.set(id, {
          objectId: object.id,
          condition: object.condition,
        });
        this.log(
          `${body.label} inspected ${object.id} · ${object.condition}`,
          "mission",
          body.id,
        );
        break;
      }
      case "preset":
        body.preset = command.preset;
        if (body.heldObjectId)
          this.object(body.heldObjectId).position = this.gripper(body);
        break;
      case "grasp": {
        const object = this.object(command.objectId);
        if (body.heldObjectId || object.heldBy)
          throw new SimError(
            "GRIPPER_BUSY",
            "The gripper or cargo is already occupied.",
          );
        if (
          body.preset !== "reach" ||
          distance(this.gripper(body), object.position) > 0.9
        )
          throw new SimError(
            "OUT_OF_REACH",
            "Move the arm to the reach preset near the cargo first.",
          );
        body.heldObjectId = object.id;
        object.heldBy = body.id;
        object.position = this.gripper(body);
        break;
      }
      case "place": {
        if (!body.heldObjectId)
          throw new SimError("GRIPPER_EMPTY", "There is no cargo to place.");
        const object = this.object(body.heldObjectId);
        object.position = this.gripper(body);
        object.position[1] = 0.55;
        object.heldBy = null;
        body.heldObjectId = null;
        this.log(`${body.label} placed ${object.id}`, "mission", body.id);
        break;
      }
      case "stop":
        this.cancel(body);
        break;
    }
    if (target) {
      const duration = Math.max(
        450,
        (distance(body.position, target) /
          (body.kind === "drone" ? 2.4 : 1.8)) *
          1000,
      );
      if (this.clock() + duration >= lease.deadline)
        throw new SimError(
          "LEASE_TOO_SHORT",
          "Not enough lease time remains for this motion. Release and possess again.",
        );
      if (command.type === "takeoff") body.airborne = true;
      body.heading = Math.atan2(
        target[0] - body.position[0],
        target[2] - body.position[2],
      );
      this.motions.set(body.id, {
        from: [...body.position],
        target,
        start: this.clock(),
        end: this.clock() + duration,
      });
      action.target = target;
      action.status = "running";
    }
    body.action = action;
    this.log(
      `${body.label} · ${command.type} ${action.status === "running" ? "accepted" : "completed"}`,
      "action",
      body.id,
    );
    this.changed();
    return {
      action: structuredClone(action),
      revision: this.revision,
      ...(command.type === "inspect"
        ? { inspection: this.inspections.get(id) }
        : {}),
    };
  }
  private gripper(body: Body): Vec3 {
    return body.preset === "reach"
      ? [2, 0.75, 0]
      : body.preset === "drop"
        ? [6, 0.8, 2]
        : [4, 2.3, 0];
  }
  tool(name: ToolName, input: unknown): unknown {
    const parsed = schemas[name].safeParse(input);
    if (!parsed.success)
      throw new SimError(
        "INVALID_COMMAND",
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      );
    const args = parsed.data as Record<string, unknown>;
    switch (name) {
      case "discover":
        return this.discover(args.kind as ResourceKind | undefined);
      case "possess":
        return this.possess(
          args.resourceId as string,
          args.ttlSeconds as number,
          args.owner as string,
        );
      case "observe":
        return this.observe(args.leaseId as string);
      case "act":
        return this.act(args.leaseId as string, args.command as Command);
      case "release":
        return this.release(args.leaseId as string);
    }
  }
  reset() {
    this.stopDemo();
    for (const id of this.leases.keys()) this.endLease(id, "LEASE_RELEASED");
    this.motions.clear();
    this.inspections.clear();
    this.initialize();
    this.demo = { running: false, phase: "Ready to begin", error: null };
    this.log("Warehouse reset · all leases released", "system");
    this.changed();
  }
  private demoGeneration = 0;
  private demoLeases = new Set<string>();
  stopDemo() {
    this.demoGeneration++;
    for (const id of this.demoLeases) if (this.leases.has(id)) this.release(id);
    this.demoLeases.clear();
    this.demo.running = false;
    this.demo.phase = "Demo stopped";
    this.changed();
  }
  startDemo() {
    this.tick();
    if (this.demo.running)
      throw new SimError("DEMO_RUNNING", "The guided demo is already running.");
    if (this.bodies.some((b) => b.lease))
      throw new SimError(
        "RESOURCE_BUSY",
        "Release all bodies before starting the guided demo.",
      );
    this.reset();
    this.demo = { running: true, phase: "Connecting the ghost", error: null };
    this.changed();
    const generation = ++this.demoGeneration;
    const tokens = new Map<ResourceKind, string>();
    void this.runDemo(generation, tokens);
    return { started: true };
  }
  private async runDemo(generation: number, tokens: Map<ResourceKind, string>) {
    const assertRunning = () => {
      if (generation !== this.demoGeneration)
        throw new SimError("DEMO_STOPPED", "Demo stopped.");
    };
    const delay = async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      assertRunning();
    };
    const phase = (text: string) => {
      assertRunning();
      this.demo.phase = text;
      this.changed();
    };
    const act = async (kind: ResourceKind, command: Command) => {
      assertRunning();
      let id = tokens.get(kind);
      if (!id) {
        id = this.possess(`${kind}-01`, 120, "Ghost · guided demo").leaseId;
        tokens.set(kind, id);
        this.demoLeases.add(id);
      }
      const result = this.act(id, command);
      while (result.action.status === "running") {
        await delay(100);
        const action = this.observe(id).body.action;
        if (
          !action ||
          action.id !== result.action.id ||
          action.status === "cancelled"
        )
          throw new SimError(
            "DEMO_INTERRUPTED",
            "A demo action was interrupted.",
          );
        if (action.status === "completed") break;
      }
      await delay(650);
    };
    const release = (kind: ResourceKind) => {
      const id = tokens.get(kind)!;
      this.release(id);
      this.demoLeases.delete(id);
    };
    try {
      phase("01 / Sentinel · locating priority cargo");
      await act("camera", { type: "look", pan: 63, tilt: -13 });
      await act("camera", { type: "inspect", objectId: "crate-07" });
      release("camera");
      phase("02 / Scout · approaching the inspection point");
      await act("rover", { type: "move", x: 1, z: 1.4 });
      await act("rover", { type: "inspect", objectId: "crate-07" });
      release("rover");
      phase("03 / Wisp · aerial verification");
      await act("drone", { type: "takeoff" });
      await act("drone", { type: "move", x: 1, z: -1.5, y: 3.4 });
      await act("drone", { type: "inspect", objectId: "crate-07" });
      await act("drone", { type: "land" });
      release("drone");
      phase("04 / Atlas · staging cargo for dispatch");
      await act("arm", { type: "preset", preset: "reach" });
      await act("arm", { type: "grasp", objectId: "crate-07" });
      await act("arm", { type: "preset", preset: "home" });
      await act("arm", { type: "preset", preset: "drop" });
      await act("arm", { type: "place" });
      await act("arm", { type: "preset", preset: "home" });
      release("arm");
      phase("Mission complete · one ghost, four bodies");
      this.demo.running = false;
      this.log(
        "Mission complete · priority cargo verified and staged",
        "mission",
      );
      this.changed();
    } catch (error) {
      if (generation !== this.demoGeneration) return;
      this.stopDemo();
      this.demo.error = error instanceof Error ? error.message : "Demo failed";
      this.changed();
    }
  }
}
