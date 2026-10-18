// The recorder substitutes capabilities in memory. Public traces never include
// credentials, lease IDs, raw image bytes, or SDK view metadata.
export function privateArguments(tool, args, leases) {
  if (!["discover", "possess", "observe", "act", "release"].includes(tool))
    throw new Error("Unknown MCP tool.");
  if (Object.hasOwn(args, "leaseId"))
    throw new Error(
      "Use leaseRef; do not put raw capabilities in recorder commands.",
    );
  if (!["observe", "act", "release"].includes(tool)) return args;
  const { leaseRef, ...rest } = args;
  const leaseId = leases.get(leaseRef);
  if (!leaseId) throw new Error("Possess this body first.");
  return { ...rest, leaseId };
}
export function publicResult(result) {
  const data =
    result.structuredContent ??
    (() => {
      const text = result.content?.find((item) => item.type === "text")?.text;
      try {
        return JSON.parse(text);
      } catch {
        return { message: "MCP returned no structured result." };
      }
    })();
  const sanitize = (value) => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) =>
              ![
                "leaseId",
                "data",
                "_meta",
                "frameData",
                "Authorization",
              ].includes(key),
          )
          .map(([key, item]) => [key, sanitize(item)]),
      );
    return value;
  };
  return { isError: Boolean(result.isError), result: sanitize(data) };
}
