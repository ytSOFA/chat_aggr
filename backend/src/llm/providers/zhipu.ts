import { getEnv } from "../../utils/env";
import { withTimeout } from "../../utils/timeout";
import type { ChatMessage } from "./chatgpt";

type ZhipuChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }>;
};

export async function generateZhipu(
  messages: ChatMessage[],
  timeoutMs: number,
  onDelta?: (text: string) => void
): Promise<{ text: string; latencyMs: number }> {
  const apiKey = getEnv("ZHIPU_API_KEY");
  if (!apiKey) throw new Error("ZHIPU_API_KEY not configured");

  const model = getEnv("SYNTH_MODEL") ?? "glm-4.5-Flash";
  const url = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const body = {
    model,
    messages,
    temperature: 0,
    stream: true,
    //thinking: { type: "disabled" }
  };
  const bodyStr = JSON.stringify(body, null, 2);
  console.log(`[zhipu] request ${bodyStr}`);

  let result: { text: string };
  let latencyMs: number;
  try {
    const wrapped = await withTimeout(async (signal) => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 4000)}`);
        (err as any).status = res.status;
        throw err;
      }

      if (!res.body) throw new Error("Zhipu response body is empty");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let raw = "";
      let text = "";
      let done = false;

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const payload = trimmed.slice(5).trim();
        if (!payload) return;
        if (payload === "[DONE]") {
          done = true;
          return;
        }
        try {
          const chunk = JSON.parse(payload) as ZhipuChatCompletionResponse;
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            text += delta;
            onDelta?.(delta);
            return;
          }
          const message = chunk?.choices?.[0]?.message?.content;
          if (typeof message === "string" && message && !text) {
            text = message;
            onDelta?.(message);
          }
        } catch {
          // ignore partial JSON chunks
        }
      };

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        const chunk = decoder.decode(value, { stream: true });
        raw += chunk;
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          handleLine(line);
          if (done) break;
        }
        if (done) {
          await reader.cancel().catch(() => {});
          break;
        }
      }

      const tail = buffer + decoder.decode();
      if (tail.trim()) {
        for (const line of tail.split(/\r?\n/)) {
          handleLine(line);
        }
      }

      if (!text.trim() && raw.trim()) {
        try {
          const parsed = JSON.parse(raw) as ZhipuChatCompletionResponse;
          const fallback = parsed.choices?.[0]?.message?.content ?? "";
          if (fallback) {
            text = fallback;
            onDelta?.(fallback);
          }
        } catch {
          // ignore fallback parse errors
        }
      }

      return { text };
    }, timeoutMs);
    result = wrapped.result;
    latencyMs = wrapped.latencyMs;
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "unknown error";
    const status = typeof err?.status === "number" ? ` status=${err.status}` : "";
    console.log(`[zhipu] request failed:${status} ${message}`);
    throw err;
  }

  const text = result.text ?? "";
  if (!text.trim()) throw new Error("Empty Zhipu response");
  return { text, latencyMs };
}
