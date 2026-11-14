#!/usr/bin/env node
// dev-nxkv skill 的「SOP 形态」门禁。
//
// 背景（#201/#202）：这个 skill 曾写成 2735 行的知识库——96% 的篇幅不含可执行动作，
// 里面还留着 auth / todo 两个早已删除的模块，agent 照着调必失败。用户要求
// 「每一条都必须是动作 SOP」。光靠一次重写守不住：下一个人加一篇纯知识文档，
// 三周后又回到原点。所以把「形态」写成机器检查。
//
// 检查三件事：
//   1. SKILL.md 的路由表 ↔ references/ 里的文件一一对应（不许有孤儿，也不许指向不存在的文件）
//   2. 每条 reference 必须含四段骨架：① 前置 / ② 动作 / ③ 自检 / ④ 失败分支
//   3. 正文里出现的 src|tests|scripts|assets|docs|bin 路径必须存在；
//      `node bin/kv.mjs <cmd>` 必须能在真实命令表里解析到
//
// 用法：node scripts/check-skill-sop.mjs        （pnpm lint 的一部分）
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = '.claude/skills/dev-nxkv';
const REF_DIR = path.join(ROOT, 'references');
const TICK = String.fromCharCode(96);

const errors = [];

if (!existsSync(ROOT)) {
  console.log('[check-skill-sop] 跳过：没有 ' + ROOT);
  process.exit(0);
}

const refFiles = readdirSync(REF_DIR).filter((f) => f.endsWith('.md')).sort();
const skillPath = path.join(ROOT, 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

// 1. 路由 ↔ 文件
const routed = [...skill.matchAll(/`(T\d+-[^`]+\.md)`/g)].map((m) => m[1]);
for (const r of routed) {
  if (!refFiles.includes(r)) errors.push(`SKILL.md 路由指向不存在的文件：${r}`);
}
for (const f of refFiles) {
  if (!routed.includes(f)) errors.push(`references/${f} 未被 SKILL.md 路由（孤儿文件）`);
}

// 2. 每条 SOP 的四段骨架
const SECTIONS = [
  { key: '前置', re: /^##\s*①[^\n]*前置/m },
  // 「动作」允许排在 ② 或 ③（有的 SOP 把「只读查询」「选一条链」放在动作之前）
  { key: '动作', re: /^##\s*[②③][^\n]*(动作|判定)/m },
  { key: '自检', re: /^##\s*[^\n]*自检/m },
  { key: '失败分支', re: /^##\s*[^\n]*失败分支/m },
];

const contents = new Map();
for (const f of refFiles) {
  const t = readFileSync(path.join(REF_DIR, f), 'utf8');
  contents.set(f, t);
  for (const s of SECTIONS) {
    if (!s.re.test(t)) errors.push(`references/${f} 缺少「${s.key}」小节（SOP 骨架不完整）`);
  }
  const cmds = t.split(/\r?\n/).filter((l) => /^\s*(node |pnpm |npx |curl |grep |ls |cat |sed |Copy-Item|\$env:)/.test(l)).length;
  if (cmds === 0) errors.push(`references/${f} 不含任何可执行命令（这是知识文档，不是 SOP）`);
}

// 3. 路径与命令真实性
const all = [skill, ...[...contents.values()]].join('\n');

const paths = new Set();
const pathRe = new RegExp(TICK + '((?:src|tests|scripts|assets|docs|plan|bin)/[A-Za-z0-9_./-]+)' + TICK, 'g');
for (const m of all.matchAll(pathRe)) paths.add(m[1]);
for (const p of paths) {
  if (/[<>*]/.test(p)) continue; // 占位符，如 src/modules/<id>/
  const clean = p.replace(/\/+$/, '');
  if (!clean) continue;
  if (!existsSync(clean)) errors.push(`引用的路径不存在：${p}`);
}

// 命令真实性：**静态解析** action 的 `cli:` 声明，不启动 runtime。
// （启动 runtime 会打开 SQLite；lint 阶段碰用户真实库是不可接受的副作用。）
const PLATFORM = ['serve', 'help', 'version'];

/** 从一个 action 源文件里抽出所有 cli 词序列（支持 ['a','b'] 与 [['a','b'],['c','d']]）。 */
function cliPathsOf(text) {
  const out = [];
  const at = text.indexOf('cli:');
  if (at < 0) return out;
  const start = text.indexOf('[', at);
  if (start < 0) return out;
  let depth = 0;
  let end = -1;
  for (let k = start; k < text.length; k++) {
    if (text[k] === '[') depth++;
    else if (text[k] === ']') {
      depth--;
      if (depth === 0) {
        end = k;
        break;
      }
    }
  }
  if (end < 0) return out;

  let cur = [];
  let quote = '';
  let buf = '';
  for (let k = start + 1; k < end; k++) {
    const ch = text[k];
    if (quote) {
      if (ch === quote) {
        cur.push(buf);
        buf = '';
        quote = '';
      } else buf += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ']') {
      if (cur.length) out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const known = new Set(PLATFORM);
for (const mod of readdirSync('src/modules', { withFileTypes: true })) {
  if (!mod.isDirectory()) continue;
  const dir = path.join('src/modules', mod.name, 'actions');
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts') || f.startsWith('_')) continue;
    const text = readFileSync(path.join(dir, f), 'utf8');
    for (const words of cliPathsOf(text)) {
      known.add(words.slice(0, 2).join(' '));
      known.add(words[0]);
    }
  }
}

const cmds = new Set();
for (const m of all.matchAll(/node bin\/kv\.mjs\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g)) {
  cmds.add(m[2] ? `${m[1]} ${m[2]}` : m[1]);
}
for (const c of cmds) {
  const [a, b] = c.split(' ');
  if (!known.has(a) && !(b && known.has(c))) errors.push(`命令不存在：nx-kv ${c}`);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = new Set(Object.keys(pkg.scripts || {}));
for (const m of all.matchAll(/pnpm (?:run )?([a-z:]+)/g)) {
  if (['install', 'run'].includes(m[1])) continue;
  if (!scripts.has(m[1])) errors.push(`pnpm script 不存在：pnpm ${m[1]}`);
}

if (errors.length) {
  console.error('[check-skill-sop] 失败 ' + errors.length + ' 项：');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(
  `[check-skill-sop] OK：${refFiles.length} 条 SOP 骨架完整；` +
    `${paths.size} 处路径存在；${cmds.size} 条命令可解析（对照 ${known.size} 个 cli 声明）`
);
