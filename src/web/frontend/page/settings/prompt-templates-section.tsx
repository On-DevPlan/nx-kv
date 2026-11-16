// 设置面板「提示词模板」（S5 UI 重设计后的容器层）。
//
// 结构：顶部一行「追加方式」→ 左轨（顺序 = 段落导航，拖动排序）+ 右编辑区。
// 本文件只做**数据与状态**：读设置 / 读注册表 / 拼 patch 落库 / 草稿(dirty) / 预览；
// 左轨渲染在 prompt-rail.tsx，编辑区渲染在 prompt-editor.tsx（行数门禁 ≤500）。
//
// 三条不变量：
//   - 顺序真相是数组：拖完即 PUT /api/prompt/order，序号只做位次展示；
//   - 模板正文/变量目录单一真相：blockTemplates（正文）+ 注册表 fields（变量）；
//   - 草稿按「段 + 模板」缓存：切段不丢未保存文本，dirty = 草稿 ≠ 已保存。
import { useEffect, useState } from 'react';
import {
  getLocaltaskSettings,
  getPromptRegistry,
  previewDelivery,
  saveLocaltaskSettings,
  savePromptOrder,
} from './api.js';
import { PromptRail, type PluginDesc, type RailSlot } from './prompt-rail.js';
import { PromptEditor, type PreviewResult } from './prompt-editor.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { APPEND_MODES, BUILTIN_TEMPLATE_ID, MAX_PROMPT_TEMPLATE_NAME } from '../../../../shared/prompt-blocks.js';
import type { BlockTemplateList, PromptTemplateItem } from '../../../../shared/prompt-blocks.js';

/** 当前面板状态：每个区块的模板列表 + 全局追加模式。 */
interface PromptListsState {
  lists: Record<string, BlockTemplateList>;
  appendMode: string;
}

/** 一份未保存的草稿（按「段|模板」缓存，切段不丢）。 */
interface Draft {
  name: string;
  template: string;
}

