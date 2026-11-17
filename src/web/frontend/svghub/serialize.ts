// SVG 资产库 · 序列化：把目录里的图元写成真正的 SVG 文本。
//
// 用途有两个，缺一不可：
//   1) `scripts/export-icons.mjs` 把全库落成 .svg 文件，别的项目/工具直接拿去用；
//   2) 单测可以只看文本，钉住「资产没写坏」（路径语法、坐标越界）。
//
// 导出文本与界面渲染共用同一份 els，不会出现「界面是这个、导出是另一个」。
import type { SvgAsset, SvgEl } from './types.js';

const num = (n: number): string => (Number.isInteger(n) ? String(n) : String(n));

/** 单个图元 → SVG 元素文本。 */
export function elMarkup(el: SvgEl): string {
  if ('p' in el) return `<path d="${el.p}" />`;
  if ('f' in el) return `<path d="${el.f}" fill="currentColor" stroke="none" />`;
  if ('c' in el) {
    const [cx, cy, r] = el.c;
    const fill = el.fill ? ' fill="currentColor" stroke="none"' : '';
    return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"${fill} />`;
  }
  const [x, y, w, h, rx] = el.r;
  const round = rx === undefined ? '' : ` rx="${num(rx)}"`;
  const fill = el.fill ? ' fill="currentColor" stroke="none"' : '';
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${round}${fill} />`;
}

/** 整份资产 → 可独立打开的 .svg 文本（24 网格 / currentColor 描边）。 */
export function svgMarkup(asset: SvgAsset): string {
  const w = asset.w ?? 1.8;
  const body = asset.els.map((el) => '  ' + elMarkup(el)).join('\n');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"',
    `  fill="none" stroke="currentColor" stroke-width="${w}"`,
    '  stroke-linecap="round" stroke-linejoin="round">',
    body,
    '</svg>',
    '',
  ].join('\n');
}
