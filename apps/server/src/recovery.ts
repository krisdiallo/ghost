import {
  blockingObstacle,
  bodyClearance,
  type FleetIncident,
  type FleetRecovery,
  type Obstacle,
  type Vec3,
} from "@ghost/shared";
import { Simulation, SimError } from "./simulation.js";
import { recoveryPath } from "./recovery-path.js";

export class BoxRecovery {
  private publicState: FleetRecovery | null = null;
  private token: string | null = null;
  private route: Vec3[] = [];
  private carryingRoute: Vec3[] = [];
  private boxOrigin: Vec3 = [0, 0, 0];
  private phaseAt = 0;
  constructor(
    private sim: Simulation,
    private changed: () => void,
    private clock: () => number,
  ) {}
  state() {
    return structuredClone(this.publicState);
  }
  active() {
    return (
      this.publicState &&
      !["parked", "interrupted"].includes(this.publicState.phase)
    );
  }
  dispatch(incident: FleetIncident) {
    if (this.active())
      throw new SimError(
        "RECOVERY_BUSY",
        "Mule is already recovering a box. Read status to follow its progress.",
      );
    const handler = this.sim.ensureHandler();
    if (handler.heldObjectId)
      throw new SimError(
        "LOAD_HELD",
        "Mule still has a load; finish its existing recovery first.",
      );
    if (handler.lease)
      throw new SimError(
        "RESOURCE_BUSY",
        "Mule is controlled by another operator.",
      );
    const box = this.sim.obstacles.find((o) => o.id === incident.obstacleId)!;
    const center = box.min.map((v, i) => (v + box.max[i]!) / 2) as Vec3;
    const bodies: Obstacle[] = this.sim
      .snapshot()
      .bodies.filter((b) => b.id !== handler.id && b.position[1] < 2)
      .map((b) => {
        const c = bodyClearance(b);
        return {
          id: b.id,
          label: b.label,
          kind: "freight",
          min: b.position.map((v, i) => v - Math.max(c[i]!, 0.5)) as Vec3,
          max: b.position.map((v, i) => v + Math.max(c[i]!, 0.5)) as Vec3,
        };
      });
    const approachObstacles = [...this.sim.obstacles, ...bodies];
    const carryingObstacles = approachObstacles.filter((o) => o.id !== box.id);
    let chosen: { approach: Vec3[]; carry: Vec3[]; destination: Vec3 } | null =
      null;
    for (const [dx, dz] of [
      [0, -2],
      [2, 0],
      [0, 2],
      [-2, 0],
    ]) {
      const pickup: Vec3 = [center[0] + dx!, 0.45, center[2] + dz!];
      const approach = recoveryPath(
        handler.position,
        pickup,
        approachObstacles,
      );
      if (!approach) continue;
      // Fork extension and retraction must also stay clear of structures and the halted body.
      if (
        blockingObstacle(
          center,
          [pickup[0], 1.55, pickup[2]],
          [0.65, 0.65, 0.65],
          carryingObstacles,
        )
      )
        continue;
      for (const x of [0, -3, 3, -6, 6, -9, 9]) {
        const destination: Vec3 = [x, 0.65, 6],
          drop: Vec3 = [x, 0.45, 4];
        if (
          blockingObstacle(
            destination,
            destination,
            [0.8, 0.8, 0.8],
            carryingObstacles,
          )
        )
          continue;
        if (
          blockingObstacle(
            [x, 1.55, 4],
            destination,
            [0.65, 0.65, 0.65],
            carryingObstacles,
          )
        )
          continue;
        const carry = recoveryPath(pickup, drop, carryingObstacles);
        if (carry) {
          chosen = { approach, carry, destination };
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen)
      throw new SimError(
        "NO_RECOVERY_ROUTE",
        "Mule cannot reach and stage this box safely. Reposition the affected device or clear another aisle first.",
      );
    this.token = this.sim.possess(
      handler.id,
      300,
      "Recovery dispatch · Mule",
    ).leaseId;
    this.route = chosen.approach;
    this.carryingRoute = chosen.carry;
    this.boxOrigin = center;
    this.publicState = {
      incidentId: incident.id,
      resourceId: handler.id,
      obstacleId: box.id,
      phase: "approaching",
      message: "Mule is navigating to the obstruction.",
      destination: chosen.destination,
    };
    this.changed();
  }
  private phase(phase: FleetRecovery["phase"], message: string) {
    this.publicState!.phase = phase;
    this.publicState!.message = message;
    this.phaseAt = this.clock();
    this.changed();
  }
  tick() {
    if (!this.active() || !this.token) return;
    const r = this.publicState!;
    try {
      this.sim.validateLease(this.token);
      const handler = this.sim
        .snapshot()
        .bodies.find((b) => b.id === r.resourceId)!;
      if (handler.action?.status === "running") return;
      if (handler.action?.status === "cancelled" && handler.lastBlocked)
        throw new SimError(
          "RECOVERY_BLOCKED",
          "Mule's route was blocked. The box remains at its actual position.",
        );
      if (r.phase === "approaching" || r.phase === "transporting") {
        if (this.route.length) {
          const p = this.route.shift()!;
          // Never drive the recovery vehicle through a stopped ground device.
          const occupied = this.sim
            .snapshot()
            .bodies.filter((b) => b.id !== handler.id && b.position[1] < 2)
            .some((b) => {
              const c = bodyClearance(b);
              const o: Obstacle = {
                id: b.id,
                label: b.label,
                kind: "freight",
                min: b.position.map((v, i) => v - Math.max(c[i]!, 0.5)) as Vec3,
                max: b.position.map((v, i) => v + Math.max(c[i]!, 0.5)) as Vec3,
              };
              return !!blockingObstacle(
                handler.position,
                p,
                bodyClearance(handler),
                [o],
              );
            });
          if (occupied)
            throw new SimError(
              "RECOVERY_BLOCKED",
              "A device entered Mule's route. The load stays in place; clear the route before retrying.",
            );
          this.sim.act(this.token, { type: "move", x: p[0], z: p[2] });
          return;
        }
        if (r.phase === "approaching") {
          this.sim.orientHandler(this.token, this.boxOrigin);
          this.phase(
            "loading",
            "Mule is lifting the box and retracting its loading forks.",
          );
        } else {
          this.sim.orientHandler(this.token, r.destination);
          this.phase(
            "unloading",
            "Mule is setting the same box down in the staging bay.",
          );
        }
      } else if (r.phase === "loading" || r.phase === "unloading") {
        const t = Math.min(1, (this.clock() - this.phaseAt) / 3200);
        const platform: Vec3 = [handler.position[0], 1.55, handler.position[2]];
        let center: Vec3;
        if (r.phase === "loading") {
          // Lift clear of the floor, then retract onto the platform.
          const slide = Math.max(0, (t - 0.35) / 0.65);
          center = [
            this.boxOrigin[0] + (platform[0] - this.boxOrigin[0]) * slide,
            this.boxOrigin[1] +
              (platform[1] - this.boxOrigin[1]) * Math.min(1, t / 0.35),
            this.boxOrigin[2] + (platform[2] - this.boxOrigin[2]) * slide,
          ];
        } else {
          const slide = Math.min(1, t / 0.65),
            lower = Math.max(0, (t - 0.65) / 0.35);
          center = [
            platform[0] + (r.destination[0] - platform[0]) * slide,
            platform[1] + (r.destination[1] - platform[1]) * lower,
            platform[2] + (r.destination[2] - platform[2]) * slide,
          ];
        }
        this.sim.transferObstruction(r.obstacleId, center, r.resourceId, true);
        this.changed();
        if (t === 1) {
          if (r.phase === "loading") {
            this.route = this.carryingRoute;
            this.phase(
              "transporting",
              "Box secured. Mule is carrying it to the staging bay.",
            );
          } else {
            this.sim.transferObstruction(
              r.obstacleId,
              r.destination,
              r.resourceId,
              false,
            );
            this.sim.release(this.token);
            this.token = null;
            this.phase(
              "parked",
              "Box placed in staging. The aisle is clear; verify and return Scout to autonomy.",
            );
          }
        }
      }
    } catch (error) {
      if (this.token) {
        try {
          this.sim.release(this.token);
        } catch {}
      }
      this.token = null;
      this.phase(
        "interrupted",
        error instanceof Error
          ? error.message
          : "Recovery interrupted; the box remains in place.",
      );
    }
  }
  close() {
    if (this.token) {
      try {
        this.sim.release(this.token);
      } catch {}
    }
    this.token = null;
  }
  reset() {
    this.close();
    this.publicState = null;
  }
}
