/**
 * WaitSpark Chrome Extension Service Worker (Manifest V3)
 *
 * Performs silent background deep thinking right after the user sends a message
 * in ChatGPT / Codex Web / Claude / Gemini, returning 1~2 high-curiosity items:
 *   1. 「灵感」 (mode="wild", kind="question"): counter-intuitive idea / cross-domain spark + detailed answer
 *   2. 「查漏」 (mode="explain", kind="quiz"): active-recall micro-quiz to catch blind spots + explanation
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: "demo", // "demo" | "openai" | "deepseek" | "ollama" | "gemini" | "anthropic"
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
};

const SYSTEM_PROMPT = `你是 WaitSpark（融合 WaitChatter 等待期微学习与 Quiz-Master 主动回忆的思维伴侣）。
用户刚刚在聊天框发送了一条消息，正进入等待回复的空窗期。请紧扣用户本轮消息与上下文，产出 **严格 2 条** 极有吸引力、让人忍不住想点开的微内容：

- 第 1 条：**「灵感」反直觉设问**（mode = "wild", kind = "question"）
  - 挑战当前做法里的一个隐含假设，提出跨界/反常识但有硬核根基的 “What if...” 设问；
  - options 为空数组 []，correct_index 为 -1；
  - answer 写 180~320 字高密度细致回答（核心直觉 → 为什么反直觉却可能奏效 → 下一步最小验证）。

- 第 2 条：**「查漏」查漏补缺微考题**（mode = "explain", kind = "quiz"）
  - 围绕当前问题涉及的底层原理、隐形边界条件、参数耦合或高频踩坑点，出一道让人想验证直觉的 3 选 1 微考题；
  - options 给 3 个精炼且具迷惑性的短选项（每项 8~24 字，不要带 A./B./C. 前缀）；
  - correct_index 为 0、1 或 2（保证逻辑严谨，不要总是固定选 0）；
  - answer 写 180~320 字第一性原理详解（先讲透正解原理，再简短拆穿干扰项，最后给一条避坑提示）。

严格要求：
1. 严禁泛泛模板句，必须紧扣本轮具体对象、概念或机制；
2. title 控制在 12~24 字，直接写问题本身，**不要**在开头加“灵感：”“脑洞：”“考题：”“查漏：”等标签前缀；
3. 排版克制清爽，少用 Emoji，可用 **加粗** 和 \`行内代码\`；
4. 只返回合法 JSON 数组（不要输出任何额外解释文字）：
[
  {
    "mode": "wild",
    "kind": "question",
    "title": "12~24字直接问句（无前缀）",
    "question": "展开后显示的完整设问（25~60字）",
    "options": [],
    "correct_index": -1,
    "answer": "180~320字细致回答",
    "follow_up_prompt": "用户点填入聊天框追问时的追问句"
  },
  {
    "mode": "explain",
    "kind": "quiz",
    "title": "12~24字查漏问句（无前缀）",
    "question": "展开后显示的完整考题题干（25~65字）",
    "options": ["选项一", "选项二", "选项三"],
    "correct_index": 1,
    "answer": "180~320字第一性原理详解",
    "follow_up_prompt": "用户点填入聊天框追问时的追问句"
  }
]`;

export function stripOptionPrefix(text) {
  return String(text ?? "")
    .trim()
    .replace(/^[A-Da-d1-4][.\u3001):]\s*/, "")
    .trim();
}

export function stripTitlePrefix(text) {
  return String(text ?? "")
    .trim()
    .replace(/^(灵感|脑洞|考题|查漏|拓展|反直觉|思考)[:：\s·\-]+/, "")
    .trim();
}

export function normalizeCards(rawCards) {
  let list = [];
  if (Array.isArray(rawCards)) {
    list = rawCards;
  } else if (rawCards && typeof rawCards === "object") {
    list = Array.isArray(rawCards.cards)
      ? rawCards.cards
      : Array.isArray(rawCards.items)
      ? rawCards.items
      : [rawCards];
  }

  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rawTitle = stripTitlePrefix(item.title || item.question || "");
    const question = String(item.question || item.title || "").trim();
    if (!rawTitle && !question) continue;

    const mode = String(item.mode || "wild").trim().toLowerCase() === "explain" ? "explain" : "wild";
    const options = Array.isArray(item.options)
      ? item.options.map(stripOptionPrefix).filter(Boolean).slice(0, 4)
      : [];
    const reqKind = String(item.kind || "").trim().toLowerCase();
    const kind = (reqKind === "quiz" || options.length >= 2) && options.length >= 2 ? "quiz" : "question";

    let correctIndex = -1;
    if (kind === "quiz") {
      const ci = Number(item.correct_index);
      correctIndex = Number.isInteger(ci) && ci >= 0 && ci < options.length ? ci : 0;
    }

    out.push({
      mode,
      kind,
      title: (rawTitle || question).slice(0, 32),
      question: question || rawTitle,
      options: kind === "quiz" ? options : [],
      correct_index: correctIndex,
      answer: String(item.answer || "").trim(),
      follow_up_prompt: String(item.follow_up_prompt || item.prompt || question || rawTitle).trim(),
    });
  }
  // Enforce 1~2 items, 「灵感」(wild) before 「查漏」(explain)
  out.sort((a, b) => (a.mode === "wild" ? 0 : 1) - (b.mode === "wild" ? 0 : 1));
  return out.slice(0, 2);
}

