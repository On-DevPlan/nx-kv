// SVG 资产库 · 序列化：把目录里的图元写成真正的 SVG 文本。
//
// 用途有两个，缺一不可：
//   1) 资产库页「复制 SVG / 下载 .svg」——资产要能离开这个仓库被别处使用；
//   2) 单测可以只看文本，钉住「资产没写坏」（路径语法、坐标越界）。
//
// 导出文本与界面渲染共用同一份 els，不会出现「预览是这个、导出是另一个」。
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

/** 触发浏览器下载一份 .svg（资产库页「下载」按钮用）。 */
export function downloadSvg(name: string, text: string): void {
  const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让部分浏览器来不及读 URL，挪到下一帧
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
