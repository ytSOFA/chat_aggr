import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { createApp } from "../src/app";

function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend", ".env")
  ];

  const envPath = candidates.find((p) => fs.existsSync(p));
  if (!envPath) return;

  dotenv.config({ path: envPath });
}

loadDotEnv();

type ProviderName = "claude" | "chatgpt" | "gemini";
const PROVIDER_ORDER: ProviderName[] = ["claude", "chatgpt", "gemini"];

function assertCandidateOrder(candidates: any[]): void {
  assert.equal(candidates.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(candidates[i]?.provider, PROVIDER_ORDER[i]);
    assert.ok(["ok", "timeout", "error"].includes(candidates[i]?.status));
    assert.equal(typeof candidates[i]?.model, "string");
  }
}

test(
  "LLM smoke: POST /api/aggr/chat streams NDJSON (final or error)",
  { timeout: 120_000, skip: process.env.RUN_REAL_LLM_SMOKE !== "1" },
  async () => {
    const app = createApp();
    const server = app.listen(0);
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;

    const threadId = randomUUID();
    const payload = {
      threadId,
      //message: "你是谁", 
      //message: "今天天气如何？",
      message: "特朗普介绍",
      //message: "2026双子座运势",
      //message: "马杜罗被抓对国际局势有何影响",
      //message: "how are you",
      ////
      //message: "用一句话说出你是否可以访问互联网",
      //message: "今天的日期",
      //message: "搜索互联网：今天的日期",
      //message: "1+1=？",
      //message: "搜索互联网：2025年F1世界冠军是谁", //都可以，gpt很慢
      //message:"你能调用工具搜索互联网吗",
      //message: "一句话描述春天", //都可以
      contextTurns: []
    };

    console.log("=== REQUEST ===");
    console.log(JSON.stringify(payload, null, 2));

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/aggr/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await res.text();

      const events = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      const finalEvent = events.find((e) => e?.type === "final");
      const errorEvent = events.find((e) => e?.type === "error");

      console.log(`=== RESPONSE status=${res.status} ===`);
      console.log(JSON.stringify({ finalEvent, errorEvent }, null, 2));

      assert.equal(res.status, 200);
      assert.ok(finalEvent || errorEvent);

      if (finalEvent) {
        const body = finalEvent.data;
        assert.equal(body.threadId, threadId);
        assert.equal(typeof body.turnId, "string");
        assert.ok(body.turnId.length > 0);

        assert.ok(Array.isArray(body.candidates));
        assertCandidateOrder(body.candidates);

        assert.ok(body.final && typeof body.final === "object");
        assert.equal(typeof body.final.final_answer, "string");
        assert.ok(body.final.final_answer.trim().length > 0);

        assert.ok(body.timing && typeof body.timing === "object");
        assert.equal(typeof body.timing.totalMs, "number");
        assert.equal(typeof body.timing.synthMs, "number");
      }

      if (errorEvent) {
        const body = errorEvent.data;
        assert.equal(body.threadId, threadId);
        assert.equal(typeof body.turnId, "string");
        assert.ok(body.turnId.length > 0);

        assert.ok(body.error && typeof body.error === "object");
        assert.equal(body.error.code, "UPSTREAM_ALL_FAILED");
        assert.equal(typeof body.error.message, "string");

        assert.ok(Array.isArray(body.candidates));
        assertCandidateOrder(body.candidates);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }
);