function genId() {
  return `bt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 取某区块的模板列表。响应里的 blockTemplates 是后端 normalize 过的合法数据
 * （8 段齐、builtin 常驻），这里的断言是收口 noUncheckedIndexedAccess，不是真的会落空。
 */
function listOf(lists: Record<string, BlockTemplateList>, id: string): BlockTemplateList {
  return lists[id]!;
}

export default function PromptTemplatesSection() {
  const toast = useToast();
  const { dialog, node: dialogNode } = useDialog();
  const [state, setState] = useState<PromptListsState | null>(null);
  const [registry, setRegistry] = useState<PluginDesc[] | null>(null);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    getLocaltaskSettings()
      .then((d) => {
        // 响应是外部数据（/api/localtasks）：settings 形状按后端 schema 读
        const s = d?.settings || {};
        const lists = s.blockTemplates as Record<string, BlockTemplateList>;
        const appendMode = s.appendMode === 'plain' ? 'plain' : 'xml';
        setState({ lists, appendMode });
        return getPromptRegistry().then((r) => {
          const plugins: PluginDesc[] = r?.plugins || [];
          setRegistry(plugins);
          const first = plugins[0]?.id;
          if (!first) return;
          setBlockId(first);
          setSelectedId(listOf(lists, first).active);
        });
      })
      .catch((e) => toast('读取失败：' + ((e as Error).message || e)));
  };

  useEffect(load, []);

  const lists = state?.lists ?? null;
  const plugins = registry || [];
  const block = blockId || plugins[0]?.id || null;
  const list = lists && block ? listOf(lists, block) : null;
  const plugin = plugins.find((p) => p.id === block) || null;

  if (!state || !lists || !list || !block || !plugin) {
    return <div className="setp-note">{state ? '读取提示词插件注册表…' : '读取提示词模板…'}</div>;
  }
  const activeBlockId: string = block; // 上面 guard 之后恒为 string（下面只用它）

  const selected =
    list.list.find((t) => t.id === selectedId) ||
    list.list.find((t) => t.id === list.active) ||
    list.list[0]!;
  const builtin = selected.id === BUILTIN_TEMPLATE_ID;
  const dkey = `${activeBlockId}|${selected.id}`;
  const draft: Draft = drafts[dkey] ?? { name: selected.name, template: selected.template };
  const dirty = builtin ? false : draft.name !== selected.name || draft.template !== selected.template;

  // APPEND_MODES 是冻结的非空常量表：找不到（异常值）时回落首项
  const activeMode =
    APPEND_MODES.find((m) => m.id === state.appendMode) || APPEND_MODES[0]!;

  const slots: RailSlot[] = plugins.map((p) => {
    const b = listOf(lists, p.id);
    const act = b.list.find((t) => t.id === b.active) || b.list[0]!;
    return { plugin: p, activeName: act.name, builtin: !!act.builtin };
  });

  /** 深拷贝：JSON 往返只搬数据（归一化后的 lists 是纯 JSON），避免改到 state 里的同一份引用 */
  const cloneLists = () => JSON.parse(JSON.stringify(lists)) as Record<string, BlockTemplateList>;

  const clearDraft = (key: string) =>
    setDrafts((cur) => {
      const c = { ...cur };
      delete c[key];
      return c;
    });

  const persist = async (
    next: Record<string, BlockTemplateList>,
    message: string,
    opts: { select?: string; clearDraftKey?: string } = {},
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      // #104 真凶：这里曾写成 { method:'PATCH', body:{…} }——api 客户端本就把整对象当 body，
      // 于是真正发出去的是 {method:'PATCH', body:{blockTemplates}}，服务端 zod 把两层未知键
      // 全部剥掉 → patch 为空 → 报「请至少指定一项」。直接传 patch 本身。
      const d = await saveLocaltaskSettings({ blockTemplates: next });
      const saved = (d?.blockTemplates as Record<string, BlockTemplateList>) || next;
      setState((cur) => (cur ? { ...cur, lists: saved } : cur));
      if (opts.select) setSelectedId(opts.select);
      if (opts.clearDraftKey) clearDraft(opts.clearDraftKey);
      toast(message);
      return true;
    } catch (e) {
      toast(String((e as Error).message || e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openBlock = (id: string) => {
    if (busy) return;
    setBlockId(id);
    setSelectedId(listOf(lists, id).active);
  };

  const patchDraft = (patch: Partial<Draft>) => {
    setDrafts((cur) => ({ ...cur, [dkey]: { ...draft, ...patch } }));
  };

  /** 保存当前选中模板；activate=true 时同时设为该段生效项。 */
  const saveSelected = async (activate: boolean): Promise<boolean> => {
    if (!dirty) {
      if (!activate) return false;
      return activateSelected();
    }
    const name = String(draft.name || '').trim().slice(0, MAX_PROMPT_TEMPLATE_NAME) || '未命名模板';
    const entry: PromptTemplateItem = { id: selected.id, name, template: String(draft.template ?? ''), builtin: false };
    const next = cloneLists();
    const b = listOf(next, activeBlockId);
    const idx = b.list.findIndex((t) => t.id === selected.id);
    if (idx >= 0) b.list[idx] = entry;
    else b.list.push(entry);
    if (activate) b.active = entry.id;
    return persist(next, activate ? `已保存并启用「${name}」` : '已保存模板', {
      select: entry.id,
      clearDraftKey: dkey,
    });
  };

  const activateSelected = async (): Promise<boolean> => {
    if (list.active === selected.id) return true;
    const next = cloneLists();
    listOf(next, activeBlockId).active = selected.id;
    return persist(next, `已启用「${selected.builtin ? '系统内置模板' : selected.name}」`, { select: selected.id });
  };

  const resetBuiltin = async () => {
    if (busy || list.active === BUILTIN_TEMPLATE_ID) return;
    const next = cloneLists();
    listOf(next, activeBlockId).active = BUILTIN_TEMPLATE_ID;
    await persist(next, '已恢复系统内置模板', { select: BUILTIN_TEMPLATE_ID });
  };

  const create = async () => {
    if (busy) return;
    const entry: PromptTemplateItem = { id: genId(), name: '新模板', template: '', builtin: false };
    const next = cloneLists();
    listOf(next, activeBlockId).list.push(entry);
    // 先落库再选中；是否启用由用户点「启用」决定
    await persist(next, '已新建模板，填写后保存，再点「启用」', { select: entry.id });
  };

  // 入参既可能是模板 id（chip 上的复制），也可能是一个点击事件
  // （按钮直接挂 onClick）——后者按“未指定”处理：取当前选中项。
  const duplicate = async (idOrEvent?: unknown) => {
    if (busy) return;
    const id = typeof idOrEvent === 'string' ? idOrEvent : '';
    const src = id ? list.list.find((t) => t.id === id) || selected : selected;
    const next = cloneLists();
    const entry: PromptTemplateItem = {
      id: genId(),
      name: `${src.name || '模板'} 副本`.slice(0, MAX_PROMPT_TEMPLATE_NAME),
      template: src.template || '',
      builtin: false,
    };
    listOf(next, activeBlockId).list.push(entry);
    await persist(next, '已复制模板', { select: entry.id });
  };

  const remove = async (id: string) => {
    if (busy) return;
    if (id === BUILTIN_TEMPLATE_ID) {
      toast('系统内置模板不可删除');
      return;
    }
    const tpl = list.list.find((t) => t.id === id) || selected;
    const ok = await dialog({
      title: '删除模板？',
      message: `将删除「${tpl.name}」，保存后不可恢复。该段的系统内置模板会保留。`,
      okText: '删除',
      danger: true,
    });
    if (!ok) return;
    const next = cloneLists();
    const b = listOf(next, activeBlockId);
    b.list = b.list.filter((t) => t.id !== id);
    if (b.active === id) b.active = BUILTIN_TEMPLATE_ID;
    await persist(next, '已删除模板，当前生效项已回落到系统内置', {
      select: b.active,
      clearDraftKey: `${activeBlockId}|${id}`,
    });
  };

  const setAppendMode = async (mode: string) => {
    if (busy || mode === state.appendMode) return;
    setBusy(true);
    try {
      // 同 persist：直接传 patch，不要套 { method, body }（#104）
      const d = await saveLocaltaskSettings({ appendMode: mode === 'plain' ? 'plain' : 'xml' });
      setState((cur) => (cur ? { ...cur, appendMode: d?.appendMode === 'plain' ? 'plain' : 'xml' } : cur));
      setPreview(null); // 追加方式变了，旧预览已不代表当前输出
      toast('已保存追加模式（全局生效）');
    } catch (e) {
      toast(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  // 拖动排序：先乐观更新本地，PUT 成功后用服务端返回的顺序位回填；失败回滚重读。
  const reorderPlugins = async (next: PluginDesc[]) => {
    const order = next.map((p) => p.id);
    setRegistry(next);
    setPreview(null); // 顺序变了，旧预览的段序已失效
    setBusy(true);
    try {
      const d = await savePromptOrder(order);
      // 服务端回填 order（数组下标 × 10）
      const returned: PluginDesc[] = d?.plugins || next;
      const byId = new Map(returned.map((p: PluginDesc) => [p.id, p]));
      setRegistry(order.map((id) => byId.get(id)!).filter(Boolean));
      toast('顺序已保存（CLI 渲染顺序同步变化）');
    } catch (e) {
      toast(String((e as Error).message || e));
      getPromptRegistry()
        .then((r) => setRegistry(r?.plugins || []))
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  // 实时预览：compose 同一链路（localtask preview 的草稿模式）。链路读的是**已保存**
  // 设置——有未保存改动时先落库再预览，避免「看到的不是正在写的」。
  const runPreview = async () => {
    if (busy) return;
    if (dirty && !builtin) {
      const ok = await saveSelected(false);
      if (!ok) return;
    }
    setBusy(true);
    try {
      const d = await previewDelivery({ id: 0, text: '（预览草稿）这是一条用于查看提示词渲染效果的任务', summary: '' });
      setPreview({
        instruction: String(d?.instruction || ''),
        segments: Array.isArray(d?.segments) ? d.segments : [],
        at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      });
      setPreviewOpen(true);
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

      <div className="ppt-split">
        <PromptRail
          slots={slots}
          activeId={activeBlockId}
          busy={busy}
          onSelect={openBlock}
          onReorder={reorderPlugins}
        />
        <PromptEditor
          plugin={plugin}
          list={list}
          selectedId={selected.id}
          draft={draft}
          dirty={dirty}
          busy={busy}
          preview={preview}
          previewOpen={previewOpen}
          total={plugins.length}
          actions={{
            onDraft: patchDraft,
            onPick: (id) => !busy && setSelectedId(id),
            onNew: create,
            onDuplicate: duplicate,
            onRemove: remove,
            onSave: () => void saveSelected(false),
            onSaveAndActivate: () => void saveSelected(true),
            onActivate: () => void activateSelected(),
            onUndo: () => clearDraft(dkey),
            onResetBuiltin: () => void resetBuiltin(),
            onPreview: () => void runPreview(),
            onTogglePreview: () => setPreviewOpen((v) => !v),
          }}
        />
      </div>
      {dialogNode}
    </div>
  );
}
