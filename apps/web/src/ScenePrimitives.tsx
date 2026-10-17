import { useEffect, useMemo } from "react";
import { CanvasTexture, Quaternion, Vector3 } from "three";
import type { Vec3 } from "@ghost/shared";
export function Box({
  position = [0, 0, 0],
  size,
  color,
  ...rest
}: {
  position?: Vec3;
  size: Vec3;
  color: string;
  rotation?: Vec3;
}) {
  return (
    <mesh position={position} castShadow receiveShadow {...rest}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.65} metalness={0.12} />
    </mesh>
  );
}
export function Cylinder({
  position,
  radius = 0.1,
  height,
  color,
  rotation,
}: {
  position: Vec3;
  radius?: number;
  height: number;
  color: string;
  rotation?: Vec3;
}) {
  return (
    <mesh position={position} rotation={rotation ?? [0, 0, 0]} castShadow>
      <cylinderGeometry args={[radius, radius, height, 20]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.25} />
    </mesh>
  );
}
export function Beam({
  from,
  to,
  width,
  color,
}: {
  from: Vec3;
  to: Vec3;
  width: number;
  color: string;
}) {
  const a = new Vector3(...from),
    b = new Vector3(...to),
    midpoint = a.clone().add(b).multiplyScalar(0.5);
  const q = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  return (
    <mesh position={midpoint} quaternion={q} castShadow>
      <boxGeometry args={[width, a.distanceTo(b), width]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.15} />
    </mesh>
  );
}
export function Text({
  text,
  position,
  color = "#8ba6a0",
  width = 3,
  floor = false,
  billboard = true,
}: {
  text: string;
  position: Vec3;
  color?: string;
  width?: number;
  floor?: boolean;
  billboard?: boolean;
}) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const measure = canvas.getContext("2d")!;
    measure.font = "600 64px monospace";
    canvas.width = Math.ceil(measure.measureText(text).width + 36);
    canvas.height = 100;
    const context = canvas.getContext("2d")!;
    context.fillStyle = color;
    context.font = "600 64px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    return {
      texture: new CanvasTexture(canvas),
      aspect: canvas.width / canvas.height,
    };
  }, [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  if (floor || !billboard)
    return (
      <mesh
        position={position}
        rotation={floor ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}
      >
        <planeGeometry args={[width, width / aspect]} />
        <meshBasicMaterial map={texture} transparent depthWrite={false} />
      </mesh>
    );
  return (
    <sprite position={position} scale={[width, width / aspect, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
export function Ring({
  position,
  radius,
  color,
  opacity = 1,
}: {
  position: Vec3;
  radius: number;
  color: string;
  opacity?: number;
}) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.035, radius, 64]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}
