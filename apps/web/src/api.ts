import type { ToolName } from "@ghost/shared";
export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, input?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      path,
      input === undefined
        ? { signal: AbortSignal.timeout(6000) }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(6000),
          },
    );
  } catch {
    throw new RequestError(
      "DISCONNECTED",
      "Warehouse connection lost. Wait for reconnection before trying again.",
    );
  }
  const value = await response.json();
  if (!response.ok)
    throw new RequestError(
      value.code ?? "ERROR",
      value.message ?? "The command could not be completed.",
    );
  return value as T;
}
export const tool = <T>(name: ToolName, input: unknown) =>
  request<T>(`/api/tools/${name}`, input);
