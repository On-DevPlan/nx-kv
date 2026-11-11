// 设置面板「提示词模板」：每个区块各自一份模板列表，各自指定生效项。
//
// 结构（v5）：
//   - 顶部区块切换（context / attachment / timecheck / ack / getloop）；
//   - 每个区块内：模板列表（新建 / 编辑 / 复制 / 删除 / 启用 / 恢复内置）；
//   - 系统内置模板固定存在、不可删除、不可编辑；用户模板可复制内置来改；
//   - 保存即落库：启用项立即参与领取任务时的系统提示词渲染。
//
// UI 边界：这里只做模板编辑与启用。编辑区下方给**只读参数清单**（参数名 + 一句含义）；
// 引擎名称、选型理由、语法教程、示例模板与成段说明仍然只写在 skill / docs，不放到设置页。
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { Button } from '../../components/button/index.jsx';
import {
  APPEND_MODES,
  BLOCK_DEFS,
  BUILTIN_TEMPLATE_ID,
  BUILTIN_TEMPLATE_NAME,
  MAX_PROMPT_TEMPLATE_NAME,
  normalizeBlockTemplateLists,
} from '../../../../shared/prompt-blocks.js';
import type { BlockDef, BlockTemplateList, PromptTemplateItem } from '../../../../shared/prompt-blocks.js';
import { BLOCK_PARAMS } from './prompt-template-params.js';

interface BlockParamsProps {
  blockId: string;
}

