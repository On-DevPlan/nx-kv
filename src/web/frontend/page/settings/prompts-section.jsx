// 设置面板「提示词 / 模板」一栏：左 tab 切换种类，右栏编辑/新增。
//
// 三类（验收反馈：操作别纵向堆散）：
//   1. 任务模板——骨架锁死，只填槽位文字；新建任务正文必须已渲染（无裸 {{槽}}）
//   2. 回调提示词（全局）——领到任务时的收尾指令，多条
//   3. ack 完成总结提示词（全局）——agent 写完成总结的格式要求，多条
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useTemplates } from '../../modules/md/use-templates.js';
import { PromptItemsEditor } from '../../modules/prompts/prompt-editor.jsx';
import { TemplateSlotsEditor } from '../../modules/prompts/template-slots.jsx';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';

const MAX_ITEMS = 10; // 与服务端 clampTaskSuffixList / clampAckPromptList 一致

const TABS = [
  { id: 'template', label: '任务模板' },
  { id: 'suffix', label: '回调提示词' },
  { id: 'ack', label: 'ack 总结' },
];

/** 全局提示词列表（回调 / ack 共用一套读写） */
function GlobalPrompts({ field, listKey, label, hint, placeholder, offText }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/localtasks')
      .then((d) => setItems(d?.settings?.[listKey] ?? []))
      .catch((e) => toast('读取失败：' + (e.message || e)));
  }, [listKey, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (list) => {
    if (list == null || busy) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', { method: 'PATCH', body: { [field]: list } });
      const saved = d?.[listKey] ?? [];
      setItems(saved);
      toast(saved.length ? `已保存（${saved.length} 条）` : offText);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setp-suffix">
      <div className="setp-row">
        <span>{label}</span>
        {items !== null && !items.length && <span className="setp-badge">已关闭</span>}
      </div>
      {items !== null && (
        <PromptItemsEditor
          items={items}
          onChange={setItems}
          disabled={busy}
          placeholder={placeholder}
          sections
        />
      )}
      <div className="setp-note">{hint}</div>
      <div className="setp-proj-a">
        <button
          className="btn ghost sm"
          disabled={busy || items === null || items.length >= MAX_ITEMS}
          onClick={() => setItems([...items, ''])}
        >
          添加一条…
        </button>
        <button className="btn sm" disabled={busy || items === null} onClick={() => save(items)}>
          保存
        </button>
        <button
          className="btn ghost sm"
          disabled={busy || items === null}
          onClick={() => save([])}
          title={offText}
        >
          关闭
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={load}>
          撤销改动
        </button>
      </div>
    </div>
  );
}

/** 任务模板：左侧点选模板，右侧只填槽位（骨架只读预览） */
function TemplateSlots({ openTemplates }) {
  const toast = useToast();
  const tpl = useTemplates();
  const [busy, setBusy] = useState(false);
  const templates = tpl.templates || [];
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    if (!templates.length) {
      setEditingId(null);
      return;
    }
    if (!editingId || !templates.some((t) => t.id === editingId)) {
      setEditingId(tpl.defaultId || templates[0].id);
    }
  }, [templates, tpl.defaultId, editingId]);

  const current = templates.find((t) => t.id === editingId) || null;
  const preview = current
    ? renderTemplateBody(current.body, current.values || {})
    : '';

  const saveValues = async (t, values) => {
    setBusy(true);
    try {
      await tpl.update(t.id, { values });
      toast(`已保存「${t.name}」的槽位内容`);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (tpl.unsupported) {
    return <div className="setp-note">当前服务比面板旧——重启面板后才有模板功能。</div>;
  }
  if (!templates.length) {
    return <div className="setp-note">还没有模板（内置默认模板加载中…）。</div>;
  }

  return (
    <div className="setp-tpl-split">
      <div className="setp-tpl-side">
        <div className="setp-row">
          <span>选用模板</span>
          <button type="button" className="btn ghost sm" onClick={() => openTemplates?.()}>
            管理…
          </button>
        </div>
        <div className="setp-tpl-list" role="listbox" aria-label="任务模板">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={t.id === editingId}
              className={`setp-tpl-pick${t.id === editingId ? ' is-on' : ''}`}
              onClick={() => setEditingId(t.id)}
            >
              <span className="setp-tpl-name">{t.name}</span>
              {t.id === tpl.defaultId && <span className="setp-badge">默认</span>}
              {t.builtin && <span className="setp-badge">内置</span>}
            </button>
          ))}
        </div>
        <div className="setp-note">
          内置骨架锁死，只能改槽位里的文字；增删/改名/设默认请开模板面板。
        </div>
      </div>
      <div className="setp-tpl-main">
        {current ? (
          <>
            <div className="setp-row">
              <span>槽位内容 · {current.name}</span>
            </div>
            <TemplateSlotsEditor
              body={current.body}
              values={current.values}
              disabled={busy}
              onSave={(values) => saveValues(current, values)}
            />
            <div className="setp-note">
              新建任务时写入**已填好的正文**（不会出现 <span className="mono">{'{{槽位}}'}</span> 标记）。
            </div>
            {preview.trim() ? (
              <details className="setp-tpl-preview">
                <summary>预览新建任务正文</summary>
                <pre className="setp-tpl-preview-body">{preview}</pre>
              </details>
            ) : null}
          </>
        ) : (
          <div className="setp-note">从左侧选一个模板。</div>
        )}
      </div>
    </div>
  );
}

export default function PromptsSection({ openTemplates }) {
  const [tab, setTab] = useState('template');

  return (
    <div className="setp-prompts">
      <nav className="setp-prompts-nav" aria-label="提示词与模板分类">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`setp-prompts-tab${tab === t.id ? ' is-on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="setp-prompts-pane">
        {tab === 'template' && <TemplateSlots openTemplates={openTemplates} />}
        {tab === 'suffix' && (
          <GlobalPrompts
            field="taskSuffix"
            listKey="taskSuffixList"
            label="回调提示词（领到任务时随交付的收尾指令，可配多条）"
            placeholder={'一条收尾指令（支持 {{task.text}} / {{goal.*}} 占位符）'}
            hint={
              <>
                多条按空行拼接后统一分流：任一条含 <span className="mono">{'{{'}</span> 渲染为独立
                instruction 字段；纯文本追加到正文末尾。<b>删光或「关闭」= 不交付收尾指令</b>。
              </>
            }
            offText="已关闭回调提示词"
          />
        )}
        {tab === 'ack' && (
          <GlobalPrompts
            field="ackPrompt"
            listKey="ackPromptList"
            label="ack 完成总结提示词（agent 写完成总结的格式要求，可配多条）"
            placeholder={'例如：完成总结按「改了什么 · 怎么验证 · 遗留什么」三段写，每段一行'}
            hint={
              <>
                随领取交付一起给到 agent；<b>默认不配置 = 交付里不追加这段</b>。
              </>
            }
            offText="已关闭 ack 提示词"
          />
        )}
      </div>
    </div>
  );
}
