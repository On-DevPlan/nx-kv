// 硬约束守卫（2026-11 DOCS_DIR 收口）：
//
//   `NX_KV_DOCS_DIR` 只是 mdfile 的默认附件目录，只能通过 attach 访问；
//   文档正文的唯一真相是 `ref_bodies`。除 attachment 层与迁移脚本外，
//   任何模块都不得引用这个目录（更不得用 fs 直读）。
//
// 这里用最简单的源码扫描做拦截：出现 `NX_KV_DOCS_DIR` / `docsRoot` /
// `mdfileDirFromEnv` 的文件必须落在允许清单里，否则失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const PATTERN = /NX_KV_DOCS_DIR|docsRoot|mdfileDirFromEnv/;
// 允许清单（相对 src/，POSIX 分隔符）：定义、attachment 层、迁移 / 导入层
const ALLOW = [
  'core/paths.ts',
  'core/attachmentdb/',
  'core/db/',
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test('DOCS_DIR 只允许出现在 attachment 层与迁移脚本里', () => {
  const offenders = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (ALLOW.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (PATTERN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `以下位置绕过了 attachment 层：\n${offenders.join('\n')}`);
});
