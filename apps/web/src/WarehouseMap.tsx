import { useState } from "react";
import {
  BOUNDS,
  surveyCell,
  STATIC_OBSTACLES,
  BODY_CLEARANCE,
} from "@ghost/shared";
import type { Snapshot, Vec3 } from "@ghost/shared";
import { BODY_COLORS } from "./Warehouse";

export const destinations = [
  { label: "Inspection bay", x: 1, z: 1.4 },
  { label: "Storage aisle B", x: -10, z: -18 },
  { label: "North docks", x: 10, z: -30 },
  { label: "Dispatch apron", x: 6, z: 5 },
];
const px = (x: number) => (x + 32) * 5;
const pz = (z: number) => (z + 34) * 5;

export function WarehouseMap({
  snapshot,
  selected,
  navigate,
  select,
}: {
  snapshot: Snapshot;
  selected: string;
  navigate: ((x: number, z: number) => void) | null;
  select: (id: string) => void;
}) {
  const body = snapshot.bodies.find((b) => b.id === selected);
  const blocked = body?.lastBlocked
    ? { resourceId: selected, position: body.lastBlocked.position }
    : null;
  const [showSurvey, setShowSurvey] = useState(true);
  return (
    <div className={`warehouse-map ${navigate ? "can-navigate" : ""}`}>
      <div className="map-heading">
        <span>WAREHOUSE MAP</span>
        <button
          type="button"
          className="map-survey-toggle"
          aria-pressed={showSurvey}
          onClick={() => setShowSurvey(!showSurvey)}
        >
          Survey {showSurvey ? "on" : "off"}
        </button>
        <span>N ↑</span>
      </div>
      <svg
        viewBox="0 0 320 220"
        role="group"
        aria-label="Live warehouse map. Select a body marker; while possessed, tap empty space to move."
      >
        <rect
          x="1"
          y="1"
          width="318"
          height="218"
          rx="3"
          fill="#172b35"
          stroke="#66818a"
          onClick={(e) => {
            if (!navigate) return;
            const bounds =
              e.currentTarget.ownerSVGElement!.getBoundingClientRect();
            const x = Math.max(
              BOUNDS.minX,
              Math.min(
                BOUNDS.maxX,
                ((e.clientX - bounds.left) / bounds.width) * 64 - 32,
              ),
            );
            const z = Math.max(
              BOUNDS.minZ,
              Math.min(
                BOUNDS.maxZ,
                ((e.clientY - bounds.top) / bounds.height) * 44 - 34,
              ),
            );
            navigate(Math.round(x * 10) / 10, Math.round(z * 10) / 10);
          }}
        />
        {showSurvey && (
          <g pointerEvents="none" aria-label="Observed floor checkpoints">
            {snapshot.survey.rows.flatMap((row, r) =>
              [...row].map((covered, c) => {
                const cell = surveyCell(c, r);
                return covered === "x" ? null : (
                  <circle
                    key={`${r}/${c}`}
                    cx={px(cell.center[0])}
                    cy={pz(cell.center[2])}
                    r="1.7"
                    fill={covered === "1" ? "#a2f4cb" : "#13262f"}
                    stroke={covered === "1" ? "#a2f4cb" : "#67877f"}
                    strokeWidth=".7"
                  />
                );
              }),
            )}
          </g>
        )}
        <g
          pointerEvents="none"
          fill="#506471"
          stroke="#8c9476"
          strokeWidth=".6"
        >
          {[
            ...(snapshot.layout?.obstacles ?? STATIC_OBSTACLES),
            ...(!snapshot.layout
              ? (snapshot.operations?.obstructions ?? [])
              : []),
          ].map((obstacle) => {
            const half =
              body && (body.kind === "drone" || body.kind === "rover")
                ? BODY_CLEARANCE[body.kind][1] * (body.profile?.scale ?? 1)
                : 0;
            const active =
              body &&
              body.position[1] + half >= obstacle.min[1] &&
              body.position[1] - half <= obstacle.max[1];
            return (
              <rect
                key={obstacle.id}
                x={px(obstacle.min[0])}
                y={pz(obstacle.min[2])}
                width={(obstacle.max[0] - obstacle.min[0]) * 5}
                height={(obstacle.max[2] - obstacle.min[2]) * 5}
                fill={obstacle.kind === "freight" ? "#9e7954" : "#506471"}
                fillOpacity={active ? ".8" : ".2"}
              >
                <title>
                  {obstacle.label} · {obstacle.min[1].toFixed(1)}–
                  {obstacle.max[1].toFixed(1)} m high
                </title>
              </rect>
            );
          })}
          <path
            d="M110 15V190M210 15V190"
            stroke="#d0bb7f"
            strokeDasharray="3 3"
            fill="none"
          />
          {snapshot.objects.map((o) => (
            <rect
              key={o.id}
              x={px(o.position[0]) - 2}
              y={pz(o.position[2]) - 2}
              width="4"
              height="4"
              fill="#ecc78e"
            />
          ))}
          {body?.action?.target && (
            <path
              d={`M${px(body.position[0])} ${pz(body.position[2])}L${px(body.action.target[0])} ${pz(body.action.target[2])}`}
              stroke="#bcf3d8"
              strokeDasharray="3 2"
            />
          )}
          <text
            x="160"
            y="13"
            textAnchor="middle"
            fontSize="8"
            fill="#cad5ce"
            stroke="none"
          >
            NORTH LOADING DOCKS
          </text>
          <text
            x="160"
            y="207"
            textAnchor="middle"
            fontSize="8"
            fill="#cad5ce"
            stroke="none"
          >
            EMBODIMENT BAY
          </text>
        </g>
        {blocked?.resourceId === selected && body && (
          <g pointerEvents="none" stroke="#ff907e" strokeWidth="1.5">
            <path
              d={`M${px(body.position[0])} ${pz(body.position[2])}L${px(blocked.position[0])} ${pz(blocked.position[2])}`}
              strokeDasharray="3 2"
            />
            <path
              d={`M${px(blocked.position[0]) - 3} ${pz(blocked.position[2]) - 3}l6 6m-6 0l6 -6`}
            />
          </g>
        )}
        {snapshot.bodies.map((b) => (
          <g
            key={b.id}
            className="map-body"
            role="button"
            aria-label={`Locate ${b.label}`}
            tabIndex={0}
            onClick={() => select(b.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                select(b.id);
              }
            }}
          >
            <circle
              cx={px(b.position[0])}
              cy={pz(b.position[2])}
              r={selected === b.id ? 8 : 6}
              fill={BODY_COLORS[b.kind]}
              fillOpacity=".25"
            />
            <circle
              cx={px(b.position[0])}
              cy={pz(b.position[2])}
              r="3"
              fill={BODY_COLORS[b.kind]}
            />
          </g>
        ))}
      </svg>
      {blocked?.resourceId === selected && (
        <span className="map-route-error">
          Direct path blocked · choose clear aisle waypoints
        </span>
      )}
      <span className="map-caption">
        {navigate
          ? "Tap for a direct move · use clear waypoints"
          : "Live fleet positions · 64 × 44 m"}
      </span>
      {showSurvey && (
        <span className="map-survey-legend">
          <i />
          {snapshot.survey.coveredCells}/{snapshot.survey.totalCells}{" "}
          checkpoints seen · hollow = unknown
        </span>
      )}
    </div>
  );
}
