import type { Candidate, FinalOutput } from "../types";
import { generateZhipu } from "./providers/zhipu";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function tryParseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(trimmed.slice(first, last + 1));
    }
    throw new Error("Synth output is not valid JSON");
  }
}

function normalizeFinal(obj: any): FinalOutput {
  const final: FinalOutput = {
    final_answer: typeof obj?.final_answer === "string" ? obj.final_answer : "",
    disagreements: Array.isArray(obj?.disagreements) ? obj.disagreements : [],
    confidence: clamp01(typeof obj?.confidence === "number" ? obj.confidence : 0)
  };

  final.disagreements = final.disagreements
    .filter((d: any) => d && typeof d === "object")
    .map((d: any) => {
      const positions = d.positions ?? {};
      return {
        topic: typeof d.topic === "string" ? d.topic : "",
        positions: {
          claude: typeof positions.claude === "string" ? positions.claude : "",
          chatgpt: typeof positions.chatgpt === "string" ? positions.chatgpt : "",
          gemini: typeof positions.gemini === "string" ? positions.gemini : ""
        },
        resolution: typeof d.resolution === "string" ? d.resolution : ""
      };
    });

  if (!final.final_answer.trim()) throw new Error("Synth final_answer is empty");
  return final;
}

function buildSynthSystemPrompt(): string {
  return [
    "你是一个“多模型回答汇总器（Chat Synthesizer）”。你会收到：用户问题、可选的最近上下文，以及来自 claude/chatgpt/gemini 的候选回答。",
    "你的任务是输出一个严格 JSON 对象，完全符合指定 schema，用于前端渲染与审计。",
    "硬性规则（必须遵守）：",
    "只输出一个 JSON 对象，不得输出任何其他文本、解释、markdown、代码块标记。",
    "只能基于 candidates 的内容归纳，不得编造新事实或引入未出现的信息。",
    "如果 candidates 之间存在冲突或差异显著，必须写入 disagreements，不要强行融合。",
    "若 disagreements 非空，final_answer 结尾追加 1–2 句差异提示：概括主要分歧及保守/条件化建议；不得加入候选未提及的信息。",
    "输出语言取 candidates 中占多数的语言。",
    "字段含义与填充规则：",
    "final_answer：给用户的最终答复。清晰、可执行、结构化。",
    "disagreements：候选回答的分歧点列表。每个分歧必须包含：topic、positions、resolution。positions 固定包含 claude/chatgpt/gemini 三个 key；若某模型无可用回答，写 \"\"。",
    "confidence：0~1 的小数。3 个回答一致且信息充分时更高；候选少、冲突多、信息不足时更低。",
    "输出必须严格符合 schema：必须包含键 final_answer, disagreements, confidence。不得缺键。"
  ].join("\n");
}

function buildSynthUserPrompt(params: {
  userMessage: string;
  contextTurns: Array<{ user: string; assistant: string }>;
  candidates: Candidate[];
}): string {
  const contextText = params.contextTurns
    .map((t, i) => `#${i + 1}\nUser: ${t.user}\nAssistant: ${t.assistant}`)
    .join("\n\n");

  const candidateText = params.candidates
    .map((c) => {
      const status = c.status;
      const text = c.status === "ok" ? c.text ?? "" : "";
      return `- ${c.provider} (${c.model || "unknown"}) [${status}]\n${text}`.trim();
    })
    .join("\n\n");

  return [
    `用户问题：\n${params.userMessage}`,
    contextText ? `\n\n最近上下文：\n${contextText}` : "",
    `\n\n候选回答：\n${candidateText}`,
    "\n\n请严格按 schema 输出 JSON。"
  ].join("");
}

export async function synthesizeFinal(params: {
  userMessage: string;
  contextTurns: Array<{ user: string; assistant: string }>;
  candidates: Candidate[];
  timeoutMs: number;
}): Promise<{ final: FinalOutput; latencyMs: number }> {
  const system = buildSynthSystemPrompt();
  const user = buildSynthUserPrompt(params);

  const { text, latencyMs } = await generateZhipu(
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    params.timeoutMs
  );

  const parsed = tryParseJsonObject(text);
  const final = normalizeFinal(parsed);
  return { final, latencyMs };
}
