// SVG 资产 · 分类：状态与提示。
//
// 「等待回填 / 完成 / 警示 / 锁定」是 nx-kv 的四个语义状态（配色见 shell.css 的
// --doing / --board / --wait）。图形只描形状，不描颜色——颜色继续由 CSS 的
// currentColor 与语义类决定。
import type { SvgAsset } from './types.js';
import { c, p, r } from './types.js';

export const STATE_ASSETS: SvgAsset[] = [
  {
    name: 'check',
    label: '完成 / 选中',
    group: 'state',
    keys: ['check', 'done', '完成', '对勾', '选中'],
    where: '任务标为完成 / 分支选择器当前分支 / 资产库复制反馈',
    els: [p('m5 12.5 4.5 4.5L19 7.5')],
  },
  {
    name: 'x',
    label: '关闭',
    group: 'state',
    keys: ['x', 'close', '关闭', '删除标记'],
    where: '面板关闭 / 附件移除 / 弹窗关闭',
    els: [p('M6 6l12 12M18 6 6 18')],
  },
  {
    name: 'warn',
    label: '警示',
    group: 'state',
    keys: ['warn', 'alert', '警示', '警告', '等待'],
    where: '侧栏「agent 等待回填」/ 清单读取失败',
    els: [p('M12 3.8 21.2 20H2.8z'), p('M12 10v4.2M12 17.2v.4')],
  },
  {
    name: 'lock',
    label: '锁定',
    group: 'state',
    keys: ['lock', '锁定', '只读'],
    where: '只读面板 / 受保护操作',
    els: [r(5.5, 10.5, 13, 9, 1.8), p('M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5')],
  },
  {
    name: 'clock',
    label: '计时',
    group: 'state',
    keys: ['clock', '时间', '计时', 'deadline'],
    where: '任务时间目标 / 等待窗口倒计时',
    els: [c(12, 12, 8.5), p('M12 7v5.2l3.4 2')],
  },
  {
    name: 'hourglass',
    label: '等待回填',
    group: 'state',
    keys: ['hourglass', 'wait', '等待', '沙漏'],
    where: '侧栏等待标记（琥珀语义）',
    els: [p('M8 4.5h8M8 19.5h8'), p('M9 4.5c0 4.2 6 4.2 6 7.5s-6 3.3-6 7.5'), p('M15 4.5c0 4.2-6 4.2-6 7.5s6 3.3 6 7.5')],
  },
  {
    name: 'progress',
    label: '进行中',
    group: 'state',
    keys: ['progress', 'running', '进行中', '进度'],
    where: '状态 tag（蓝=进行中）/ 进程面板',
    els: [
      c(12, 12, 8.5),
      p('M12 3.5a8.5 8.5 0 0 1 8.5 8.5'),
      p('M12 8.4v4l2.6 1.8'),
    ],
  },
];
