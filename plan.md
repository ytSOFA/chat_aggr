# plan.md — 多模型聚合 AI Chat

目标：实现一个类似 ChatGPT 的对话式 AI Agent。用户每次提问后，后端并行调用 Claude / ChatGPT / Gemini 生成候选回答，再使用 Synthesizer（GLM-4.5-Flash）进行汇总，返回给用户。前端仅保留最近 10 个聊天 thread；每个 thread 原文上下文深度最多 8 轮(暂定)，超出部分删除最旧的轮。后端不保留状态。 
> 交互更新：不需要模型输出流式（stream）。用户等待期间前端展示“三个模型心跳圆点”指示正在思考。部署在自建服务器。

---

## 1. 范围与关键需求

### 1.1 功能范围（MVP）
- 前端
  - 左侧边栏从上显示ChatGPT及版本，Gemini及版本，Claude及版本
    “版本 = 后端环境变量里的模型名（如 CHATGPT_MODEL/GEMINI_MODEL/CLAUDE_MODEL），前端在启动时调用 /api/aggr/config 获取并展示。”
  - 左侧边栏提供“新聊天”入口，点击后进入空会话（不创建 thread）；**只有首次发送消息时才生成 `threadId` 并创建 thread**（更省 thread 配额）。
  - 左侧边栏显示最近 10 个聊天 thread（按最近更新时间排序）。
  - 主聊天区：用户输入后立即显示 3 个模型的“心跳圆点”加载状态（不显示流式 token）。
  - 后端返回后：展示最终汇总答案（默认），并可展开查看 3 个模型的原始回答与状态（成功/超时/失败）。
  - 10 个 thread 与 8 轮上下文限制由前端 localStorage 维护，后端无状态。
- 后端（Node 服务）
  - 并行调用Claude / ChatGPT / Gemini生成候选回答。
  - 任一模型超时/失败时，不阻塞整体：用其余成功回答继续 Synthesizer 总结。
  - Synthesizer 使用智谱（ZhipuAI）GLM-4.5-Flash 进行汇总
  - 后端不保存thread和turn数据
- 部署
  - 自建服务器部署，要求布署简单

## 2. 技术架构

### 2.1 总体架构
- 前端：静态站点（纯 HTML/CSS/JS 或 Vite/React build 出来的静态文件）
- 后端：Node.js + TypeScript（Express）
  LLM Provider：统一接口封装 3 家 SDK + 1 个 Synthesizer Provider。

### 2.2 请求流程（无流式）
1. 前端提交用户消息（HTTP POST）。
2. 前端立即在 UI 中展示 3 个模型的“心跳圆点”（表示“思考中”）。
3. 后端并行调用 Claude / ChatGPT / Gemini：
   - 成功则记录候选回答；失败/超时则记录错误状态。
4. 后端将成功候选回答交给 GLM-4.5-Flash（Synthesizer）生成汇总 JSON。
5. 后端一次性返回：threadId（透传）、最终汇总、三模型原始回答与状态、耗时信息。
6. 前端停止心跳圆点，渲染最终答案与原始回答（折叠）。

---

## 3. 数据模型与上下文策略

### 3.1 Thread 与 Turn 定义与裁剪规则
- **1 轮（turn）= 用户一次输入 + Synthesizer 最终输出（final_answer）**  
- 本地只把 “userMessage + finalAnswer” 计入 turns（3 模型 candidates 不计入 turn 深度，可作为该 turn 的附件保存用于展开查看）。
- 每个 thread 最多保留 **8 轮** turns；超出时**删除最旧轮次**，保留最新 8 轮。
- 最多保留 **10 个 thread**；超出时按 `updatedAt` 删除最旧 thread（连同其 turns 一并删除）。
- `threadId` 由前端在**首次发送消息时**生成（UUID），后端只透传回响应（后端无状态）。

### 3.2 存储结构（建议）
- Thread
  - `id: string`
  - `title: string`（可取第一条用户消息截断或后续生成）
  - `updatedAt: number`
  - `turns: Turn[]`（仅保留最近 8 轮原文）
- Turn
  - `userMessage: string`
  - `finalAnswer: string`（Synthesizer 产出）
  - `candidates: Candidate[]`（3 模型原始回答与状态）
  - `createdAt: number`
- Candidate
  - `provider: 'claude' | 'chatgpt' | 'gemini'`
  - `model: string`
  - `status: 'ok' | 'timeout' | 'error'`
  - `text?: string`
  - `latencyMs?: number`
  - `errorMessage?: string`

### 3.3 仅保留最近 10 个 thread
- 淘汰策略：按 `updatedAt` 做 LRU（超出 10 个时移除最久未更新的 thread）。
- 重要：移除 thread 时连同其 turns/candidates 一并删除。

