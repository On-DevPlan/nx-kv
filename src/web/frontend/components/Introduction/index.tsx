// 简介组件（项目 / 项目组统一）：一行**文字超链接** + 「查看详情」入口。
//
// 页面不内嵌渲染正文，补充文档也不再以 tag/chip 外显（任务「简介文档优化」）——
// 点「查看详情」打开**右侧栏的文档列表**（panel component:'refs'）：主篇 / 目录补充 /
// 登记的 reference / 组内描述都在那一块里，行内的 ＃ 改标签、× 摘除、头部 ＋ 补充也在那儿。
// 点某一行 → 在**主内容区**打开该文档（DocPanel 负责编辑 / 保存 / 更多）。
//
// #186：以前这份列表是 DocsModal（模态弹窗），与「更多 → 查看列表」的右侧栏重复。
// 用户要求「查看列表统一只要右侧边栏，不要 modal 弹窗」→ 弹窗下线，这里只负责开门。
import { useApp } from '../../app-context.jsx';
import type { Model } from 'flexlayout-react';
import { useIntro } from './use-intro.js';
import type { IntroKind, IntroOwner } from './use-intro.js';
import { openPanel } from '../../workspace.js';
import './style.css';

export interface IntroductionProps {
  kind: IntroKind;
  /** 仓库或看板对象（含 doc / docId / key|id）；没加载到就传 null。 */
  owner: IntroOwner | null;
  model?: Model | null;
}

export default function Introduction({ kind, owner, model }: IntroductionProps) {
  const app = useApp();
  const { label, docRef, links, openMain } = useIntro({ kind, owner, model });

  if (!owner || !docRef) return null;

  // 主篇以「介绍文档集」为准
  const mainEntry = links.find((l) => l.main);
  const pathLabel = mainEntry?.label || '文档库';
  const extrasCount = links.filter((l) => !l.main).length;

  // 「查看详情」= 打开右侧栏文档列表（同一块面板在任意宿主复用；config 可序列化 → 按 config 去重）
  const openList = () => {
    const m = model || app.model;
    if (!m) return;
    openPanel(m, {
      component: 'refs',
      name: '文档列表',
      config: kind === 'repo'
        ? { repoKey: owner.key || '' }
        : { boardKey: owner.id || owner.key || '', boardName: owner.name || '' },
      location: 'right',
    });
  };

  return (
    <div className="nx-intro">
      <div className="nx-intro-head">
        <button
          type="button"
          className="nx-intro-link-main"
          title={`打开${label}（在主内容区阅读 / 编辑）`}
          onClick={openMain}
        >
          {label}
        </button>
        <span className="nx-intro-path mono">{pathLabel}</span>
        <span className="nx-intro-spacer" />
        <button
          type="button"
          className="nx-intro-btn"
          title={`在右侧栏列出${label}的全部文章（点标题在主内容区打开，可编辑）`}
          onClick={openList}
        >
          查看详情{extrasCount > 0 ? ` ${extrasCount}` : ''}
        </button>
      </div>
    </div>
  );
}

export { useIntro, introRefOf } from './use-intro.js';
export { default as IntroRail } from './rail.jsx';
