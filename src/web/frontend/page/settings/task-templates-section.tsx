// 设置「任务模板」（#135）：卡片列表——可见绑定 / 编辑 / 设默认；改正文进全屏 MdPanes。
import { useState } from 'react';
import { useTemplates } from '../../modules/md/use-templates.js';
import { Button } from '../../components/button/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useToast } from '../../components/toast/index.jsx';
import ScopeChips from '../templates/scope-chips.jsx';
import type { PromptTemplate, TemplateEditorOpts, TemplatesApi } from '../../types.js';

/** 打开全屏模板编辑器的入参：**唯一定义在共享契约**（panels.openTemplateEditor 也用它），此处转出给设置页。 */
export type { TemplateEditorOpts };

export interface TaskTemplatesSectionProps {
  openTemplateEditor?: (opts: TemplateEditorOpts) => void;
}

export default function TaskTemplatesSection({ openTemplateEditor }: TaskTemplatesSectionProps) {
  // useTemplates 还没标注返回面（templates 被推断成 null），按共享契约 TemplatesApi 桥接
  const tpl = useTemplates() as unknown as TemplatesApi;
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const templates = tpl.templates || [];
  const [scopeOpenId, setScopeOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (tpl.unsupported) {
    return <div className="setp-note">当前服务比面板旧——重启面板后才有模板功能。</div>;
  }

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast(okMsg);
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const removeTpl = async (t: PromptTemplate) => {
    const ok = await dialog({
      title: `删除模板「${t.name}」`,
      danger: true,
      okText: '删除',
    });
    if (!ok) return;
    await act(() => tpl.remove(t.id), `已删除「${t.name}」`);
    if (scopeOpenId === t.id) setScopeOpenId(null);
  };

  return (
    <div className="setp-tpl setp-tpl-cards">
      {dialogNode}
      {!templates.length && (
        <div className="setp-note">还没有模板（内置默认模板加载中…）。</div>
      )}
      {templates.map((t) => {
        const isDefault = t.id === tpl.defaultId;
        const scopeOpen = scopeOpenId === t.id;
        return (
          <div key={t.id} className={'setp-tpl-card' + (isDefault ? ' is-default' : '')}>
            <div className="setp-tpl-card-head">
              <span className="setp-tpl-card-name">{t.name}</span>
              {isDefault && <span className="setp-badge">默认</span>}
              {t.builtin && <span className="setp-badge soft">内置</span>}
            </div>
            {scopeOpen && (
              <div className="setp-tpl-card-scope">
                <ScopeChips
                  scope={t.scope}
                  originTopic={t.originTopic}
                  onChange={(next: string[]) => tpl.update(t.id, { scope: next })}
                />
              </div>
            )}
            <div className="setp-tpl-card-foot">
              <span className="grow" />
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setScopeOpenId(scopeOpen ? null : t.id)}
              >
                可见绑定
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => openTemplateEditor?.({ id: t.id, name: t.name, mode: 'edit' })}
              >
                编辑
              </Button>
              {!isDefault && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => act(() => tpl.setDefault(t.id), `默认模板已设为「${t.name}」`)}
                >
                  设为默认
                </Button>
              )}
              {!t.builtin && (
                <Button variant="secondary" disabled={busy} onClick={() => removeTpl(t)}>
                  删除
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <div className="setp-tpl-card-new">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => openTemplateEditor?.({ mode: 'new', scope: [] })}
        >
          ＋ 新建模板
        </Button>
      </div>
    </div>
  );
}
