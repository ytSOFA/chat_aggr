export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function getEnvOrThrow(name: string): string {
  const value = getEnv(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getIntEnv(name: string, fallback: number): number {
  const value = getEnv(name);
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

