// 任务模板列表（#217：从「设置 → 任务模板」搬到侧边栏入口，在主内容区显示）。
//
// 与设置页那份的差别：
//   · 页面级布局（.rp-page 外壳，与仓库管理页同款头部），不是设置里的卡片堆；
//   · 每张卡带**预览**——按当前正文渲染成本来的样子，没填的槽位显示〔槽位名〕；
//   · 编辑仍走全屏模板编辑器（#/templates/edit/<id>），这里只做列表与轻动作。
//
// 数据面零新增：/api/templates（App 层 useTemplates 已持有一份）+ 已有的 scope。
import { useState } from 'react';
import { useApp } from '../../app-context.jsx';
import { Button } from '../../components/button/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { renderMarkdownHtml } from '../../modules/md/md-parse.js';
import { renderTemplatePreview, templateSlots } from '../../modules/prompts/template-preview.js';
import type { PromptTemplate, TemplatesApi } from '../../types.js';
import ScopeChips from './scope-chips.jsx';
import './style.css';

/** 正文摘要：前两行非空内容（列表里只用来认模板，不替代预览）。 */
function summaryOf(body: string): string {
  const lines = String(body || '')
    .split('\n')
    .map((l) => l.trim())
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
          <h2>任务模板</h2>
          <p className="muted tpl-head-note">
            新建任务时的正文骨架。带 <code>{'{{content}}'}</code> 的段落可在任务里填写，其余骨架在任务中只读。
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" disabled={busy} onClick={() => go('#/templates/new')}>
            ＋ 新建模板
          </Button>
        </div>
      </div>

      {!templates.length && <div className="muted" style={{ padding: '8px 2px' }}>还没有模板（内置默认模板加载中…）。</div>}

      <div className="tpl-list">
        {templates.map((t) => {
          const isDefault = t.id === tpl.defaultId;
          const scopeOpen = scopeOpenId === t.id;
          const previewOpen = previewId === t.id;
          const slots = templateSlots(t.body);
          return (
            <div key={t.id} className={'tpl-card' + (isDefault ? ' is-default' : '')}>
              <div className="tpl-card-head">
                <span className="tpl-card-name">{t.name}</span>
                {isDefault && <span className="tpl-badge">默认</span>}
                {t.builtin && <span className="tpl-badge soft">内置</span>}
                {slots.length > 0 && (
                  <span className="tpl-card-slots" title={slots.join('、')}>
                    槽位 {slots.length}：{slots.slice(0, 3).join(' / ')}{slots.length > 3 ? ' …' : ''}
                  </span>
                )}
                <span className="grow tpl-card-grow" />
                <div className="tpl-card-acts">
                  <Button
                    variant="secondary"
                    small
                    onClick={() => setPreviewId(previewOpen ? null : t.id)}
                  >
                    {previewOpen ? '收起预览' : '预览'}
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={() => setScopeOpenId(scopeOpen ? null : t.id)}
                  >
                    可见绑定
                  </Button>
                  <Button
                    variant="secondary"
                    small
                    disabled={busy}
                    onClick={() => go(`#/templates/edit/${encodeURIComponent(t.id)}`)}
                  >
                    编辑
                  </Button>
                  {!isDefault && (
                    <Button
                      variant="secondary"
                      small
                      disabled={busy}
                      onClick={() => act(() => tpl.setDefault(t.id), `默认模板已设为「${t.name}」`)}
                    >
                      设为默认
                    </Button>
                  )}
                  {!t.builtin && (
                    <Button variant="secondary" small disabled={busy} onClick={() => removeTpl(t)}>
                      删除
                    </Button>
                  )}
                </div>
              </div>

              <div className="tpl-card-sum">{summaryOf(t.body) || '（空模板）'}</div>

              {slots.length === 0 && (
                <div className="tpl-card-hint">
                  未声明插槽：这条模板生成的任务整篇可编辑。在正文里写 <code>{'{{content}}'}</code>
                  就能把那段变成任务里可填的插槽（可写多次，共用同一个值），其余骨架随之只读。
                </div>
              )}

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
                  <div className="tpl-preview-note">
                    预览（插槽按当前值渲染，未填的显示〔content〕；保存后任务里看到的就是这段骨架）
                  </div>
                  <div
                    className="tpl-preview-body mdw-lp-view"
                    // 预览只渲染模板自身正文，不含任务上下文——纯只读展示
                    dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(renderTemplatePreview(t.body, t.values)) }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
