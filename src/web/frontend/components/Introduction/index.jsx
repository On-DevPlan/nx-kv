// 简介组件（项目 / 项目组统一）：一行**文字超链接**，点开 DocPanel 阅读/编辑。
//
// 页面不内嵌渲染正文——阅读体验（标题滚动目录、双链跳转、编辑保存）
// 全收敛在文档页签（DocPanel）里，那边带归属上下文与滚动目录轨。
import { useToast } from '../toast/index.jsx';
import { useDialog } from '../popup/index.jsx';
import { useIntro } from './use-intro.js';
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
  const { label, docRef, links, openMain, openDoc, addRef, setLinkTag, canEdit } = useIntro({ kind, owner, model });

  if (!owner || !docRef) return null;

  const pathLabel = docRef.startsWith('rel:') ? docRef.slice(4) : docRef;
  const extras = links.filter((l) => !l.main);
  const onAdd = () => addRef(dialog, toast).catch((e) => toast(String(e.message || e)));

  /** 改 / 清一篇补充文档的标签（对话框留空 = 清掉） */
  const onEditTag = (l) => {
    (async () => {
      const res = await dialog({
        title: `标签 · ${l.label}`,
        input: true,
        placeholder: '标签（如 qa；留空 = 清掉）',
        value: l.tag || '',
        okText: '保存标签',
      });
      if (res === null) return;
      const tag = typeof res === 'string' ? res : (res && res.tag) || '';
      await setLinkTag(l.docId, tag, l);
      toast(tag ? `标签已设为 [${tag}]` : '标签已清除');
    })().catch((e) => toast(String(e.message || e)));
  };

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
        {canEdit && docRef.startsWith('rel:') && (
          <button
            type="button"
            className="nx-intro-btn"
            title="补充一篇介绍文档（reference）"
            onClick={onAdd}
          >
            ＋ ref
          </button>
        )}
      </div>

      {extras.length > 0 && (
        <div className="nx-intro-links">
          <span className="nx-intro-links-lab">补充</span>
          {extras.map((l) => (
            <span key={l.docId} className="nx-intro-link-item">
              <button
                type="button"
                className={'nx-intro-link' + (l.docId.startsWith('path:') ? ' ext' : '')}
                title={l.note ? `${l.label} — ${l.note}` : l.label}
                onClick={() => openDoc(l.docId)}
              >
                <span className="nx-intro-link-label">{l.label}</span>
                {l.tag ? <span className="nx-intro-link-tag" title={`标签：${l.tag}`}>{l.tag}</span> : null}
                {l.note ? <span className="nx-intro-link-note">{l.note}</span> : null}
                {l.docId.startsWith('path:') ? <span className="nx-intro-link-tag">外部</span> : null}
              </button>
              {canEdit && !l.ref && (
                <button
                  type="button"
                  className="nx-intro-tag-btn"
                  title={l.tag ? `改标签（当前：${l.tag}）` : '加标签'}
                  aria-label={`标签：${l.label}`}
                  onClick={() => onEditTag(l)}
                >
                  ＃
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {dialogNode}
    </div>
  );
}

export { useIntro, introRefOf, introDirFromRef } from './use-intro.js';
export { default as IntroRail } from './rail.jsx';
