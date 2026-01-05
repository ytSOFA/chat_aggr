import { randomUUID } from "node:crypto";
import express from "express";
import type { Candidate, ChatRequest, FinalOutput } from "./types";
import { getEnv, getIntEnv } from "./utils/env";
import { safeLog } from "./utils/redact";
import { runOrchestrator } from "./llm/orchestrator";
import { synthesizeFinal } from "./llm/synthesizer";

const LOCAL_STORAGE_KEY = "ai_chat_state_v1";
const MAX_CONTEXT_TURNS = 8;

function getVersion(): string {
  return process.env.npm_package_version ?? process.env.APP_VERSION ?? "dev";
}

function nowMs(): number {
  return Date.now();
}

function pickBestCandidate(candidates: Candidate[]): Candidate | undefined {
  const ok = candidates.filter((c) => c.status === "ok" && typeof c.text === "string");
  if (!ok.length) return undefined;
  return ok.reduce((best, cur) => ((cur.text?.length ?? 0) > (best.text?.length ?? 0) ? cur : best));
}

function buildMessages(req: ChatRequest) {
  const contextTurns = Array.isArray(req.contextTurns) ? req.contextTurns : [];
  const trimmed = contextTurns
    .filter((t) => t && typeof t.user === "string" && typeof t.assistant === "string")
    .slice(-MAX_CONTEXT_TURNS);

  const messages = [
    {
      role: "system" as const,
      content: "回答要简洁明了，不需要来源链接，如果用户明确要求详细说明或步骤，再适当展开。"
    },
    ...trimmed.flatMap((t) => [
      { role: "user" as const, content: t.user },
      { role: "assistant" as const, content: t.assistant }
    ])
  ];

  messages.push({ role: "user" as const, content: req.message });
  return { messages, contextTurns: trimmed };
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // 简易 CORS（本地分端口调试时使用；生产可收紧为白名单域）
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  app.get("/api/aggr/config", (_req, res) => {
    res.json({
      providers: {
        chatgpt: { model: getEnv("CHATGPT_MODEL") ?? "" },
        gemini: { model: getEnv("GEMINI_MODEL") ?? "" },
        claude: { model: getEnv("CLAUDE_MODEL") ?? "" }
      }
    });
  });

  app.post("/api/aggr/chat", async (req, res) => {
    const startedAt = nowMs();
    const turnId = randomUUID();

    const body = req.body as Partial<ChatRequest>;
    const threadId = typeof body.threadId === "string" ? body.threadId : "";
    const message = typeof body.message === "string" ? body.message : "";
    const contextTurns = Array.isArray(body.contextTurns) ? body.contextTurns : [];

    if (!threadId.trim() || !message.trim()) {
      return res.status(400).json({
        threadId: threadId || "",
        turnId,
        error: { code: "BAD_REQUEST", message: "threadId and message are required" }
      });
    }

    safeLog("[/api/aggr/chat] request", { threadId, turnId, message, contextTurns });

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    const writeEvent = (payload: unknown) => {
      if (closed || res.writableEnded) return;
      res.write(`${JSON.stringify(payload)}\n`);
    };

    const { messages, contextTurns: trimmedContext } = buildMessages({ threadId, message, contextTurns });
    const { candidates } = await runOrchestrator(messages);

    const normalizedCandidates: Candidate[] = candidates.map((c) => ({
      provider: c.provider,
      model: c.model ?? "",
      status: c.status,
      text: c.text,
      latencyMs: c.latencyMs ?? 0,
      errorMessage: c.errorMessage
    }));

    const okCandidates = normalizedCandidates.filter((c) => c.status === "ok" && c.text && c.text.trim());

    if (okCandidates.length === 0) {
      const payload = {
        threadId,
        turnId,
        error: { code: "UPSTREAM_ALL_FAILED", message: "All providers failed" },
        candidates: normalizedCandidates.map((c) => ({
          provider: c.provider,
          model: c.model,
          status: c.status === "timeout" ? "timeout" : "error",
          errorMessage: c.errorMessage ?? (c.status === "timeout" ? "timeout" : "error"),
          latencyMs: c.latencyMs ?? 0
        }))
      };
      safeLog("[/api/aggr/chat] upstream_all_failed", payload);
      writeEvent({ type: "error", data: payload });
      return res.end();
    }

    const synthTimeoutMs = getIntEnv("SYNTH_TIMEOUT_MS", 10000);
    const synthStartedAt = nowMs();
    let synthMs = 0;

    let final: FinalOutput;
    if (okCandidates.length === 1) {
      final = {
        final_answer: okCandidates[0]?.text ?? "抱歉，本次汇总失败，请稍后重试。"
      };
    } else {
      try {
        const synth = await synthesizeFinal({
          candidates: normalizedCandidates,
          timeoutMs: synthTimeoutMs,
          onDelta: (text) => writeEvent({ type: "delta", text })
        });
        synthMs = synth.latencyMs;
        final = synth.final;
      } catch (err: any) {
        synthMs = nowMs() - synthStartedAt;
        const best = pickBestCandidate(normalizedCandidates);
        final = {
          final_answer: best?.text ?? "抱歉，本次汇总失败，请稍后重试。"
        };
        safeLog("[/api/aggr/chat] synth_failed_fallback", {
          threadId,
          turnId,
          error: typeof err?.message === "string" ? err.message : "unknown synth error"
        });
      }
    }

    const responseBody = {
      threadId,
      turnId,
      final,
      candidates: normalizedCandidates,
      timing: { totalMs: nowMs() - startedAt, synthMs }
    };

    safeLog("[/api/aggr/chat] response", responseBody);
    writeEvent({ type: "final", data: responseBody });
    res.end();
  });

  app.get("/", (_req, res) => {
    res.type("text").send(`chat-aggr-backend ${getVersion()} (localStorageKey=${LOCAL_STORAGE_KEY})`);
  });

  return app;
}
