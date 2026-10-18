import { useLayoutEffect, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import { RACK_BAYS, FREIGHT_STACKS, STRUCTURAL_COLUMNS } from "@ghost/shared";
import type { Vec3 } from "@ghost/shared";
import { Beam, Box, Cylinder, Text } from "./ScenePrimitives";

type Part = { at: Vec3; size: Vec3; color: string };
// Static obstacle positions are shared with the authority. Instancing keeps hundreds of
// repeated structural/pallet parts in a handful of draw calls on mobile GPUs.
export function Parts({
  parts,
  glow = false,
  shadows = true,
}: {
  parts: Part[];
  glow?: boolean;
  shadows?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const object = new Object3D(),
      color = new Color();
    parts.forEach((part, index) => {
      object.position.set(...part.at);
      object.scale.set(...part.size);
      object.updateMatrix();
      mesh.current!.setMatrixAt(index, object.matrix);
      mesh.current!.setColorAt(index, color.set(part.color));
    });
    mesh.current!.instanceMatrix.needsUpdate = true;
    mesh.current!.instanceColor!.needsUpdate = true;
    mesh.current!.computeBoundingSphere();
  }, [parts]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, parts.length]}
      castShadow={shadows}
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        roughness={glow ? 0.35 : 0.75}
        metalness={glow ? 0.1 : 0.18}
        emissive={glow ? "#b5e6ec" : "#000000"}
        emissiveIntensity={glow ? 2 : 0}
      />
    </instancedMesh>
  );
}
const frame: Part[] = [],
  stock: Part[] = [],
  accents: Part[] = [],
  lights: Part[] = [];
const add = (list: Part[], at: Vec3, size: Vec3, color: string) =>
  list.push({ at, size, color });
const steel = "#354b59",
  rail = "#687f8a",
  amber = "#d4a451";
// Sixteen four-tier storage bays; the front center stays open for the mission.
const bays = RACK_BAYS;
for (const [bay, [x, z]] of bays.entries()) {
  for (const dx of [-3.65, 3.65])
    for (const dz of [-1.05, 1.05])
      add(frame, [x + dx, 4, z + dz], [0.16, 8, 0.16], steel);
  for (const y of [0.3, 2.3, 4.3, 6.3]) {
    add(frame, [x, y, z], [7.5, 0.14, 2.3], rail);
    add(accents, [x, y + 0.07, z + 1.18], [7.5, 0.12, 0.08], amber);
    for (const [slot, dx] of [-2.4, 0, 2.4].entries()) {
      const shade = ["#9f8e71", "#c7af85", "#91a496", "#b8aa91"][
        (bay + slot + y) % 4 | 0
      ]!;
      add(stock, [x + dx, y + 0.18, z], [2.28, 0.18, 1.9], "#6c5e48");
      add(stock, [x + dx, y + 1, z], [2.15, 1.5, 1.8], shade);
      add(accents, [x + dx, y + 1, z + 0.91], [0.12, 1.5, 0.025], "#ded0ac");
      add(
        accents,
        [x + dx + 0.55, y + 1.1, z + 0.93],
        [0.44, 0.3, 0.025],
        "#e2e2d3",
      );
    }
  }
  // The highest boxes are exposed; there is no shelf or cap above them.
}
// A high north wall, side wall, loading doors and a mezzanine establish the scale.
add(frame, [0, 7.2, -33.9], [64, 14.4, 0.3], "#394e5a");
add(frame, [-31.9, 6.7, -12], [0.25, 13.4, 44], "#3f5661");
add(accents, [-31.7, 6.7, -12], [0.07, 0.3, 44], "#89bcb5");
add(frame, [31.9, 0.65, -12], [0.2, 1.3, 44], "#3b515b");
for (const x of [-25, -15, -5, 5, 15, 25]) {
  add(frame, [x, 2.6, -33.65], [8, 5.2, 0.3], "#1c303c");
  for (let row = 0; row < 16; row++)
    add(
      accents,
      [x, 0.35 + row * 0.29, -33.44],
      [7.1, 0.24, 0.07],
      row % 2 ? "#546976" : "#4a606d",
    );
  add(lights, [x, 5.5, -33.45], [7.8, 0.13, 0.1], "#f4c672");
  for (const dx of [-4.25, 4.25])
    add(accents, [x + dx, 0.8, -32.9], [0.18, 1.6, 0.18], amber);
}
for (const [x, z] of STRUCTURAL_COLUMNS) {
  add(frame, [x, 7.2, z], [0.4, 14.4, 0.4], steel);
  add(frame, [x, 0.35, z], [0.9, 0.7, 0.9], "#81908c");
  add(accents, [x, 1.2, z + 0.22], [0.45, 1.2, 0.05], amber);
}
for (const z of [-31, -19, -7]) {
  add(frame, [0, 14.2, z], [62.4, 0.28, 0.3], steel);
  add(frame, [0, 13, z], [62.4, 0.2, 0.22], steel);
  for (const x of [-22, -10, 2, 14, 26])
    add(lights, [x, 13.2, z + 0.3], [5.5, 0.1, 0.18], "#e2f5f0");
}
for (const x of [-31, 31]) add(frame, [x, 14.2, -12], [0.28, 0.3, 44], steel);
// Mezzanine and control booth on the west side, with a visible access stair.
add(frame, [-25, 6, -29.7], [12.5, 0.35, 7.4], "#6e8289");
add(frame, [-25, 7.7, -30.1], [11, 3.1, 6], "#526d78");
add(accents, [-25, 8.1, -27.04], [10.6, 1.7, 0.08], "#9cbeb9");
for (const x of [-29.6, -27.3, -25, -22.7, -20.4])
  add(frame, [x, 8.1, -26.95], [0.1, 1.85, 0.12], steel);
