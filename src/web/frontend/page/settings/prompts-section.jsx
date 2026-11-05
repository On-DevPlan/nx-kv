// 设置面板「提示词 / 模板」一栏：左 tab 悬停即切换（点击兜底），右栏编辑/新增。
// #41 交互收敛：说明文字全部删除；提示词条目默认收起成标题行，点击才展开。
//
// 三类：
//   1. 任务模板——骨架锁死，只填槽位文字；新建任务正文必须已渲染（无裸 {{槽}}）
//   2. 回调提示词（全局）——领到任务时的收尾指令，多条
//   3. ack 完成总结提示词（全局）——agent 写完成总结的格式要求，多条
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useTemplates } from '../../modules/md/use-templates.js';
import { PromptItemsEditor } from '../../modules/prompts/prompt-editor.jsx';
import { TemplateSlotsEditor } from '../../modules/prompts/template-slots.jsx';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';

const MAX_ITEMS = 10; // 与服务端 clampTaskSuffixList / clampAckPromptList 一致

const TABS = [
  { id: 'template', label: '任务模板' },
  { id: 'suffix', label: '回调提示词' },
  { id: 'ack', label: 'ack 总结' },
  { id: 'delivery', label: '交付上下文' },
];

/** 全局提示词列表（回调 / ack 共用一套读写） */
function GlobalPrompts({ listFlag, listKey, placeholder, offText }) {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openIdx, setOpenIdx] = useState(-1); // 手风琴展开态（受控：新增条目自动展开）

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
      // 整体替换列表走 listFlag（suffixList / ackList）——action 此前只暴露单条
      // flag，面板用 taskSuffix/ackPrompt 保存会 400 且静默无效（#41 实测修）。
      const d = await api('/api/localtasks/setting', { method: 'PATCH', body: { [listFlag]: list } });
      const saved = d?.[listKey] ?? [];
      setItems(saved);
      toast(saved.length ? `已保存（${saved.length} 条）` : offText);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 停用 = 清空全部条目（save([])）。曾用文案「关闭」排在「保存 / 撤销改动」
  // 一排里，怎么看都是「关掉这个页面」——一点却把整份已配置的条目清掉
  // （#80：反直觉且不可恢复）。改成明说后果的「停用」，有配置时先弹确认。
  const disableAll = async () => {
    if (busy || items === null) return;
    if (items.length) {
      const ok = await dialog({
        title: '清空并停用？',
        message: `将删除全部 ${items.length} 条已配置条目并停用，保存后不可恢复。`,
        okText: '清空并停用',
        danger: true,
      });
      if (!ok) return;
    }
    save([]);
  };

  return (
    <div className="setp-suffix">
      {items !== null && !items.length && <span className="setp-badge">已关闭</span>}
      {items !== null && (
        <PromptItemsEditor
          items={items}
          onChange={setItems}
          disabled={busy}
          placeholder={placeholder}
          sections
          accordion
          openIndex={openIdx}
          onOpenChange={setOpenIdx}
        />
      )}
      <div className="setp-proj-a">
        <button
          className="btn ghost sm"
          disabled={busy || items === null || items.length >= MAX_ITEMS}
          onClick={() => {
            const next = items.length;
            setItems([...items, '']);
            setOpenIdx(next);
          }}
        >
          添加一条…
        </button>
        <span className="spacer" />
        <button className="btn sm" disabled={busy || items === null} onClick={() => save(items)}>
          保存
        </button>
        <button
          className="btn ghost sm danger"
          disabled={busy || items === null}
          onClick={disableAll}
          title="清空全部条目并停用"
        >
          停用
        </button>
        <button className="btn ghost sm" disabled={busy} onClick={load}>
          撤销改动
        </button>
      </div>
      {dialogNode}
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

/**
 * 交付上下文模板（任务 #62）：原始提示词之外那段「组 / 项目关键路径」怎么写。
 * 面板上**看得见、改得动**——占位符清单直接列在旁边，不靠记忆。
 */
function DeliveryTemplate() {
  const toast = useToast();
  const [text, setText] = useState(null); // null = 还没读
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/localtasks')
      .then((d) => setText(d?.settings?.deliveryTemplate ?? ''))
      .catch((e) => toast('读取失败：' + (e.message || e)));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', {
        method: 'PATCH',
        body: { deliveryTemplate: text ?? '' },
      });
      setText(d?.deliveryTemplate ?? '');
      toast('已保存交付上下文模板');
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', {
        method: 'PATCH',
        body: { deliveryTemplate: '' },
      });
      setText(d?.deliveryTemplate ?? '');
      toast('已恢复内置默认模板');
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setp-suffix">
      <div className="setp-row">
        <span>交付上下文模板（原始提示词之外的组 / 项目关键路径）</span>
        <button type="button" className="btn ghost sm" onClick={save} disabled={busy || text === null}>
          保存
        </button>
        <button type="button" className="btn ghost sm" onClick={reset} disabled={busy || text === null}>
          恢复默认
        </button>
      </div>
      <textarea
        className="setp-area"
        rows={12}
        value={text ?? ''}
        placeholder={'留空 = 用内置默认模板'}
        disabled={text === null}
        onChange={(e) => setText(e.target.value)}
      />
      <details className="setp-tpl-preview">
        <summary>可用占位符</summary>
        <pre className="setp-tpl-preview-body">
          {'{{task.text}} 原始提示词（正文逐字）\n{{repo.name}} {{repo.intro}} {{repo.introPath}} {{repo.docs}} 项目介绍与补充文档\n{{group.name}} {{group.desc}} {{group.intro}} {{group.introPath}} {{group.note}} {{group.peers}} {{group.docs}}\n{{source}} {{summary}} {{cwd}} {{name}} {{goal.*}}\n{{params.k}} / {{k}} 外部参数（--param k=v 平铺传入）\n段落：{{#repo}}…{{/repo}}、{{#group}}…{{/group}}（ctx 里没有就整段不出现）'}
        </pre>
      </details>
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
            onMouseEnter={() => setTab(t.id)}
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
            listFlag="suffixList"
            listKey="taskSuffixList"
            placeholder={'一条收尾指令（支持 {{task.text}} / {{goal.*}} 占位符）'}
            offText="已关闭回调提示词"
          />
        )}
        {tab === 'ack' && (
          <GlobalPrompts
            listFlag="ackList"
            listKey="ackPromptList"
            placeholder={'例如：完成总结按「改了什么 · 怎么验证 · 遗留什么」三段写，每段一行'}
            offText="已关闭 ack 提示词"
          />
        )}
        {tab === 'delivery' && <DeliveryTemplate />}
      </div>
    </div>
  );
}
