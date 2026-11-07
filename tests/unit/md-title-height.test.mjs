// 标题高度必须跟着宽度一起重算（#94 验收反馈「title下有一大段空白」）。
//
// 病灶：TitleArea 的 fit() 读 scrollHeight，而 scrollHeight 是**当前宽度**下
// 折行的结果——面板刚打开、布局尚未定宽时，标题按极窄宽度折成七八行，
// scrollHeight 暴涨到几百 px（用户现场 271px、探针复现 316px）。此后宽度
// 恢复正常、标题只占一行，高度却再也降不回去——fit 只在 value 变化时跑，
// 宽度变化不触发。标题下方就留着一大段空白。
//
// 修法：ResizeObserver 观察自身盒子，宽度一变就重算高度。
//
// 这里做**结构检查**（前端行为在 node 里跑不起来，探针在 temp/ 里做端到端）：
// 源码必须用 ResizeObserver 观察 title 元素，且不再只依赖 window resize。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = readFileSync(join(root, 'src/web/frontend/components/md/md-panes.jsx'), 'utf-8');

// 取 TitleArea 函数体（到下一个顶层 function 声明为止）
function titleAreaBody() {
  const start = src.indexOf('function TitleArea(');
  assert.ok(start > 0, 'md-panes.jsx 里有 TitleArea');
  const next = src.indexOf('\nfunction ', start + 10);
  return src.slice(start, next > 0 ? next : src.length);
}

test('TitleArea：用 ResizeObserver 观察自身，宽度变化即重算高度', () => {
  const body = titleAreaBody();
  assert.match(body, /new ResizeObserver/, '标题高度必须由 ResizeObserver 兜底重算');
  assert.match(body, /ro\.observe\(el\)/, '观察的是标题元素自身');
  assert.match(body, /ro\.disconnect\(\)/, '卸载时必须断开观察');
});

test('TitleArea：不再只靠 window resize 兜底（窗口不变、面板变宽同样要重算）', () => {
  const body = titleAreaBody();
  // resize 监听只作为**无 ResizeObserver 环境**的兜底，不能是唯一路径
  const hasObserver = /new ResizeObserver/.test(body);
  assert.ok(hasObserver, '主路径必须是 ResizeObserver');
  assert.match(body, /else\s*\{[^}]*window\.addEventListener\('resize'/, 'window resize 降级为兜底分支');
});

test('TitleArea：fit 每次都先把 height 归零再读 scrollHeight（否则读到旧高度）', () => {
  const body = titleAreaBody();
  const fit = body.slice(body.indexOf('const fit'));
  const zeroIdx = fit.indexOf("el.style.height = 'auto'");
  const readIdx = fit.indexOf('el.scrollHeight');
  assert.ok(zeroIdx > 0 && readIdx > zeroIdx, '先归零再读 scrollHeight');
});