### 3.4 后端 API 契约（必须严格遵守）
#### `GET /api/aggr/config`
- 目的：前端在启动时获取“展示用”的模型版本信息（不包含任何密钥）。
- Response JSON：
```json
{
  "providers": {
    "chatgpt": { "model": "string" },
    "gemini": { "model": "string" },
    "claude": { "model": "string" }
  }
}
```

#### `POST /api/aggr/chat`
- Request JSON：
```json
{
  "threadId": "string",
  "message": "string",
  "contextTurns": [
    { "user": "string", "assistant": "string" }
  ]
}
```
`contextTurns` 按时间从旧到新排序；`assistant` 必须是上一轮 synth 的 final_answer

- Response JSON（一次性返回，无 stream）：
```json
{
  "threadId": "string",
  "turnId": "string",
  "final": {
    "final_answer": "string",
    "disagreements": [
      { "topic": "string", "positions": { "claude": "string", "chatgpt": "string", "gemini": "string" }, "resolution": "string" }
    ],
    "confidence": 0.0
  },
  "candidates": [
    { "provider": "claude", "model": "string", "status": "ok", "text": "string", "latencyMs": 0 },
    { "provider": "chatgpt", "model": "string", "status": "timeout", "errorMessage": "string", "latencyMs": 0 },
    { "provider": "gemini", "model": "string", "status": "error", "errorMessage": "string", "latencyMs": 0 }
  ],
  "timing": { "totalMs": 0, "synthMs": 0 }
}
```

- 字段语义约定：
  - `final.disagreements` 允许为空数组 `[]`（但字段必须存在）。
  - `final.disagreements[].positions` 必须固定包含 `claude` / `chatgpt` / `gemini` 三个 key；若某模型 `timeout/error` 或未参与综合，其值用空字符串 `""`。
  - `final.confidence` 取值范围 0.0–1.0：
    - 正常综合时由 Synthesizer 给出（仍需落在 0.0–1.0）。
    - 降级建议：仅 1 个候选成功时可设 `0.3`；Synthesizer 失败且回退为某个候选直出时设 `0.2`。

- 约束：
  - `contextTurns` 最多 8 轮；若前端传入超过 8 轮，后端必须截断到最后 8 轮（防御性）。
  - `threadId` 必填；新聊天在**首次发送消息时**由前端生成新的 `threadId`（新会话未发送前不占用 thread 配额）。
  - `turnId` 由后端生成（UUID）用于前端调试/追踪。
  - `candidates` 固定返回 3 条（`claude`/`chatgpt`/`gemini`），顺序固定；若某 provider 的 API Key 缺失/未配置或调用失败，用 `status: "error"` 占位并填写 `errorMessage`。
  - 若 3 个候选全部失败：返回 HTTP 502，并返回 JSON（同样包含 `candidates`，便于前端展示状态）：
    ```json
    {
      "threadId": "string",
      "turnId": "string",
      "error": { "code": "UPSTREAM_ALL_FAILED", "message": "string" },
      "candidates": [
        { "provider": "claude", "model": "string", "status": "error", "errorMessage": "string", "latencyMs": 0 },
        { "provider": "chatgpt", "model": "string", "status": "error", "errorMessage": "string", "latencyMs": 0 },
        { "provider": "gemini", "model": "string", "status": "error", "errorMessage": "string", "latencyMs": 0 }
      ]
    }
    ```

### 3.5 前端 localStorage（实现约束）
- localStorage key：`ai_chat_state_v1`
- 建议结构：
```json
{
  "version": 1,
  "activeThreadId": "string",
  "threads": [
    {
      "id": "string",
      "title": "string",
      "updatedAt": 0,
      "turns": [
        {
          "userMessage": "string",
          "finalAnswer": "string",
          "createdAt": 0,
          "candidates": []
        }
      ]
    }
  ]
}
```
- threads 与 turns 的裁剪规则必须与 3.1 一致。
- 首次发送失败处理（HTTP 502）：
  - 若该会话是首次发送消息（即刚生成 `threadId` 的那次请求）且后端返回 502，则**不在 localStorage 中保留该 thread/threadId**，也**不会生成一条 error turn**。


---

## 4. LLM Provider 设计

### 4.1 统一接口（TypeScript）
- `LLMProvider` 统一对外：
  - `name: string`
  - `generateChat(params): Promise<{ text: string, usage?, latencyMs }>`
- `params` 应包含：
  - `messages: { role: 'system'|'user'|'assistant', content: string }[]`
  - `model: string`
  - `timeoutMs: number`

### 4.2 三模型并行调用（Orchestrator）
- 并行执行：`Promise.allSettled` / 自定义任务池。
- 每个 provider 设定超时：例如 `PROVIDER_TIMEOUT_MS=20000`。
- 等到所有 provider settled（含超时）后再 synth
- 结果归一化为 `Candidate[]`：成功就写 text，失败记录 status 与错误信息。
- 若某 provider 的 API Key 缺失/未配置：该 provider 直接返回 `status: "error"`（不发起外部请求），并继续使用其余候选进入 Synthesizer。

