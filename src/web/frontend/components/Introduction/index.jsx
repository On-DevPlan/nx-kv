// 简介组件（项目 / 项目组统一）：一行**文字超链接** + 「查看详情」入口。
//
// 页面不内嵌渲染正文，补充文档也不再以 tag/chip 外显（任务「简介文档优化」）——
// 点「查看详情」打开 DocsModal：完整文档列表 + 复用编辑器（MdPanes）就地编辑。
// 阅读体验（标题滚动目录、双链跳转）仍收敛在文档页签（DocPanel）里。
import { useState } from 'react';
import { useIntro } from './use-intro.js';
import DocsModal from './docs-modal.jsx';
import './style.css';

/**
 * @param {object} props
 * @param {'repo'|'board'} props.kind
 * @param {object|null} props.owner  仓库或看板对象（含 doc / docRel / docLinks / key|id）
 * @param {object} [props.model]
 */
export default function Introduction({ kind, owner, model }) {
  const { label, docRef, links, openMain } = useIntro({ kind, owner, model });
  // 「查看详情」弹窗（完整文档列表 + 就地编辑）
  const [docsOpen, setDocsOpen] = useState(false);

  if (!owner || !docRef) return null;

  // 主篇以「介绍文档集」为准（目录 index.md 优先 → 旧单文件回落）
  const mainEntry = links.find((l) => l.main);
  const mainRef = mainEntry ? mainEntry.docId : docRef;
  const pathLabel = mainRef.startsWith('rel:') ? mainRef.slice(4) : mainRef;
  const extrasCount = links.filter((l) => !l.main).length;

  return (
    <div className="nx-intro">
      <div className="nx-intro-head">
        <button
          type="button"
          className="nx-intro-link-main"
          title={`打开${label}（新页签阅读 / 编辑）`}
          onClick={openMain}
        >
          {label}
        </button>
        <span className="nx-intro-path mono">{pathLabel}</span>
        <span className="nx-intro-spacer" />
        <button
          type="button"
          className="nx-intro-btn"
          title={`查看${label}的完整文档列表（补充 / reference / 组内），可就地编辑`}
          onClick={() => setDocsOpen(true)}
        >
          查看详情{extrasCount > 0 ? ` ${extrasCount}` : ''}
        </button>
      </div>

      {docsOpen && (
        <DocsModal kind={kind} owner={owner} model={model} onClose={() => setDocsOpen(false)} />
      )}
    </div>
  );
}

export { useIntro, introRefOf, introDirFromRef } from './use-intro.js';
export { default as IntroRail } from './rail.jsx';
