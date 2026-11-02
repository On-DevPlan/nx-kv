// 简介组件（项目 / 项目组统一）：显示 · 编辑/创建 · 补充 ref · 滚动目录。
//
// 两边只传 kind + owner + model；数据加载与落盘差异收在 use-intro。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialog, useToast } from '../ui.jsx';
import { extractMdHeadings, renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { useIntro } from './use-intro.js';
import IntroRail from './rail.jsx';
import './style.css';

/**
 * @param {object} props
 * @param {'repo'|'board'} props.kind
 * @param {object|null} props.owner  仓库或看板对象（含 doc / docRel / docLinks / key|id）
 * @param {object} [props.model]
 */
export default function Introduction({ kind, owner, model }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const {
    label,
    docRef,
    intro,
    known,
    links,
    onNavClick,
    openEdit,
    openDoc,
    addRef,
    canEdit,
  } = useIntro({ kind, owner, model });

  const bodyRef = useRef(null);
  const [scrollRoot, setScrollRoot] = useState(null);

  const html = useMemo(() => {
    if (!intro || intro.missing || intro.dir || !intro.body) return '';
    return renderMarkdownHtml(intro.body, [], known);
  }, [intro, known]);

  const headings = useMemo(
    () => (intro && !intro.missing && intro.body ? extractMdHeadings(intro.body) : []),
    [intro]
  );

  useEffect(() => {
    setScrollRoot(bodyRef.current);
  }, [html]);

  if (!owner || !docRef) return null;

  const pathLabel = intro?.rel || intro?.path || '';
  const extras = links.filter((l) => !l.main);
  const onAdd = () => addRef(dialog, toast).catch((e) => toast(String(e.message || e)));

  return (
    <div className="nx-intro" onClick={onNavClick}>
      <div className="nx-intro-head">
        <span>{label}{pathLabel ? ` · ${pathLabel}` : ''}</span>
        {intro?.rel && <span className="nx-intro-path mono">{intro.rel}</span>}
        <span className="grow" />
        <span className="nx-intro-acts">
          {canEdit && (
            <button
              type="button"
              className="nx-intro-btn"
              title={html ? `编辑${label}` : `创建${label}`}
              onClick={(e) => { e.stopPropagation(); openEdit(); }}
            >
              {html ? '编辑' : (intro && !intro.dir ? '创建' : '编辑')}
            </button>
          )}
          {canEdit && docRef.startsWith('rel:') && (
            <button
              type="button"
              className="nx-intro-btn"
              title="补充一篇介绍文档（reference）"
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
            >
              ＋ ref
            </button>
          )}
        </span>
      </div>

      {html ? (
        <div className="nx-intro-body mdw" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="nx-intro-body muted" ref={bodyRef}>
          {intro?.dir
            ? `外部目录绑定：${intro.path}（${(intro.files || []).length} 个文档）`
            : `还没有${label}文档——点「创建」写一篇（约定路径自有 md）。`}
        </div>
      )}

      {extras.length > 0 && (
        <div className="nx-intro-links">
          <span className="nx-intro-links-lab">补充</span>
          {extras.map((l) => (
            <button
              key={l.docId}
              type="button"
              className={'nx-intro-link' + (l.docId.startsWith('path:') ? ' ext' : '')}
              title={l.note || l.label}
              onClick={(e) => { e.stopPropagation(); openDoc(l.docId); }}
            >
              {l.label}
              {l.note ? <span className="nx-intro-link-note">{l.note}</span> : null}
              {l.docId.startsWith('path:') ? <span className="nx-intro-link-tag">外部</span> : null}
            </button>
          ))}
        </div>
      )}

      <IntroRail
        headings={headings}
        scrollRoot={scrollRoot}
        links={links}
        activeDocId={docRef}
        onOpenDoc={openDoc}
        onAddRef={canEdit && docRef.startsWith('rel:') ? onAdd : null}
      />

      {dialogNode}
    </div>
  );
}

export { useIntro, introRefOf, introDirFromRef } from './use-intro.js';
export { default as IntroRail } from './rail.jsx';
