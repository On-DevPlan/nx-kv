// 把 svghub 目录里的图标资产落成真正的 .svg 文件（开发期复用，不是界面功能）。
//
// 用法：
//   node --import tsx scripts/export-icons.mjs            → 默认写到 temp/icons/
//   node --import tsx scripts/export-icons.mjs <目录>      → 写到指定目录
//
// 每个文件都是 24 网格、currentColor 描边，可直接拖进别的工程（nx-ft 的 SVG 档、
// Figma、设计稿），也方便对比改动前后的图形差异。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SVG_ASSETS } from '../src/web/frontend/svghub/index.js';
import { svgMarkup } from '../src/web/frontend/svghub/serialize.js';

const out = resolve(process.argv[2] || 'temp/icons');
mkdirSync(out, { recursive: true });
for (const asset of SVG_ASSETS) {
  writeFileSync(join(out, `${asset.name}.svg`), svgMarkup(asset), 'utf8');
}
console.log(`${SVG_ASSETS.length} 份 .svg → ${out}`);
