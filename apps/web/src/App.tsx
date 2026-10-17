import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { DEMO_RESOURCES } from "@ghost/shared";

export function App() {
  const [selected, setSelected] = useState(DEMO_RESOURCES[0]!.id);
  const resource = DEMO_RESOURCES.find((item) => item.id === selected)!;

  return (
    <main>
      <header><span className="eyebrow">YC HACKATHON · SCAFFOLD</span><h1>ghost</h1><p>Any agent. Any body.</p></header>
      <section className="workspace" aria-label="Warehouse preview">
        <div className="scene" role="img" aria-label="Placeholder 3D warehouse with four resource markers; use the buttons to select a resource.">
          <Canvas camera={{ position: [9, 9, 12], fov: 45 }}>
            <color attach="background" args={["#151d29"]} />
            <ambientLight intensity={1.5} />
            <directionalLight position={[4, 8, 4]} intensity={3} />
            <gridHelper args={[12, 12, "#4b6279", "#2a3a4a"]} />
            {DEMO_RESOURCES.map((body) => (
              <mesh key={body.id} position={body.position} onClick={(event) => { event.stopPropagation(); setSelected(body.id); }}>
                <boxGeometry args={[1, body.kind === "arm" ? 1.6 : 0.6, 1]} />
                <meshStandardMaterial color={selected === body.id ? "#a7f3d0" : "#728aa5"} />
              </mesh>
            ))}
          </Canvas>
        </div>
        <aside>
          <h2>Available body types</h2>
          <p className="muted">Static preview · server connection pending</p>
          <div className="resources">
            {DEMO_RESOURCES.map((body) => (
              <button key={body.id} aria-pressed={selected === body.id} onClick={() => setSelected(body.id)}>{body.label}<small>{body.id}</small></button>
            ))}
          </div>
          <p aria-live="polite">Selected: <strong>{resource.label}</strong></p>
          <p className="muted">Possession, observation, and controls come next.</p>
        </aside>
      </section>
    </main>
  );
}