export function parseModelJson(rawText) {
  let text = String(rawText || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    text = fenced[1].trim();
  } else {
    const arrStart = text.indexOf("[");
    const arrEnd = text.lastIndexOf("]");
    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (arrStart !== -1 && arrEnd > arrStart) {
      text = text.slice(arrStart, arrEnd + 1);
    } else if (objStart !== -1 && objEnd > objStart) {
      text = text.slice(objStart, objEnd + 1);
    }
  }
  // Clean common trailing commas produced by some models
  const cleaned = text.replace(/,\s*([}\]])/g, "$1");
  const parsed = JSON.parse(cleaned);
  return normalizeCards(parsed);
}

export function buildDemoCards(promptText) {
  const clean = String(promptText || "当前问题").replace(/\s+/g, " ").trim();
  const short = clean.slice(0, 13).replace(/[，。！？、\s]+$/, "") || "当前问题";
  return [
    {
      mode: "wild",
      kind: "question",
      title: `给「${short}」主动加约束反而更快？`,
      question: `围绕「${clean.slice(0, 44)}」，如果主动收紧一个自由度或引入轻微扰动，会不会反而更快收敛到稳健解？`,
      options: [],
      correct_index: -1,
      answer:
        `**核心直觉**：在复杂工程与算法调优里，过大的自由度常常带来大量“窄而脆”的局部最优，表面指标好看，一遇边界扰动就失效。\n\n` +
        `**为什么反直觉却常奏效**：刻意收紧次要自由度或加入结构化扰动，相当于隐式正则化——把搜索压进“宽而平”的鲁棒区域，收敛更稳、泛化也更强。\n\n` +
        `**最小验证**：保持主逻辑不变，只挑最敏感的 1 个参数做 ±10% 扰动对照，盯住最差 5% 样本而非均值。`,
      follow_up_prompt: `围绕「${clean.slice(0, 60)}」，从“主动收紧约束或加扰动提升鲁棒性”的角度给一个具体可验证方案。`,
    },
    {
      mode: "explain",
      kind: "quiz",
      title: `排查「${short}」最容易误判的信号？`,
      question: `推进「${clean.slice(0, 42)}」时，若前期平均指标快速变好但尾部极端样本波动放大，最合理的诊断是什么？`,
      options: [
        "方向完全正确，忽略尾部波动即可",
        "可能触发了局部捷径或边界失稳，应优先查尾部样本",
        "步长或容量太小，应立刻放大 10 倍",
      ],
      correct_index: 1,
      answer:
        `**正确答案：B（可能触发了局部捷径或边界失稳，应优先查尾部样本）**\n\n` +
        `**第一性原理**：均值指标对“常规样本刷高分 + 关键边界崩溃”高度钝化。平均值抬升伴随方差放大，往往是过拟合主路径或约束松弛的早期信号。\n\n` +
        `**排除干扰项**：A 会让你在错误方向上白等很久；C 盲目放大步长只会加剧边界发散。\n\n` +
        `**避坑建议**：始终同时监控 \`P50\` 与 \`P95 / Worst-5%\`，把异常边界前置成快速烟雾测试。`,
      follow_up_prompt: `针对「${clean.slice(0, 60)}」，帮我设计 2~3 个能及早发现边界失稳的尾部监控指标。`,
    },
  ];
}

