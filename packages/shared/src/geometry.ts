import type { Vec3 } from "./index.js";
export const RACK_BAYS = [-27, -16]
  .flatMap((z) => [-25, -15, -5, 5, 15, 25].map((x) => [x, z] as const))
  .concat([-25, -15, 15, 25].map((x) => [x, -5] as const));
export const FREIGHT_STACKS = [-26, -22, 21, 25].flatMap((x) =>
  [3, 6.3].map((z) => [x, z] as const),
);
export const STRUCTURAL_COLUMNS = [-31, 31].flatMap((x) =>
  [-31, -19, -7, 8].map((z) => [x, z] as const),
);
export interface Obstacle {
  id: string;
  label: string;
  kind: "rack" | "wall" | "column" | "freight" | "mezzanine";
  min: Vec3;
  max: Vec3;
}
function box(
  id: string,
  label: string,
  kind: Obstacle["kind"],
  center: Vec3,
  size: Vec3,
): Obstacle {
  return {
    id,
    label,
    kind,
    min: center.map((v, i) => v - size[i]! / 2) as Vec3,
    max: center.map((v, i) => v + size[i]! / 2) as Vec3,
  };
}
// Solid rack/stock envelopes deliberately reserve gaps within a packed bay.
// Coordinates/dimensions match the instanced hall; thin trim/paint is not solid.
export const STATIC_OBSTACLES: Obstacle[] = [
  ...RACK_BAYS.map(([x, z], i) =>
    box(
      `rack-${i + 1}`,
      `Storage bay ${i + 1}`,
      "rack",
      [x, 4.025, z],
      [7.6, 8.05, 2.46],
    ),
  ),
  ...FREIGHT_STACKS.map(([x, z], i) =>
    box(
      `freight-${i + 1}`,
      `Freight stack ${i + 1}`,
      "freight",
      [x, 0.875, z],
      [2.8, 1.75, 2.5],
    ),
  ),
  ...STRUCTURAL_COLUMNS.flatMap(([x, z], i) => [
    box(
      `column-${i + 1}`,
      `Column ${i + 1}`,
      "column",
      [x, 7.2, z],
      [0.4, 14.4, 0.4],
    ),
    box(
      `column-base-${i + 1}`,
      `Column base ${i + 1}`,
      "column",
      [x, 0.35, z],
      [0.9, 0.7, 0.9],
    ),
  ]),
  box(
    "north-wall",
    "North wall and closed loading doors",
    "wall",
    [0, 7.2, -33.7],
    [64, 14.4, 0.7],
  ),
  box("west-wall", "West wall", "wall", [-31.9, 6.7, -12], [0.25, 13.4, 44]),
  box("east-wall", "East low wall", "wall", [31.9, 0.65, -12], [0.2, 1.3, 44]),
  box(
    "mezzanine-floor",
    "Mezzanine platform",
    "mezzanine",
    [-25, 6, -29.7],
    [12.5, 0.35, 7.4],
  ),
  box(
    "control-booth",
    "Control booth",
    "mezzanine",
    [-25, 7.7, -30.1],
    [11, 3.1, 6],
  ),
  box(
    "control-roof",
    "Control booth roof",
    "mezzanine",
    [-25, 9.4, -30.1],
    [11.5, 0.18, 6.3],
  ),
  box(
    "stairs",
    "Mezzanine stairs",
    "mezzanine",
    [-29.3, 3.05, -22.1],
    [2.4, 6.1, 8.6],
  ),
];
export function containsPoint(obstacle: Obstacle, point: Vec3) {
  return point.every((v, i) => v >= obstacle.min[i]! && v <= obstacle.max[i]!);
}
// Slab intersection over the whole segment, including tangency and endpoints.
// Expanding boxes by body clearance prevents fast commands tunnelling through them.
export function segmentBoxHit(
  from: Vec3,
  to: Vec3,
  obstacle: Obstacle,
  clearance: Vec3 = [0, 0, 0],
): number | null {
  let enter = 0,
    exit = 1;
  for (let i = 0; i < 3; i++) {
    const low = obstacle.min[i]! - clearance[i]!,
      high = obstacle.max[i]! + clearance[i]!;
    const delta = to[i]! - from[i]!;
    if (Math.abs(delta) < 1e-9) {
      if (from[i]! < low || from[i]! > high) return null;
    } else {
      const a = (low - from[i]!) / delta,
        b = (high - from[i]!) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return null;
    }
  }
  return enter <= 1 && exit >= 0 ? Math.max(0, enter) : null;
}
export function blockingObstacle(
  from: Vec3,
  to: Vec3,
  clearance: Vec3 = [0, 0, 0],
) {
  let first: { obstacle: Obstacle; fraction: number; point: Vec3 } | null =
    null;
  for (const obstacle of STATIC_OBSTACLES) {
    const fraction = segmentBoxHit(from, to, obstacle, clearance);
    if (fraction !== null && (!first || fraction < first.fraction))
      first = {
        obstacle,
        fraction,
        point: from.map((v, i) => v + (to[i]! - v) * fraction) as Vec3,
      };
  }
  return first;
}
export const BODY_CLEARANCE = {
  rover: [1.15, 1.05, 1.15] as Vec3,
  drone: [1.45, 0.45, 1.45] as Vec3,
};
