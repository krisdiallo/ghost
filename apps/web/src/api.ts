import type { ToolName } from "@ghost/shared";
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  input?: unknown,
  timeoutMs = 6000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      path,
      input === undefined
        ? { signal: AbortSignal.timeout(timeoutMs) }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(timeoutMs),
          },
    );
  } catch {
    throw new RequestError(
      "DISCONNECTED",
      "Warehouse connection lost. Wait for reconnection before trying again.",
    );
  }
  const value = await response.json();
  if (response.status === 401 && value.code === "AUTH_REQUIRED") {
    sessionStorage.removeItem("ghost-leases");
    window.location.replace("/");
  }
  if (!response.ok)
    throw new RequestError(
      value.code ?? "ERROR",
      value.message ?? "The command could not be completed.",
      value.details,
    );
  return value as T;
}
export const tool = <T>(name: ToolName, input: unknown) => {
  const args = input as { image?: boolean; imageResourceId?: string };
  return request<T>(
    `/api/tools/${name}`,
    input,
    (name === "observe" && args?.image) ||
      (name === "experiment_inspect" && args?.imageResourceId)
      ? 45000
      : 6000,
  );
};