export function normalizeBaseUrl(raw, fallback, ensureV1ForOllama = false) {
  let val = String(raw || "").trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (!val || val.startsWith("sk-") || val.startsWith("AIza") || /\s/.test(val)) {
    return fallback;
  }
  if (!/^https?:\/\//i.test(val)) {
    const scheme = /localhost|127\.0\.0\.1/i.test(val) ? "http://" : "https://";
    val = scheme + val;
  }
  // Strip accidental full endpoint suffix if user pasted .../chat/completions
  val = val.replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "").replace(/\/+$/, "");
  if (ensureV1ForOllama && /localhost|127\.0\.0\.1/i.test(val) && !/\/v1$/i.test(val)) {
    val = `${val}/v1`;
  }
  return val;
}

function extractOpenAIText(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  if (typeof data?.output_text === "string") return data.output_text;
  return "";
}

async function callOpenAICompatible(settings, userPrompt) {
  const isDeepSeek = settings.provider === "deepseek";
  const isOllama = settings.provider === "ollama";
  const defaultUrl = isDeepSeek
    ? "https://api.deepseek.com/v1"
    : isOllama
    ? "http://localhost:11434/v1"
    : "https://api.openai.com/v1";
  const defaultModel = isDeepSeek ? "deepseek-chat" : isOllama ? "qwen2.5:7b" : "gpt-4.1-mini";

  const baseUrl = normalizeBaseUrl(settings.baseUrl, defaultUrl, isOllama);
  const model = (settings.model || defaultModel).trim();
  const isLocal = isOllama || /localhost|127\.0\.0\.1/i.test(baseUrl);
  if (!settings.apiKey && !isLocal) {
    throw new Error("未填写 API Key（请在弹窗填入并保存）");
  }

  const isReasoning = /^(gpt-5|gpt-6|o1|o3|o4|deepseek-reasoner)/i.test(model);
  const supportsReasoningEffort = /^(gpt-5|gpt-6|o1|o3|o4)/i.test(model);
  const payload = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  };
  if (isReasoning) {
    payload.max_completion_tokens = 4096;
    if (supportsReasoningEffort) {
      payload.reasoning_effort = "medium";
    }
  } else {
    payload.temperature = 0.8;
    payload.max_tokens = 2400;
  }

  const doPost = (bodyObj) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey || "ollama"}`,
      },
      body: JSON.stringify(bodyObj),
    });

  let resp = await doPost(payload);
  if (resp.status === 400) {
    const errLower = (await resp.clone().text().catch(() => "")).toLowerCase();
    let retry = false;
    if (errLower.includes("reasoning_effort") && "reasoning_effort" in payload) {
      delete payload.reasoning_effort;
      retry = true;
    }
    if (errLower.includes("max_completion_tokens") && "max_tokens" in payload) {
      delete payload.max_tokens;
      payload.max_completion_tokens = 4096;
      retry = true;
    } else if (errLower.includes("max_tokens") && "max_completion_tokens" in payload) {
      delete payload.max_completion_tokens;
      payload.max_tokens = 2400;
      retry = true;
    }
    if (errLower.includes("temperature") && "temperature" in payload) {
      delete payload.temperature;
      retry = true;
    }
    if (retry) {
      resp = await doPost(payload);
    }
  }

  if (!resp.ok) {
    const rawErr = await resp.text().catch(() => "");
    let detail = rawErr.slice(0, 220);
    try {
      const parsed = JSON.parse(rawErr);
      detail = parsed?.error?.message || parsed?.message || detail;
    } catch (_) {}
    throw new Error(`HTTP ${resp.status} (${baseUrl}): ${detail}`);
  }

  const data = await resp.json();
  const text = extractOpenAIText(data);
  if (!text.trim()) {
    throw new Error(`模型返回空内容（finish_reason=${data?.choices?.[0]?.finish_reason || "unknown"}）`);
  }
  return text;
}

async function callGemini(settings, userPrompt) {
  if (!settings.apiKey) throw new Error("未填写 Gemini API Key");
  const baseUrl = normalizeBaseUrl(
    settings.baseUrl,
    "https://generativelanguage.googleapis.com/v1beta"
  );
  const model = (settings.model || "gemini-2.5-flash").trim().replace(/^models\//, "");
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!resp.ok) {
    const rawErr = await resp.text().catch(() => "");
    let detail = rawErr.slice(0, 220);
    try {
      const parsed = JSON.parse(rawErr);
      detail = parsed?.error?.message || detail;
    } catch (_) {}
    throw new Error(`Gemini HTTP ${resp.status}: ${detail}`);
  }
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("");
  if (!text.trim()) {
    throw new Error(`Gemini 返回空内容（reason=${data?.candidates?.[0]?.finishReason || "unknown"}）`);
  }
  return text;
}

async function callAnthropic(settings, userPrompt) {
  if (!settings.apiKey) throw new Error("未填写 Anthropic API Key");
  const baseUrl = normalizeBaseUrl(settings.baseUrl, "https://api.anthropic.com/v1");
  const model = (settings.model || "claude-3-5-haiku-latest").trim();
  const resp = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      max_tokens: 2400,
      temperature: 0.8,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) {
    const rawErr = await resp.text().catch(() => "");
    let detail = rawErr.slice(0, 220);
    try {
      const parsed = JSON.parse(rawErr);
      detail = parsed?.error?.message || detail;
    } catch (_) {}
    throw new Error(`Anthropic HTTP ${resp.status}: ${detail}`);
  }
  const data = await resp.json();
  const blocks = data?.content || [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  if (!text.trim()) throw new Error("Anthropic 返回空内容");
  return text;
}

async function loadSettings() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return { ...DEFAULT_SETTINGS };
  }
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function setRunStatus(text) {
  try {
    await chrome.storage?.local?.set({ lastRunStatus: text });
  } catch (_) {}
}

async function generateBubbleCards({ prompt, context, forceDemo = false, overrideSettings = null }) {
  const settings = overrideSettings ? { ...DEFAULT_SETTINGS, ...overrideSettings } : await loadSettings();
  if (!settings.enabled && !forceDemo && !overrideSettings) {
    return { skipped: true };
  }

  const userPrompt =
    `用户刚刚发送的消息：\n${String(prompt || "").slice(0, 1200)}\n\n` +
    (context ? `最近对话上下文摘录：\n${String(context).slice(0, 900)}\n\n` : "") +
    "请严格按要求返回 2 条合法 JSON 数组（第 1 条为灵感设问，第 2 条为查漏微考题，title 不要带前缀标签，均带完整细致回答）。";

  if (forceDemo || settings.provider === "demo") {
    // Only demo mode uses offline cards; wait briefly so it never flashes right on keypress
    await new Promise((r) => setTimeout(r, forceDemo ? 120 : 2200));
    await setRunStatus(`✓ 离线演示模式就绪（${new Date().toLocaleTimeString()}）`);
    return {
      ok: true,
      source: "demo",
      topic: String(prompt || "").slice(0, 60),
      cards: buildDemoCards(prompt),
    };
  }

  try {
    const t0 = Date.now();
    let raw = "";
    if (settings.provider === "gemini") {
      raw = await callGemini(settings, userPrompt);
    } else if (settings.provider === "anthropic") {
      raw = await callAnthropic(settings, userPrompt);
    } else {
      raw = await callOpenAICompatible(settings, userPrompt);
    }

    let cards = [];
    try {
      cards = parseModelJson(raw);
    } catch (parseErr) {
      throw new Error(`JSON 解析失败（${parseErr?.message || parseErr}），原文开头：${String(raw).slice(0, 90)}`);
    }
    if (!cards.length) {
      throw new Error("模型返回 JSON 中没有有效卡片");
    }

    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    await setRunStatus(
      `✓ 思考完成（${settings.provider}/${settings.model || "default"} · ${elapsedSec}s · ${new Date().toLocaleTimeString()}）`
    );
    return {
      ok: true,
      source: settings.provider,
      topic: String(prompt || "").slice(0, 60),
      cards,
    };
  } catch (err) {
    // Do NOT pop up an instant fake fallback bubble when a real model fails — stay completely quiet
    const errMsg = String(err?.message || err);
    await setRunStatus(`⚠ 模型调用失败：${errMsg}`);
    return {
      ok: false,
      warning: errMsg,
      error: errMsg,
    };
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled && chrome.scripting?.executeScript) {
  chrome.runtime.onInstalled.addListener(async () => {
    try {
      const tabs = await chrome.tabs.query({
        url: [
          "https://chatgpt.com/*",
          "https://chat.openai.com/*",
          "https://claude.ai/*",
          "https://gemini.google.com/*",
        ],
      });
      for (const tab of tabs) {
        if (tab.id) {
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }).catch(() => {});
        }
      }
    } catch (_) {}
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== "object") return false;
    if (msg.type === "WAITSPARK_GENERATE") {
      generateBubbleCards({
        prompt: msg.prompt || "",
        context: msg.context || "",
        forceDemo: Boolean(msg.forceDemo),
      })
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    if (msg.type === "WAITSPARK_TEST_API") {
      generateBubbleCards({
        prompt: "如何在 MuJoCo 中稳定调整接触摩擦与仿真步长？",
        context: "",
        forceDemo: false,
        overrideSettings: msg.settings || null,
      })
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
      return true;
    }
    return false;
  });
}
