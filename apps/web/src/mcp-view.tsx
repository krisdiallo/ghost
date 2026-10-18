import { bootstrapView, ThemeProvider, useToolContext } from "mcp-use/react";
import type { Observation } from "@ghost/shared";
import "./mcp-view.css";

function BodyView() {
  const view = useToolContext();
  if (view.status === "pending")
    return <div className="body-card">Opening body sensors…</div>;
  if (view.status === "error")
    return (
      <div className="body-card" role="alert">
        {view.error.message}
      </div>
    );
  const observation = view.toolOutput as Observation;
  const data =
    typeof view.meta?.frameData === "string" ? view.meta.frameData : null;
  return (
    <ThemeProvider>
      <article className="body-card">
        <header>
          <span className="ghost-word">GHOST</span>
          <span>BODY SENSOR / {observation.body.kind.toUpperCase()}</span>
        </header>
        <h2>
          {observation.body.label} <small>{observation.body.id}</small>
        </h2>
        {observation.frame && data ? (
          <>
            <div className="body-image">
              <img
                src={`data:image/jpeg;base64,${data}`}
                alt={`${observation.body.label} sensor frame received by the agent`}
              />
              <span>AGENT FRAME · REV {observation.frame.revision}</span>
            </div>
            <p>
              Same image returned to the agent ·{" "}
              {new Date(observation.frame.at).toISOString().slice(11, 19)} UTC ·
              640 × 360
            </p>
          </>
        ) : (
          <div className="body-empty">
            Structured observation. Ask the agent to observe with image: true
            for a camera frame.
          </div>
        )}
        <div className="body-readout">
          <span>X / {observation.body.position[0].toFixed(1)} m</span>
          <span>Y / {observation.body.position[1].toFixed(1)} m</span>
          <span>Z / {observation.body.position[2].toFixed(1)} m</span>
          <span>{observation.body.action?.status ?? "idle"}</span>
        </div>
        {observation.inspection && (
          <p className="body-result">
            {observation.inspection.objectId} /{" "}
            {observation.inspection.condition}
          </p>
        )}
        <footer>
          Captured simulation image. New observations produce new frames.
        </footer>
      </article>
    </ThemeProvider>
  );
}
bootstrapView({ default: BodyView });
