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
