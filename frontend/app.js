const STORAGE_KEY = "ai_chat_state_v1";
const MAX_THREADS = 10;
const MAX_TURNS_PER_THREAD = 8;
const MAX_CONTEXT_TURNS = 8;

const $ = (id) => document.getElementById(id);

function resolveApiBase() {
  const urlParam = new URLSearchParams(location.search).get("api");
  if (urlParam) return urlParam.replace(/\/+$/, "");
  if (location.port === "3001") return "http://localhost:3000";
  return "";
}

const API_BASE = resolveApiBase();

const els = {
  threadsList: $("threads-list"),
  threadsEmpty: $("threads-empty"),
  chatEmpty: $("chat-empty"),
  chatList: $("chat-list"),
  topbarTitle: $("topbar-title"),
  topbarMeta: $("topbar-meta"),
  input: $("composer-input"),
  send: $("btn-send"),
  newChat: $("btn-new-chat"),
  toast: $("toast"),
  hint: $("composer-hint"),
  modelChatGPT: $("model-chatgpt"),
  modelGemini: $("model-gemini"),
  modelClaude: $("model-claude"),
  rotateTip: $("rotate-tip"),
  rotateTipClose: $("rotate-tip-close")
};

let state = loadState();
let pending = null; // { mode: 'inflight'|'error', threadId, isNewThread, userMessage, startedAt, candidates?, error? }

init();

function init() {
  wireEvents();
  renderAll();
  loadConfig();
}

function wireEvents() {
  els.newChat.addEventListener("click", () => {
    pending = null;
    state.activeThreadId = null;
    saveState(state);
    renderAll();
    els.input.focus();
  });

  els.send.addEventListener("click", () => sendMessage());
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  if (els.rotateTip && els.rotateTipClose) {
    els.rotateTipClose.addEventListener("click", () => {
      els.rotateTip.hidden = true;
    });
  }
}

