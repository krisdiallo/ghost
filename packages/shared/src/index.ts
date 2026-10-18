import { defaultProfile } from "./experiments.js";
import type { DeviceProfile, LabToolName } from "./experiments.js";
export * from "./experiments.js";
import {
  blockingObstacle,
  BODY_CLEARANCE,
  STATIC_OBSTACLES,
} from "./geometry.js";
export * from "./geometry.js";
export type ResourceKind = "camera" | "rover" | "arm" | "drone";
export type Vec3 = [number, number, number];
export interface ResourceDefinition {
  id: string;
  kind: ResourceKind;
  label: string;
  position: Vec3;
  attachment?: "pallet-handler" | undefined;
}
export const DEMO_RESOURCES: ResourceDefinition[] = [
  {
    id: "camera-01",
    kind: "camera",
    label: "Sentinel",
    position: [-30.2, 10, 8],
  },
  { id: "rover-01", kind: "rover", label: "Scout", position: [-6, 0.45, 3] },
  { id: "arm-01", kind: "arm", label: "Atlas", position: [4, 0.5, 0] },
  { id: "drone-01", kind: "drone", label: "Wisp", position: [-4, 0.4, -3] },
];
export const WAREHOUSE = {
  width: 64,
  depth: 44,
  centerZ: -12,
  clearHeight: 12,
};
export const BOUNDS = {
  minX: -31,
  maxX: 31,
  minZ: -33,
  maxZ: 9,
  maxAltitude: 12,
};
export const CAMERA_SENSOR = {
  range: 45,
  horizontalFov: 70,
  verticalFov: 43,
  homePan: 104,
  homeTilt: -16,
};
export const CAPABILITIES: Record<ResourceKind, string[]> = {
  camera: ["look", "inspect"],
  rover: ["move", "inspect", "stop"],
  arm: ["preset", "grasp", "place"],
  drone: ["takeoff", "move", "look", "inspect", "land", "stop"],
};
export type Command =
  | { type: "move"; x: number; z: number; y?: number }
  | { type: "look"; pan: number; tilt: number }
  | { type: "inspect"; objectId: string }
  | { type: "preset"; preset: "home" | "reach" | "drop" }
  | { type: "grasp"; objectId: string }
  | { type: "place" }
  | { type: "takeoff" }
  | { type: "land" }
  | { type: "stop" };
