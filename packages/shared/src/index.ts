export type ResourceKind = "camera" | "rover" | "arm" | "drone";
export type Vec3 = [number, number, number];
export interface ResourceDefinition {
  id: string;
  kind: ResourceKind;
  label: string;
  position: Vec3;
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
  verticalFov: 60,
  homePan: 104,
  homeTilt: -16,
};
export const CAPABILITIES: Record<ResourceKind, string[]> = {
  camera: ["look", "inspect"],
  rover: ["move", "inspect", "stop"],
  arm: ["preset", "grasp", "place"],
  drone: ["takeoff", "move", "inspect", "land", "stop"],
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
  heading: number;
  pan: number;
  tilt: number;
  preset: "home" | "reach" | "drop";
  heldObjectId: string | null;
  airborne: boolean;
  lease: { owner: string; expiresAt: number } | null;
  action: Action | null;
}
export interface SceneObject {
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
  instanceId: string;
  revision: number;
  at: number;
  bodies: Body[];
  objects: SceneObject[];
  mission: MissionStep[];
  activity: Activity[];
  demo: { running: boolean; phase: string; error: string | null };
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
// Forward is local +Z. Mobile bodies rotate with their authoritative heading.
export function sensorPose(body: Body): {
  position: Vec3;
  target: Vec3;
  fov: number;
} {
  const [x, y, z] = body.position;
  if (body.kind === "arm") {
    const end: Vec3 =
      body.preset === "reach"
        ? [-2, 0.3, 0]
        : body.preset === "drop"
          ? [2, 0.35, 2]
          : [0, 1.8, 0];
    return {
      position: [x + end[0], y + end[1] + 0.48, z + end[2] + 0.55],
      target: [x + end[0], y + end[1] - 0.25, z + end[2]],
      fov: 90,
    };
  }
  const pan =
    body.kind === "camera" ? (body.pan * Math.PI) / 180 : body.heading;
  const tilt =
    ((body.kind === "camera" ? body.tilt : body.kind === "drone" ? -35 : -8) *
      Math.PI) /
    180;
  const direction: Vec3 = [
    Math.sin(pan) * Math.cos(tilt),
    Math.sin(tilt),
    Math.cos(pan) * Math.cos(tilt),
  ];
  const height =
    body.kind === "rover" ? 0.9 : body.kind === "drone" ? -0.23 : 0;
  const offset =
    body.kind === "camera" ? 0.7 : body.kind === "rover" ? 0.63 : 0.35;
  const position: Vec3 = [
    x + direction[0] * offset,
    y + height + direction[1] * offset,
    z + direction[2] * offset,
  ];
  return {
    position,
    target: position.map((v, i) => v + direction[i]! * 10) as Vec3,
    fov: body.kind === "camera" ? 43 : 58,
  };
}
export interface Possession {
  leaseId: string;
  resource: Body;
  expiresAt: number;
}
export type ToolName = "discover" | "possess" | "observe" | "act" | "release";
export interface ApiError {
  code: string;
  message: string;
}
