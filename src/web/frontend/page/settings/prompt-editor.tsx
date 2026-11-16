// 提示词段落编辑器（S5 UI 重设计）：左轨选中哪一段，这里就编辑哪一段。
//
// 四件事与旧实现不同：
//   1. 模板集从「列表 + 每行 3 个常驻按钮」改成 chips（当前生效项打勾、内置项带锁），
//      删除收进 chip 的 ×——8 段从 24 个常驻按钮降到每段 1 个主操作；
//   2. 「启用中」（数据状态）与「正在编辑」（视图状态）分开表达，不再两个近似高亮；
//   3. 有 dirty 语义：``● 未保存`` + 「撤销改动」丢弃草稿（旧实现的撤销是重新 GET 服务器）；
//   4. 变量从只读速查变成**可点击插入**（在光标处插 `{{…}}`），目录仍来自注册表 fields。
import { useRef } from 'react';
import { Button } from '../../components/button/index.js';
import { BUILTIN_TEMPLATE_ID, BUILTIN_TEMPLATE_NAME, MAX_PROMPT_TEMPLATE_NAME } from '../../../../shared/prompt-blocks.js';
import type { BlockTemplateList } from '../../../../shared/prompt-blocks.js';
import type { PluginDesc } from './prompt-rail.js';

/** 预览结果（POST /api/localtasks/preview 的 segments = compose 的 trace）。 */
export interface PreviewResult {
  instruction: string;
  segments: { id: string; label: string; text: string; templateName: string }[];
  /** 渲染时刻（HH:mm:ss），用来提示「这份预览是几点渲染的」 */
  at: string;
}

export interface EditorActions {
  onDraft: (patch: { name?: string; template?: string }) => void;
  onPick: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
  onSaveAndActivate: () => void;
  onActivate: () => void;
  onUndo: () => void;
  onResetBuiltin: () => void;
  onPreview: () => void;
  onTogglePreview: () => void;
}

