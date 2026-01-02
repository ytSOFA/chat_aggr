import { postJson } from "../http";
import { getEnv } from "../../utils/env";
import type { ChatMessage } from "./chatgpt";

type ZhipuChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function generateZhipu(
  messages: ChatMessage[],
  timeoutMs: number
): Promise<{ text: string; latencyMs: number }> {
  const apiKey = getEnv("ZHIPU_API_KEY");
  if (!apiKey) throw new Error("ZHIPU_API_KEY not configured");

  const model = getEnv("SYNTH_MODEL") ?? "glm-4.5-Flash";
  const url = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const body = {
    model,
    messages,
    temperature: 0,
    stream: false
  };
  const bodyStr = JSON.stringify(body);                                                                                                                             
  console.log(`[zhipu] request size: ${bodyStr.length} bytes, timeout: ${timeoutMs}ms`); 
  const { data, latencyMs } = await postJson<ZhipuChatCompletionResponse>(
    url,
    body,
    { authorization: `Bearer ${apiKey}` },
    timeoutMs
  );

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("Empty Zhipu response");
  return { text, latencyMs };
}

