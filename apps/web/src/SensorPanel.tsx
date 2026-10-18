import { useEffect, useState } from "react";
import type { Body, Observation, SensorFrame } from "@ghost/shared";

export function SensorPanel({
  body,
  leaseId,
  live,
  compact = false,
}: {
  body: Body;
  leaseId?: string | undefined;
  live: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const [frame, setFrame] = useState<SensorFrame | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !live) return;
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/frames/${body.id}`);
        if (!response.ok) return;
        const result = (await response.json()) as { frame: SensorFrame | null };
        if (active) setFrame(result.frame);
      } catch {
        /* Connection status is shown by the main console. */
      }
    }
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [body.id, open, live]);
  async function capture() {
    if (!leaseId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/tools/observe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId, image: true }),
      });
      const result = (await response.json()) as Observation & {
        message?: string;
      };
      if (!response.ok)
        throw new Error(result.message ?? "Capture failed. Retry.");
      setFrame(result.frame ?? null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Capture failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={`sensor-panel ${compact ? "sensor-floating" : ""}`}
      aria-label={`${body.label} agent vision`}
    >
      <button
        className="sensor-heading"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="sensor-dot" /> AGENT VISION{" "}
        <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="sensor-content">
          {frame ? (
            <>
              <div className="sensor-image">
                <img
                  src={`data:image/jpeg;base64,${frame.data}`}
                  alt={`${body.label} captured sensor frame`}
                />
                <span>CAPTURED / REV {frame.revision}</span>
              </div>
              <p>
                {body.label} · {new Date(frame.at).toISOString().slice(11, 19)}{" "}
                UTC · {frame.width} × {frame.height}
              </p>
              <small>
                Exact frame available to MCP. The live world may have moved
                since capture.
              </small>
            </>
          ) : (
            <div className="sensor-empty">
              <strong>{body.label} / Camera ready</strong>
              <p>
                No captured frame yet. An agent can call observe with image:
                true.
              </p>
            </div>
          )}
          {leaseId && (
            <button
              className="sensor-capture"
              disabled={busy || !live}
              onClick={() => {
                void capture();
              }}
            >
              {busy ? "Capturing body sensors…" : "Capture sensor frame"}
            </button>
          )}
          {!leaseId && (
            <small>
              Possess this body to capture, or watch an external agent’s next
              frame here.
            </small>
          )}
          {error && <p role="alert">{error}</p>}
          {!live && <p>Connection lost · captured image is historical.</p>}
        </div>
      )}
    </section>
  );
}