add(frame, [-25, 9.4, -30.1], [11.5, 0.18, 6.3], steel);
for (let i = 0; i < 17; i++)
  add(frame, [-29.3, 0.35 * i + 0.2, -18.1 - i * 0.5], [2.2, 0.18, 0.54], rail);
// Freight waiting at the edges of the open forecourt.
for (const [x, z] of FREIGHT_STACKS) {
  add(stock, [x, 0.13, z], [2.8, 0.26, 2.5], "#6c5e48");
  add(stock, [x, 1, z], [2.5, 1.5, 2.2], x < 0 ? "#9aab9f" : "#b6a17e");
  add(accents, [x, 1, z + 1.12], [0.15, 1.5, 0.03], "#e2cfa4");
}
// Safety lanes, cross-aisles, and perimeter markings share one instanced batch.
for (const x of [-30, -10, 10, 30])
  for (let z = -32; z < 9; z += 2)
    add(accents, [x, 0.025, z], [0.08, 0.02, 0.85], "#c7b778");
for (const z of [-32.8, 9])
  add(accents, [0, 0.025, z], [62.5, 0.02, 0.09], "#c7b778");
for (const x of [-31.3, 31.3])
  add(accents, [x, 0.025, -12], [0.09, 0.02, 42], "#c7b778");
for (const z of [-10.5, 6.9])
  add(accents, [0, 0.025, z], [59, 0.02, 0.06], "#9eaeab");

export function IndustrialHall() {
  return (
    <>
      <Parts parts={frame} />
      <Parts parts={stock} shadows={false} />
      <Parts parts={accents} shadows={false} />
      <Parts parts={lights} glow shadows={false} />
      {[-31, -19, -7].flatMap((z) =>
        Array.from({ length: 12 }, (_, i) => (
          <Beam
            key={`${z}/${i}`}
            from={[-30 + i * 5, i % 2 ? 14.2 : 13, z]}
            to={[-25 + i * 5, i % 2 ? 13 : 14.2, z]}
            width={0.12}
            color={rail}
          />
        )),
      )}
      <Beam
        from={[-30.4, 1.1, -18]}
        to={[-30.4, 6.8, -26.5]}
        width={0.08}
        color={amber}
      />
      {[-23, 21].map((x) => (
        <Cylinder
          key={x}
          position={[x, 13.6, -12]}
          radius={0.28}
          height={40}
          color="#70858d"
          rotation={[Math.PI / 2, 0, 0]}
        />
      ))}
      <Text
        text="G H O S T"
        position={[4, 11.7, -33.65]}
        width={17}
        color="#c9e5dd"
        billboard={false}
      />
      <Text
        text="EMBODIMENT LOGISTICS / TERMINAL 01"
        position={[4, 9.7, -33.6]}
        width={17}
        color="#9cb3bd"
        billboard={false}
      />
      {[-25, -15, -5, 5, 15, 25].map((x, i) => (
        <Text
          key={x}
          text={`DOCK 0${i + 1}`}
          position={[x, 4.8, -33.34]}
          width={3.1}
          color="#f1cf87"
          billboard={false}
        />
      ))}
      <Text
        text="RESERVE STORAGE"
        position={[0, 0.045, -10.4]}
        width={14}
        floor
        color="#bac9c5"
      />
      <Text
        text="INBOUND"
        position={[-22, 0.045, 8.2]}
        width={7}
        floor
        color="#d7c797"
      />
      <Text
        text="OUTBOUND"
        position={[23, 0.045, 8.2]}
        width={7}
        floor
        color="#d7c797"
      />
      <Text
        text="OPERATIONS"
        position={[-25, 9.8, -27]}
        width={4}
        color="#d5ece4"
      />
      <Box
        position={[0, -0.65, -12]}
        size={[64.4, 1.2, 44.4]}
        color="#263b47"
      />
    </>
  );
}
