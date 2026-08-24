export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function responseMessage(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") return body.detail;
    }
    const text = await response.text();
    return text && text.length < 300 ? text : fallback;
  } catch {
    return fallback;
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit,
  timeoutMs = 45_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new ApiError(await responseMessage(response), response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("This is taking longer than expected. Please try again.");
    }
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  } finally {
    window.clearTimeout(timeout);
  }
}
