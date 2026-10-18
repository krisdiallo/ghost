import type { OperationsInput, OperationsState, Snapshot } from "@ghost/shared";
import { useState } from "react";
import { tool } from "./api";
import { BodyIcon } from "./icons";
export function FleetOperations({
  snapshot,
  disabled,
  placing,
  setPlacing,
  focus,
  leaseId,
  compact = false,
}: {
  snapshot: Snapshot | null;
  disabled: boolean;
  placing: boolean;
  setPlacing: (v: boolean) => void;
  focus: (id: string) => void;
  leaseId?: string | undefined;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const ops = snapshot?.operations;
  const incident = ops?.incidents.find((i) => !i.resolvedAt);
  const previous = ops?.incidents.find((i) => i.resolvedAt);
  async function run(input: OperationsInput) {
    setBusy(true);
    setError("");
    try {
      await tool<OperationsState>("operations", input);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const prompt =
    "There seems to be an incident in the warehouse. Use GHOST to investigate it, possess the affected body, inspect its actual camera image, clear the simulated obstruction, verify the route and return the device to local autonomy. Then confirm work has resumed.";
  return (
    <section
      className={
        "fleet-ops panel " +
        (incident ? "has-incident" : "") +
        (compact ? " compact" : "")
      }
      aria-label="Live fleet operations"
    >
      <div className="fleet-ops-header">
        <div>
          <span className="eyebrow">LIVE OPERATIONS / LOCAL AUTONOMY</span>
          <h2>
            {incident
              ? "Routine interrupted. Your ghost is needed."
              : ops?.running
                ? "The warehouse is working."
                : "Start the working warehouse."}
          </h2>
          <p>
            Devices run assigned jobs. Your agent takes over when something
            needs judgment.
          </p>
        </div>
        <div className="fleet-ops-actions">
          <button
            disabled={disabled || busy}
            onClick={() =>
              void run({ action: ops?.running ? "pause" : "start" })
            }
          >
            {ops?.running ? "Pause operations" : "Start operations"}
          </button>
          <button
            disabled={disabled || busy || !ops?.running}
            onClick={() => {
              focus("rover-01");
              void run({ action: "place_box" });
            }}
          >
            Drop box ahead of Scout
          </button>
          <button
            aria-pressed={placing}
            disabled={disabled || busy}
            onClick={() => setPlacing(!placing)}
          >
            {placing ? "Cancel box placement" : "Place a box on the floor"}
          </button>
          <a href="#lab">Experiment lab ↗</a>
        </div>
      </div>
      <div className="fleet-job-grid">
        {ops?.jobs.map((j) => {
          const b = snapshot?.bodies.find((b) => b.id === j.resourceId);
          return (
            <button
              key={j.resourceId}
              className={"fleet-job " + j.status}
              onClick={() => focus(j.resourceId)}
            >
              <span className="fleet-job-icon">
                {b && <BodyIcon kind={b.kind} />}
              </span>
              <div>
                <strong>
                  {b?.label}{" "}
                  <i>
                    {j.status === "operator"
                      ? "Operator control"
                      : j.status === "working"
                        ? "Working"
                        : j.status === "blocked"
                          ? "Needs assistance"
                          : j.status === "complete"
                            ? "Job complete"
                            : "Paused"}
                  </i>
                </strong>
                <span>{j.label}</span>
                <small>
                  {j.step} · {j.cycles} completed cycles
                </small>
              </div>
            </button>
          );
        })}
      </div>
      {placing && (
        <p className="ops-placement" role="status">
          Click clear floor space in the warehouse or map to place a simulated
          box. Moving devices check it before continuing.
        </p>
      )}
      {incident ? (
        <div className="ops-incident" role="alert">
          <div>
            <span className="ops-beacon" />
            <strong>INCIDENT · {incident.code}</strong>
            <span>{incident.message}</span>
            <span>{incident.resolution}</span>
            <small>
              {incident.id} ·{" "}
              {snapshot?.bodies.find((b) => b.id === incident.resourceId)?.lease
                ?.owner ?? "Waiting for operator"}
            </small>
          </div>
          <div className="ops-recovery">
            <button onClick={() => focus(incident.resourceId)}>
              Focus affected device
            </button>
            <button
              onClick={() => {
                void navigator.clipboard
                  .writeText(prompt)
                  .then(() => setCopied(true));
              }}
            >
              {copied ? "Prompt copied" : "Copy ChatGPT recovery prompt"}
            </button>
            {leaseId && (
              <>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run({
                      action: "clear_box",
                      incidentId: incident.id,
                      leaseId,
                    })
                  }
                >
                  Clear simulated obstruction
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run({
                      action: "resume",
                      incidentId: incident.id,
                      leaseId,
                    })
                  }
                >
                  Return to autonomy
                </button>
              </>
            )}
          </div>
        </div>
      ) : previous ? (
        <div className="ops-restored" role="status">
          ✓ Incident resolved · Route verified. Scout returned to its assigned
          job. <a href="#lab">Test an improved workflow ↗</a>
        </div>
      ) : (
        <p className="ops-hint">
          Try it: place a box in Scout’s path. Watch the stop, then ask ChatGPT
          to investigate. The agent takes control through MCP.
        </p>
      )}
      {error && (
        <p className="ops-error" role="alert">
          {error}
        </p>
      )}
      <p className="ops-disclosure">
        Local jobs use deterministic task loops and real simulation commands.
        External ChatGPT supplies incident reasoning. Box clearance is a
        simulated operator action.
      </p>
    </section>
  );
}