### 4.3 Synthesizer（GLM-4.5-Flash）
- 合成策略：仅使用成功的候选回答进行总结。
- 强制结构化输出（严格 JSON），便于前端渲染与审计。
- 实现要求：Synthesizer 通过**智谱（ZhipuAI）LLM 接口**调用 `GLM-4.5-Flash`。
- 配置（环境变量）：
  - `ZHIPU_API_KEY`：智谱 API Key
  - `SYNTH_MODEL`：Synthesizer 模型名（默认 `glm-4.5-Flash`）
- Endpoint 约定：默认使用各厂商官方 SDK/默认 API Endpoint；**不支持/不需要通过 `*_BASE_URL` 配置自定义网关**。

### 4.4 并发、超时、降级（写死策略）
- 后端每次请求并行调用 3 家模型：Claude / ChatGPT / Gemini。
- 默认超时（可用环境变量覆盖）：
  - `PROVIDER_TIMEOUT_MS=20000`
  - `SYNTH_TIMEOUT_MS=10000`
- 任一 provider 超时/失败：
  - 记录对应 `Candidate.status = timeout | error`，并继续流程（不阻塞）。
- 候选回答数量不足时：
  - **至少 1 个候选成功**：仍然调用 Synthesizer 总结（并在 `confidence` 适当降低）。
  - **0 个候选成功**：返回 HTTP 502，提示稍后重试。
- Synthesizer 失败：
  - 降级返回：选一个成功候选作为 `final.final_answer`（例如“最长且可读性最好”），并把 `candidates` 原样返回，`confidence` 设为较低值（如 0.2）（以 3.4 约定为准）。

### 4.5 Synthesizer（GLM-4.5-Flash）输出要求（必须）
- Synthesizer 必须输出**严格 JSON**，只输出 `final` 对象本身（后端负责把 `candidates` / `timing` 拼装到 `POST /api/aggr/chat` 的响应中）。
```json
{
  "final_answer": "string",
  "disagreements": [
    { "topic": "string", "positions": { "claude": "string", "chatgpt": "string", "gemini": "string" }, "resolution": "string" }
  ],
  "confidence": 0.0
}
```
- **不得输出任何额外文本**（例如前后缀说明、代码块标记）。
- 合成规则（写入 system prompt）：
你是一个“多模型回答汇总器（Chat Synthesizer）”。你会收到：用户问题、可选的最近上下文，以及来自 claude/chatgpt/gemini 的候选回答。
你的任务是输出一个严格 JSON 对象，完全符合指定 schema，用于前端渲染与审计。
硬性规则（必须遵守）：
只输出一个 JSON 对象，不得输出任何其他文本、解释、markdown、代码块标记。
只能基于 candidates 的内容归纳，不得编造新事实或引入未出现的信息。
如果 candidates 之间存在冲突或差异显著，必须写入 disagreements，不要强行融合。
输出语言取 candidates 中占多数的语言（默认中文）。
字段含义与填充规则：
final_answer：给用户的最终答复。清晰、可执行、结构化。
disagreements：候选回答的分歧点列表。每个分歧必须包含：
topic：分歧主题（短标题）
positions：提炼 claude/chatgpt/gemini 的观点（简短摘要；若某模型无可用回答，写 ""）
resolution：如何处理该分歧（条件化结论/更保守建议/需要澄清的问题）
没有分歧则 []。
confidence：0~1 的小数。3 个回答一致且信息充分时更高；候选少、冲突多、信息不足时更低。
输出必须严格符合 schema：
必须包含键：final_answer, disagreements, confidence。不得缺键。

### 4.6 配置常量（建议写死）
- 前端（localStorage 裁剪相关）：
  - `LOCAL_STORAGE_KEY = "ai_chat_state_v1"`
  - `MAX_THREADS = 10`
  - `MAX_TURNS_PER_THREAD = 8`
- 后端（防御性截断/超时相关）：
  - `MAX_CONTEXT_TURNS = 8`
  - `PROVIDER_TIMEOUT_MS_DEFAULT = 20000`
  - `SYNTH_TIMEOUT_MS_DEFAULT = 10000`

### 4.7 环境变量（最小集）
- ChatGPT：`CHATGPT_API_KEY`、`CHATGPT_MODEL`
- Claude：`CLAUDE_API_KEY`、`CLAUDE_MODEL`
- Gemini：`GEMINI_API_KEY`、`GEMINI_MODEL`
- Synthesizer（智谱）：`ZHIPU_API_KEY`、`SYNTH_MODEL`（默认 `glm-4.5-Flash`）
- 超时：`PROVIDER_TIMEOUT_MS`、`SYNTH_TIMEOUT_MS`
- 服务：`PORT`、`NODE_ENV`