// 只读参数速查：分组紧凑、参数名等宽、含义一行内说完。
function BlockParams({ blockId }: BlockParamsProps) {
  const groups = BLOCK_PARAMS[blockId] || [];
  if (!groups.length) return null;
  return (
    <div className="setp-params" aria-label="可使用参数">
      <div className="setp-params-head">可使用参数</div>
      {groups.map((g) => (
        <div className="setp-params-row" key={g.label}>
          <span className="setp-params-label">{g.label}</span>
          <div className="setp-params-items">
            {g.items.map(([name, desc]) => (
              <span className="setp-param" key={name}>
                <code>{name}</code>
                <span>{desc}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 当前面板状态：每个区块的模板列表 + 全局追加模式。 */
interface PromptListsState {
  lists: Record<string, BlockTemplateList>;
  appendMode: string;
}

/** 正在编辑的模板（blockId + 条目字段的草稿副本）。 */
interface EditingState {
  blockId: string;
  id: string;
  name: string;
  template: string;
}

/** persist / applyLists 之后要选中的条目（不传则沿用当前选择）。 */
interface KeepTarget {
  blockId: string;
  id: string;
}

function genId() {
  return `bt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blockOf(id: string): BlockDef {
  // BLOCK_DEFS 是冻结的非空常量表：find 落空时才回落到首项
  return (BLOCK_DEFS.find((d) => d.id === id) || BLOCK_DEFS[0])!;
}

/**
 * 取某区块的模板列表。normalizeBlockTemplateLists 的契约是「每个区块都有列表，
 * 且列表首项恒为系统内置条目」，所以这里的下标记号是收口 noUncheckedIndexedAccess，
 * 不是真的会落空。
 */
function listOf(lists: Record<string, BlockTemplateList>, id: string): BlockTemplateList {
  return lists[id]!;
}

function templateOf(lists: Record<string, BlockTemplateList>, blockId: string, id: string): PromptTemplateItem {
  const b = listOf(lists, blockId);
  return b.list.find((t) => t.id === id) || b.list.find((t) => t.id === b.active) || b.list[0]!;
}

export default function PromptTemplatesSection() {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [state, setState] = useState<PromptListsState | null>(null); // { lists, appendMode }
  const [blockId, setBlockId] = useState(BLOCK_DEFS[0]!.id);
  const [editing, setEditing] = useState<EditingState | null>(null); // { blockId, id, name, template }
  const [busy, setBusy] = useState(false);

  const applyLists = (lists: Record<string, BlockTemplateList>, keep: KeepTarget | null = null) => {
    // state 缺省时按 xml 起步（= APPEND_MODES[0]，与旧实现里「读不到就回落首项」等价）
    setState((cur) => ({ lists, appendMode: cur?.appendMode ?? 'xml' }));
    const target = keep || (editing && editing.blockId === blockId ? editing : null);
    const bid = target?.blockId || blockId;
    const tpl = templateOf(lists, bid, target?.id || listOf(lists, bid).active);
    setEditing({ blockId: bid, id: tpl.id, name: tpl.name, template: tpl.template });
  };

  const load = () => {
    api('/api/localtasks')
      .then((d) => {
        // 响应是外部数据（/api/localtasks）：settings 形状按后端 schema 读
        const s = d?.settings || {};
        const lists = normalizeBlockTemplateLists(s.blockTemplates);
        const appendMode = s.appendMode === 'plain' ? 'plain' : 'xml';
        setState({ lists, appendMode });
        const first = BLOCK_DEFS[0]!;
        const tpl = templateOf(lists, first.id, listOf(lists, first.id).active);
        setBlockId(first.id);
        setEditing({ blockId: first.id, id: tpl.id, name: tpl.name, template: tpl.template });
      })
      .catch((e) => toast('读取失败：' + ((e as Error).message || e)));
  };

  useEffect(load, []);

  if (!state) return <div className="setp-note">读取提示词模板…</div>;

  const activeBlock = blockOf(blockId);
  // APPEND_MODES 是冻结的非空常量表：找不到（异常值）时回落首项
  const activeMode = APPEND_MODES.find((m) => m.id === state.appendMode) || APPEND_MODES[0]!;
  const currentBlock = listOf(state.lists, blockId);
  const isBuiltin = editing?.id === BUILTIN_TEMPLATE_ID;

  const persist = async (nextLists: Record<string, BlockTemplateList>, message: string, keep: KeepTarget | null = null) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', {
        method: 'PATCH',
        body: { blockTemplates: nextLists },
      });
      applyLists(normalizeBlockTemplateLists(d?.blockTemplates), keep);
      toast(message);
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // 深拷贝：JSON 往返只搬数据（归一化后的 lists 是纯 JSON），避免改到 state 里的同一份引用
  const cloneLists = () => JSON.parse(JSON.stringify(state.lists)) as Record<string, BlockTemplateList>;

  const openBlock = (id: string) => {
    if (busy) return;
    setBlockId(id);
    const tpl = templateOf(state.lists, id, listOf(state.lists, id).active);
    setEditing({ blockId: id, id: tpl.id, name: tpl.name, template: tpl.template });
  };

  const pick = (id: string) => {
    const tpl = templateOf(state.lists, blockId, id);
    setEditing({ blockId, id: tpl.id, name: tpl.name, template: tpl.template });
  };

  const patchEditing = (patch: Partial<EditingState>) => setEditing((cur) => (cur ? { ...cur, ...patch } : cur));

  const saveTemplate = () => {
    if (!editing) return;
    if (isBuiltin) {
      toast('系统内置模板不可编辑；请先「复制」一份再改');
      return;
    }
    const name = String(editing.name || '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
    const template = String(editing.template ?? '');
    const next = cloneLists();
    const b = listOf(next, blockId);
    const idx = b.list.findIndex((t) => t.id === editing.id);
    const entry: PromptTemplateItem = { id: editing.id, name, template, builtin: false };
    if (idx >= 0) b.list[idx] = entry;
    else b.list.push(entry);
    persist(next, '已保存模板（当前生效项保存后立即生效）', { blockId, id: editing.id });
  };

  const create = () => {
    if (busy) return;
    const next = cloneLists();
    const entry: PromptTemplateItem = { id: genId(), name: '新模板', template: '', builtin: false };
    listOf(next, blockId).list.push(entry);
    // 先落库再选中；是否启用由用户点「启用」决定
    persist(next, '已新建模板，填写后保存，再点「启用」', { blockId, id: entry.id });
  };

  // 入参既可能是模板 id（列表行的「复制」），也可能是一个点击事件
  // （「复制为我的模板」按钮直接挂 onClick）——后者按“未指定”处理：
  // 原实现拿事件对象去匹配 id 也匹配不上，最终取到的是当前生效项，行为一致。
  const duplicate = (idOrEvent?: unknown) => {
    if (busy) return;
    const id = typeof idOrEvent === 'string' ? idOrEvent : '';
    const src = templateOf(state.lists, blockId, id);
    const next = cloneLists();
    const entry: PromptTemplateItem = {
      id: genId(),
      name: `${src.name || '模板'} 副本`.slice(0, MAX_PROMPT_TEMPLATE_NAME),
      template: src.template || '',
      builtin: false,
    };
    listOf(next, blockId).list.push(entry);
    persist(next, '已复制模板', { blockId, id: entry.id });
  };

  const saveAndActivate = () => {
    if (busy || isBuiltin) return;
    if (!editing) return;
    const name = String(editing.name || '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
    const next = cloneLists();
    const b = listOf(next, blockId);
    const idx = b.list.findIndex((t) => t.id === editing.id);
    const entry: PromptTemplateItem = { id: editing.id, name, template: String(editing.template ?? ''), builtin: false };
    if (idx >= 0) b.list[idx] = entry;
    else b.list.push(entry);
    b.active = editing.id;
    persist(next, `已保存并启用「${name}」`, { blockId, id: editing.id });
  };

  const activate = (id: string) => {
    if (busy) return;
    if (id === currentBlock.active) return;
    const next = cloneLists();
    listOf(next, blockId).active = id;
    persist(next, `已启用「${templateOf(state.lists, blockId, id).name}」`, { blockId, id });
  };

  const remove = async (id: string) => {
    if (busy) return;
    if (id === BUILTIN_TEMPLATE_ID) {
      toast('系统内置模板不可删除');
      return;
    }
    const tpl = templateOf(state.lists, blockId, id);
    const ok = await dialog({
      title: '删除模板？',
      message: `将删除「${tpl.name}」，保存后不可恢复。该区块的系统内置模板会保留。`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    const next = cloneLists();
    const b = listOf(next, blockId);
    b.list = b.list.filter((t) => t.id !== id);
    if (b.active === id) b.active = BUILTIN_TEMPLATE_ID;
    persist(next, '已删除模板，当前生效项已回落到系统内置');
  };

  const resetBuiltin = () => {
    if (busy) return;
    if (currentBlock.active === BUILTIN_TEMPLATE_ID) return;
    const next = cloneLists();
    listOf(next, blockId).active = BUILTIN_TEMPLATE_ID;
    persist(next, '已恢复系统内置模板', { blockId, id: BUILTIN_TEMPLATE_ID });
  };

  const setAppendMode = async (mode: string) => {
    if (busy || mode === state.appendMode) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', {
        method: 'PATCH',
        body: { appendMode: mode },
      });
      // state 为 null 只可能发生在首轮加载前（那时没有按钮可点）：保持 null 即可
      setState((cur) => (cur ? { ...cur, appendMode: d?.appendMode === 'plain' ? 'plain' : 'xml' } : cur));
      toast('已保存追加模式（全局生效）');
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setp-tpl-editor">
      <div className="setp-tpl-head">
        <span className="setp-tpl-head-label">系统提示词追加方式</span>
        <div className="setp-seg" role="group" aria-label="系统提示词追加方式">
          {APPEND_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={'setp-seg-btn' + (state.appendMode === m.id ? ' is-on' : '')}
              aria-pressed={state.appendMode === m.id}
              title={m.desc}
              disabled={busy}
              onClick={() => setAppendMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="setp-note">{activeMode.desc}</span>
      </div>

      <nav className="setp-block-tabs" aria-label="提示词区块">
        {BLOCK_DEFS.map((d) => {
          const act = templateOf(state.lists, d.id, listOf(state.lists, d.id).active);
          return (
            <button
              key={d.id}
              type="button"
              className={'setp-block-tab' + (d.id === blockId ? ' is-on' : '')}
              disabled={busy}
              onClick={() => openBlock(d.id)}
            >
              <span>{d.label}</span>
              <small>{act.builtin ? '系统内置' : act.name}</small>
            </button>
          );
        })}
      </nav>

      <div className="setp-block-card">
        <div className="setp-block-card-head">
          <div className="setp-block-card-title">
            <b>{activeBlock.label}</b>
            <span className="setp-note">{activeBlock.desc}</span>
          </div>
          <div className="setp-block-card-actions">
            <Button variant="secondary" disabled={busy} onClick={create}>
              新建模板
            </Button>
            <Button
              variant="secondary"
              disabled={busy || currentBlock.active === BUILTIN_TEMPLATE_ID}
              onClick={resetBuiltin}
            >
              恢复内置
            </Button>
          </div>
        </div>

        <div className="setp-tpl-list" role="listbox" aria-label={`${activeBlock.label}模板列表`}>
          {currentBlock.list.map((t) => {
            const on = t.id === currentBlock.active;
            const selected = t.id === editing?.id;
            return (
              <div
                key={t.id}
                className={`setp-tpl-pick${on ? ' is-on' : ''}${selected ? ' is-sel' : ''}`}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  className="setp-tpl-name"
                  title={t.name}
                  onClick={() => pick(t.id)}
                >
                  <span className="setp-tpl-name-text">{t.name}</span>
                  {t.builtin && <span className="setp-badge">内置</span>}
                  {on && <span className="setp-badge">启用中</span>}
                </button>
                <Button
                  variant="secondary"
                  className="setp-tpl-act"
                  disabled={busy}
                  title={t.builtin ? '复制系统内置模板' : '复制该模板'}
                  onClick={() => duplicate(t.id)}
                >
                  复制
                </Button>
                <Button
                  variant="secondary"
                  className="setp-tpl-act"
                  disabled={busy || on}
                  title="设为该区块当前生效模板"
                  onClick={() => activate(t.id)}
                >
                  启用
                </Button>
                <Button
                  variant="secondary"
                  danger
                  className="setp-tpl-act"
                  disabled={busy || t.builtin}
                  title={t.builtin ? '系统内置模板不可删除' : '删除该模板'}
                  onClick={() => remove(t.id)}
                >
                  删除
                </Button>
              </div>
            );
          })}
        </div>

        {editing && (
          <div className="setp-tpl-editor-box">
            <div className="setp-tpl-editor-head">
              <span>
                {isBuiltin ? BUILTIN_TEMPLATE_NAME : `编辑 · ${editing.name || '未命名模板'}`}
              </span>
              <span className="setp-note">
                {editing.id === currentBlock.active
                  ? '当前生效，保存后立即参与领取'
                  : '未启用；保存后可点「启用」'}
              </span>
            </div>

            {!isBuiltin && (
              <div className="setp-row">
                <span>模板名</span>
                <div className="setp-input">
                  <input
                    value={editing.name}
                    maxLength={MAX_PROMPT_TEMPLATE_NAME}
                    disabled={busy}
                    onChange={(e) => patchEditing({ name: e.target.value })}
                  />
                </div>
              </div>
            )}

            <textarea
              className="setp-area setp-tpl-textarea"
              value={editing.template}
              readOnly={isBuiltin}
              spellCheck={false}
              disabled={busy}
              placeholder={isBuiltin ? '' : '在这里写该区块的模板'}
              onChange={(e) => patchEditing({ template: e.target.value })}
            />

            <BlockParams blockId={blockId} />

            <div className="setp-proj-a">
              {isBuiltin ? (
                <Button variant="secondary" disabled={busy} onClick={duplicate}>
                  复制为我的模板
                </Button>
              ) : (
                <>
                  <Button variant="primary" disabled={busy} onClick={saveTemplate}>
                    保存
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={load}>
                    撤销改动
                  </Button>
                  {editing.id !== currentBlock.active && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={saveAndActivate}
                    >
                      保存并启用
                    </Button>
                  )}
                </>
              )}
              <span className="spacer" />
            </div>
          </div>
        )}
      </div>
      {dialogNode}
    </div>
  );
}
