const SECRET_ENV_KEYS = ["CHATGPT_API_KEY", "CLAUDE_API_KEY", "GEMINI_API_KEY", "ZHIPU_API_KEY"] as const;

function getSecrets(): string[] {
  const secrets: string[] = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value && value.trim().length) secrets.push(value.trim());
  }
  return secrets;
}

export function redactSecrets(input: string): string {
  let out = input;

  for (const secret of getSecrets()) {
    out = out.split(secret).join("***");
  }

  out = out.replace(/sk-[A-Za-z0-9]{10,}/g, "***");
  out = out.replace(/AIzaSy[A-Za-z0-9_-]{10,}/g, "***");
  out = out.replace(/Bearer\\s+[A-Za-z0-9._-]{10,}/gi, "Bearer ***");

  return out;
}

export function safeLog(label: string, payload: unknown): void {
  try {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    // eslint-disable-next-line no-console
    console.log(label, redactSecrets(text));
  } catch {
    // eslint-disable-next-line no-console
    console.log(label, "[unserializable payload]");
  }
}
