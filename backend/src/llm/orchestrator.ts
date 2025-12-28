import type { Candidate, ProviderName } from "../types";
import { getEnv, getIntEnv } from "../utils/env";
import { isAbortError } from "../utils/timeout";
import type { ChatMessage } from "./providers/chatgpt";
import { generateChatGPT } from "./providers/chatgpt";
import { generateClaude } from "./providers/claude";
import { generateGemini } from "./providers/gemini";

const PROVIDER_ORDER: ProviderName[] = ["claude", "chatgpt", "gemini"];

function modelFor(provider: ProviderName): string {
  if (provider === "claude") return getEnv("CLAUDE_MODEL") ?? "";
  if (provider === "chatgpt") return getEnv("CHATGPT_MODEL") ?? "";
  return getEnv("GEMINI_MODEL") ?? "";
}

function hasApiKey(provider: ProviderName): boolean {
  if (provider === "claude") return !!getEnv("CLAUDE_API_KEY");
  if (provider === "chatgpt") return !!getEnv("CHATGPT_API_KEY");
  return !!getEnv("GEMINI_API_KEY");
}

async function callProvider(
  provider: ProviderName,
  messages: ChatMessage[],
  timeoutMs: number
): Promise<Candidate> {
  const startedAt = Date.now();
  const model = modelFor(provider);
  if (!hasApiKey(provider)) {
    return {
      provider,
      model,
      status: "error",
      latencyMs: 0,
      errorMessage: "API key not configured"
    };
  }

  try {
    if (provider === "claude") {
      const { text, latencyMs } = await generateClaude(messages, timeoutMs);
      return { provider, model, status: "ok", text, latencyMs };
    }
    if (provider === "chatgpt") {
      const { text, latencyMs } = await generateChatGPT(messages, timeoutMs);
      return { provider, model, status: "ok", text, latencyMs };
    }
    const { text, latencyMs } = await generateGemini(messages, timeoutMs);
    return { provider, model, status: "ok", text, latencyMs };
  } catch (err: any) {
    const isTimeout = isAbortError(err);
    return {
      provider,
      model,
      status: isTimeout ? "timeout" : "error",
      latencyMs: Date.now() - startedAt,
      errorMessage: typeof err?.message === "string" ? err.message : "unknown error"
    };
  }
}

export async function runOrchestrator(messages: ChatMessage[]): Promise<{
  candidates: Candidate[];
  timeoutMs: number;
}> {
  const timeoutMs = getIntEnv("PROVIDER_TIMEOUT_MS", 20000);
  const promises = PROVIDER_ORDER.map((p) => callProvider(p, messages, timeoutMs));
  const results = await Promise.all(promises);
  return { candidates: results, timeoutMs };
}
