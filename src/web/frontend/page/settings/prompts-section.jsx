// 设置面板「提示词 / 模板」一栏：左 tab 悬停即切换（点击兜底），右栏编辑/新增。
// #41 交互收敛：说明文字全部删除；提示词条目默认收起成标题行，点击才展开。
//
// 三类：
//   1. 任务模板——直接改正文（文字就是模板，任务 #87）；新建任务正文必须已渲染（无裸 {{槽}}）
//   2. 回调提示词（全局）——领到任务时的收尾指令，多条
//   3. ack 完成总结提示词（全局）——agent 写完成总结的格式要求，多条
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { useToast } from '../../components/toast/index.jsx';
import { useDialog } from '../../components/popup/index.jsx';
import { useTemplates } from '../../modules/md/use-templates.js';
import { PromptItemsEditor } from '../../modules/prompts/prompt-editor.jsx';
import { renderTemplateBody } from '../../modules/prompts/placeholders.js';
import TemplateEditor from '../../components/md/template-editor.jsx';

const MAX_ITEMS = 10; // 与服务端 clampTaskSuffixList / clampAckPromptList 一致

const TABS = [
  { id: 'vars', label: '变量字典' },
  { id: 'template', label: '任务模板' },
  { id: 'suffix', label: '回调提示词' },
  { id: 'ack', label: 'ack 总结' },
  { id: 'attach', label: '附件提示词' },
  { id: 'delivery', label: '交付上下文' },
];

// ─── 变量字典（任务 #82）─────────────────────────────────────────────
//
// 所有提示词模板的占位符都聚在这一页：每份模板管什么、在哪配、能用哪些变量、
// 每个变量装的是什么。第一页放它——「先认识变量，再动手改模板」。

