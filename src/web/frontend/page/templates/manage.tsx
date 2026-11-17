// 主题级任务模板管理（#151）：从「新建任务」下拉的「管理模板…」进来，只管这个
// topic 下可见的模板。filter 绑定可见行（不匹配即隐藏）、ScopeChips 改可见范围、
// 拖拽改顺序（落库走 templates.reorder）。参考自定义工具栏的编排面板，但更贴
// 数据列表：一行一条，信息密度优先。
import { useMemo, useState } from 'react';
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { Button } from '../../components/button/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { ListSearch } from '../../components/list-search.jsx';
import { filterByKeyword } from '../../modules/list-filter.js';
import { useTemplatesFor } from '../../modules/md/use-templates.js';
import { getManageSession } from '../../modules/md/manage-session.js';
import { templateSlots } from '../../modules/prompts/template-preview.js';
import type { PromptTemplate, TemplatesApi } from '../../types.js';
import ScopeChips from './scope-chips.jsx';
import './style.css';

interface ManagePanelProps {
  config?: Record<string, any>;
}

export default function TemplateManagePanel({ config }: ManagePanelProps) {
  const app = useApp();
  const toast = useToast();
  const tpl = app.tpl as TemplatesApi | undefined;
  const session = useMemo(() => getManageSession(config?.id), [config?.id]);
  const scoped = useTemplatesFor(
    session
      ? { topic: session.topic || '', group: session.group || '', repo: session.repo || '' }
      : { topic: '__no_topic__' },
  );
  const [q, setQ] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [scopeOpenId, setScopeOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = scoped.templates || [];
  const shown = filterByKeyword(rows, q, (t) => [
    t.name,
    t.body,
    (t.scope || []).join(' '),
    templateSlots(t.body).join(' '),
  ]);

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

  const reorder = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = rows.map((t) => t.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    await act(() => tpl!.reorder(ids));
  };

  const newTemplate = () => {
    const scope = session?.group
      ? [`group:${session.group}`]
      : session?.repo
        ? [`repo:${session.repo}`]
        : session?.topic
          ? [`topic:${session.topic}`]
          : [];
    import('../../panels.jsx').then(({ openTemplateEditor }) => {
      if (app.model) {
        openTemplateEditor(app.model, { mode: 'new', scope, topic: session?.topic || '', name: '' });
      }
    });
  };

  const label = session?.label || session?.topic || session?.group || session?.repo || '本主题';

  return (
    <div className="rp-page tpl-mng-page">
      <RouteBreadcrumb />
      <div className="page-head">
        <div className="title-block">
          <h2><Icon name="gear" size={16} /> 管理模板 · {label}</h2>
          <p className="muted tpl-head-note">
            只显示本主题可见的模板。拖动左侧把手调整顺序，点图标改可见范围；搜索框会同步隐藏不匹配的行。
          </p>
        </div>
        <div className="acts">
          <Button variant="primary" small disabled={busy} onClick={newTemplate}>
            <Icon name="plus" size={13} /> 新建模板
          </Button>
        </div>
      </div>

      <div className="tpl-mng-search">
        <ListSearch
          value={q}
          onChange={setQ}
          placeholder="搜索名称 / 正文 / 槽位 / 可见范围…"
          title="过滤本主题模板"
          count={shown.length}
          className="wide"
        />
      </div>

      {!rows.length ? (
        <div className="muted" style={{ padding: '8px 2px' }}>本主题下没有可见模板。</div>
      ) : (
        <div className="tpl-mng-list">
          {shown.map((t: PromptTemplate) => {
            const isDefault = t.id === tpl?.defaultId;
            const slots = templateSlots(t.body);
            return (
              <div
                key={t.id}
                className={[
                  'tpl-mng-row',
                  dragId === t.id ? 'is-dragging' : '',
                  overId === t.id && dragId !== t.id ? 'is-over' : '',
                ].filter(Boolean).join(' ')}
                draggable
                onDragStart={(e) => {
                  setDragId(t.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setOverId(t.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverId(null);
                  if (dragId) void reorder(dragId, t.id);
                  setDragId(null);
                }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
              >
                <span className="tpl-mng-grip" title="拖动排序"><Icon name="grip" size={14} /></span>
                <div className="tpl-mng-main">
                  <div className="tpl-mng-line">
                    <span className="tpl-mng-name">{t.name}</span>
                    {isDefault && <span className="tpl-badge">默认</span>}
                    {t.builtin && <span className="tpl-badge soft">内置</span>}
                    {slots.length > 0 && <span className="tpl-badge soft">槽位 {slots.length}</span>}
                  </div>
                  {(t.scope || []).length > 0 && !scopeOpenId && (
                    <div className="tpl-mng-scope-sum muted">可见：{(t.scope || []).join(' / ')}</div>
                  )}
                </div>
                <div className="tpl-mng-acts">
                  <button
                    type="button"
                    className="iconbtn"
                    title="可见范围"
                    onClick={() => setScopeOpenId(scopeOpenId === t.id ? null : t.id)}
                  >
                    <Icon name="globe" size={14} />
                  </button>
                  <button
                    type="button"
                    className="iconbtn"
                    title="编辑"
                    onClick={() => app.onNavigate?.(`#/templates/edit/${encodeURIComponent(t.id)}`)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  {!isDefault && (
                    <button
                      type="button"
                      className="iconbtn"
                      title="设为默认"
                      disabled={busy}
                      onClick={() => act(() => tpl!.setDefault(t.id), `默认模板已设为「${t.name}」`)}
                    >
                      <Icon name="star" size={14} />
                    </button>
                  )}
                  {!t.builtin && (
                    <button
                      type="button"
                      className="iconbtn"
                      title="删除"
                      disabled={busy}
                      onClick={() => act(() => tpl!.remove(t.id), `已删除「${t.name}」`)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>
                {scopeOpenId === t.id && (
                  <div className="tpl-mng-scope">
                    <ScopeChips
                      scope={t.scope}
                      originTopic={(t as unknown as { originTopic?: string }).originTopic}
                      onChange={(next: string[]) => tpl!.update(t.id, { scope: next })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
