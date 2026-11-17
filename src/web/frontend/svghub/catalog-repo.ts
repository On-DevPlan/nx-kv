// SVG 资产 · 分类：仓库与组。
//
// 语义区分是这批资产的核心用途：**组（分支）/ 开发仓库 / 参考仓库** 三者在
// 侧栏与仓库页必须一眼可分。原实现里侧栏三种行统统画文件夹，用户只能靠
// 名字猜；现在按语义取不同图形（见 catalog 的 where 与 sidebar 的 rowIcon）。
import type { SvgAsset } from './types.js';
import { c, p, r } from './types.js';

export const REPO_ASSETS: SvgAsset[] = [
  {
    name: 'board',
    label: '项目组（分支）',
    group: 'repo',
    keys: ['board', 'group', 'branch', '组', '分组', '分支'],
    where: '侧栏组行 / 仓库页分支条 / 分组管理',
    els: [
      c(6, 5, 2.2), c(6, 19, 2.2), c(18, 12, 2.2),
      p('M6 7.2v9.6'),
      p('M6 12h6.6a2 2 0 0 1 2 2v-4a2 2 0 0 1 2-2'),
    ],
  },
  {
    name: 'repo',
    label: '开发仓库',
    group: 'repo',
    keys: ['repo', '仓库', 'box', '开发仓库'],
    where: '侧栏仓库行 / 仓库页「仓库」区块 / footer 仓库管理',
    els: [
      p('M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z'),
      p('M4 8.5 12 13l8-4.5'),
      p('M12 13v7'),
    ],
  },
  {
    name: 'repo-ref',
    label: '参考仓库',
    group: 'repo',
    keys: ['ref', 'repo', '参考仓库', '只读', 'reference'],
    where: '侧栏参考仓库行 / 仓库页「参考仓库」区块',
    els: [
      p('M3.5 9 10 5.4l6.5 3.6v5.6L10 18.2 3.5 14.6z'),
      p('M3.5 9 10 12.8 16.5 9'),
      p('M10 12.8v5.4'),
      p('M15.5 17.5h5'),
      p('M18.4 15.4 20.5 17.5l-2.1 2.1'),
    ],
  },
  {
    name: 'remote',
    label: '远端 / 服务器',
    group: 'repo',
    keys: ['remote', 'server', '远端', '服务器', 'git'],
    where: '仓库行「对齐 remote」动作',
    els: [
      r(4.2, 4.6, 15.6, 5.8, 1.6),
      r(4.2, 13.6, 15.6, 5.8, 1.6),
      c(7.4, 7.5, 0.95, true),
      c(7.4, 16.5, 0.95, true),
    ],
  },
  {
    name: 'open',
    label: '外部打开',
    group: 'repo',
    keys: ['open', '打开', '外部'],
    where: '仓库行「打开」/ 文档页「在文件管理器打开」',
    els: [p('M13.5 4.5H20v6.5'), p('M20 4.5 11.5 13'), p('M17 14.5V20H4V7h5.5')],
  },
  {
    name: 'users',
    label: '成员',
    group: 'repo',
    keys: ['users', 'member', '成员', '人'],
    where: '仓库页组分支「添加成员」/ 成员选择器',
    els: [
      c(9.5, 8.5, 3.2),
      p('M3.6 19.6c.6-3 3-4.6 5.9-4.6s5.3 1.6 5.9 4.6'),
      p('M16 5.6a3 3 0 0 1 0 5.9'),
      p('M17.4 15.3c2 .5 3.3 2 3.7 4.3'),
    ],
  },
  {
    name: 'unlink',
    label: '摘除绑定',
    group: 'repo',
    keys: ['unlink', '摘除', '解绑'],
    where: '仓库 / 文档解绑动作',
    els: [
      p('M9.5 14.5 8 16a3.5 3.5 0 0 1-5-5l2.2-2.2'),
      p('M14.5 9.5 16 8a3.5 3.5 0 0 1 5 5l-2.2 2.2'),
      p('M9.8 14.2 14.2 9.8'),
    ],
  },
  {
    name: 'filter',
    label: '筛选',
    group: 'repo',
    keys: ['filter', '筛选', '过滤', 'funnel'],
    where: '列表检索 / 分组分支筛选',
    els: [p('M4 5.5h16l-6.2 7.2v6.1l-3.6-1.7v-4.4z')],
  },
];
