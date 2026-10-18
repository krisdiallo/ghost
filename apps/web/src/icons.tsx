import type { ResourceKind } from "@ghost/shared";
export function Ghost({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 26V14a10 10 0 0 1 20 0v12l-5-3-5 3-5-3-5 3Z"
        fill="currentColor"
      />
      <rect x="11" y="12" width="3" height="5" rx="1.5" fill="#111b1b" />
      <rect x="18" y="12" width="3" height="5" rx="1.5" fill="#111b1b" />
    </svg>
  );
}
export function BodyIcon({
  kind,
  size = 22,
}: {
  kind: ResourceKind;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "camera" ? (
        <>
          <rect x="3" y="5" width="13" height="10" rx="2" />
          <path d="m16 8 5-3v10l-5-3M9 15v5M5 20h8" />
          <circle cx="8" cy="10" r="2" />
        </>
      ) : kind === "rover" ? (
        <>
          <path d="m4 15 1-7h13l2 7M3 15h18v4H3zM9 8V4h5M11 11h5" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="19" r="2" />
        </>
      ) : kind === "arm" ? (
        <>
          <path d="M4 21h15M7 21v-5l6-5-5-5 4-3 6 7-4 6v5M7 6 4 8l-2-3 3-3M18 10h3" />
          <circle cx="13" cy="12" r="2" />
        </>
      ) : (
        <>
          <rect x="9" y="9" width="6" height="6" rx="2" />
          <path d="m9 9-4-4m10 4 4-4M9 15l-4 4m10-4 4 4" />
          <ellipse cx="5" cy="4" rx="4" ry="2" />
          <ellipse cx="19" cy="4" rx="4" ry="2" />
          <ellipse cx="5" cy="20" rx="4" ry="2" />
          <ellipse cx="19" cy="20" rx="4" ry="2" />
        </>
      )}
    </svg>
  );
}
export function UIIcon({
  name,
  size = 14,
}: {
  name:
    | "pan"
    | "zoomIn"
    | "zoomOut"
    | "expand"
    | "arrow"
    | "play"
    | "stop"
    | "reset"
    | "focus"
    | "top"
    | "target"
    | "check"
    | "connect";
  size?: number;
}) {
  const paths = {
    pan: "M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3",
    zoomIn: "M5 12h14M12 5v14",
    zoomOut: "M5 12h14",
    expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",

    arrow: "M5 19 19 5M5 5h14v14",
    play: "m8 5 12 7-12 7Z",
    stop: "M6 6h12v12H6Z",
    reset: "M4 10a8 8 0 1 1 0 5M4 4v6h6",
    focus: "M12 2v4m0 12v4M2 12h4m12 0h4M7 7l10 10M7 17 17 7",
    top: "m3 16 5-10h13l-5 10Z",
    target:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18",
    check: "m5 12 4 4L19 6",
    connect:
      "M9 9H6a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H9",
  };
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "play" || name === "stop" ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