export interface Action {
  id: string;
  type: string;
  status: "running" | "completed" | "cancelled";
  target: Vec3 | null;
}
export interface Body extends ResourceDefinition {
  profile?: DeviceProfile;
  handling?: { extension: number; lift: number };
  heading: number;
  pan: number;
  tilt: number;
  preset: "home" | "reach" | "drop";
  heldObjectId: string | null;
  airborne: boolean;
  lease: { owner: string; expiresAt: number } | null;
  action: Action | null;
  lastBlocked: {
    obstacleId: string;
    label: string;
    position: Vec3;
    at: number;
  } | null;
}
export interface SceneObject {
  massKg?: number;
  id: string;
  label: string;
  position: Vec3;
  condition: string;
  heldBy: string | null;
  inspectedBy: string[];
}
export interface Activity {
  id: number;
  at: number;
  resourceId: string | null;
  message: string;
  kind: "lease" | "action" | "mission" | "system";
}
export interface MissionStep {
  id: string;
  label: string;
  body: ResourceKind;
  complete: boolean;
}
export interface Snapshot {
  operations?: import("./operations.js").OperationsState;
  layout?: { obstacles: import("./geometry.js").Obstacle[] };
  instanceId: string;
  revision: number;
  at: number;
  bodies: Body[];
  objects: SceneObject[];
  mission: MissionStep[];
  activity: Activity[];
  demo: { running: boolean; phase: string; error: string | null };
  survey: Survey;
}
export interface Observation {
  at: number;
  revision: number;
  body: Body;
  objects: {
    id: string;
    label: string;
    position: Vec3;
    distance: number;
    condition?: string;
  }[];
  inspection: { objectId: string; condition: string } | null;
  limits: ReturnType<typeof bodyLimits>;
  survey: Survey;
  frame?: SensorFrame;
}
export interface SensorFrame {
  id: string;
  instanceId: string;
  resourceId: string;
  revision: number;
  at: number;
  width: number;
  height: number;
  mimeType: "image/jpeg";
  data: string;
}
// One optical rig for both the interactive viewer and server image observations.
// Forward is local +Z. Drone optics have world aim independent of chassis heading.
export function sensorPose(body: Body): {
  position: Vec3;
  target: Vec3;
  fov: number;
} {
  const [x, y, z] = body.position;
  const scale = body.profile?.scale ?? 1;
  if (body.kind === "arm") {
    const end: Vec3 =
      body.preset === "reach"
        ? [-2, 0.3, 0]
        : body.preset === "drop"
          ? [2, 0.35, 2]
          : [0, 1.8, 0];
    return {
      position: [
        x + end[0] * scale,
        y + (end[1] + 0.48) * scale,
        z + (end[2] + 0.55) * scale,
      ],
      target: [
        x + end[0] * scale,
        y + (end[1] - 0.25) * scale,
        z + end[2] * scale,
      ],
      fov: 90,
    };
  }
  const pan =
    body.kind === "camera" || body.kind === "drone"
      ? (body.pan * Math.PI) / 180
      : body.heading;
  const tilt =
    ((body.kind === "camera" || body.kind === "drone" ? body.tilt : -8) *
      Math.PI) /
    180;
  const direction: Vec3 = [
    Math.sin(pan) * Math.cos(tilt),
    Math.sin(tilt),
    Math.cos(pan) * Math.cos(tilt),
  ];
  const height =
    body.kind === "rover" ? 0.9 : body.kind === "drone" ? -0.15 : 0;
  const offset =
    body.kind === "camera" ? 0.7 : body.kind === "rover" ? 0.63 : 0.24;
  const position: Vec3 = [
    x + direction[0] * offset * scale,
    y + (height + direction[1] * offset) * scale,
    z + direction[2] * offset * scale,
  ];
  return {
    position,
    target: position.map((v, i) => v + direction[i]! * 10) as Vec3,
    fov: body.kind === "camera" ? CAMERA_SENSOR.verticalFov : 58,
  };
}
export interface Possession {
  leaseId: string;
  resource: Body;
  expiresAt: number;
}
export type BodyToolName =
  | "discover"
  | "possess"
  | "observe"
  | "act"
  | "release";
export type ToolName = BodyToolName | LabToolName | "operations";
export interface ApiError {
  code: string;
  message: string;
}

