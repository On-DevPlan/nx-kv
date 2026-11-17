// SVG 资产 · 分类：文档与任务。
//
// doc / docs 沿用仓库页那套「带折角的纸」与「一叠纸」；task / chain / template
// 是这次新增的一组——任务、任务链、模板在界面上原先没有专属图形。
import type { SvgAsset } from './types.js';
import { c, p, r } from './types.js';

export const DOC_ASSETS: SvgAsset[] = [
  {
    name: 'doc',
    label: '文档',
    group: 'doc',
    keys: ['doc', '文档', 'paper', '页'],
    where: '仓库页组分支「文档」按钮 / 文档列表行',
    els: [
      p('M6 3.5h7.2L18 8.3V20.5H6z'),
      p('M13 3.5v5h5'),
      p('M8.8 12.6h6.4M8.8 16.2h4.4'),
    ],
  },
  {
    name: 'docs',
    label: '文档集',
    group: 'doc',
    keys: ['docs', '文档集', '多篇', '文档列表'],
    where: '仓库页「文档」区块 / 侧栏 footer 文档列表',
    els: [
      p('M8 6.5h9.5V21H8z'),
      p('M5.5 17.5V3.5h9'),
      p('M10.6 11h4.3M10.6 14.6h3'),
    ],
  },
  {
    name: 'task',
    label: '任务',
    group: 'doc',
    keys: ['task', '任务', 'todo'],
    where: '任务面板标题 / 任务行状态位',
    els: [
      r(3.8, 4.5, 16.4, 15, 2),
      p('m7.4 9.6 1.7 1.7 3-3.2'),
      p('M13.6 9.9h3.6'),
      p('M7.4 15.6h9.8'),
    ],
  },
  {
    name: 'chain',
    label: '任务链',
    group: 'doc',
    keys: ['chain', 'link', '任务链', '依赖', 'dep'],
    where: '任务页「任务链」/ 依赖图节点',
    els: [
      c(6, 6, 2.4),
      c(18, 18, 2.4),
      p('M7.9 7.9 16.1 16.1'),
      p('M11 3.5h5'),
    ],
  },
  {
    name: 'template',
    label: '模板',
    group: 'doc',
    keys: ['template', '模板', '模版', 'tpl'],
    where: '任务模板页 / 新建任务模板下拉',
    els: [r(3.6, 4.5, 16.8, 15, 2), p('M3.6 9.2h16.8'), p('M9.6 9.2v10.3')],
  },
  {
    name: 'star',
    label: '主篇',
    group: 'doc',
    keys: ['star', '主篇', '星标', '收藏'],
    where: '文档列表 ⋯ 菜单「主篇」',
    els: [p('m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z')],
  },
  {
    name: 'link',
    label: '链接 / 引用',
    group: 'doc',
    keys: ['link', 'ref', '引用', '链接', 'refId'],
    where: '文档 ⋯ 菜单「复制 refId」/ 绑定',
    els: [
      p('M10.2 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.2 1.2'),
      p('M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.2-1.2'),
    ],
  },
  {
    name: 'flow',
    label: '编排',
    group: 'doc',
    keys: ['flow', 'dag', '编排', '流程'],
    where: '工具区「编排」入口',
    els: [p('M4 7h6M14 7h6M4 17h6M14 17h6M10 7a4 4 0 0 0 4 4M14 13a4 4 0 0 0-4 4')],
  },
];
