export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiRequestError(0, "Couldn't reach the server. Check your connection and try again.");
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON responses fall through to the status check below.
  }

  const payload = data as { ok?: boolean; error?: string } | null;
  if (!response.ok || payload?.ok === false) {
    throw new ApiRequestError(response.status, payload?.error || "Something went wrong. Please try again.");
  }
  return data as T;
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Please try again.";
}
