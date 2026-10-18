import { BOUNDS } from "@ghost/shared";
import type { Snapshot } from "@ghost/shared";
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
  return (
    <div className={`warehouse-map ${navigate ? "can-navigate" : ""}`}>
      <div className="map-heading">
        <span>WAREHOUSE MAP</span>
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
        <g
          pointerEvents="none"
          fill="#506471"
          stroke="#8c9476"
          strokeWidth=".6"
        >
          {[-27, -16, -5].flatMap((z) =>
            [-25, -15, -5, 5, 15, 25]
              .filter((x) => z !== -5 || Math.abs(x) > 10)
              .map((x) => (
                <rect
                  key={`${x}/${z}`}
                  x={px(x - 3.8)}
                  y={pz(z - 1.2)}
                  width="38"
                  height="12"
                />
              )),
          )}
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
      <span className="map-caption">
        {navigate
          ? "Tap map to set destination"
          : "Live fleet positions · 64 × 44 m"}
      </span>
    </div>
  );
}
