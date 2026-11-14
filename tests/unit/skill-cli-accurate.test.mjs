// skill 文档 ↔ 源码的**准确性守卫**（#123 第 2 轮）。
//
// 背景：skill 是给 agent 照着敲命令的，写错一个子命令（比如 `localtask clone` 实际叫
// `fork`、`restore` 实际在 `localtask task restore` 下）就会让执行方直接失败。
// 靠人眼对源码不可持续，这里把「文档里的每条 nx-kv 命令/参数必须真实存在」变成单测：
//
//   ① 抽出文档里所有 `nx-kv <a> <b> …`，按最长前缀匹配 registry 的 cli 路径；
//   ② 匹配不到 → 报「文档里的命令不存在」；
//   ③ 同一行里的 `--flag` 必须在该 action 的入参 schema 里（或允许列的全局开关）；
//   ④ 占位符（<n> / "…" / <id|key>）不当命令词。
//
// 改文案随便改；写错命令或参数名就红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_ROOT = 'assets/nx-kv';

const { ACTIONS } = await import('../../src/runtime/registry.js');

/** cli 路径（按词数组）→ 该 action 的合法参数集合 */
const CLI = new Map();
for (const a of ACTIONS) {
  const raw = Array.isArray(a.cli) ? a.cli.join(' ') : String(a.cli || '');
  // 少数 action 的 cli 声明里带逗号别名（如 skill,list / skill,install,--list），拆开各自登记
  const variants = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const keys = new Set(Object.keys((a.input && a.input.shape) || {}));
  for (const v of variants) {
    const words = v.split(/\s+/).filter((w) => w && !w.startsWith('--'));
    if (words.length) CLI.set(words.join(' '), keys);
  }
}

/** 全局开关：不绑定到单个 action 的通用位 */
const GLOBAL_FLAGS = new Set(['json', 'xml', 'help', 'version']);

function mdFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/**
 * 从一行里取 `nx-kv ...` 的命令词（遇到 --flag / 占位符 / 引号 / 反引号 / 中文即止）。
 *
 * 按**字符**走而不是按空白切词：文档里常见 `nx-kv localtask get`（默认输出…） 这种
 * 「命令后面紧跟反引号/中文说明」的行，按空白切会把 `get`（说明）粘成一个词，
 * 于是命令词被截短、误报「命令不存在」。这里只收 [a-zA-Z0-9_-]，其余一律停。
 */
function commandWords(line) {
  const i = line.indexOf('nx-kv ');
  if (i < 0) return null;
  const rest = line.slice(i + 'nx-kv '.length);
  const words = [];
  let cur = '';
  for (const ch of rest) {
    if (/[a-zA-Z0-9_-]/.test(ch)) {
      cur += ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (cur) {
        // 命令词必须以字母开头（版本号「nx-kv 0.54」之类不是命令）
        if (!/^[a-zA-Z]/.test(cur)) break;
        words.push(cur);
        cur = '';
        continue;
      }
      if (words.length) break; // 连续空白 → 后面不是命令词了
      continue;
    }
    break; // 反引号 / 引号 / 括号 / 中文 / '-' → 停
  }
  if (cur && /^[a-zA-Z]/.test(cur)) words.push(cur);
  // 尾部若是 flag（--json 之类）不算命令词
  while (words.length && words[words.length - 1].startsWith('-')) words.pop();
  return words;
}

/** 按最长前缀解析到某个 cli 路径 */
function resolve(words) {
  for (let n = Math.min(words.length, 3); n >= 1; n -= 1) {
    const key = words.slice(0, n).join(' ');
    if (CLI.has(key)) return key;
  }
  return null;
}

test('#123 skill 文档里的每条 nx-kv 命令都必须真实存在', () => {
  const bad = [];
  for (const file of mdFiles(SKILL_ROOT)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const words = commandWords(line);
      if (!words || !words.length) return;
      if (!resolve(words)) bad.push(`${file}:${idx + 1}  nx-kv ${words.join(' ')}`);
    });
  }
  assert.deepEqual(bad, [], '文档里出现了 registry 中不存在的命令：\n' + bad.join('\n'));
});

test('#123 文档里写的命令参数必须在该 action 的入参里', () => {
  const bad = [];
  for (const file of mdFiles(SKILL_ROOT)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const words = commandWords(line);
      if (!words || !words.length) return;
      const key = resolve(words);
      if (!key) return; // 上一条用例负责报「命令不存在」
      if ((line.match(/nx-kv /g) || []).length > 1) return; // 一行多个命令时不猜参数归属
      const keys = CLI.get(key);
      const flags = [...line.matchAll(/--([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
      for (const f of flags) {
        if (GLOBAL_FLAGS.has(f)) continue;
        const ok = keys.has(f) || keys.has(f.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
        if (!ok) bad.push(`${file}:${idx + 1}  ${key} 不认识 --${f}`);
      }
    });
  }
  assert.deepEqual(bad, [], '文档里的参数与源码不一致：\n' + bad.join('\n'));
});
