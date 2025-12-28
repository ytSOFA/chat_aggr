import { postJson } from "../http";
import { getEnv } from "../../utils/env";
import type { ChatMessage } from "./chatgpt";

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

function sanitizeUnicode(input: string): string {
  if (typeof input !== "string") {
    return String(input ?? "");
  }
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // 过滤有害的控制字符（保留 \t, \n, \r）
    if (code < 0x09 || (code > 0x0d && code < 0x20) || code === 0x0b || code === 0x0c) {
      continue;
    }
    // 处理代理对
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += input[i] + input[i + 1];
        i++;
      } else {
        out += "\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\uFFFD";
    } else {
      out += input[i];
    }
  }
  // 确保输出是有效的 UTF-8
  return Buffer.from(out, "utf8").toString("utf8");
}

function mapMessages(messages: ChatMessage[]): {
  systemInstruction?: string;
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
} {
  const systemInstruction = sanitizeUnicode(
    messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n")
  ).trim();

  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  for (const m of messages.filter((x) => x.role !== "system")) {
    const role = m.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: sanitizeUnicode(m.content) }] });
  }

  return { systemInstruction: systemInstruction || undefined, contents };
}

export async function generateGemini(
  messages: ChatMessage[],
  timeoutMs: number
): Promise<{ text: string; latencyMs: number }> {
  const apiKey = getEnv("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const model = getEnv("GEMINI_MODEL") ?? "";
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`;

  const { systemInstruction, contents } = mapMessages(messages);

  const body: any = {
    contents,
    tools: [{ google_search: {} }]
  };
  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const { data, latencyMs } = await postJson<GeminiGenerateContentResponse>(
    url,
    body,
    { "x-goog-api-key": apiKey },
    timeoutMs
  );

  const text = sanitizeUnicode(
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? ""
  );

  if (!text) throw new Error("Empty Gemini response");
  return { text, latencyMs };
}