export function PromptEditor({
  plugin,
  list,
  selectedId,
  draft,
  dirty,
  busy,
  preview,
  previewOpen,
  total,
  actions,
}: {
  plugin: PluginDesc;
  list: BlockTemplateList;
  selectedId: string;
  draft: { name: string; template: string };
  dirty: boolean;
  busy: boolean;
  preview: PreviewResult | null;
  previewOpen: boolean;
  total: number;
  actions: EditorActions;
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const selected = list.list.find((t) => t.id === selectedId) || list.list[0]!;
  const builtin = selected.id === BUILTIN_TEMPLATE_ID;
  const isActive = list.active === selected.id;
  const readOnlySegment = plugin.writableKeys.length === 0;

  // 点变量 chip：在光标处插入 {{…}}，插完把光标挪到 token 之后
  const insertVar = (key: string) => {
    if (builtin) return;
    const el = areaRef.current;
    const token = `{{${key}}}`;
    const text = draft.template;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    actions.onDraft({ template: text.slice(0, start) + token + text.slice(end) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="ppt-ed">
      <div className="ppt-ed-head">
        <div className="ppt-ed-title">
          <b>{plugin.label}</b>
          <code className="ppt-ed-tag">{plugin.tag}</code>
          <span className={'ppt-pill' + (readOnlySegment ? '' : ' is-write')}>
            {readOnlySegment ? '只读段' : '可写段'}
          </span>
          {isActive && <span className="ppt-pill is-on">启用中</span>}
        </div>
        <Button
          variant="secondary"
          small
          className="ppt-ed-reset"
          disabled={busy || list.active === BUILTIN_TEMPLATE_ID}
          title="把本段生效模板换回系统内置"
          onClick={actions.onResetBuiltin}
        >
          恢复内置
        </Button>
        <span className="ppt-ed-sub">
          {readOnlySegment ? '只读段不回写交付上下文；' : ''}
          模板留空则整段不输出 · 输出为 &lt;{plugin.tag}&gt;
        </span>
      </div>

      <div className="ppt-chips" role="group" aria-label={`${plugin.label}候选模板`}>
        <span className="ppt-chips-cap">候选模板</span>
        {list.list.map((t) => {
          const on = t.id === list.active;
          const sel = t.id === selected.id;
          return (
            <span key={t.id} className={'ppt-chip-wrap' + (sel ? ' is-sel' : '') + (on ? ' is-on' : '')}>
              <button
                type="button"
                className="ppt-chip"
                aria-pressed={sel}
                title={on ? `${t.name}（启用中）` : t.name}
                disabled={busy}
                onClick={() => actions.onPick(t.id)}
              >
                {t.builtin && <span className="ppt-chip-lock">内置</span>}
                <span className="ppt-chip-name">{t.name}</span>
                {on && <span className="ppt-chip-tick">✓</span>}
              </button>
              {!t.builtin && (
                <button
                  type="button"
                  className="ppt-chip-x"
                  title="删除该模板"
                  aria-label={`删除 ${t.name}`}
                  disabled={busy}
                  onClick={() => actions.onRemove(t.id)}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button type="button" className="ppt-chip-new" disabled={busy} title="新建一个空模板" onClick={actions.onNew}>
          + 新建
        </button>
      </div>

      <div className="ppt-name-row">
        <span className="ppt-name-label">模板名</span>
        <input
          className="ppt-name-input"
          value={builtin ? BUILTIN_TEMPLATE_NAME : draft.name}
          readOnly={builtin}
          maxLength={MAX_PROMPT_TEMPLATE_NAME}
          placeholder="未命名模板"
          disabled={busy}
          title={builtin ? '系统内置模板不可改名，请先复制一份' : ''}
          onChange={(e) => actions.onDraft({ name: e.target.value })}
        />
        <span className={'ppt-dirty' + (dirty ? ' is-on' : '')}>● 未保存</span>
      </div>

      <textarea
        ref={areaRef}
        className="ppt-tpl-area"
        value={draft.template}
        readOnly={builtin}
        spellCheck={false}
        disabled={busy}
        placeholder={builtin ? '' : '在这里写该段的模板；可用下方变量，留空则整段不输出'}
        onChange={(e) => actions.onDraft({ template: e.target.value })}
      />

      {plugin.fields.length > 0 && (
        <div className="ppt-vars" aria-label="可用变量（点击插入）">
          <span className="ppt-vars-cap">点击插入</span>
          {plugin.fields.map((f) => (
            <code
              key={f.key}
              className="ppt-var"
              role="button"
              tabIndex={builtin ? -1 : 0}
              title={f.desc || f.label || f.key}
              aria-disabled={builtin}
              onClick={() => insertVar(f.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  insertVar(f.key);
                }
              }}
            >
              {f.key}
            </code>
          ))}
        </div>
      )}

      <div className="ppt-actions">
        {builtin ? (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => actions.onDuplicate(selected.id)}>
              复制为我的模板
            </Button>
            {!isActive && (
              <Button variant="secondary" disabled={busy} onClick={actions.onActivate}>
                设为生效
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="primary" disabled={busy || !dirty} onClick={actions.onSave}>
              保存
            </Button>
            {!isActive && (
              <>
                <Button variant="secondary" disabled={busy} onClick={actions.onSaveAndActivate}>
                  保存并启用
                </Button>
                <Button variant="secondary" disabled={busy} onClick={actions.onActivate}>
                  仅启用（保存的版本）
                </Button>
              </>
            )}
            <Button variant="secondary" disabled={busy || !dirty} onClick={actions.onUndo} title="丢弃未保存改动，回到上次保存的文本">
              撤销改动
            </Button>
          </>
        )}
        <span className="spacer" />
        <Button
          variant="secondary"
          className="ppt-preview-btn"
          disabled={busy}
          title={dirty ? '有未保存改动：先保存再按已保存内容渲染' : '用一条草稿任务渲染当前已保存的生效模板与顺序'}
          onClick={actions.onPreview}
        >
          {dirty ? '保存并预览' : '预览交付'}
        </Button>
      </div>

      <div className="ppt-pv">
        <button type="button" className="ppt-pv-head" aria-expanded={previewOpen} onClick={actions.onTogglePreview}>
          <b>交付预览</b>
          <span className="setp-note">
            {preview
              ? `命中 ${preview.segments.length}/${total} 段 · ${preview.at} 渲染${dirty ? ' · 不含未保存改动' : ''}`
              : '尚未渲染 · 按已保存的生效模板与当前顺序合成'}
          </span>
          <span className="ppt-pv-toggle">{previewOpen ? '收起 ⌃' : '展开 ⌄'}</span>
        </button>
        {previewOpen && (
          <div className="ppt-pv-body">
            {preview ? (
              <>
                <pre className="ppt-pv-pre">{preview.instruction || '（本次领取没有可输出的段落）'}</pre>
                {preview.segments.length > 0 && (
                  <div className="ppt-pv-segs">
                    {preview.segments.map((s, i) => (
                      <span className="ppt-pv-seg" key={`${s.id}-${i}`}>
                        <span className="ppt-pv-seg-label">{s.label}</span>
                        <code>{s.templateName}</code>
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="ppt-pv-empty">点右上「预览交付」，用一条草稿任务渲染真实领取时会拿到的提示词。</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
