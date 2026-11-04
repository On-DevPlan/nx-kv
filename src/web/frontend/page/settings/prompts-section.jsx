// 设置面板「提示词 / 模板」一栏：把散在各处、风格各异的提示词/模板配置收到一起。
//
// 收进来的是三样（此前分散在「模板与任务工具」区、模板页、项目级设置里）：
//   1. **任务模板**——骨架固定（内置模板不可改结构），只填正文里 {{槽位}} 处的文字；
//      增删改名/设默认仍在模板面板。
//   2. **回调提示词**（全局）——领到任务时随交付给的收尾指令，多条。
//   3. **ack 完成总结提示词**（全局）——agent 写完成总结（ack）时的格式要求，多条。
//
// 项目级「持续 get」提示词仍留在「项目级设置」（它本来就是项目级的），
// 但用的是同一套编辑器组件（modules/prompts）。
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useTemplates } from '../../modules/md/use-templates.js';
import { PromptItemsEditor } from '../../modules/prompts/prompt-editor.jsx';
import { TemplateSlotsEditor } from '../../modules/prompts/template-slots.jsx';

const MAX_ITEMS = 10; // 与服务端 clampTaskSuffixList / clampAckPromptList 的条数上限一致

/** 全局提示词列表（回调 / ack 共用一套读写：settings.taskSuffixList / ackPromptList） */
function GlobalPrompts({ field, listKey, label, hint, placeholder, offText }) {
  const toast = useToast();
  const [items, setItems] = useState(null); // null = 还在读
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

/** 任务模板的槽位编辑：骨架固定，只填 {{槽位}} 处的文字 */
function TemplateSlots({ openTemplates }) {
  const toast = useToast();
  const tpl = useTemplates();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const templates = tpl.templates || [];
  const current = templates.find((t) => t.id === editingId) || null;

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

  return (
    <div className="setp-suffix">
      <div className="setp-row">
        <span>任务模板（骨架固定，只填槽位内容）</span>
        <button className="btn ghost sm" onClick={() => openTemplates?.()}>
          打开模板面板…
        </button>
      </div>
      {tpl.unsupported ? (
        <div className="setp-note">当前服务比面板旧——重启面板后才有模板功能。</div>
      ) : !templates.length ? (
        <div className="setp-note">还没有模板（内置默认模板加载中…）。</div>
      ) : (
        <>
          <div className="setp-tpl-list">
            {templates.map((t) => (
              <div key={t.id} className="setp-tpl-row">
                <span className="setp-tpl-name">{t.name}</span>
                {t.id === tpl.defaultId && <span className="setp-badge">默认</span>}
                {t.builtin && <span className="setp-badge">内置</span>}
                <button
                  className="btn ghost sm"
                  onClick={() => setEditingId(editingId === t.id ? null : t.id)}
                >
                  {editingId === t.id ? '收起' : '填槽位'}
                </button>
              </div>
            ))}
          </div>
          {current && (
            <div className="setp-tpl-slots">
              <TemplateSlotsEditor
                body={current.body}
                values={current.values}
                disabled={busy}
                onSave={(values) => saveValues(current, values)}
              />
              <div className="setp-note">
                槽位从模板正文里扫出来（正文里的 <span className="mono">{'{{名字}}'}</span> 处填这段文字）；
                新建任务时正文按这里的值渲染。
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PromptsSection({ openTemplates }) {
  return (
    <>
      <div className="setp-note">
        <b>提示词 / 模板都收在这一栏</b>：填好后，领到任务时随交付给 agent；
        任务模板的槽位内容会进新建任务的正文。占位符用文本框里的「{'{'}占位符{'}'}」菜单插入。
      </div>

      <GlobalPrompts
        field="taskSuffix"
        listKey="taskSuffixList"
        label="回调提示词（领到任务时随交付的收尾指令，可配多条）"
        placeholder={'一条收尾指令（支持 {{task.text}} / {{goal.*}} 占位符）'}
        hint={
          <>
            多条按空行拼接后统一分流：任一条含 <span className="mono">{'{{'}</span> 渲染为独立 instruction
            字段；纯文本追加到正文末尾。<b>删光或「关闭」= 不交付收尾指令</b>。
          </>
        }
        offText="已关闭回调提示词"
      />

      <GlobalPrompts
        field="ackPrompt"
        listKey="ackPromptList"
        label="ack 完成总结提示词（agent 写完成总结的格式要求，可配多条）"
        placeholder={'例如：完成总结按「改了什么 · 怎么验证 · 遗留什么」三段写，每段一行'}
        hint={
          <>
            随领取交付一起给到 agent（要求它写完成总结时按这个格式）；<b>默认不配置 = 交付里不追加这段</b>。
          </>
        }
        offText="已关闭 ack 提示词"
      />

      <TemplateSlots openTemplates={openTemplates} />
    </>
  );
}
