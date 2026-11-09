// 前端静态自检：JSX 里用到的组件与 React hook 必须有来源。
//
// 为什么要有这个测试：**前端整页崩在运行时，而 lint 与单测都看不见**。
// 真实踩过两次：
//   1. `localtask/view.jsx` 用了 `<CliHints>` 却从没 import 它
//      → 「本地任务」页整页倒在错误边界上（"CliHints is not defined"），
//         HEAD 上就存在，本地任务页其实一直打不开。
//   2. `localtask/view.jsx` 用了 `useMemo` 却没 import（且声明位置早于
//      `directoryRows`，还撞了一次 const 的 TDZ）→ 同样是整页崩。
//
// eslint 的 `no-undef` 是关掉的（浏览器/Node 全局混用，装 globals 包不值得），
// 于是这两类错误只能靠运行时暴露——太晚了。所以这里补一条**只查引用来源**的静态检查：
// 不管全局，只查"你用到的东西有没有被引进来 / 有没有在本地定义"。
//
// 约束：只做**来源**检查，不做语义检查；宁可不报错，也别误伤。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    // 构建产物（src/web/public 与任何 dist/）与依赖不进检查：那里是压缩过的
    // 代码，里面当然"引用了"一堆没有 import 的东西（#129 当天本地就踩过：
    // 游离的 src/web/frontend/dist 让本测试报了十几条假缺失）。
    if (
      p.includes('node_modules')
      || p.includes(join('src', 'web', 'public'))
      || /(^|[\\/])dist([\\/]|$)/.test(p)
    ) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(jsx|js)$/.test(name)) out.push(p);
  }
  return out;
}

// 从源码里收集"本地可用"的标识符：import 进来的 + 本地定义/声明的。
function declaredNames(src) {
  const names = new Set();
  // import { a, b as c } from '...'  /  import d from '...'  /  import * as ns
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) {
      for (const part of named[1].split(',')) {
        const name = (part.split(/\s+as\s+/).pop() || '').trim();
        if (name) names.add(name);
      }
    }
    const def = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    for (const n of def.split(/\s+/)) {
      if (n && n !== '*' && n !== 'as') names.add(n);
    }
  }
  // 本地定义：function X / const X = / let X = / class X
  for (const m of src.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  // 解构出来的别名：const { a, b } = x  →  a / b
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = (part.split(':').pop() || '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

const files = walk(join(root, 'src'));

// 剥掉注释（字符串感知，保留换行）。**必须剥**：JSDoc 泛型如 `Readonly<Record<…>>`
// 会撞上 JSX 组件的 `<Capitalized>` 正则——workflow 契约文件全是类型注释，
// 不剥的话每个带 JSDoc 的模块都是一排假阳性。注释里的 JSX / hook 调用不是代码，
// 剥掉只减少误伤，不会漏掉真实引用；扫描两个测试都用剥过的源码，口径一致。
function stripComments(src) {
  let out = '';
  let mode = 'code'; // code | line | block | single | double | template
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'" || c === '"' || c === '`') { mode = c === "'" ? 'single' : c === '"' ? 'double' : 'template'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c; } else out += ' ';
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i += 1; continue;
    }
    // 字符串内容原样保留（含转义）；引号回到 code。模板串按平铺处理——
    // 嵌套 `${}` 里的反引号只会让中间片段被多算，字符串感知已挡住绝大多数误伤。
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') || (mode === 'template' && c === '`')) mode = 'code';
    out += c;
    i += 1;
  }
  return out;
}

test('前端源码里用到的组件 / hook 都必须有来源（没有来源 = 运行时整页崩）', () => {
  const problems = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const known = declaredNames(src);
    const rel = file.replace(root + '\\', '').replace(/\\/g, '/');

    // 1) JSX 组件：<Foo …>（小写是 HTML 标签，不管）
    const used = new Set();
    for (const m of src.matchAll(/<([A-Z][A-Za-z0-9_$]*)/g)) used.add(m[1]);
    // 2) React hook：useXxx(
    for (const m of src.matchAll(/\b(use[A-Z][A-Za-z0-9_$]*)\s*\(/g)) used.add(m[1]);

    for (const name of used) {
      if (known.has(name)) continue;
      // 局部函数声明在 useMemo/useState 之前也算已知（declaredNames 已收 function/const）
      problems.push(`${rel}: 「${name}」被用到但没有 import、也没有本地定义`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});

test('前端源码里不出现明显写错的 React hook 名（useMemo/useRef 等拼写检查）', () => {
  // useMemo / useRef / useCallback / useEffect / useState / useLayoutEffect / useReducer
  const KNOWN_HOOKS = new Set([
    'useCallback', 'useEffect', 'useLayoutEffect', 'useMemo', 'useReducer',
    'useRef', 'useState', 'useContext', 'useSyncExternalStore', 'useId', 'useTransition',
  ]);
  const problems = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const rel = file.replace(root + '\\', '').replace(/\\/g, '/');
    const declared = declaredNames(src);
    for (const m of src.matchAll(/\b(use[A-Z][A-Za-z0-9_$]*)\s*\(/g)) {
      const name = m[1];
      if (KNOWN_HOOKS.has(name)) continue;
      if (declared.has(name)) continue; // 自定义 hook 之类
      problems.push(`${rel}: 「${name}」不像 React 内置 hook，确认拼写没错`);
    }
  }
  assert.deepEqual(problems, [], `\n${problems.join('\n')}\n`);
});