export const SENSOR_LIMITS = {
  camera: {
    telemetryRange: CAMERA_SENSOR.range,
    inspectRange: CAMERA_SENSOR.range,
  },
  rover: { telemetryRange: 4, inspectRange: 2.3 },
  arm: { telemetryRange: 2.8, inspectRange: null },
  drone: { telemetryRange: 9, inspectRange: 5 },
} as const;
export const ARM_PRESETS: Record<Body["preset"], Vec3> = {
  home: [4, 2.3, 0],
  reach: [2, 0.75, 0],
  drop: [6, 0.8, 2],
};
export function bodyClearance(body: Body): Vec3 {
  if (body.attachment === "pallet-handler") return [0.9, 1.05, 0.9];
  const base =
    body.kind === "rover" || body.kind === "drone"
      ? BODY_CLEARANCE[body.kind]
      : [0, 0, 0];
  return base.map((v) => v * (body.profile?.scale ?? 1)) as Vec3;
}
export function armPresets(body: Body): Record<Body["preset"], Vec3> {
  return Object.fromEntries(
    Object.entries(ARM_PRESETS).map(([key, position]) => [
      key,
      position.map(
        (v, i) =>
          body.position[i]! +
          (v - [4, 0.5, 0][i]!) * (body.profile?.scale ?? 1),
      ),
    ]),
  ) as Record<Body["preset"], Vec3>;
}
export function bodyLimits(body: Body) {
  const profile = body.profile ?? defaultProfile(body.kind);
  return {
    ...SENSOR_LIMITS[body.kind],
    telemetryRange: profile.telemetryRange,
    inspectRange: profile.inspectRange,
    scale: profile.scale,
    telemetryModel: body.kind === "camera" ? "range-and-pan-tilt" : "radial-3d",
    telemetryOcclusion: true,
    occlusionModel: "static solid rack, freight and building envelopes",
    image: {
      verticalFov: sensorPose(body).fov,
      aspectRatio: 16 / 9,
      occlusion: true,
    },
    ...(body.kind === "camera" || body.kind === "drone"
      ? {
          horizontalFov:
            body.kind === "camera" ? CAMERA_SENSOR.horizontalFov : 360,
          verticalFov: body.kind === "camera" ? CAMERA_SENSOR.verticalFov : 180,
          panBounds: [-180, 180],
          tiltBounds: [body.kind === "drone" ? -90 : -80, 30],
          aimReference:
            "world degrees: 0 faces +Z, 90 faces +X; drone aim persists through flight",
        }
      : {}),
    ...(body.kind === "arm"
      ? {
          gripperPresets: armPresets(body),
          graspRadius: 0.9 * profile.scale,
          payloadKg: profile.payloadKg,
          dispatch: { preset: "drop", placedCargoHeight: 0.55 },
        }
      : {}),
    ...(body.kind === "rover" || body.kind === "drone"
      ? {
          speed: profile.speed,
          collisionChecks: true,
          automaticPathPlanning: false,
          clearance: bodyClearance(body),
          clearanceUnits:
            "x/y/z half-extents in meters; includes full wheel or rotor footprint",
          ...(body.kind === "drone"
            ? {
                minFlightAltitude: 0.8 * profile.scale,
                maxFlightAltitude: BOUNDS.maxAltitude,
                takeoffAltitude: 2.8 * profile.scale,
                landedAltitude: 0.4 * profile.scale,
              }
            : {}),
        }
      : {}),
  };
}
// Proximity telemetry is range + static line of sight; camera images also use optics.
export function telemetryVisible(
  body: Body,
  position: Vec3,
  obstacles = STATIC_OBSTACLES,
): boolean {
  const profile = body.profile ?? defaultProfile(body.kind);
  const [dx, dy, dz] = position.map((v, i) => v - body.position[i]!) as Vec3;
  const d = Math.hypot(dx, dy, dz);
  if (
    blockingObstacle(sensorPose(body).position, position, [0, 0, 0], obstacles)
  )
    return false;
  if (body.kind !== "camera") return d <= profile.telemetryRange;
  const pan = (Math.atan2(dx, dz) * 180) / Math.PI;
  const tilt = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  return (
    d < profile.telemetryRange &&
    Math.abs(((pan - body.pan + 540) % 360) - 180) <=
      CAMERA_SENSOR.horizontalFov / 2 &&
    Math.abs(tilt - body.tilt) <= CAMERA_SENSOR.verticalFov / 2
  );
}
export const SURVEY_GRID = {
  columns: 12,
  rows: 8,
  minX: BOUNDS.minX,
  maxX: BOUNDS.maxX,
  minZ: BOUNDS.minZ,
  maxZ: BOUNDS.maxZ,
  floorCargoHeight: 0.55,
};
export function surveyCell(column: number, row: number) {
  const width = (SURVEY_GRID.maxX - SURVEY_GRID.minX) / SURVEY_GRID.columns;
  const depth = (SURVEY_GRID.maxZ - SURVEY_GRID.minZ) / SURVEY_GRID.rows;
  const minX = SURVEY_GRID.minX + column * width,
    minZ = SURVEY_GRID.minZ + row * depth;
  return {
    minX,
    minZ,
    maxX: minX + width,
    maxZ: minZ + depth,
    center: [
      minX + width / 2,
      SURVEY_GRID.floorCargoHeight,
      minZ + depth / 2,
    ] as Vec3,
  };
}
export interface SurveyCargo {
  id: string;
  label: string;
  position: Vec3;
  lastSeenAt: number;
  condition?: string;
  inspectedBy: string[];
}
export interface Survey {
  grid: typeof SURVEY_GRID;
  // North-to-south rows, west-to-east columns. 1 = visible checkpoint, 0 = unknown, x = inside structure.
  rows: string[];
  coveredCells: number;
  totalCells: number;
  blockedCells: number;
  coverageModel: "visible-floor-checkpoints";
  knownCargo: SurveyCargo[];
  lastObservedAt: number | null;
}

export * from "./operations.js";
