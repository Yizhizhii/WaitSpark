# WaitSpark

> **Wait-Learning 2.0 for Web AI Chats** — Turn AI waiting dead-time into quiet, high-curiosity **「灵感」** & **「查漏」** micro-bubbles floating right above your chat box.

[![CI](https://github.com/Yizhizhii/WaitSpark/actions/workflows/ci.yml/badge.svg)](https://github.com/Yizhizhii/WaitSpark/actions/workflows/ci.yml)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-0EA5E9)](extension/manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-10B981)](LICENSE)

WaitSpark 是一款零本地后台、极简浅色系的 **Chrome / Edge / Arc 浏览器扩展**，灵感源自 MIT CSAIL 经典 HCI 论文 *Wait-Learning / WaitChatter*（CHI 2014 / 2015）与主动回忆微测验（Active Recall Quiz）：

当你在 **ChatGPT / Codex Web**、**Claude** 或 **Gemini** 发送消息、等待模型思考和执行的空窗期，WaitSpark 在后台静默深度思考，完成后在**聊天输入框正上方**以轻盈柔焦动效浮出一枚纯白磨砂浅色小气泡——不抢焦点、不刷屏、拒绝“等待刷手机脑雾”。

---

## 核心体验

- **静默思考，好了再弹**：发消息后全程隐藏（零加载条）；仅在模型真正完成深度思考并校验输出有效后，才优雅浮现。
- **极简 1~2 条，零冗余顶栏**：折叠态去掉一切多余标题文字，只保留最勾起好奇心的 1~2 条微内容：
  - **`灵感`**（暖琥珀徽章）：挑战当前做法隐含假设的反直觉 *What if...* 设问，点击原地向上展开 200~320 字高密度解答；
  - **`查漏`**（清天蓝徽章）：紧扣当前对话上下文的 3 选 1 硬核微考题，点选即时给出薄荷绿/淡红直觉反馈并展开第一性原理详解（也支持「跳过作答，直接看详解 ↓」）。
- **优雅微动效 & 零侵入交互**：
  - 隔离的 **Shadow DOM**，绝不污染原网页样式；
  - 单击顶部 `收起 ▾` / 题干 / 底部 `▾ 折叠收起` 轻盈折叠回小气泡；点 `×` 雾化淡出关闭；
  - 点右下角 `填入聊天框追问 ↗` 一键把追问填入当前输入框。
- **跨平台零构建**：纯原生 HTML / CSS / JS（Manifest V3），**macOS / Windows / Linux** 上的 Chrome、Edge、Arc、Brave 均开箱即用。

---

## 快速安装（Windows / macOS / Linux）

### 方式 1：直接下载 Release 压缩包（最简单）

1. 前往本仓库 [**Releases**](https://github.com/Yizhizhii/WaitSpark/releases) 下载最新版 `waitspark-chrome-extension-v*.zip` 并解压；
2. 打开浏览器扩展管理页（Chrome：`chrome://extensions`，Edge：`edge://extensions`，Arc：`arc://extensions`）；
3. 开启右上角 **「开发者模式」** → 点击 **「加载已解压的扩展程序」** → 选择解压后的文件夹即可。

### 方式 2：从源码加载

```bash
git clone https://github.com/Yizhizhii/WaitSpark.git
```

在浏览器 `chrome://extensions` 开启开发者模式，点击 **「加载已解压的扩展程序」**，选择仓库内的 **`extension/`** 目录即可（无需 `npm install` 或构建）。

---

## 模型配置

点击浏览器工具栏的 **WaitSpark** 图标即可配置（所有 Key 仅保存在本机浏览器的 `chrome.storage.local`，不会上传到任何第三方中转服务）：

| 模式 | 说明 | 推荐模型 |
| :--- | :--- | :--- |
| **离线演示模式** | 免 API Key，装完即可体验完整交互与动效 | 内置 |
| **OpenAI / 兼容中转** | 支持官方 OpenAI 及任意 OpenAI 兼容接口（推理模型自动开启 `reasoning_effort: "medium"`） | `gpt-5.2` / `gpt-5` / `gpt-4.1-mini` / `o3` |
| **DeepSeek** | 内置 `https://api.deepseek.com/v1` 预设 | `deepseek-chat` / `deepseek-reasoner` |
| **Google Gemini** | 内置 `responseMimeType: "application/json"` 防截断 | `gemini-2.5-flash` |
| **Anthropic Claude** | 已内置浏览器侧所需请求头 | `claude-3-5-haiku-latest` |
| **本地 Ollama** | 免 Key，纯本机推理（自动补齐 `/v1`） | `qwen2.5:7b` 等 |

点击弹窗中的 **「测试模型」** 可实时检查接口连通与返回状态，点击 **「预览气泡」** 可在当前 AI 聊天页直接预览效果。

---

## 项目结构

```text
WaitSpark/
├── extension/              # 可直接加载到 Chrome / Edge / Arc 的 Manifest V3 扩展本体
│   ├── manifest.json
│   ├── background.js       # Service Worker：静默调用模型、JSON 清洗与重试容错
│   ├── content.js          # Shadow DOM 浅色磨砂气泡、4 重发送检测与微动效
│   ├── popup.html          # 浅色系设置弹窗
│   ├── popup.js
│   └── icons/              # 16 / 48 / 128 PNG 图标
├── tests/
│   └── background.test.mjs # 零依赖 Node 内置测试（node --test）
├── scripts/
│   └── pack.mjs            # 一键生成 macOS / Windows 兼容发布压缩包
└── .github/workflows/
    └── ci.yml              # GitHub Actions 语法与单元测试 CI
```

## 本地测试与打包

需要 Node.js 20+（零外部依赖）：

```bash
# 运行语法检查与单元测试
node --check extension/background.js extension/content.js extension/popup.js
node --test

# 打包发布用 ZIP（输出到 dist/）
node scripts/pack.mjs
```

---

## 隐私说明

- API Key 与模型配置仅存储在本地浏览器 `chrome.storage.local`；
- 仅在你发送消息时，由浏览器后台直接向你配置的模型服务商发送当前提问与最近 3 条上下文摘录，不经过任何 WaitSpark 自建服务器。

## 致谢与灵感

- Carrie J. Cai, Philip J. Guo, James Glass, Robert C. Miller. *Wait-Learning: Leveraging Conversational Dead Time for Second Language Education* (ACM CHI 2014 / 2015, MIT CSAIL).
- Active-recall micro-quiz workflows for AI coding sessions.

## License

[MIT](LICENSE)
