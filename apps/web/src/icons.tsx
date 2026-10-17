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