---


## 5. 前端页面与交互

### 5.1 页面结构
- 左侧：Threads 列表（最多 10 条）
  - 显示 title、更新时间
- 右侧：聊天区
  - 消息输入框
  - 消息列表：用户消息、最终汇总答案（默认展开）、原始候选答案（折叠）

### 5.2 心跳圆点（无 stream）
- 用户点击发送后：
  - 立即显示 3 个模型的“心跳圆点”组件（例如 3 个 pulsing dots，对应 Claude/ChatGPT/Gemini）。
- 当后端响应返回：
  - 停止动画，替换为各模型状态：
    - `ok`：显示完成标记（如 ✅）
    - `timeout`：显示超时（如 ⏱️）
    - `error`：显示失败（如 ⚠️）
  - 展示最终汇总答案；可展开查看原始候选回答。

> 注：MVP 无法提前显示“某模型先完成”的瞬间状态，除非引入 SSE/WS 或轮询；本期不做。

### 5.3 页面图标
- 左侧栏，模型版本下面，将文字ChatGPT替换为图片：https://www.edigitalagency.com.au/wp-content/uploads/new-ChatGPT-logo-black-png-large-size.png
  将文字Gemini替换为图片： https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Google_Gemini_logo_2025.svg/2560px-Google_Gemini_logo_2025.svg.png
  将文字Claude替换为图片：https://i.logos-download.com/114232/31116-s1280-fa091cbf2b0bebc0fad188b896376d53.png/Claude_Logo_2023-s1280.png
- 当用户点击发送后，会立即显示 3 个模型的“心跳圆点”组件（例如 3 个 pulsing dots，对应 Claude/ChatGPT/Gemini）。
  将Claude/ChatGPT/Gemini文字改为对应的图标
  Claude: https://registry.npmmirror.com/@lobehub/icons-static-png/latest/files/dark/claude-color.png
  ChatGPT: https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/ChatGPT-Logo.png/1280px-ChatGPT-Logo.png
  Gemini: https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Google_Gemini_icon_2025.svg/1200px-Google_Gemini_icon_2025.svg.png

### 5.4 左侧边栏删除thread功能
- 鼠标悬停/键盘聚焦时出现删除按钮
- 需要二次确认 confirm()
- 删除当前线程后，自动切到“新聊天”（清空主区）

---

## 6. 可靠性与降级策略

- 并行调用任何 provider 超时/失败：
  - 记录对应 `Candidate.status` 为 `timeout`/`error`
  - 不阻塞整体：使用其余成功候选进入 Synthesizer。
- 若仅 1 个候选成功：
  - 仍然调用 Synthesizer（或直接返回该候选作为 final 的降级策略，二选一；推荐仍 synth，并降低 confidence）。
- 若 3 个候选全部失败：
  - 直接返回错误（HTTP 502），并提示用户稍后重试。
- 若 Synthesizer 失败：
  - 降级输出：选“最可读/最长/最近成功”的候选作为 `final_answer`，并附上其它候选/错误信息（供排障）。

### 6.1 日志与隐私
- 后端允许打印任意调试信息（包括请求/响应内容、候选回答、Synth 输出等），但**严禁打印任何 API Key**（包括 `CHATGPT_API_KEY` / `CLAUDE_API_KEY` / `GEMINI_API_KEY` / `ZHIPU_API_KEY` 等）。
- 若日志中可能出现密钥形态字符串，输出前必须脱敏（替换为 `***`）。

### 6.2 访问控制
- 本项目默认**不做任何访问控制/鉴权**（不实现登录、Token、IP 白名单、Basic Auth 等）。

---

## 7. 测试与验收标准

### 7.1 核心用例
- 新建 thread：首次发送消息时生成 `threadId`，边栏出现新条目。
- 最近 10 个 thread：创建第 11 个后最旧的被淘汰。
- 深度 8 轮：第 9 轮后删最旧的轮上下文，仍保持对话连贯。
- 某模型超时：最终仍返回汇总答案，并标注超时模型。
- Synthesizer 失败：触发降级策略仍可返回可用答复。

### 7.2 体验标准
- 前端发送后立即出现 3 个心跳圆点。
- 响应返回后心跳停止，显示模型状态与最终答案。
- 原始候选回答默认折叠，用户可展开查看。

---

### 8. 本地测试
- 0. 后端冒烟测试：cd backend
                 RUN_REAL_LLM_SMOKE=1 npm run test:smoke
- 1. 后端：cd backend && npm run dev（默认 3000）
- 2. 前端：npx serve frontend -l 3001（或任意静态服）
- 3. 浏览器打开：http://localhost:3001/?api=http://localhost:3000（即使不带 ?api，在 3001 端口也会自动指向 3000）




