import type { Candidate, FinalOutput } from "../types";
import { generateZhipu } from "./providers/zhipu";

function buildSynthSystemPrompt(): string {
  return [
    "你是一个“回答总结器”,会收到：来自 claude/chatgpt/gemini 的候选回答。",
    "你的任务是总结候选回答，只能基于候选回答的内容归纳，不得编造新事实或引入未出现的信息。",
    "如果候选回答之间存在显著冲突或差异，主要总结占多数的回答，但不要强行融合，也不要不断比较，可以在结尾追加几句差异提示，概括主要分歧",
    "只输出文本，输出语言用候选回答中占多数的语言。"
  ].join("\n");
}

function buildSynthUserPrompt(params: { candidates: Candidate[] }): string {
  const candidateText = params.candidates
    .map((c) => {
      const status = c.status;
      const text = c.status === "ok" ? c.text ?? "" : "";
      return `- ${c.provider} [${status}]\n${text}`.trim();
    })
    .join("\n\n");

  return [`候选回答：\n${candidateText}`].join("");
}

export async function synthesizeFinal(params: {
  candidates: Candidate[];
  timeoutMs: number;
}): Promise<{ final: FinalOutput; latencyMs: number }> {
  const system = buildSynthSystemPrompt();
  const user = buildSynthUserPrompt({ candidates: params.candidates });

  const { text, latencyMs } = await generateZhipu(
    [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    params.timeoutMs
  );

  const preview =
    text.length > 2000 ? `${text.slice(0, 2000)}...[truncated]` : text;
  console.log(`[synth] raw response (${text.length} chars): ${preview}`);

  const finalAnswer = text.trim();
  if (!finalAnswer) throw new Error("Synth final_answer is empty");
  return { final: { final_answer: finalAnswer }, latencyMs };
}
