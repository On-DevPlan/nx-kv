// 任务模板列表（#217：从「设置 → 任务模板」搬到侧边栏入口，在主内容区显示）。
//
// #191 重构：任务模板只负责「按模板初始化 task 草稿」，与提示词模板无关。
//  - 可见范围配置整体下线（无 scope 按钮 / ScopeChips）——全部模板直接显示；
//  - filter 头部固定在顶部（不再随模板数条件出现）；
//  - 右侧操作按钮改成「上图标 + 下小文字」，一眼看懂每个按钮做什么。
// 数据面不变：/api/templates（App 层 useTemplates 已持有一份）。
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
  const shownTemplates = filterByKeyword(templates, q, (t) => [t.name, summaryOf(t.body)]);

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

  /** 上图标 + 下小文字的单个操作按钮。 */
  const actBtn = (
    icon: string,
    label: string,
    onClick: () => void,
    opts: { disabled?: boolean; on?: boolean } = {},
  ) => (
    <button
      type="button"
      className={'tpl-act' + (opts.on ? ' is-on' : '')}
      title={label}
      disabled={busy || opts.disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );

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

      {/* #191：filter 头部固定在顶部（不再条件出现） */}
      <div className="tpl-search">
        <ListSearch
          value={q}
          onChange={setQ}
          placeholder="搜索名称 / 正文…"
          title="过滤任务模板"
          count={shownTemplates.length}
          className="wide"
        />
      </div>

      {!templates.length && <div className="muted" style={{ padding: '8px 2px' }}>还没有模板（内置默认模板加载中…）。</div>}

      <div className="tpl-list">
        {shownTemplates.map((t) => {
          const isDefault = t.id === tpl.defaultId;
          const previewOpen = previewId === t.id;
          return (
            <div key={t.id} className={'tpl-card' + (isDefault ? ' is-default' : '')}>
              <div className="tpl-card-head">
                <span className="tpl-card-name">{t.name}</span>
                {isDefault && <span className="tpl-badge">默认</span>}
                {t.builtin && <span className="tpl-badge soft">内置</span>}
                <span className="grow tpl-card-grow" />
                <div className="tpl-card-acts">
                  {actBtn(
                    'monitor',
                    previewOpen ? '收起' : '预览',
                    () => setPreviewId(previewOpen ? null : t.id),
                    { on: previewOpen },
                  )}
                  {/* #195：内置模板不可改（出厂正文随版本升级自动覆盖）——只给用户模板编辑入口 */}
                  {!t.builtin && actBtn('edit', '编辑', () => go(`#/templates/edit/${encodeURIComponent(t.id)}`))}
                  {!isDefault && actBtn(
                    'star',
                    '设为默认',
                    () => act(() => tpl.setDefault(t.id), `默认模板已设为「${t.name}」`),
                  )}
                  {!t.builtin && actBtn('trash', '删除', () => removeTpl(t))}
                </div>
              </div>
              <div className="tpl-card-sum">{summaryOf(t.body) || '（空模板）'}</div>

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
