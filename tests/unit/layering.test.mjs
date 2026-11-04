// 分层边界：把「前后端只通过 /api 通信」写成可执行断言。
//
// 背景（2026-11-04）：面板曾经直接 import 后端模块里的「纯函数文件」——
// `modules/localtask/board.js`（前端视图模型）、`modules/todo/attach.js`、
// `modules/docs/wikilink.js`、`modules/localtask/frontmatter.js`。
// 这些文件本身没问题，位置错了：它们让浏览器包直接依赖后端目录结构，
// 于是「后端挪个文件」= 「前端白屏」，而且谁都能顺手在里面加一句
// `import fs from 'node:fs'` —— 构建期才炸。
//
// 现在只有五层，方向单行：
//
//   core      ←  什么都不能依赖（最底层基础设施）
//   shared    ←  同构纯函数：不能依赖任何一层，也不能碰 node: / react
//   modules   ←  core + shared（模块之间由 eslint 白名单逐个放开）
//   runtime   ←  组合根，可以装配 modules / core / shared
//   web       ←  shared + 自己；**够不着 modules / runtime / core**
//
// 前端能拿到的后端能力只有一种：HTTP `/api`。数据契约由
// tests/unit/registry.test.mjs 的「视图调用的每个 /api 路径都有对应路由」守住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

const rel = (abs) => abs.split('\\').join('/').replace(SRC.split('\\').join('/') + '/', '');

function collect(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // public/ 是 vite 构建产物；node_modules 不该出现在 src 里
      if (e.name === 'node_modules' || p.endsWith(join('web', 'public'))) continue;
      collect(p, out);
    } else if (/\.(js|jsx|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// 归层：返回 'core' | 'shared' | 'runtime' | 'web' | 'modules'（模块名另存）
function layerOf(relPath) {
  if (relPath.startsWith('core/')) return 'core';
  if (relPath.startsWith('shared/')) return 'shared';
  if (relPath.startsWith('runtime/')) return 'runtime';
  if (relPath.startsWith('web/frontend/')) return 'web';
  if (relPath.startsWith('modules/')) return 'modules';
  return 'entry'; // src/index.js —— 对外入口，允许再导出任何东西
}

const ALLOWED = {
  core: new Set(['core']),
  shared: new Set(['shared']),
  runtime: new Set(['core', 'shared', 'runtime', 'modules', 'web']),
  modules: new Set(['core', 'shared', 'modules']),
  web: new Set(['web', 'shared']),
  entry: new Set(['core', 'shared', 'runtime', 'modules', 'web', 'entry']),
};

const FILES = collect(SRC);

// 抓静态 import / 再导出 / 动态 import() 三种写法。
//
// 先剥注释：注释里经常“举个例子”写 `import('../../runtime/cli.js')`，
// 把它们当成真依赖会造成假阳性（本文件的注释就这么干过）。
// 剥法很保守：块注释整体删，行注释只删「前面不是 : " ' ` \」的那些，
// 使 `https://` 、转义斜杠、以及字符串里的 `//` 保留下来。
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

function specifiersOf(srcRaw) {
  const src = stripComments(srcRaw);
  const specs = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
    specs.push(m[1]);
  }
  for (const m of src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs;
}

test('分层依赖方向：web 只能碰 web + shared，core/shared 不能向上依赖', () => {
  const problems = [];
  for (const file of FILES) {
    const from = rel(file);
    const fromLayer = layerOf(from);
    const allowed = ALLOWED[fromLayer];
    assert.ok(allowed, `未知层次: ${from}`);

    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue; // 裸包名另有用例
      const target = rel(posix.normalize(posix.join(posix.dirname(from), spec)));
      const toLayer = layerOf(target);
      if (allowed.has(toLayer)) continue;
      problems.push(`${from}  →  ${spec}（${fromLayer} 不得依赖 ${toLayer}）`);
    }
  }
  assert.deepEqual(problems, [], `跨层依赖越界:\n${problems.join('\n')}`);
});

test('前端与 shared 不得引用 node: 内置模块', () => {
  const problems = [];
  for (const file of FILES) {
    const from = rel(file);
    const layer = layerOf(from);
    if (layer !== 'web' && layer !== 'shared') continue;
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:')) problems.push(`${from} → ${spec}`);
    }
  }
  assert.deepEqual(problems, [], `node 内置模块进不了浏览器包:\n${problems.join('\n')}`);
});

test('shared 只放同构纯函数：不得依赖第三方包（含 react）', () => {
  // 判据很硬：shared 同时被 Node 与浏览器加载，任何第三方包都会经过
  // 「能不能被 vite 打进浏览器包」的运气考验。纯函数没有这个问题。
  const problems = [];
  for (const file of FILES) {
    const from = rel(file);
    if (layerOf(from) !== 'shared') continue;
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.') && !spec.startsWith('node:')) problems.push(`${from} → ${spec}`);
    }
  }
  assert.deepEqual(problems, [], `shared 出现了外部依赖:\n${problems.join('\n')}`);
});

test('后端模块目录里不允许出现 .jsx（视图归前端）', () => {
  const strays = FILES.filter((f) => rel(f).startsWith('modules/') && f.endsWith('.jsx')).map(rel);
  assert.deepEqual(strays, [], `这些视图文件长在后端模块目录里: ${strays}`);
});
