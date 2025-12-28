export type ProviderName = "claude" | "chatgpt" | "gemini";

export type CandidateStatus = "ok" | "timeout" | "error";

export type Candidate = {
  provider: ProviderName;
  model: string;
  status: CandidateStatus;
  text?: string;
  latencyMs?: number;
  errorMessage?: string;
};

export type FinalOutput = {
  final_answer: string;
  disagreements: Array<{
    topic: string;
    positions: { claude: string; chatgpt: string; gemini: string };
    resolution: string;
  }>;
  confidence: number;
};

export type ChatRequest = {
  threadId: string;
  message: string;
  contextTurns?: Array<{ user: string; assistant: string }>;
};
