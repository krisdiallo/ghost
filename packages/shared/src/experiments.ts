import type {
  Command,
  ResourceDefinition,
  ResourceKind,
  SceneObject,
  Snapshot,
  Vec3,
} from "./index.js";
import type { Obstacle } from "./geometry.js";

export interface DeviceProfile {
  scale: number;
  speed: number;
  telemetryRange: number;
  inspectRange: number | null;
  payloadKg: number | null;
}
export function defaultProfile(kind: ResourceKind): DeviceProfile {
  return {
    scale: 1,
    speed: kind === "drone" ? 2.4 : kind === "rover" ? 1.8 : 0,
    telemetryRange: { camera: 45, rover: 4, drone: 9, arm: 2.8 }[kind],
    inspectRange:
      kind === "arm" ? null : { camera: 45, rover: 2.3, drone: 5 }[kind],
    payloadKg: kind === "arm" ? 5 : null,
  };
}
export interface DeviceDefinition extends ResourceDefinition {
  profile: DeviceProfile;
  heading?: number;
  pan?: number;
  tilt?: number;
  airborne?: boolean;
}
export interface WorkflowStep {
  actor: string;
  dwellSeconds?: number;
  label?: string;
  command: Command;
}
export interface WorkflowDefinition {
  name: string;
  actors: Record<string, string>;
  steps: WorkflowStep[];
  stopOnError: boolean;
  maxSimulatedSeconds: number;
  requireSafeEnd: boolean;
}
export interface WarehouseDefinition {
  version: 1;
  name: string;
  obstacles: Obstacle[];
  devices: DeviceDefinition[];
  cargo: (Pick<SceneObject, "id" | "label" | "position" | "condition"> & {
    massKg?: number;
  })[];
  workflow?: WorkflowDefinition;
}
export interface SandboxSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  deviceCount: number;
  obstacleCount: number;
  source: string;
}
export type RunStatus = "running" | "completed" | "failed" | "cancelled";
export interface TrialStepResult {
  index: number;
  actor: string;
  resourceId: string;
  label: string;
  command: Command;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAtSeconds: number;
  finishedAtSeconds?: number;
  before: Vec3;
  after: Vec3;
  error?: { code: string; message: string };
  inspection?: { objectId: string; condition: string };
}
export interface TrialMetrics {
  simulatedSeconds: number;
  distanceMeters: number;
  completedSteps: number;
  totalSteps: number;
  failedSteps: number;
  blockedMoves: number;
  inspectedCargo: string[];
  observedCheckpoints: number;
  eligibleCheckpoints: number;
  allLeasesReleased: boolean;
  safeEndState: boolean;
}
export interface RunSummary {
  id: string;
  sandboxId: string;
  name: string;
  sandboxName: string;
  status: RunStatus;
  startedAt: number;
  playbackRate: number;
  currentStep: number;
  metrics: TrialMetrics;
  error?: { code: string; message: string };
}
export interface ExperimentReport extends RunSummary {
  sourceRevision: number;
  definition: WarehouseDefinition;
  workflow: WorkflowDefinition;
  steps: TrialStepResult[];
  scenarioHash: string;
  workflowHash: string;
  assumptions: string[];
}
export interface RunDetail {
  run: ExperimentReport;
  snapshot?: Snapshot;
  frame?: import("./index.js").SensorFrame;
}
export interface SandboxDetail {
  sandbox: SandboxSummary;
  definition: WarehouseDefinition;
  snapshot: Snapshot;
}
export interface LabState {
  sandboxes: SandboxSummary[];
  runs: RunSummary[];
  limits: {
    sandboxes: number;
    devices: number;
    activeRuns: number;
    retainedRuns: number;
  };
  assumptions: string[];
}
export interface ExperimentComparison {
  comparable: boolean;
  reasons: string[];
  runs: RunSummary[];
  completedRuns: number;
  delta: { simulatedSeconds: number; distanceMeters: number } | null;
  interpretation: string;
}
export interface ExperimentTemplate {
  id: string;
  name: string;
  description: string;
  device: DeviceDefinition;
  variants: { name: string; scale: number }[];
  workflow: WorkflowDefinition;
}
export type LabToolName =
  | "sandbox_list"
  | "sandbox_create"
  | "sandbox_inspect"
  | "sandbox_update"
  | "sandbox_add_device"
  | "sandbox_delete"
  | "experiment_templates"
  | "experiment_run"
  | "experiment_inspect"
  | "experiment_cancel"
  | "experiment_compare";
