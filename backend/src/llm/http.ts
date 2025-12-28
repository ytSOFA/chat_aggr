import { withTimeout } from "../utils/timeout";

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ data: T; latencyMs: number }> {
  const { result, latencyMs } = await withTimeout(async (signal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 4000)}`);
      (err as any).status = res.status;
      throw err;
    }
    return JSON.parse(text) as T;
  }, timeoutMs);

  return { data: result, latencyMs };
}

