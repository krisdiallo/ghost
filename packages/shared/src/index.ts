export type ResourceKind = "camera" | "rover" | "arm" | "drone";

export interface ResourceDefinition {
  id: string;
  kind: ResourceKind;
  label: string;
  position: [number, number, number];
}

// Static demo catalog, not live availability or simulation state.
export const DEMO_RESOURCES: ResourceDefinition[] = [
  { id: "camera-01", kind: "camera", label: "Camera", position: [-3, 1.5, -2] },
  { id: "rover-01", kind: "rover", label: "Rover", position: [-2, 0.4, 2] },
  { id: "arm-01", kind: "arm", label: "Robotic arm", position: [2, 0.8, 2] },
  { id: "drone-01", kind: "drone", label: "Drone", position: [3, 2, -2] }
];
