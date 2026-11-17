// SVG 资产 · 分类：操作。
//
// 复制 / 下载 / 源码 / 检索这几个是资产库页自己要用到的：资产库既是仓库的
// 消费方，也要能「导出单份资产」。它们同样进目录，别处也能复用。
import type { SvgAsset } from './types.js';
import { c, p, r } from './types.js';

export const ACT_ASSETS: SvgAsset[] = [
  {
    name: 'plus',
    label: '新增',
    group: 'act',
    keys: ['plus', 'add', '新增', '加号'],
    where: '新建页 / 新建任务 / 登记仓库',
    els: [p('M12 5v14M5 12h14')],
  },
  {
    name: 'search',
    label: '检索',
    group: 'act',
    keys: ['search', 'find', '检索', '搜索'],
    where: '侧栏搜索框 / 仓库页检索 / 资产库检索',
    els: [c(11, 11, 6.5), p('m20.2 20.2-4.5-4.5')],
  },
  {
    name: 'edit',
    label: '编辑',
    group: 'act',
    keys: ['edit', 'pencil', '编辑', '铅笔'],
    where: '仓库行「编辑」/ 任务页源码模式',
    els: [p('M4 20h16M13.5 4.5l4 4L8 18H4v-4z')],
  },
  {
    name: 'trash',
    label: '删除',
    group: 'act',
    keys: ['trash', 'delete', '删除', '垃圾桶'],
    where: '仓库行「删除」/ 任务删除 / 附件移除',
    els: [p('M4.5 6.5h15M9.5 6V4.5c0-.6.4-1 1-1h3c.6 0 1 .4 1 1V6M6.5 6.5l.8 12c.1.9.8 1.5 1.7 1.5h6c.9 0 1.6-.6 1.7-1.5l.8-12')],
  },
  {
    name: 'send',
    label: '提交',
    group: 'act',
    keys: ['send', 'submit', '提交', '发送'],
    where: '任务页「提交」/ 评论区发送',
    els: [p('M4 12 20 4l-4 16-4.5-6.5z')],
  },
  {
    name: 'copy',
    label: '复制',
    group: 'act',
    keys: ['copy', 'duplicate', '复制'],
    where: '资产库「复制 SVG」/ 路径点击复制',
    els: [r(8.5, 3.5, 12, 12, 2), p('M15.5 15.5v2.8c0 1.1-.9 2-2 2H5.5c-1.1 0-2-.9-2-2V8.3c0-1.1.9-2 2-2h2.8')],
  },
  {
    name: 'download',
    label: '导出',
    group: 'act',
    keys: ['download', 'export', '导出', '下载'],
    where: '资产库「下载 .svg」',
    els: [p('M12 4v10.5M7.5 10 12 14.5 16.5 10'), p('M4.5 19.5h15')],
  },
  {
    name: 'code',
    label: '源码模式',
    group: 'act',
    keys: ['code', 'source', '源码', '代码'],
    where: '任务/文档页「源码模式」',
    els: [p('M9 7.5 4.5 12 9 16.5'), p('M15 7.5 19.5 12 15 16.5')],
  },
  {
    name: 'refresh',
    label: '刷新 / 同步',
    group: 'act',
    keys: ['refresh', 'sync', '刷新', '同步'],
    where: '仓库页「刷新状态」/ 侧栏工具区刷新',
    els: [p('M20 12a8 8 0 1 1-2.34-5.66'), p('M20 3.8v4.4h-4.4')],
  },
  {
    name: 'img',
    label: '插图',
    group: 'act',
    keys: ['img', 'image', '图片', '插图'],
    where: '任务页「插入图片」',
    els: [r(3.5, 4.5, 17, 15, 2), p('m4 16 5-4.6 4.4 3.8 2.8-2.2L19 16.5'), p('M8.4 9.4h.2')],
  },
];
