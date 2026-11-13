// #191 第 2 轮：删除任务/文档后**不拆面板**——maincontent 永远不会被删除。
// 第 1 轮修的是组页 hook 顺序（b4c5a18），这轮修的是删除动作本身：
// delTask / delDoc 原来 `Actions.deleteTab(tabId)` 把整块面板删掉，主区直接空掉。
// 新口径：主布局面板就地导航回父级（路由 effect 用 openPanel 换内容，壳一直活着）；
// 浮窗（getWindowId()==='float'）与旁路原文（config.beside）是辅助视图，维持直接关闭。
// 结构钉（前端行为端到端在 temp/probe-191.cjs 探针里做）：
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const actions = readFileSync(join(root, 'src/web/frontend/page/dir/task-actions.ts'), 'utf-8');
const doc = readFileSync(join(root, 'src/web/frontend/page/doc/index.tsx'), 'utf-8');

test('delTask：删除后不再无条件 deleteTab，主面板导航回父级', () => {
  assert.ok(!/toast\(`已删除「\$\{title\}」`\);\s*\n\s*if \(model && tabId\) model\.doAction\(Actions\.deleteTab\(tabId\)\);/.test(actions),
    '删除 toast 之后紧跟 deleteTab 的旧写法已移除');
  assert.match(actions, /const auxiliary =/, '先判定浮窗 / 旁路');
  assert.match(actions, /app\.onNavigate\('#\/group\/' \+ encodeURIComponent\(groupId \|\| ''\)\)/, '组锚定 → 组页');
  assert.match(actions, /app\.onNavigate\('#\/dir\/' \+ encodeURIComponent\(topicKey \|\| ''\)\)/, '目录任务 → 目录页');
  assert.match(actions, /app\.onNavigate\('#\/global'\)/, '全局任务 → 全局');
});

test('delDoc：同规——主布局文档页删除后就地回归属页', () => {
  assert.match(doc, /#191 同规：maincontent 永远不会被删除/, '口径注释在场');
  assert.match(doc, /app\.onNavigate\('#\/repos'\)/, '仓库归属 → 仓库管理');
  assert.match(doc, /app\.onNavigate\('#\/group\/' \+ encodeURIComponent\(boardKey \|\| ''\)\)/, '组归属 → 组页');
});

test('辅助视图（浮窗 / 旁路）仍直接关闭，不产生多余路由跳转', () => {
  const aux = (src) => src.match(/const auxiliary =\s*\n?[^\n]*getWindowId\(\) === 'float'[^\n]*\|\| !!cfg\.beside;/);
  assert.ok(aux(actions), 'task-actions 有浮窗/旁路判定');
  assert.ok(aux(doc), 'doc 有浮窗/旁路判定');
});
