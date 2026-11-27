import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDemoCards,
  normalizeBaseUrl,
  normalizeCards,
  parseModelJson,
  stripOptionPrefix,
  stripTitlePrefix,
} from "../extension/background.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, "..", "extension");

test("manifest.json is valid MV3 with valid PNG icons and referenced scripts", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("scripting"));
  for (const rel of Object.values(manifest.icons)) {
    const buf = fs.readFileSync(path.join(EXT_DIR, rel));
    assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `Invalid PNG: ${rel}`);
  }
  assert.ok(fs.existsSync(path.join(EXT_DIR, manifest.action.default_popup)));
  assert.ok(fs.existsSync(path.join(EXT_DIR, manifest.background.service_worker)));
  for (const js of manifest.content_scripts[0].js) {
    assert.ok(fs.existsSync(path.join(EXT_DIR, js)));
  }
});

test("buildDemoCards returns 2 cards ordered 灵感 (wild) before 查漏 (explain/quiz)", () => {
  const cards = buildDemoCards("在 MuJoCo 仿真中加入柔性真实杆体并调整接触摩擦");
  assert.equal(cards.length, 2);
  assert.equal(cards[0].mode, "wild");
  assert.equal(cards[0].kind, "question");
  assert.ok(cards[0].answer.length > 80);
  assert.equal(cards[1].mode, "explain");
  assert.equal(cards[1].kind, "quiz");
  assert.equal(cards[1].options.length, 3);
  assert.equal(cards[1].correct_index, 1);
});

test("parseModelJson strips redundant prefixes, handles trailing commas, and caps to 2 ordered cards", () => {
  const raw =
    "```json\n" +
    `{
      "cards": [
        {
          "mode": "explain",
          "kind": "quiz",
          "title": "查漏：condim=3 时增大摩擦为何压不住扭转？",
          "question": "MuJoCo 中 condim=3 时仅增大滑动摩擦能否提供扭转摩擦？",
          "options": ["A. 可以自动覆盖", "B. 不能，需要 condim=4 或 6", "C. 法向力非零即可",],
          "correct_index": 1,
          "answer": "**正解是 B**：condim=3 不含扭转维。",
        },
        {
          "mode": "wild",
          "kind": "question",
          "title": "灵感：球杆变软所需摩擦冲量反而变小？",
          "question": "保持摩擦系数不变，为何柔性杆体切向冲量可能下降？",
          "options": [],
          "correct_index": -1,
          "answer": "**核心直觉**：弯曲改变了接触期的切向相对速度。",
        },
        {
          "mode": "explain",
          "kind": "question",
          "title": "多余的第 3 条会被截断",
          "question": "ignored",
          "answer": "ignored",
        },
      ]
    }` +
    "\n```";

  const cards = parseModelJson(raw);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].mode, "wild");
  assert.equal(cards[0].title, "球杆变软所需摩擦冲量反而变小？");
  assert.equal(cards[1].mode, "explain");
  assert.equal(cards[1].title, "condim=3 时增大摩擦为何压不住扭转？");
  assert.equal(cards[1].options[1], "不能，需要 condim=4 或 6");
});

test("normalizeBaseUrl handles full endpoint suffixes, Ollama /v1, and pasted keys", () => {
  assert.equal(
    normalizeBaseUrl("https://api.deepseek.com/v1/chat/completions", "https://api.openai.com/v1"),
    "https://api.deepseek.com/v1"
  );
  assert.equal(
    normalizeBaseUrl("http://localhost:11434", "http://localhost:11434/v1", true),
    "http://localhost:11434/v1"
  );
  assert.equal(
    normalizeBaseUrl("sk-accidentally-pasted", "https://api.openai.com/v1"),
    "https://api.openai.com/v1"
  );
  assert.equal(stripOptionPrefix("B、正确选项"), "正确选项");
  assert.equal(stripTitlePrefix("脑洞：测试问题？"), "测试问题？");
  assert.equal(normalizeCards([]).length, 0);
});

test("content.js keeps minimalist UI without header text and uses 灵感 / 查漏", () => {
  const src = fs.readFileSync(path.join(EXT_DIR, "content.js"), "utf8");
  assert.ok(!src.includes("ws-head"));
  assert.ok(!src.includes("脑洞"));
  assert.ok(!src.includes("考题"));
  assert.ok(src.includes('"灵感"') && src.includes('"查漏"'));
});
