export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<{ result: T; latencyMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    const result = await task(controller.signal);
    return { result, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { name?: string; message?: string };
  return anyErr.name === "AbortError" || anyErr.message === "timeout";
}