async function loadConfig() {
  try {
    const res = await fetch(`${API_BASE}/api/aggr/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    els.modelChatGPT.textContent = data?.providers?.chatgpt?.model ?? "";
    els.modelGemini.textContent = data?.providers?.gemini?.model ?? "";
    els.modelClaude.textContent = data?.providers?.claude?.model ?? "";
  } catch (err) {
    els.modelChatGPT.textContent = "未连接";
    els.modelGemini.textContent = "未连接";
    els.modelClaude.textContent = "未连接";
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, activeThreadId: null, threads: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("bad state");
    const threads = Array.isArray(parsed.threads) ? parsed.threads : [];
    const activeThreadId = typeof parsed.activeThreadId === "string" ? parsed.activeThreadId : null;
    return {
      version: 1,
      activeThreadId,
      threads: threads
        .filter((t) => t && typeof t.id === "string")
        .map((t) => ({
          id: t.id,
          title: typeof t.title === "string" ? t.title : "未命名",
          updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : 0,
          turns: Array.isArray(t.turns)
            ? t.turns
                .filter((x) => x && typeof x.userMessage === "string" && typeof x.finalAnswer === "string")
                .map((x) => ({
                  userMessage: x.userMessage,
                  finalAnswer: x.finalAnswer,
                  createdAt: typeof x.createdAt === "number" ? x.createdAt : 0,
                  candidates: Array.isArray(x.candidates) ? x.candidates : [],
                  timing: x.timing && typeof x.timing === "object" ? x.timing : undefined
                }))
            : []
        }))
    };
  } catch {
    return { version: 1, activeThreadId: null, threads: [] };
  }
}

function saveState(nextState) {
  const pruned = pruneState(nextState);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  state = pruned;
}

function pruneState(s) {
  const threads = [...(s.threads ?? [])]
    .map((t) => ({
      ...t,
      turns: Array.isArray(t.turns) ? t.turns.slice(-MAX_TURNS_PER_THREAD) : []
    }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, MAX_THREADS);

  const activeExists = s.activeThreadId && threads.some((t) => t.id === s.activeThreadId);
  return {
    version: 1,
    activeThreadId: activeExists ? s.activeThreadId : null,
    threads
  };
}

function getActiveThread() {
  if (!state.activeThreadId) return null;
  return state.threads.find((t) => t.id === state.activeThreadId) ?? null;
}

function renderAll() {
  renderThreads();
  renderChat();
}

function renderThreads() {
  const threadsSorted = [...state.threads].sort((a, b) => b.updatedAt - a.updatedAt);
  els.threadsList.innerHTML = "";

  if (!threadsSorted.length) {
    els.threadsEmpty.hidden = false;
    return;
  }
  els.threadsEmpty.hidden = true;

  for (const thread of threadsSorted) {
    const el = document.createElement("div");
    el.className = "thread-item" + (thread.id === state.activeThreadId ? " active" : "");
    el.tabIndex = 0;

    const title = document.createElement("div");
    title.className = "thread-title";
    title.textContent = thread.title || "未命名";

    const meta = document.createElement("div");
    meta.className = "thread-meta";
    const left = document.createElement("span");
    left.textContent = `${thread.turns.length} 轮`;
    const right = document.createElement("span");
    right.textContent = formatTime(thread.updatedAt);
    meta.append(left, right);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "thread-delete";
    del.textContent = "删除";
    del.setAttribute("aria-label", `删除对话：${thread.title || "未命名"}`);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pending?.mode === "inflight" && pending.threadId === thread.id) {
        showToast("当前对话正在请求中，无法删除");
        return;
      }
      const ok = window.confirm(`删除对话“${thread.title || "未命名"}”？此操作不可恢复。`);
      if (!ok) return;
      state.threads = state.threads.filter((t) => t.id !== thread.id);
      if (state.activeThreadId === thread.id) {
        state.activeThreadId = null;
      }
      if (pending && pending.threadId === thread.id) {
        pending = null;
      }
      saveState(state);
      renderAll();
    });

    el.append(title, meta);
    el.appendChild(del);

    el.addEventListener("click", () => {
      pending = null;
      state.activeThreadId = thread.id;
      saveState(state);
      renderAll();
    });

    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });

    els.threadsList.appendChild(el);
  }
}

function renderChat() {
  const activeThread = getActiveThread();
  const isNewChat = !activeThread;
  const title = isNewChat ? "新聊天" : activeThread.title;
  els.topbarTitle.textContent = title;

  const turns = activeThread?.turns ?? [];

  const hasMessages = turns.length > 0 || pending;
  // Debug：观测当前渲染状态（可按需去掉）
  console.log("[renderChat]", { activeThreadId: state.activeThreadId, turns: turns.length, pending: !!pending, hasMessages });

  els.chatEmpty.hidden = hasMessages;
  els.chatList.hidden = !hasMessages;
  // 保险：若有消息强制显示列表
  if (hasMessages) {
    els.chatEmpty.hidden = true;
    els.chatList.hidden = false;
  }

  if (!hasMessages) return;

  els.chatList.innerHTML = "";

  for (const turn of turns) {
    els.chatList.appendChild(renderTurn(turn));
  }

  if (pending) {
    els.chatList.appendChild(renderPendingTurn(pending));
  }

  // Auto-scroll to bottom.
  requestAnimationFrame(() => {
    els.chatList.scrollTop = els.chatList.scrollHeight;
  });
}

function renderTurn(turn) {
  const container = document.createElement("div");
  container.className = "msg";

  const userBubble = document.createElement("div");
  userBubble.className = "bubble user";
  userBubble.textContent = turn.userMessage;

  const assistantBubble = document.createElement("div");
  assistantBubble.className = "bubble assistant";
  assistantBubble.textContent = turn.finalAnswer;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = formatTime(turn.createdAt);
  meta.appendChild(tag);

  if (turn.timing && typeof turn.timing.totalMs === "number") {
    const t = document.createElement("span");
    t.className = "tag";
    t.textContent = `耗时 ${Math.round(turn.timing.totalMs)}ms`;
    meta.appendChild(t);
  }

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "展开查看 3 个模型候选回答与状态";
  details.appendChild(summary);

  const candidates = document.createElement("div");
  candidates.className = "candidates";
  for (const c of normalizeCandidates(turn.candidates)) {
    candidates.appendChild(renderCandidate(c));
  }
  details.appendChild(candidates);

  container.append(meta, userBubble, assistantBubble, details);
  return container;
}

function renderPendingTurn(p) {
  const container = document.createElement("div");
  container.className = "msg";

  const userBubble = document.createElement("div");
  userBubble.className = "bubble user";
  userBubble.textContent = p.userMessage;

  const assistantBubble = document.createElement("div");
  assistantBubble.className = "bubble assistant";

  if (p.error) {
    assistantBubble.textContent = p.error;
  } else if (p.streamText) {
    assistantBubble.textContent = p.streamText;
  } else {
    const wrap = document.createElement("div");
    wrap.className = "msg-meta";
    wrap.appendChild(renderPulse("Claude"));
    wrap.appendChild(renderPulse("ChatGPT"));
    wrap.appendChild(renderPulse("Gemini"));
    assistantBubble.appendChild(wrap);
  }

  container.append(userBubble, assistantBubble);

  if (p.candidates) {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = "本次请求失败（未写入本地对话），候选状态如下";
    details.appendChild(summary);

    const candidates = document.createElement("div");
    candidates.className = "candidates";
    for (const c of normalizeCandidates(p.candidates)) {
      candidates.appendChild(renderCandidate(c));
    }
    details.appendChild(candidates);
    container.appendChild(details);
  }

  return container;
}

function renderPulse(label) {
  const el = document.createElement("span");
  el.className = "pulse";
  const logos = {
    Claude: "./assets/pulse-claude.png",
    ChatGPT: "./assets/chatgpt_logo_trim_1024.png",
    Gemini: "./assets/pulse-gemini.png"
  };
  const src = logos[label];
  let name = null;
  if (src) {
    name = document.createElement("img");
    name.className = `pulse-logo${label === "ChatGPT" ? " pulse-logo-chatgpt" : ""}`;
    name.src = src;
    name.alt = label;
    name.title = label;
  } else {
    name = document.createElement("span");
    name.textContent = label;
  }
  const dots = document.createElement("span");
  dots.className = "dots";
  dots.innerHTML = `<span class="dot"></span><span class="dot"></span><span class="dot"></span>`;
  el.append(name, dots);
  return el;
}

function renderCandidate(c) {
  const wrap = document.createElement("div");
  wrap.className = "candidate";

  const head = document.createElement("div");
  head.className = "candidate-head";

  const left = document.createElement("div");
  left.className = "candidate-title";
  left.textContent = `${providerLabel(c.provider)}`;

  const right = document.createElement("div");
  right.className = "candidate-meta";
  right.textContent = `${c.model || ""}${typeof c.latencyMs === "number" ? ` · ${Math.round(c.latencyMs)}ms` : ""}`;

  head.append(left, right);

  const badge = document.createElement("div");
  badge.className = `badge ${c.status}`;
  badge.textContent = c.status.toUpperCase();

  const text = document.createElement("div");
  text.className = "candidate-text";
  if (c.status === "ok") text.textContent = c.text ?? "";
  else text.textContent = c.errorMessage ?? (c.status === "timeout" ? "timeout" : "error");

  wrap.append(head, badge, text);
  return wrap;
}

function normalizeCandidates(candidates) {
  const byProvider = new Map();
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (c && typeof c.provider === "string") byProvider.set(c.provider, c);
  }

  const order = ["claude", "chatgpt", "gemini"];
  return order.map((p) => {
    const c = byProvider.get(p) ?? {};
    return {
      provider: p,
      model: typeof c.model === "string" ? c.model : "",
      status: ["ok", "timeout", "error"].includes(c.status) ? c.status : "error",
      text: typeof c.text === "string" ? c.text : "",
      latencyMs: typeof c.latencyMs === "number" ? c.latencyMs : 0,
      errorMessage: typeof c.errorMessage === "string" ? c.errorMessage : ""
    };
  });
}

function providerLabel(p) {
  if (p === "claude") return "Claude";
  if (p === "chatgpt") return "ChatGPT";
  if (p === "gemini") return "Gemini";
  return String(p);
}

async function sendMessage() {
  if (pending?.mode === "inflight") return;
  const text = els.input.value.trim();
  if (!text) return;

  const activeThread = getActiveThread();
  const isNewThread = !activeThread;
  const threadId = isNewThread ? crypto.randomUUID() : activeThread.id;

  const contextTurns = (activeThread?.turns ?? []).slice(-MAX_CONTEXT_TURNS).map((t) => ({
    user: t.userMessage,
    assistant: t.finalAnswer
  }));

  pending = {
    mode: "inflight",
    threadId,
    isNewThread,
    userMessage: text,
    startedAt: Date.now()
  };
  els.input.value = "";
  setComposerDisabled(true);
  renderChat();

  try {
    const res = await fetch(`${API_BASE}/api/aggr/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadId, message: text, contextTurns })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // Only 502 is expected by the plan for upstream all failed; treat others as generic.
      const message = data?.error?.message || `请求失败：HTTP ${res.status}`;
      showToast(message);

      // If first send of a new chat fails, do not keep thread/threadId, no error turn.
      pending = {
        mode: "error",
        threadId,
        isNewThread,
        userMessage: text,
        startedAt: Date.now(),
        error: `请求失败（HTTP ${res.status}）：${message}`,
        candidates: data?.candidates
      };
      renderChat();
      return;
    }

    if (!res.body) throw new Error("响应为空：未收到流数据");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData = null;
    let errorData = null;

    const handleEvent = (evt) => {
      if (!evt || typeof evt !== "object") return;
      if (evt.type === "delta") {
        if (!pending || pending.mode !== "inflight") return;
        const delta = typeof evt.text === "string" ? evt.text : "";
        if (!delta) return;
        pending.streamText = (pending.streamText ?? "") + delta;
        renderChat();
        return;
      }
      if (evt.type === "final") {
        finalData = evt.data ?? null;
        return;
      }
      if (evt.type === "error") {
        errorData = evt.data ?? null;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // ignore invalid chunks
        }
        if (finalData || errorData) break;
      }
      if (finalData || errorData) {
        await reader.cancel().catch(() => {});
        break;
      }
    }

    const tail = buffer + decoder.decode();
    if (tail.trim()) {
      for (const line of tail.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          // ignore trailing parse errors
        }
      }
    }

    if (errorData) {
      const message = errorData?.error?.message || "请求失败";
      showToast(message);
      pending = {
        mode: "error",
        threadId,
        isNewThread,
        userMessage: text,
        startedAt: Date.now(),
        error: `请求失败：${message}`,
        candidates: errorData?.candidates
      };
      renderChat();
      return;
    }

    if (!finalData) throw new Error("后端返回格式异常：final 为空");

    // Success: write a new turn into localStorage.
    const finalAnswer = finalData?.final?.final_answer ?? "";
    if (!finalAnswer.trim()) throw new Error("后端返回格式异常：final_answer 为空");

    const turn = {
      userMessage: text,
      finalAnswer,
      createdAt: Date.now(),
      candidates: finalData?.candidates ?? [],
      timing: finalData?.timing ?? undefined
    };

    if (isNewThread) {
      const title = makeTitle(text);
      state.threads.unshift({ id: threadId, title, updatedAt: Date.now(), turns: [turn] });
      state.activeThreadId = threadId;
    } else {
      const thread = state.threads.find((t) => t.id === threadId);
      if (!thread) throw new Error("thread 不存在");
      thread.turns.push(turn);
      thread.updatedAt = Date.now();
      if (!thread.title || thread.title === "未命名") {
        thread.title = makeTitle(thread.turns[0]?.userMessage ?? text);
      }
    }

    saveState(state);
    pending = null;
    renderAll();
  } catch (err) {
    showToast(`网络错误：${err?.message ?? "unknown"}`);
    pending = {
      mode: "error",
      threadId,
      isNewThread,
      userMessage: text,
      startedAt: Date.now(),
      error: `网络错误：${err?.message ?? "unknown"}`,
      candidates: null
    };
    renderChat();
  } finally {
    setComposerDisabled(false);
    els.input.focus();
  }
}

function setComposerDisabled(disabled) {
  els.send.disabled = disabled;
  els.hint.textContent = "";
}

function showToast(text) {
  els.toast.hidden = false;
  els.toast.textContent = text;
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function makeTitle(text) {
  const t = String(text).trim().replace(/\s+/g, " ");
  return t.length > 22 ? t.slice(0, 22) + "…" : t || "未命名";
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return "";
  }
}
