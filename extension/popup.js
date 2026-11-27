const DEFAULTS = {
  enabled: true,
  provider: "demo",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
};

const PROVIDER_PRESETS = {
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", showBase: true, showKey: true },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", showBase: true, showKey: true },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b", showBase: true, showKey: false },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.5-flash", showBase: false, showKey: true },
  anthropic: { baseUrl: "https://api.anthropic.com/v1", model: "claude-3-5-haiku-latest", showBase: false, showKey: true },
  demo: { baseUrl: "", model: "", showBase: false, showKey: false },
};

const elEnabled = document.getElementById("enabled");
const elProvider = document.getElementById("provider");
const elApiFields = document.getElementById("api-fields");
const elBaseUrlWrap = document.getElementById("baseurl-wrap");
const elApiKeyWrap = document.getElementById("apikey-wrap");
const elBaseUrl = document.getElementById("baseUrl");
const elModel = document.getElementById("model");
const elApiKey = document.getElementById("apiKey");
const elStatus = document.getElementById("status");
const btnSave = document.getElementById("btn-save");
const btnTest = document.getElementById("btn-test");
const btnPreview = document.getElementById("btn-preview");

function setStatus(msg, isWarn = false) {
  if (!msg) {
    elStatus.textContent = "";
    elStatus.className = "status empty";
    return;
  }
  elStatus.textContent = msg;
  elStatus.className = isWarn ? "status warn" : "status";
}

function readFormSettings() {
  return {
    enabled: elEnabled.checked,
    provider: elProvider.value,
    baseUrl: elBaseUrl.value.trim(),
    model: elModel.value.trim(),
    apiKey: elApiKey.value.trim(),
  };
}

function updateVisibility(applyPreset = false) {
  const p = elProvider.value;
  const preset = PROVIDER_PRESETS[p] || PROVIDER_PRESETS.demo;
  elApiFields.classList.toggle("hidden", p === "demo");
  elBaseUrlWrap.classList.toggle("hidden", !preset.showBase);
  elApiKeyWrap.classList.toggle("hidden", !preset.showKey);
  if (applyPreset && p !== "demo") {
    elBaseUrl.value = preset.baseUrl;
    elModel.value = preset.model;
  }
}

async function init() {
  const saved = await chrome.storage.local.get({ ...DEFAULTS, lastRunStatus: "" });
  elEnabled.checked = Boolean(saved.enabled);
  elProvider.value = saved.provider || "demo";
  elBaseUrl.value = saved.baseUrl || DEFAULTS.baseUrl;
  elModel.value = saved.model || DEFAULTS.model;
  elApiKey.value = saved.apiKey || "";
  updateVisibility(false);
  if (saved.lastRunStatus) {
    setStatus(saved.lastRunStatus, saved.lastRunStatus.startsWith("⚠"));
  }
}

elProvider.addEventListener("change", () => updateVisibility(true));

btnSave.addEventListener("click", async () => {
  await chrome.storage.local.set(readFormSettings());
  setStatus("✓ 配置已保存，在聊天页发消息即可生效");
});

btnTest.addEventListener("click", async () => {
  const cfg = readFormSettings();
  await chrome.storage.local.set(cfg);
  if (cfg.provider === "demo") {
    setStatus("✓ 当前为离线演示模式（免 Key），直接可用");
    return;
  }
  setStatus("正在测试当前模型连接与 JSON 输出...");
  chrome.runtime.sendMessage({ type: "WAITSPARK_TEST_API", settings: cfg }, (res) => {
    if (chrome.runtime.lastError) {
      setStatus(`⚠ 后台服务异常：${chrome.runtime.lastError.message}`, true);
      return;
    }
    if (!res) {
      setStatus("⚠ 未收到模型响应", true);
      return;
    }
    if (res.warning) {
      setStatus(`⚠ 失败详情：${res.warning}`, true);
    } else if (res.ok && res.cards?.length) {
      setStatus(`✓ 连接成功！示例生成：「${res.cards[0].title}」`);
    } else {
      setStatus(`⚠ 测试失败：${res.error || "未知错误"}`, true);
    }
  });
});

btnPreview.addEventListener("click", async () => {
  try {
    const cfg = readFormSettings();
    await chrome.storage.local.set(cfg);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus("请先切到 ChatGPT / Codex Web 标签页", true);
      return;
    }
    chrome.tabs.sendMessage(
      tab.id,
      { type: "WAITSPARK_PREVIEW_NOW", forceDemo: cfg.provider === "demo" },
      async (res) => {
        if (chrome.runtime.lastError || !res?.ok) {
          try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
            chrome.tabs.sendMessage(
              tab.id,
              { type: "WAITSPARK_PREVIEW_NOW", forceDemo: cfg.provider === "demo" },
              (res2) => {
                if (chrome.runtime.lastError || !res2?.ok) {
                  setStatus("请在 chatgpt.com / claude.ai / gemini.google.com 页面尝试", true);
                } else {
                  setStatus("✓ 已在当前页聊天框上方弹出预览气泡");
                }
              }
            );
          } catch (_) {
            setStatus("请先打开 chatgpt.com / claude.ai / gemini.google.com 页面", true);
          }
        } else {
          setStatus("✓ 已在当前页聊天框上方弹出预览气泡");
        }
      }
    );
  } catch (err) {
    setStatus(`触发失败: ${err?.message || err}`, true);
  }
});

init();
