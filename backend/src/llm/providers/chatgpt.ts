import { postJson } from "../http";
import { getEnv } from "../../utils/env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type OpenAIResponsesApiResponse = {
  output_text?: string;
  output?: Array<{
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

export async function generateChatGPT(
  messages: ChatMessage[],
  timeoutMs: number
): Promise<{ text: string; latencyMs: number }> {
  const apiKey = getEnv("CHATGPT_API_KEY");
  if (!apiKey) throw new Error("CHATGPT_API_KEY not configured");

  const model = getEnv("CHATGPT_MODEL") ?? "";
  const url = "https://api.openai.com/v1/responses";
  const input = messages.map((m) => {
    const role = m.role === "system" ? "developer" : m.role;
    const contentType = role === "assistant" ? "output_text" : "input_text";
    return {
      role,
      content: [{ type: contentType, text: m.content }]
    };
  });

  const tools = [{ type: "web_search" }];

  const body: any = {
    model,
    input,
    tools,
    tool_choice: "auto"
  };

  const { data, latencyMs } = await postJson<OpenAIResponsesApiResponse>(
    url,
    body,
    { authorization: `Bearer ${apiKey}` },
    timeoutMs
  );

  const text =
    data.output_text ??
    data.output?.flatMap((item) => item.content ?? []).find((c) => typeof c?.text === "string")?.text ??
    "";
  if (!text.trim()) throw new Error("Empty ChatGPT response");
  return { text, latencyMs };
}
