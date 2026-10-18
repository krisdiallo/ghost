import type { Command, Vec3 } from "./index.js";
import type { Obstacle } from "./geometry.js";
export interface FleetIncident {
  id: string;
  sequence: number;
  resourceId: string;
  job: string;
  code: string;
  message: string;
  obstacleId: string | null;
  position: Vec3;
  createdAt: number;
  resolvedAt: number | null;
  resolution: string | null;
}
export interface FleetJob {
  resourceId: string;
  label: string;
  status: "working" | "operator" | "blocked" | "paused" | "complete";
  step: string;
  cycles: number;
  command: Command;
}
export interface OperationsState {
  running: boolean;
  sequence: number;
  watchers: number;
  jobs: FleetJob[];
  incidents: FleetIncident[];
  obstructions: Obstacle[];
  recovery: FleetRecovery | null;
  mode: "local-autonomy";
}
export interface OperationsInput {
  action:
    | "status"
    | "start"
    | "pause"
    | "place_box"
    | "clear_box"
    | "recover_box"
    | "resume"
    | "watch";
  x?: number;
  z?: number;
  incidentId?: string;
  leaseId?: string;
  afterSequence?: number;
  waitSeconds?: number;
}
export interface FleetStep {
  label: string;
  command: Command;
  dwell: number;
}

export interface FleetRecovery {
  incidentId: string;
  resourceId: string;
  obstacleId: string;
  phase:
    | "approaching"
    | "loading"
    | "transporting"
    | "unloading"
    | "parked"
    | "interrupted";
  message: string;
  destination: Vec3;
}
