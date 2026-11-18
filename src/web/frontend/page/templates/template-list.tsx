// 任务模板列表（#217：从「设置 → 任务模板」搬到侧边栏入口，在主内容区显示）。
//
// #151 重做：图标优先、文字收敛。操作从五个纯文字按钮改成图标按钮，卡片只留
// 「名称 / 一行摘要 / 徽标 / 图标操作」，预览与可见域按需展开。数据面不变：
// /api/templates（App 层 useTemplates 已持有一份）+ scope。
import { useState } from 'react';
import { useApp } from '../../app-context.jsx';
import { Button } from '../../components/button/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { ListSearch } from '../../components/list-search.jsx';
import { filterByKeyword } from '../../modules/list-filter.js';
import type { PromptTemplate, TemplatesApi } from '../../types.js';
import ScopeChips from './scope-chips.jsx';
import './style.css';

/** 正文摘要：前两行可读内容（剥掉 markdown 标记）。 */
function summaryOf(body: string): string {
  const lines = String(body || '')
    .split('\n')
    .map((l) =>
      l.trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+\[[ x]\]\s*/i, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^>\s?/, ''),
    )
    .filter(Boolean)
    .slice(0, 2);
  return lines.join(' · ');
}

export default function TemplateListPanel() {
  const app = useApp();
  const tpl = app.tpl as TemplatesApi | undefined;
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [scopeOpenId, setScopeOpenId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const go = (hash: string) => app.onNavigate?.(hash);

  if (!tpl) {
    return <div className="rp-page tpl-page"><div className="muted" style={{ padding: 20 }}>模板服务未就绪…</div></div>;
  }
  if (tpl.unsupported) {
    return (
      <div className="rp-page tpl-page">
        <div className="muted" style={{ padding: 20 }}>当前服务比面板旧——重启面板后才有模板功能。</div>
      </div>
    );
  }

  const templates = tpl.templates || [];
  const shownTemplates = filterByKeyword(templates, q, (t) => [t.name, summaryOf(t.body), (t.scope || []).join(' ')]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const removeTpl = async (t: PromptTemplate) => {
    const ok = await dialog({ title: `删除模板「${t.name}」`, danger: true, okText: '删除' });
    if (!ok) return;
    await act(() => tpl.remove(t.id), `已删除「${t.name}」`);
  };

  return (
    <div className="rp-page tpl-page">
      {dialogNode}
      <div className="page-head">
        <div className="title-block">
          <h2><Icon name="list" size={16} /> 任务模板</h2>
          <p className="muted tpl-head-note">新建任务时的正文骨架；正式内容在编辑页自行填写。</p>
        </div>
        <div className="acts">
          <Button variant="primary" small disabled={busy} onClick={() => go('#/templates/new')}>
            <Icon name="plus" size={13} /> 新建
          </Button>
        </div>
      </div>

      {!templates.length && <div className="muted" style={{ padding: '8px 2px' }}>还没有模板（内置默认模板加载中…）。</div>}
      {templates.length > 1 ? (
        <div className="tpl-search">
          <ListSearch
            value={q}
            onChange={setQ}
            placeholder="搜索名称 / 正文 / 可见范围…"
            title="过滤任务模板"
            count={shownTemplates.length}
            className="wide"
          />
        </div>
      ) : null}

      <div className="tpl-list">
        {shownTemplates.map((t) => {
          const isDefault = t.id === tpl.defaultId;
          const scopeOpen = scopeOpenId === t.id;
          const previewOpen = previewId === t.id;
          return (
            <div key={t.id} className={'tpl-card' + (isDefault ? ' is-default' : '')}>
              <div className="tpl-card-head">
                <span className="tpl-card-name">{t.name}</span>
                {isDefault && <span className="tpl-badge">默认</span>}
                {t.builtin && <span className="tpl-badge soft">内置</span>}
                <span className="grow tpl-card-grow" />
                <div className="tpl-card-acts">
                  <button
                    type="button"
                    className="iconbtn"
                    title={previewOpen ? '收起预览' : '预览'}
                    onClick={() => setPreviewId(previewOpen ? null : t.id)}
                  >
                    <Icon name="monitor" size={14} />
                  </button>
                  <button
                    type="button"
                    className={'iconbtn' + (scopeOpen ? ' is-on' : '')}
                    title="可见范围"
                    disabled={busy}
                    onClick={() => setScopeOpenId(scopeOpen ? null : t.id)}
                  >
                    <Icon name="globe" size={14} />
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    title="编辑"
                    disabled={busy}
                    onClick={() => go(`#/templates/edit/${encodeURIComponent(t.id)}`)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      className="iconbtn"
                      title="设为默认"
                      disabled={busy}
                      onClick={() => act(() => tpl.setDefault(t.id), `默认模板已设为「${t.name}」`)}
                    >
                      <Icon name="star" size={14} />
                    </button>
                  )}
                  {!t.builtin && (
                    <button type="button" className="iconbtn" title="删除" disabled={busy} onClick={() => removeTpl(t)}>
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="tpl-card-sum">{summaryOf(t.body) || '（空模板）'}</div>

              {scopeOpen && (
                <div className="tpl-card-scope">
                  <ScopeChips
                    scope={t.scope}
                    originTopic={(t as unknown as { originTopic?: string }).originTopic}
                    onChange={(next: string[]) => tpl.update(t.id, { scope: next })}
                  />
                </div>
              )}
              {previewOpen && (
                <div className="tpl-preview">
                  <div
                    className="tpl-preview-body mdw-lp-view"
                    dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(t.body) }}
                  />
                </div>
              )}
            </div>
          );
        })}
        {templates.length && !shownTemplates.length ? (
          <div className="muted" style={{ padding: '8px 2px' }}>（没有匹配的模板）</div>
        ) : null}
      </div>
    </div>
  );
}
