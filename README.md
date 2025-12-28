# 多模型聚合AI Chat

一个自建服务的多模型聚合对话应用：后端并行调用 Claude / ChatGPT / Gemini 生成候选回答，再由 Synthesizer（智谱 GLM-4.5-Flash）汇总；前端为纯静态页面，使用 localStorage 保存最近对话（最多 10 个线程、每线程 8 轮），无流式输出。

## 目录结构
- `backend/`：Node.js + TypeScript 后端服务
- `frontend/`：静态前端（HTML/CSS/JS）
- `plan.md`：需求/接口约定文档

## 接口
- `GET /api/aggr/config`：返回模型版本（来自环境变量）
- `POST /api/aggr/chat`：发送消息并获取汇总与候选

## 环境变量（后端）
在 `backend/.env` 或项目根目录 `.env` 设置（示例见 `backend/.env.example`）：
- `CHATGPT_API_KEY`、`CHATGPT_MODEL`
- `CLAUDE_API_KEY`、`CLAUDE_MODEL`
- `GEMINI_API_KEY`、`GEMINI_MODEL`
- `ZHIPU_API_KEY`、`SYNTH_MODEL`（默认 `glm-4.5-Flash`）
- `PROVIDER_TIMEOUT_MS`、`SYNTH_TIMEOUT_MS`
- `PORT`、`NODE_ENV`

## 本地运行
后端：
```bash
cd backend
npm install
npm run dev
```

前端（静态文件服务任意方式）：
```bash
cd frontend
npx serve . -l 3001
```

访问：
- `http://localhost:3001/?api=http://localhost:3000`
- 若不带 `?api`，在 3001 端口会默认指向 3000

## 部署（简要）
1. 后端：`cd backend && npm install && npm run build && npm start`
2. 前端：将 `frontend/` 目录作为静态站点部署（建议与后端同域名，避免 CORS）

## 使用说明
- 点击“新聊天”后输入问题发送
- 等待期间显示 3 个模型心跳图标
- 服务端返回后显示汇总答案，可展开查看三模型候选与状态

