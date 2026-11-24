// 参数填写中间页（#151）：从「新建任务」下拉点带 {{槽位}} 的模板时先到这里。
//
// 槽位只活到「任务正文生成前」——这一页把模板正文渲染成**纯文本**草稿，
// 不再往任务里写 template: frontmatter、编辑器零槽位概念。两个出口：
//   · 直接提交：进任务页后自动 submit() 落库为待领取任务；
//   · 进入编辑页：进任务页保留草稿（不落库）。
// 所有参数都是可选长编辑框，留空按空串填充。
import { useMemo, useState } from 'react';
import RouteBreadcrumb from '../../components/layout/route-crumb.jsx';
import { popRoute } from '../../components/layout/route-history.js';
import { Button } from '../../components/button/index.jsx';
import { Icon } from '../../components/icons.jsx';
import { useApp } from '../../app-context.jsx';
import { useToast } from '../../components/toast/index.jsx';
import { docIdOf, nextDraftId, saveDoc, scopeOf } from '../../modules/md/doc-store.js';
import { titleFromMd } from '../../modules/md/md-parse.js';
import { getFillSession, dropFillSession } from '../../modules/md/fill-session.js';
import { setTaskIntent } from '../../modules/md/task-intent.js';
import { templateDraftBody, templateSlots } from '../../modules/prompts/template-preview.js';
import './style.css';

interface FillPanelProps {
  config?: Record<string, any>;
}

export default function TemplateFillPanel({ config }: FillPanelProps) {
  const app = useApp();
  const toast = useToast();
  const session = useMemo(() => getFillSession(config?.id), [config?.id]);
  const tmpl = useMemo(
    () => (app.tpl?.templates || []).find((t) => t.id === (session || {})?.templateId) || null,
    [app.tpl?.templates, session],
  );
  const slots = useMemo(() => (tmpl ? templateSlots(tmpl.body) : []), [tmpl]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of slots) out[s] = String((tmpl?.values || {})[s] ?? '');
    return out;
  });

  if (!session || !tmpl) {
    return (
      <div className="rp-page tpl-fill-page">
        <RouteBreadcrumb />
        <div className="pad muted">参数会话已失效——请从「新建任务」下拉重新选择模板。</div>
      </div>
    );
  }

  const setValue = (key: string, val: string) => setValues((m) => ({ ...m, [key]: val }));

  /** 渲染正文 → 种草稿 → 开任务页。submit=true 时留一次性 intent 触发自动提交。 */
  const proceed = (submit: boolean) => {
    const extra: Record<string, unknown> = {};
    if (session.board) extra.board = session.board;
    if (session.project) extra.project = session.project;
    const body = templateDraftBody(
      { id: tmpl.id, body: tmpl.body, values: tmpl.values },
      extra,
      values,
    );
    const task = nextDraftId();
    const rootKey = session.groupId || session.dirKey || '';
    const docId = docIdOf(scopeOf(rootKey), task);
    // 标题从渲染后的正文首行反推（模板常以 `# {{标题}}` 开头）——否则编辑页显示「无标题」
    saveDoc(docId, { title: titleFromMd(body, ''), body });
    // intent key 必须与任务页取用侧一致：task.tsx 用 docIdOf(scope, task) 取，
    // 若存裸 task id 就永远取不到——「直接提交」会退化成「进入编辑页」（#156 的坑）。
    if (submit) setTaskIntent(docId, { submit: true });
    dropFillSession(config?.id);
    const spec = session.groupId
      ? { groupId: session.groupId, task, name: '新任务' }
      : { dirKey: session.dirKey, task, name: '新任务' };
    app.openPage?.(spec);
    toast(submit ? '正在提交任务…' : '已进入草稿编辑');
  };

  return (
    <div className="rp-page tpl-fill-page">
      <RouteBreadcrumb />
      <div className="page-head">
        <div className="title-block">
          <h2><Icon name="list" size={16} /> 填写模板参数</h2>
          <p className="muted tpl-head-note">
            「{tmpl.name}」· 全部可选，留空即为空白。生成的是纯文本任务，编辑页不会再出现槽位框。
          </p>
        </div>
        <div className="acts">
          <Button
            variant="secondary"
            small
            onClick={() => app.onNavigate?.(popRoute() || '#/templates')}
          >
            <Icon name="back" size={13} /> 返回
          </Button>
        </div>
      </div>

      <div className="tpl-fill-body">
        {slots.length === 0 ? (
          <div className="muted tpl-fill-empty">这条模板没有参数槽位，可直接进入任务编辑。</div>
        ) : (
          slots.map((key) => (
            <label key={key} className="tpl-fill-field">
              <span className="tpl-fill-label">{key}</span>
              <textarea
                className="tpl-fill-input"
                value={values[key] ?? ''}
                placeholder={`填写「${key}」（可留空）`}
                onChange={(e) => setValue(key, e.target.value)}
                rows={4}
              />
            </label>
          ))
        )}
      </div>

      <div className="tpl-fill-foot">
        <Button variant="secondary" onClick={() => proceed(false)}>
          <Icon name="edit" size={13} /> 进入编辑页（草稿）
        </Button>
        <Button variant="primary" onClick={() => proceed(true)}>
          <Icon name="check" size={13} /> 直接提交
        </Button>
      </div>
    </div>
  );
}
