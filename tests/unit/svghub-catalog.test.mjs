// SVG 资产库的守门测试：把「资产没写坏」与「挂载点没悬空」钉成断言。
//
// 三类断言：
//   1) 目录本身：名字唯一、分类合法、图元非空、路径语法与坐标在 24 网格内；
//   2) 序列化：独立 .svg 文本可被解析（有 xmlns / viewBox / 成对标签）；
//   3) 挂载：源码里出现的字面量 <Icon name="…"> / <SvgIcon name="…"> / glyph('…')
//      必须在目录里有登记——名字写错会静默变白，这层负责让它变红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SVG_ASSETS, SVG_GROUPS, assetOf, searchAssets, hubStats } from '../../src/web/frontend/svghub/index.js';
import { svgMarkup } from '../../src/web/frontend/svghub/serialize.js';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FRONTEND = join(ROOT, 'src', 'web', 'frontend');

/** 目录里每份资产的基本约束。 */
test('目录：名字唯一、分类合法、图元非空', () => {
  const seen = new Set();
  for (const a of SVG_ASSETS) {
    assert.match(a.name, /^[a-z][a-z0-9-]*$/, `资产名只允许小写字母/数字/连字符：${a.name}`);
    assert.equal(seen.has(a.name), false, `资产名重复：${a.name}`);
    seen.add(a.name);
    assert.ok(a.label && a.label.length > 0, `${a.name} 缺中文名`);
    assert.ok(SVG_GROUPS.some((g) => g.id === a.group), `${a.name} 的分类不在登记表里：${a.group}`);
    assert.ok(Array.isArray(a.els) && a.els.length > 0, `${a.name} 没有图元`);
    assert.ok(assetOf(a.name) === a, `assetOf 没有返回同一份资产：${a.name}`);
  }
});

/** 路径语法：只允许 SVG path 的字母/数字/符号，且必须以 M 起笔。 */
test('图元：路径语法合法、圆与矩形落在 24 网格内', () => {
  const ALLOWED = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$/;
  const inGrid = (n) => Number.isFinite(n) && n >= -2 && n <= 26;
  for (const a of SVG_ASSETS) {
    for (const el of a.els) {
      if ('p' in el) {
        assert.match(el.p, ALLOWED, `${a.name} 的路径不是合法 path：${el.p}`);
      } else if ('f' in el) {
        assert.match(el.f, ALLOWED, `${a.name} 的填充路径不是合法 path：${el.f}`);
      } else if ('c' in el) {
        const [cx, cy, r] = el.c;
        for (const n of [cx, cy, r]) assert.ok(inGrid(n), `${a.name} 的圆越界：${n}`);
      } else {
        const [x, y, w, h, rx] = el.r;
        for (const n of [x, y, w, h]) assert.ok(inGrid(n), `${a.name} 的矩形越界：${n}`);
        if (rx !== undefined) assert.ok(rx >= 0 && rx <= 12, `${a.name} 的圆角异常：${rx}`);
      }
    }
  }
});

/** 序列化：导出的文本是一份能独立打开的 SVG。 */
test('序列化：每份资产都能导出独立 .svg', () => {
  for (const a of SVG_ASSETS) {
    const text = svgMarkup(a);
    assert.match(text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(text, /viewBox="0 0 24 24"/);
    assert.match(text, /stroke="currentColor"/);
    assert.equal(text.trim().endsWith('</svg>'), true, `${a.name} 的导出文本没有闭合`);
    // 标签成对：<path/> 自闭合，<circle/> <rect/> 自闭合；不应出现裸 "<"
    const opens = (text.match(/<[a-z]/g) || []).length;
    const closes = (text.match(/<\/[a-z]/g) || []).length + (text.match(/\/>/g) || []).length;
    assert.equal(opens, closes, `${a.name} 的标签不成对：${opens} vs ${closes}`);
  }
});

/** 检索与统计：资产库页依赖的口径。 */
test('检索：名字 / 中文名 / 别名都能命中，空串返回全库', () => {
  assert.equal(searchAssets('').length, SVG_ASSETS.length);
  assert.equal(searchAssets('repo').some((a) => a.name === 'repo'), true);
  assert.equal(searchAssets('参考仓库').some((a) => a.name === 'repo-ref'), true);
  assert.equal(searchAssets('等待').length > 0, true);
  const s = hubStats();
  assert.equal(s.total, SVG_ASSETS.length);
  assert.equal(s.groups, SVG_GROUPS.length);
});

/** 源码里的字面量图标名必须能在目录里查到。 */
test('挂载：源码里引用的图标名都在资产库里', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'svghub') walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(e.name)) {
        files.push(full);
      }
    }
  };
  walk(FRONTEND);

  const missing = [];
  const check = (name, file) => {
    if (!assetOf(name)) missing.push(`${name} @ ${file.replace(ROOT, '')}`);
  };
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<(?:Icon|SvgIcon)\s+name="([a-z][a-z0-9-]*)"/g)) check(m[1], file);
    for (const m of src.matchAll(/glyph\('([a-z][a-z0-9-]*)'\)/g)) check(m[1], file);
  }
  assert.deepEqual(missing, [], `以下图标名没有登记：\n${missing.join('\n')}`);
});
