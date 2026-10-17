import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { CanvasTexture, Group, Quaternion, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Body, ResourceKind, Snapshot, Vec3 } from "@ghost/shared";

export const BODY_COLORS: Record<ResourceKind, string> = {
  camera: "#a9b7ff",
  rover: "#bcf3d8",
  arm: "#ffad75",
  drone: "#99d8fc",
};
const metal = "#d9e3dc",
  dark = "#253b3b";
function Box({
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
function Cylinder({
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
function Beam({
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
function Text({
  text,
  position,
  color = "#8ba6a0",
  width = 3,
  floor = false,
}: {
  text: string;
  position: Vec3;
  color?: string;
  width?: number;
  floor?: boolean;
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
  if (floor)
    return (
      <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
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
function Ring({
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
function Rover() {
  return (
    <>
      <Box size={[1.15, 0.38, 1.65]} color={metal} />
      <Box position={[0, 0.25, -0.15]} size={[0.9, 0.3, 1]} color="#f2f1e7" />
      <Box position={[0, 0.3, 0.64]} size={[0.8, 0.14, 0.07]} color="#243d3c" />
      {[-1, 1].flatMap((x) =>
        [-0.55, 0.55].map((z) => (
          <Cylinder
            key={`${x}/${z}`}
            position={[x * 0.64, -0.1, z]}
            radius={0.28}
            height={0.22}
            color="#182b2c"
            rotation={[0, 0, Math.PI / 2]}
          />
        )),
      )}
      <Cylinder
        position={[0, 0.6, 0.15]}
        height={0.55}
        radius={0.055}
        color={dark}
      />
      <Box position={[0, 0.9, 0.15]} size={[0.38, 0.2, 0.25]} color={dark} />
      <Box position={[0, 0.9, 0.29]} size={[0.2, 0.07, 0.02]} color="#a3fbd4" />
      <Box
        position={[0, 0.13, 0.84]}
        size={[0.65, 0.045, 0.03]}
        color="#c5ffe0"
      />
    </>
  );
}
function Drone({ airborne }: { airborne: boolean }) {
  const rotors = useRef<Group>(null);
  useFrame((_, delta) => {
    if (rotors.current)
      for (const child of rotors.current.children)
        child.rotation.y += delta * (airborne ? 40 : 1);
  });
  return (
    <>
      <Box size={[0.65, 0.22, 0.7]} color="#e0ebe7" />
      <Box position={[0, 0.15, 0]} size={[0.35, 0.08, 0.4]} color="#95d4ed" />
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <group key={`${x}/${z}`}>
            <Beam
              from={[0, 0, 0]}
              to={[x * 0.7, 0, z * 0.65]}
              width={0.12}
              color={dark}
            />
            <Cylinder
              position={[x * 0.7, 0.08, z * 0.65]}
              radius={0.12}
              height={0.16}
              color={dark}
            />
            <Ring
              position={[x * 0.7, 0.16, z * 0.65]}
              radius={0.48}
              color="#9bb5b6"
              opacity={0.7}
            />
          </group>
        )),
      )}
      <group ref={rotors}>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <group key={`${x}/${z}`} position={[x * 0.7, 0.18, z * 0.65]}>
              <Box size={[0.85, 0.025, 0.09]} color="#a3c6d1" />
              <Box size={[0.09, 0.025, 0.85]} color="#a3c6d1" />
            </group>
          )),
        )}
      </group>
      <Cylinder
        position={[0, -0.2, 0.2]}
        height={0.15}
        radius={0.13}
        color={dark}
      />
      <Beam
        from={[-0.35, -0.1, -0.3]}
        to={[-0.45, -0.4, 0.4]}
        width={0.06}
        color={dark}
      />
      <Beam
        from={[0.35, -0.1, -0.3]}
        to={[0.45, -0.4, 0.4]}
        width={0.06}
        color={dark}
      />
    </>
  );
}
function Camera({ pan, tilt }: { pan: number; tilt: number }) {
  return (
    <>
      <Cylinder
        position={[0, -1.3, 0]}
        radius={0.11}
        height={2.6}
        color="#839f9a"
      />
      <Cylinder
        position={[0, -2.47, 0]}
        radius={0.4}
        height={0.15}
        color={dark}
      />
      <group rotation={[0, (pan * Math.PI) / 180, 0]}>
        <group rotation={[(-tilt * Math.PI) / 180, 0, 0]}>
          <Box size={[0.65, 0.42, 0.95]} color={metal} />
          <Box
            position={[0, 0.23, 0.03]}
            size={[0.8, 0.06, 1.1]}
            color="#ebf0e8"
          />
          <Cylinder
            position={[0, 0, 0.52]}
            radius={0.2}
            height={0.2}
            color={dark}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <mesh position={[0, 0, 0.63]}>
            <circleGeometry args={[0.13, 24]} />
            <meshStandardMaterial
              color="#94a7fb"
              emissive="#94a7fb"
              emissiveIntensity={0.4}
            />
          </mesh>
          <mesh position={[0, 0, 2.3]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[1.6, 3.5, 4, 1, true]} />
            <meshBasicMaterial
              color="#a3b1ff"
              transparent
              opacity={0.055}
              depthWrite={false}
              side={2}
            />
          </mesh>
        </group>
      </group>
    </>
  );
}
function Arm({ preset }: { preset: Body["preset"] }) {
  const end: Vec3 =
    preset === "reach"
      ? [-2, 0.3, 0]
      : preset === "drop"
        ? [2, 0.35, 2]
        : [0, 1.8, 0];
  const elbow: Vec3 =
    preset === "reach"
      ? [-0.9, 2.1, 0]
      : preset === "drop"
        ? [1.2, 2.1, 0.7]
        : [0.75, 2.6, 0];
  return (
    <>
      <Cylinder
        position={[0, -0.2, 0]}
        height={0.5}
        radius={0.65}
        color={dark}
      />
      <Cylinder
        position={[0, 0.1, 0]}
        height={0.35}
        radius={0.45}
        color="#f0a06d"
      />
      <Beam from={[0, 0.2, 0]} to={elbow} width={0.36} color="#f4a573" />
      <Beam from={elbow} to={end} width={0.27} color="#df8a56" />
      <mesh position={elbow} castShadow>
        <sphereGeometry args={[0.24, 16, 16]} />
        <meshStandardMaterial color={dark} />
      </mesh>
      <group position={end}>
        <Box size={[0.45, 0.17, 0.3]} color={dark} />
        <Box
          position={[-0.2, -0.18, 0]}
          size={[0.07, 0.28, 0.25]}
          color={metal}
        />
        <Box
          position={[0.2, -0.18, 0]}
          size={[0.07, 0.28, 0.25]}
          color={metal}
        />
      </group>
    </>
  );
}
function GhostSignal({ position }: { position: Vec3 }) {
  const sprite = useRef<import("three").Sprite>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#baf7cf";
    ctx.shadowColor = "#baf7cf";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(24, 104);
    ctx.lineTo(24, 52);
    ctx.arc(64, 52, 40, Math.PI, 0);
    ctx.lineTo(104, 104);
    ctx.lineTo(84, 92);
    ctx.lineTo(64, 104);
    ctx.lineTo(44, 92);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#193426";
    ctx.beginPath();
    ctx.ellipse(49, 54, 5, 9, 0, 0, Math.PI * 2);
    ctx.ellipse(79, 54, 5, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    return new CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(({ clock }) => {
    if (sprite.current)
      sprite.current.position.set(
        position[0],
        position[1] + Math.sin(clock.elapsedTime * 2) * 0.1,
        position[2],
      );
  });
  return (
    <sprite ref={sprite} position={position} scale={[0.75, 0.75, 1]}>
      <spriteMaterial map={texture} transparent depthTest={false} />
    </sprite>
  );
}
function BodyMesh({
  body,
  selected,
  onSelect,
}: {
  body: Body;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const group = useRef<Group>(null);
  const initialPosition = useRef<Vec3>([...body.position]);
  const color = BODY_COLORS[body.kind];
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.position.lerp(
      new Vector3(...body.position),
      1 - Math.exp(-delta * 18),
    );
    if (body.kind !== "camera" && body.kind !== "arm")
      group.current.rotation.y = body.heading;
  });
  return (
    <>
      <group
        ref={group}
        position={initialPosition.current}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(body.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        {body.kind === "rover" ? (
          <Rover />
        ) : body.kind === "drone" ? (
          <Drone airborne={body.airborne} />
        ) : body.kind === "camera" ? (
          <Camera pan={body.pan} tilt={body.tilt} />
        ) : (
          <Arm preset={body.preset} />
        )}
      </group>
      <Ring
        position={[body.position[0], 0.035, body.position[2]]}
        radius={selected ? 1.25 : 1}
        color={color}
        opacity={selected ? 1 : 0.25}
      />
      {body.lease && (
        <GhostSignal
          position={[
            body.position[0],
            body.position[1] + (body.kind === "arm" ? 4 : 2.5),
            body.position[2],
          ]}
        />
      )}
      {body.lease && (
        <Ring
          position={[body.position[0], 0.04, body.position[2]]}
          radius={1.4}
          color="#9cf2cf"
          opacity={0.5}
        />
      )}
      <Text
        text={`${body.label.toUpperCase()}${body.lease ? " •" : ""}`}
        position={[
          body.position[0],
          body.position[1] + (body.kind === "arm" ? 3.2 : 1.7),
          body.position[2],
        ]}
        color={selected ? "#f0faf2" : color}
        width={2.1}
      />
      {body.action?.status === "running" && body.action.target && (
        <>
          <Ring
            position={[body.action.target[0], 0.05, body.action.target[2]]}
            radius={0.5}
            color={color}
          />
          <Beam
            from={[body.position[0], 0.045, body.position[2]]}
            to={[body.action.target[0], 0.045, body.action.target[2]]}
            width={0.035}
            color={color}
          />
        </>
      )}
    </>
  );
}
function Rack({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      {[-2, 2].flatMap((x) =>
        [-0.6, 0.6].map((z) => (
          <Box
            key={`${x}/${z}`}
            position={[x, 1.65, z]}
            size={[0.1, 3.3, 0.1]}
            color="#51645f"
          />
        )),
      )}
      {[0.2, 1.65, 3.1].map((y) => (
        <group key={y}>
          <Box position={[0, y, 0]} size={[4.2, 0.13, 1.4]} color="#9a7f55" />
          {[-1.4, 0, 1.4].map((x, i) => (
            <group key={x}>
              <Box
                position={[x, y + 0.5, 0]}
                size={[1.05, 0.9, 1]}
                color={i === 1 ? "#8d9c8d" : "#ac9976"}
              />
              <Box
                position={[x, y + 0.5, 0.505]}
                size={[0.06, 0.9, 0.015]}
                color="#d1bd95"
              />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}
function Floor({
  navigate,
}: {
  navigate: ((x: number, z: number) => void) | null;
}) {
  const [point, setPoint] = useState<Vec3 | null>(null);
  return (
    <>
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          if (navigate) setPoint([e.point.x, 0.04, e.point.z]);
        }}
        onPointerOut={() => setPoint(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (navigate && e.delta < 5) {
            e.stopPropagation();
            navigate(
              Math.round(e.point.x * 10) / 10,
              Math.round(e.point.z * 10) / 10,
            );
          }
        }}
      >
        <planeGeometry args={[20, 14]} />
        <meshStandardMaterial color="#61716b" roughness={0.92} />
      </mesh>
      <Box
        position={[0, -0.22, 0]}
        size={[20.15, 0.4, 14.15]}
        color="#314740"
      />
      <gridHelper
        args={[20, 20, "#819289", "#6c7c73"]}
        position={[0, 0.015, 0]}
        scale={[1, 1, 0.7]}
      />
      {[-1, 1].map((x) => (
        <Box
          key={x}
          position={[x * 9.6, 0.02, 0]}
          size={[0.05, 0.025, 13]}
          color="#c3b97a"
        />
      ))}
      {[-1, 1].map((z) => (
        <Box
          key={z}
          position={[0, 0.02, z * 6.5]}
          size={[19.2, 0.025, 0.05]}
          color="#c3b97a"
        />
      ))}
      <Box
        position={[0, 0.025, 3.8]}
        size={[17, 0.02, 0.045]}
        color="#acb39a"
      />
      {Array.from({ length: 16 }, (_, i) => (
        <Box
          key={i}
          position={[-8 + i, 0.03, 3.6]}
          size={[0.4, 0.025, 0.05]}
          color="#acb39a"
        />
      ))}
      <mesh position={[6, 0.025, 2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.4, 2.6]} />
        <meshBasicMaterial color="#a4ddbb" transparent opacity={0.18} />
      </mesh>
      <Ring position={[6, 0.04, 2]} radius={1.1} color="#b8e3b7" />
      <Text
        text="DISPATCH"
        position={[6, 0.05, 3.6]}
        floor
        width={2.4}
        color="#d1e5c3"
      />
      <Text
        text="G H O S T  /  W - 0 1"
        position={[-2, 0.04, 5.5]}
        floor
        width={7}
        color="#b3c0af"
      />
      <Text text="STORAGE / A" position={[-4, 0.04, -3.1]} floor width={3} />
      <Text text="INSPECTION" position={[1, 0.04, 2.5]} floor width={3} />
      {point && navigate && (
        <Ring position={point} radius={0.4} color="#d9ffe1" />
      )}
    </>
  );
}
function Controls({ focus, view }: { focus: Vec3 | null; view: number }) {
  const { camera, gl } = useThree();
  const controls = useMemo(
    () => new OrbitControls(camera, gl.domElement),
    [camera, gl],
  );
  useEffect(() => {
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.18;
    controls.minDistance = 5;
    controls.maxDistance = 34;
    controls.target.set(0, 0, 0);
    controls.update();
    return () => controls.dispose();
  }, [controls]);
  useEffect(() => {
    if (focus) {
      controls.target.set(focus[0], 0.5, focus[2]);
      camera.position.set(focus[0] + 7, 8, focus[2] + 8);
      controls.update();
    }
  }, [focus, camera, controls]);
  useEffect(() => {
    camera.position.set(
      view % 2 ? 0.1 : 15,
      view % 2 ? 23 : 15,
      view % 2 ? 0.1 : 18,
    );
    controls.target.set(0, 0, 0);
    controls.update();
  }, [view, camera, controls]);
  useFrame(() => controls.update());
  return null;
}
class WebGLErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <strong>3D view unavailable</strong>
        <p>
          Enable WebGL to explore the warehouse. Fleet controls and live
          telemetry still work below.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function Warehouse({
  snapshot,
  selected,
  onSelect,
  navigate,
  focus,
  view,
}: {
  snapshot: Snapshot;
  selected: string;
  onSelect: (id: string) => void;
  navigate: ((x: number, z: number) => void) | null;
  focus: Vec3 | null;
  view: number;
}) {
  return (
    <WebGLErrorBoundary>
      <Canvas
        shadows
        dpr={[1, 1.6]}
        camera={{ position: [15, 15, 18], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
        fallback={
          <div className="scene-fallback">
            WebGL is unavailable. Use the fleet controls to continue.
          </div>
        }
      >
        <color attach="background" args={["#142622"]} />
        <fog attach="fog" args={["#142622", 32, 65]} />
        <ambientLight intensity={1.6} />
        <hemisphereLight args={["#ddf5eb", "#455044", 1.8]} />
        <directionalLight
          position={[-5, 14, 7]}
          intensity={3}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-15}
          shadow-camera-right={15}
          shadow-camera-top={15}
          shadow-camera-bottom={-15}
          shadow-bias={-0.0004}
        />
        <Suspense fallback={null}>
          <Floor navigate={navigate} />
          <Rack position={[-3.4, 0, -5.4]} />
          <Rack position={[3.4, 0, -5.4]} />
          <Box
            position={[-9.8, 0.6, -1.8]}
            size={[0.18, 1.2, 9.8]}
            color="#52665b"
          />
          <Box
            position={[0, 0.45, -6.9]}
            size={[20, 0.9, 0.15]}
            color="#52665b"
          />
          {[-8, 8].map((x) => (
            <group key={x}>
              <Cylinder
                position={[x, 0.4, 5.8]}
                height={0.8}
                radius={0.12}
                color="#d7b97c"
              />
              <Cylinder
                position={[x, 0.5, 5.8]}
                height={0.16}
                radius={0.13}
                color={dark}
              />
            </group>
          ))}
          {snapshot.objects.map((object) => (
            <group key={object.id} position={object.position}>
              <Box
                size={[0.95, 1, 0.95]}
                color={object.id === "crate-07" ? "#d6ba7f" : "#9da88e"}
              />
              <Box
                position={[0, 0.015, 0.485]}
                size={[0.12, 1, 0.015]}
                color="#efe0b0"
              />
              <Box
                position={[0, 0.51, 0]}
                size={[0.12, 0.02, 0.96]}
                color="#efe0b0"
              />
              <Box
                position={[0.27, 0.12, 0.49]}
                size={[0.25, 0.22, 0.02]}
                color="#eeeddb"
              />
              {object.id === "crate-07" && (
                <Text
                  text="CARGO 07"
                  position={[0, 1.3, 0]}
                  color="#ffdf91"
                  width={2}
                />
              )}
            </group>
          ))}
          {snapshot.bodies.map((body) => (
            <BodyMesh
              key={body.id}
              body={body}
              selected={selected === body.id}
              onSelect={onSelect}
            />
          ))}
        </Suspense>
        <Controls focus={focus} view={view} />
      </Canvas>
    </WebGLErrorBoundary>
  );
}
