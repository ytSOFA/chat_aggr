import { postJson } from "../http";
import { getEnv } from "../../utils/env";
import type { ChatMessage } from "./chatgpt";

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

export async function generateClaude(
  messages: ChatMessage[],
  timeoutMs: number
): Promise<{ text: string; latencyMs: number }> {
  const apiKey = getEnv("CLAUDE_API_KEY");
  if (!apiKey) throw new Error("CLAUDE_API_KEY not configured");

  const model = getEnv("CLAUDE_MODEL") ?? "";
  const mcpUrl = getEnv("MCP_SERVER_URL");
  const mcpLabel = getEnv("MCP_SERVER_LABEL") ?? "default";
  const mcpAuth = getEnv("MCP_SERVER_AUTH");

  const systemMessages = messages.filter((m) => m.role === "system").map((m) => m.content.trim());
  const system = systemMessages.length ? systemMessages.join("\n\n") : undefined;
  const nonSystem = messages.filter((m) => m.role !== "system");

  const url = "https://api.anthropic.com/v1/messages";
  const body: any = {
    model,
    max_tokens: 1024,
    messages: nonSystem.map((m) => ({ role: m.role, content: m.content }))
  };

  if (!mcpUrl) {
    body.tools = [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5
      }
    ];
  }
  if (mcpUrl) {
    body.mcp_servers = [
      {
        type: "url",
        name: mcpLabel,
        url: mcpUrl,
        ...(mcpAuth ? { authorization_token: mcpAuth } : {})
      }
    ];
  }
  if (system) body.system = system;

  const { data, latencyMs } = await postJson<AnthropicMessageResponse>(
    url,
    body,
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(mcpUrl ? { "anthropic-beta": "mcp-client-2025-04-04" } : {})
    },
    timeoutMs
  );

  const text = (data.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("")
    .trim();

  if (!text) throw new Error("Empty Claude response");
  return { text, latencyMs };
}
