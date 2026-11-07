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
import {
  APPEND_MODES,
  BLOCK_DEFS,
  BUILTIN_TEMPLATE_ID,
  BUILTIN_TEMPLATE_NAME,
  MAX_PROMPT_TEMPLATE_NAME,
  normalizeBlockTemplateLists,
} from '../../../../shared/prompt-blocks.js';

// 每区块**实际可用**的参数（参数名 + 一句含义）：只做速查，不写语法/示例。
// 数据来自共享 ctx（delivery-template.js 的 buildDeliveryCtx）与 attach 的 attachTemplateCtx。
const BLOCK_PARAMS = {
  context: [
    {
      label: '项目',
      items: [
        ['repo.name', '项目名'],
        ['repo.intro', '项目介绍正文'],
        ['repo.introPath', '介绍全文路径'],
        ['repo.docs', '补充文档（可循环 path/tag/note）'],
        ['repo.docCount', '补充文档数'],
      ],
    },
    {
      label: '组',
      items: [
        ['group.name', '组名'],
        ['group.desc', '组定位'],
        ['group.intro', '组介绍正文'],
        ['group.note', '本项目在组里的位置'],
        ['group.peers', '组内成员（可循环 name/note）'],
        ['group.docs', '组绑定参考文件（可循环）'],
        ['groups', '其余组（可循环 name/desc/path）'],
      ],
    },
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务原文'],
        ['params', '外部参数（k=v）'],
      ],
    },
  ],
  attachment: [
    {
      label: '附件',
      items: [
        ['attach.count', '附件个数'],
        ['attach.list', '附件清单（可循环 name/kindLabel/localPath）'],
        ['attach.sync', '同步结果'],
        ['attach.sync.dir', '同步目录'],
        ['attach.sync.downloaded', '已下载数'],
        ['attach.sync.skipped', '跳过数'],
        ['attach.sync.failureCount', '失败数'],
      ],
    },
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务原文'],
      ],
    },
  ],
  timecheck: [
    {
      label: '时间目标',
      items: [
        ['goal.check', '时间检查指令（任务级）'],
        ['goal.statusLine', '目录级目标状态行'],
        ['goal.name', '目标名'],
        ['goal.deadline', '截止时间'],
        ['goal.remainingSec', '剩余秒数'],
        ['goal.remainingMin', '剩余分钟（向上取整）'],
        ['goal.overtimeSec', '超时秒数'],
        ['goal.reached', '是否到点'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
    },
  ],
  ext: [
    {
      label: '队列',
      items: [
        ['ext.topic', '主题 / 队列名'],
        ['ext.count', '待领取任务数'],
        ['ext.list', '待领取清单（可循环 id/title/topic）'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
    },
  ],
  ack: [
    {
      label: '通用',
      items: [
        ['task.id', '任务号'],
        ['task.text', '任务原文'],
        ['source', '任务来源（local/global）'],
        ['summary', '领取方现状'],
        ['name', '领取方名字'],
        ['cwd', '领取方目录'],
        ['params', '外部参数（k=v）'],
      ],
    },
  ],
  getloop: [
    {
      label: '持续 get',
      items: [
        ['getloop.text', '持续 get 指令正文'],
        ['getloop.waitMinutes', '单轮等待分钟数'],
      ],
    },
    {
      label: '通用',
      items: [['task.id', '任务号']],
    },
  ],
};

// 只读参数速查：分组紧凑、参数名等宽、含义一行内说完。
function BlockParams({ blockId }) {
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

function genId() {
  return `bt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function blockOf(id) {
  return BLOCK_DEFS.find((d) => d.id === id) || BLOCK_DEFS[0];
}

function templateOf(lists, blockId, id) {
  const b = lists[blockId];
  return b.list.find((t) => t.id === id) || b.list.find((t) => t.id === b.active) || b.list[0];
}

export default function PromptTemplatesSection() {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [state, setState] = useState(null); // { lists, appendMode }
  const [blockId, setBlockId] = useState(BLOCK_DEFS[0].id);
  const [editing, setEditing] = useState(null); // { blockId, id, name, template }
  const [busy, setBusy] = useState(false);

  const applyLists = (lists, keep = null) => {
    setState((cur) => ({ ...(cur || {}), lists }));
    const target = keep || (editing && editing.blockId === blockId ? editing : null);
    const bid = target?.blockId || blockId;
    const tpl = templateOf(lists, bid, target?.id || lists[bid].active);
    setEditing({ blockId: bid, id: tpl.id, name: tpl.name, template: tpl.template });
  };

  const load = () => {
    api('/api/localtasks')
      .then((d) => {
        const s = d?.settings || {};
        const lists = normalizeBlockTemplateLists(s.blockTemplates);
        const appendMode = s.appendMode === 'plain' ? 'plain' : 'xml';
        setState({ lists, appendMode });
        const first = BLOCK_DEFS[0];
        const tpl = templateOf(lists, first.id, lists[first.id].active);
        setBlockId(first.id);
        setEditing({ blockId: first.id, id: tpl.id, name: tpl.name, template: tpl.template });
      })
      .catch((e) => toast('读取失败：' + (e.message || e)));
  };

  useEffect(load, []);

  if (!state) return <div className="setp-note">读取提示词模板…</div>;

  const activeBlock = blockOf(blockId);
  const currentBlock = state.lists[blockId];
  const isBuiltin = editing?.id === BUILTIN_TEMPLATE_ID;

  const persist = async (nextLists, message, keep = null) => {
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
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const cloneLists = () => JSON.parse(JSON.stringify(state.lists));

  const openBlock = (id) => {
    if (busy) return;
    setBlockId(id);
    const tpl = templateOf(state.lists, id, state.lists[id].active);
    setEditing({ blockId: id, id: tpl.id, name: tpl.name, template: tpl.template });
  };

  const pick = (id) => {
    const tpl = templateOf(state.lists, blockId, id);
    setEditing({ blockId, id: tpl.id, name: tpl.name, template: tpl.template });
  };

  const patchEditing = (patch) => setEditing((cur) => ({ ...cur, ...patch }));

  const saveTemplate = () => {
    if (isBuiltin) {
      toast('系统内置模板不可编辑；请先「复制」一份再改');
      return;
    }
    const name = String(editing.name || '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
    const template = String(editing.template ?? '');
    const next = cloneLists();
    const b = next[blockId];
    const idx = b.list.findIndex((t) => t.id === editing.id);
    const entry = { id: editing.id, name, template, builtin: false };
    if (idx >= 0) b.list[idx] = entry;
    else b.list.push(entry);
    persist(next, '已保存模板（当前生效项保存后立即生效）', { blockId, id: editing.id });
  };

  const create = () => {
    if (busy) return;
    const next = cloneLists();
    const entry = { id: genId(), name: '新模板', template: '', builtin: false };
    next[blockId].list.push(entry);
    // 先落库再选中；是否启用由用户点「启用」决定
    persist(next, '已新建模板，填写后保存，再点「启用」', { blockId, id: entry.id });
  };

  const duplicate = (id = editing?.id) => {
    if (busy || !id) return;
    const src = templateOf(state.lists, blockId, id);
    const next = cloneLists();
    const entry = {
      id: genId(),
      name: `${src.name || '模板'} 副本`.slice(0, MAX_PROMPT_TEMPLATE_NAME),
      template: src.template || '',
      builtin: false,
    };
    next[blockId].list.push(entry);
    persist(next, '已复制模板', { blockId, id: entry.id });
  };

  const saveAndActivate = () => {
    if (busy || isBuiltin) return;
    const name = String(editing.name || '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
    const next = cloneLists();
    const b = next[blockId];
    const idx = b.list.findIndex((t) => t.id === editing.id);
    const entry = { id: editing.id, name, template: String(editing.template ?? ''), builtin: false };
    if (idx >= 0) b.list[idx] = entry;
    else b.list.push(entry);
    b.active = editing.id;
    persist(next, `已保存并启用「${name}」`, { blockId, id: editing.id });
  };

  const activate = (id) => {
    if (busy) return;
    if (id === currentBlock.active) return;
    const next = cloneLists();
    next[blockId].active = id;
    persist(next, `已启用「${templateOf(state.lists, blockId, id).name}」`, { blockId, id });
  };

  const remove = async (id) => {
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
    const b = next[blockId];
    b.list = b.list.filter((t) => t.id !== id);
    if (b.active === id) b.active = BUILTIN_TEMPLATE_ID;
    persist(next, '已删除模板，当前生效项已回落到系统内置');
  };

  const resetBuiltin = () => {
    if (busy) return;
    if (currentBlock.active === BUILTIN_TEMPLATE_ID) return;
    const next = cloneLists();
    next[blockId].active = BUILTIN_TEMPLATE_ID;
    persist(next, '已恢复系统内置模板', { blockId, id: BUILTIN_TEMPLATE_ID });
  };

  const setAppendMode = async (mode) => {
    if (busy || mode === state.appendMode) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', {
        method: 'PATCH',
        body: { appendMode: mode },
      });
      setState((cur) => ({ ...cur, appendMode: d?.appendMode === 'plain' ? 'plain' : 'xml' }));
      toast('已保存追加模式（全局生效）');
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setp-tpl-editor">
      <div className="setp-mode-picks">
        {APPEND_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={'setp-mode-pick' + (state.appendMode === m.id ? ' is-on' : '')}
            disabled={busy}
            onClick={() => setAppendMode(m.id)}
          >
            <b>{m.label}</b>
            <small>{m.desc}</small>
          </button>
        ))}
      </div>

      <nav className="setp-block-tabs" aria-label="提示词区块">
        {BLOCK_DEFS.map((d) => {
          const act = templateOf(state.lists, d.id, state.lists[d.id].active);
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
            <button type="button" className="btn ghost sm" disabled={busy} onClick={create}>
              新建模板
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy || currentBlock.active === BUILTIN_TEMPLATE_ID}
              onClick={resetBuiltin}
            >
              恢复内置
            </button>
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
                <button
                  type="button"
                  className="btn ghost sm setp-tpl-act"
                  disabled={busy}
                  title={t.builtin ? '复制系统内置模板' : '复制该模板'}
                  onClick={() => duplicate(t.id)}
                >
                  复制
                </button>
                <button
                  type="button"
                  className="btn ghost sm setp-tpl-act"
                  disabled={busy || on}
                  title="设为该区块当前生效模板"
                  onClick={() => activate(t.id)}
                >
                  启用
                </button>
                <button
                  type="button"
                  className="btn ghost sm danger setp-tpl-act"
                  disabled={busy || t.builtin}
                  title={t.builtin ? '系统内置模板不可删除' : '删除该模板'}
                  onClick={() => remove(t.id)}
                >
                  删除
                </button>
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
                <button type="button" className="btn ghost sm" disabled={busy} onClick={duplicate}>
                  复制为我的模板
                </button>
              ) : (
                <>
                  <button type="button" className="btn sm" disabled={busy} onClick={saveTemplate}>
                    保存
                  </button>
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={load}>
                    撤销改动
                  </button>
                  {editing.id !== currentBlock.active && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={saveAndActivate}
                    >
                      保存并启用
                    </button>
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
