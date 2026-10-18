import { useEffect, useState } from "react";
import type { Body, Command } from "@ghost/shared";
export function GimbalControls({
  body,
  enabled,
  act,
  compact = false,
}: {
  body: Body;
  enabled: boolean;
  act: (command: Command) => void;
  compact?: boolean;
}) {
  const [pan, setPan] = useState(String(body.pan)),
    [tilt, setTilt] = useState(String(body.tilt));
  useEffect(() => {
    setPan(String(body.pan));
    setTilt(String(body.tilt));
  }, [body.pan, body.tilt]);
  const aim = (pan: number, tilt: number) => act({ type: "look", pan, tilt });
  return (
    <fieldset
      className={`gimbal-controls ${compact ? "gimbal-compact" : ""}`}
      disabled={!enabled}
      aria-label="Drone camera gimbal"
    >
      <div className="gimbal-heading">
        <strong>CAMERA / GIMBAL</strong>
        <span>
          {body.pan.toFixed(0)}° / {body.tilt.toFixed(0)}°
        </span>
      </div>
      {!compact && (
        <>
          <p>
            Aim independently while flying. Pan uses world compass directions.
          </p>
          <div className="coordinate-inputs">
            <label>
              Camera pan °
              <input
                type="number"
                min="-180"
                max="180"
                value={pan}
                onChange={(e) => setPan(e.target.value)}
              />
            </label>
            <label>
              Camera tilt °
              <input
                type="number"
                min="-90"
                max="30"
                value={tilt}
                onChange={(e) => setTilt(e.target.value)}
              />
            </label>
          </div>
          <button
            className="full-button"
            onClick={() => aim(Number(pan), Number(tilt))}
          >
            Aim drone camera
          </button>
        </>
      )}
      <div className="gimbal-presets">
        <button onClick={() => aim(body.pan, -90)}>Look down</button>
        <button onClick={() => aim((body.heading * 180) / Math.PI, -15)}>
          Look ahead
        </button>
        <button onClick={() => aim(((body.pan + 360) % 360) - 180, body.tilt)}>
          Look behind
        </button>
      </div>
    </fieldset>
  );
}
