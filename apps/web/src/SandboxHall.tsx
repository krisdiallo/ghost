import { useMemo } from "react";
import type { Obstacle, Vec3 } from "@ghost/shared";
import { Parts } from "./IndustrialHall";

// The same edited solid envelopes drive the scene, collision checks and sensing.
// Instancing keeps larger candidate layouts usable on phone GPUs.
export function SandboxHall({ obstacles }: { obstacles: Obstacle[] }) {
  const parts = useMemo(() => {
    const parts: { at: Vec3; size: Vec3; color: string }[] = [];
    const add = (at: Vec3, size: Vec3, color: string) =>
      parts.push({ at, size, color });
    for (const o of obstacles) {
      const size = o.max.map((v, i) => v - o.min[i]!) as Vec3;
      const [cx, cy, cz] = o.min.map((v, i) => (v + o.max[i]!) / 2) as Vec3;
      if (o.kind !== "rack") {
        add(
          [cx, cy, cz],
          size,
          o.kind === "freight"
            ? "#9f8e71"
            : o.kind === "column"
              ? "#587180"
              : "#354b59",
        );
        continue;
      }
      const [w, h, d] = size;
      for (const x of [-1, 1])
        for (const z of [-1, 1])
          add(
            [cx + x * (w / 2 - 0.08), cy, cz + z * (d / 2 - 0.08)],
            [0.16, h, 0.16],
            "#435d6d",
          );
      for (let tier = 0; tier < 4; tier++) {
        const base = o.min[1] + (tier * h) / 4;
        add([cx, base + 0.12, cz], [w, 0.14, d], "#6a818c");
        add([cx, base + 0.2, cz + d / 2], [w, 0.12, 0.05], "#e2b66c");
        for (const slot of [-1, 0, 1]) {
          const x = cx + (slot * w) / 3,
            y = base + h / 8 + 0.175;
          add(
            [x, y, cz],
            [
              Math.max(0.03, w / 3 - 0.14),
              Math.max(0.03, h / 4 - 0.35),
              Math.max(0.03, d - 0.22),
            ],
            tier % 2 ? "#b6a483" : "#8e9f91",
          );
          add(
            [x + w / 12, y, cz + d / 2 - 0.09],
            [0.32, 0.22, 0.025],
            "#e1dfd0",
          );
        }
      }
    }
    for (const z of [-31, -19, -7, 8]) {
      add([0, 14.1, z], [62, 0.22, 0.22], "#4e6978");
      for (const x of [-24, -8, 8, 24])
        add([x, 13.2, z], [4, 0.12, 0.25], "#dfede6");
    }
    return parts;
  }, [obstacles]);
  return <Parts parts={parts} />;
}
