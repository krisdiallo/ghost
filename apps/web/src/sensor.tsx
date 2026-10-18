import { createRoot } from "react-dom/client";
import type { Snapshot } from "@ghost/shared";
import { Warehouse } from "./Warehouse";

const root = createRoot(document.getElementById("root")!);
declare global {
  interface Window {
    ghostSensor: (snapshot: Snapshot, resourceId: string) => Promise<string>;
  }
}
// Only the server supplies frozen snapshots. This page never fetches world state.
window.ghostSensor = (snapshot, resourceId) =>
  new Promise((resolve) => {
    root.render(
      <Warehouse
        snapshot={snapshot}
        selected={resourceId}
        sensorId={resourceId}
        onSelect={() => {}}
        navigate={null}
        focus={null}
        view="mission"
        capture={resolve}
      />,
    );
  });