/** 字典表：两列（变量 / 含义），行数据驱动的纯展示。 */
function VarsTable({ rows }) {
  return (
    <div className="setp-vars-wrap">
      <table>
        <tbody>
          {rows.map(([v, desc]) => (
            <tr key={v}>
              <td>
                <code>{v}</code>
              </td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 模板清单：系统里每份提示词模板的位置与配置入口。 */
function TemplateMap() {
  const rows = [
    ['交付上下文', '任务原文之外的组 / 项目关键路径（介绍、成员、参考文件路径）', '本页「交付上下文」'],
    ['回调提示词', '领取任务后的收尾指令（可多条，按空行拼接）', '本页「回调提示词」'],
    ['ack 总结', '完成任务时写总结的格式要求', '本页「ack 总结」'],
    ['附件提示词', '交付里〔附件〕段的清单与拉取 SOP', '本页「附件提示词」'],
    ['任务模板', '新建任务的正文骨架（槽位填写）', '本页「任务模板」'],
    ['持续 get 指令', '项目开启持续 get 后追加的循环指令', '项目级设置（侧栏项目 → 持续 get）'],
    ['任务级 check 指令', '任务带时间目标（--duration）时的计时 check 要求', '系统内置：发布时固化，暂不可配'],
  ];
  return (
    <div className="setp-vars-wrap">
      <table>
        <thead>
          <tr>
            <th>模板</th>
            <th>管什么</th>
            <th>在哪配</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, what, where]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{what}</td>
              <td>{where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VarDictionary() {
  return (
    <div className="setp-vars">
      <div className="setp-note">
        所有模板共用一套占位符语法（与 Mustache 同形的子集）：<code>{'{{var}}'}</code> 取值；
        <code>{'{{#sec}}…{{/sec}}'}</code> 是段落闸门——上下文里没有这个键，整段就不出现。
        列表类变量（成员、文档、附件清单）是预拼接好的多行文本，写进模板即整块展开。
        空壳组（没有任何可交付内容的组）整段不渲染。
      </div>
      <h4>模板清单（都在哪配）</h4>
      <TemplateMap />
      <h4>通用变量（所有模板可用）</h4>
      <VarsTable
        rows={[
          ['{{task.id}}', '任务编号'],
          ['{{task.text}}', '任务正文（逐字）。交付模板含它 = 交付自包含原文'],
          ['{{source}}', '任务来源：local（本目录队列）/ global（全局共享池）'],
          ['{{summary}}', '领取方现状（wait/get --summary）'],
          ['{{cwd}}', '工作目录绝对路径'],
          ['{{name}}', '目录名'],
          ['{{params.k}} / {{k}}', '外部参数（--param k=v 平铺传入；内建同名键不被覆盖）'],
        ]}
      />
      <h4>项目 / 组（交付上下文模板）</h4>
      <VarsTable
        rows={[
          ['{{repo.name}} / {{repo.key}}', '仓库名 / 仓库 key（github.com/owner/repo）'],
          ['{{repo.intro}} / {{repo.introPath}}', '项目介绍正文 / 主篇文件路径'],
          ['{{repo.docs}}', '项目登记的补充文档清单（多行，可直接读取）'],
          ['{{#repo}}…{{/repo}}', '闸门：有项目介绍才出现'],
          ['{{group.name}} / {{group.desc}}', '组名 / 组定位（组描述）'],
          ['{{group.intro}} / {{group.introPath}}', '组介绍正文 / 主篇路径'],
          ['{{group.note}}', '本项目在组里的位置（本仓库的组内描述）'],
          ['{{group.peers}}', '组内成员清单（多行：名字 + 组内描述）'],
          ['{{group.docs}}', '组绑定参考文件清单（多行，可直接读取）'],
          ['{{groups}}', '多组归属时其余组的概览（一行一组）'],
          ['{{#group}} / {{#groupPeers}} / {{#groupDocs}}', '闸门：组在 / 有成员 / 有参考文件才出现'],
        ]}
      />
      <h4>时间目标（回调 / ack / getLoop 模板）</h4>
      <VarsTable
        rows={[
          ['{{goal.name}}', '时间目标名'],
          ['{{goal.deadline}}', '截止时刻（YYYY-MM-DD HH:mm:ss）'],
          ['{{goal.prompt}}', '任务级 check 指令原文（任务带 --duration 时固化）'],
          ['{{goal.remainingHuman}}', '人话时间：「剩 12 分钟」/「已超时 3 分钟」'],
          ['{{goal.remainingSec}} / {{goal.remainingMin}}', '剩余秒数 / 剩余分钟（向上取整，可做运算比较）'],
          ['{{goal.overtimeSec}}', '已超时秒数（未超时 = 0）'],
          ['{{goal.reached}}', '是否已到点'],
          ['{{#goal}}…{{/goal}}', '闸门：没有时间目标整段消失'],
        ]}
      />
      <h4>附件段（附件提示词模板）</h4>
      <VarsTable
        rows={[
          ['{{attach.count}}', '附件个数'],
          ['{{attach.list}}', '附件清单（多行：「- 图片 名: 本地路径 / 图床 id 与拉取命令」）'],
          ['{{attach.sync}}', '本次云端同步详情（目录 · 下载 · 跳过 · 失败）；空串 = 本次没跑同步'],
          ['{{#attachSync}}…{{/attachSync}}', '闸门：本次跑过云端同步才出现'],
        ]}
      />
    </div>
  );
}

/** 附件段提示词（任务 #82）：交付里〔附件〕段的清单与拉取 SOP，可配；空 = 内置默认。 */
function AttachTemplate() {
  const toast = useToast();
  const [text, setText] = useState(null); // null = 还没读
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/localtasks')
      .then((d) => setText(d?.settings?.attachTemplate ?? ''))
      .catch((e) => toast('读取失败：' + (e.message || e)));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (v) => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await api('/api/localtasks/setting', { method: 'PATCH', body: { attachTemplate: v ?? '' } });
      setText(d?.attachTemplate ?? '');
      toast(v && v.trim() ? '已保存附件段提示词' : '已恢复内置默认附件段');
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setp-suffix">
      <div className="setp-row">
        <span>附件段提示词（〔附件〕段的清单与拉取 SOP；空 = 内置默认，附件段不能关）</span>
        <button type="button" className="btn ghost sm" onClick={() => save(text)} disabled={busy || text === null}>
          保存
        </button>
        <button type="button" className="btn ghost sm" onClick={() => save('')} disabled={busy || text === null}>
          恢复默认
        </button>
      </div>
      <textarea
        className="setp-area"
        rows={8}
        value={text ?? ''}
        placeholder={'留空 = 用内置默认（附件清单 + 本地路径 + 拉取命令）'}
        disabled={text === null}
        onChange={(e) => setText(e.target.value)}
      />
      <details className="setp-tpl-preview">
        <summary>可用占位符（完整含义见「变量字典」页）</summary>
        <pre className="setp-tpl-preview-body">
          {'{{task.id}} {{task.text}} {{source}} {{summary}} {{cwd}} {{name}}\n{{attach.count}} 附件个数\n{{attach.list}} 附件清单（多行：路径 / 图床 id 与拉取命令）\n{{attach.sync}} 本次同步详情（空串 = 没跑云端同步）\n{{#attachSync}}…{{/attachSync}} 跑过同步才出现的段'}
        </pre>
      </details>
    </div>
  );
}

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

/**
 * 任务模板（任务 #87）：左侧点选模板，右侧**直接改正文**——
 * 「直接文字就是模板」：不再有「槽位内容」那套 {{槽位}} 填值界面，
 * 写下的文字就是模板正文，新建页拿到的也是这段文字。
 * 旧的 {{槽位}} 模板仍能正常渲染（renderTemplateBody 兜底），但不再暴露槽位概念。
 */
function TemplateBody({ openTemplates }) {
  const tpl = useTemplates();
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

  if (tpl.unsupported) {
    return <div className="setp-note">当前服务比面板旧——重启面板后才有模板功能。</div>;
  }
  if (!templates.length) {
    return <div className="setp-note">还没有模板（内置默认模板加载中…）。</div>;
  }

  const current = templates.find((t) => t.id === editingId) || null;

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
          // key=模板 id：切模板即重挂载，草稿随之重置（不跨模板保留半截改动）
          <TemplateBodyEditor key={current.id} tpl={tpl} template={current} />
        ) : (
          <div className="setp-note">从左侧选一个模板。</div>
        )}
      </div>
    </div>
  );
}

/** 模板正文编辑器（直接改文字）——草稿 + 显式保存（每次按键都存会把接口刷爆）。 */
function TemplateBodyEditor({ tpl, template }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // 草稿初始 = **渲染后的文字**（出厂骨架里的 {{槽位}} 落到正文里）——
  // 用户看到什么、存回去的就是什么：文字就是模板（任务 #87）。
  const [draft, setDraft] = useState(() =>
    renderTemplateBody(template.body || '', template.values || {}));
  const dirty = draft !== renderTemplateBody(template.body || '', template.values || {});
  // 预览 = 新建页会拿到的正文（老模板里的 {{槽位}} 仍按 values 渲染，不露标记）
  const preview = useMemo(
    () => renderTemplateBody(draft, template.values || {}),
    [draft, template.values],
  );

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await tpl.update(template.id, { body: draft });
      toast(`已保存「${template.name}」`);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="setp-row">
        <span>模板正文 · {template.name}</span>
        <span className="grow" />
        {dirty ? <span className="muted">未保存</span> : null}
        <button type="button" className="btn sm" disabled={busy || !dirty} onClick={save}>
          保存
        </button>
      </div>
      <TemplateEditor value={draft} onChange={setDraft} onSubmit={save} rows={12} />
      {preview.trim() ? (
        <details className="setp-tpl-preview">
          <summary>预览新建任务正文</summary>
          <pre className="setp-tpl-preview-body">{preview}</pre>
        </details>
      ) : null}
    </>
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
  // 第一页 = 变量字典（#82）：先认识有哪些变量，再动手改模板。
  const [tab, setTab] = useState('vars');

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
        {tab === 'vars' && <VarDictionary />}
        {tab === 'template' && <TemplateBody openTemplates={openTemplates} />}
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
        {tab === 'attach' && <AttachTemplate />}
        {tab === 'delivery' && <DeliveryTemplate />}
      </div>
    </div>
  );
}
